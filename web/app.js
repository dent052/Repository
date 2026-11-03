import { questionsA } from "./data/questions-a.js";
import { questionsB } from "./data/questions-b.js";
import { glossary, decoyWords } from "./data/glossary.js";
import { pastExams, pastQuestions } from "./data/questions-past.js";
import { points } from "./data/points.js";
import { episodes, PLANNED_EPISODES } from "./data/episodes.js";
import {
  MOCK_MINUTES, PASS_SCORE, shuffle, recordAnswer, buildMockExam, scoreExam,
  localDate, dueIds, predictScore, streakDays, markDay, examPlan, findTerms, markUnsure, followUp, endingIndex,
  acronymWords, pickDecoys,
} from "./core.js";

const LABELS = "アイウエオカキクケコ";
const CHAPTERS = {
  1: "情報セキュリティの基本", 2: "脅威と攻撃手法", 3: "暗号と認証", 4: "技術的セキュリティ対策", 5: "情報セキュリティマネジメント",
  6: "インシデント対応と組織", 7: "法務と標準・ガイドライン", 8: "テクノロジの基礎", 9: "マネジメント・ストラテジ",
};
const WHO = { s: ["柴田部長", "shibata"], o: ["経理の岡本さん", "okamoto"], m: ["システム部の三浦さん", "miura"], t: ["営業の高木さん", "takagi"] };
const KEY = "sg-trainer-progress";
const MAX_EXAMS = 20;
const REVIEW_MAX = 15;
const LEARNED_MAX = 3;
const XP_BASE = 20;
const app = document.getElementById("app");
const allQuestions = [...questionsA, ...questionsB, ...pastQuestions];
const byId = new Map(allQuestions.map((q) => [q.id, q]));
const examTitle = new Map(pastExams.map((e) => [e.key, e.title.replace("情報セキュリティマネジメント試験 ", "")]));
const pointOf = new Map(points.flatMap((p) => p.questions.map((id) => [id, p])));
const pointById = new Map(points.map((p) => [p.id, p]));
const scenesOf = (e) => e.steps.filter((x) => x.scene).map((x) => x.scene);
const questionsOf = (e) => e.steps.filter((x) => typeof x === "string");
const inEpisodes = new Set(episodes.flatMap(questionsOf));
// 論点 → それを教えた場面（ヒントで照らす）
const sceneOfPoint = new Map(episodes.flatMap((e) => scenesOf(e).flatMap((sc) => sc.points.map((p) => [p, sc]))).reverse());
const chapterName = (ch) => (Number(ch) === 10 ? "科目B" : `第${ch}章 ${CHAPTERS[ch]}`);
const TERMS = glossary.map((g) => g.term);
const byTerm = new Map(glossary.map((g) => [g.term, g]));
// 外れの候補は4文字以上の英単語だけ（"DeMilitarized" を分けた "De" のような切れ端は使わない）
const WORD_POOL = [...glossary.flatMap((g) => acronymWords(g.term, g.en) ?? []), ...decoyWords].filter((w) => /^[A-Z][a-z-]{3,}$/.test(w));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const anim = (el, frames, opts) => (reducedMotion() || !el?.animate ? null : el.animate(frames, opts));
const buzz = (pattern) => navigator.vibrate?.(pattern);
const score = () => predictScore(progress.stats, allQuestions).score;

// ---- 進捗の保存（localStorage、使えれば claude.ai の db にも） ----
const normalize = (p) => ({
  stats: p?.stats ?? {}, exams: p?.exams ?? [], days: p?.days ?? [], examDate: p?.examDate ?? null,
  ep: { next: p?.ep?.next ?? 1, results: p?.ep?.results ?? {}, cur: p?.ep?.cur ?? null },
});
let progress = normalize(readLocal());
let remote = null;
let remoteChain = Promise.resolve();
let remoteQueued = false;
let localChanged = false; // db の読み込みが終わる前に解いた記録があるか

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* 保存できない環境では保持しない */ }
  if (!remote) localChanged = true;
  if (!remote || remoteQueued) return;
  remoteQueued = true; // 書き込みは1件ずつ、待っている間の変更はまとめて1回で書く
  remoteChain = remoteChain.then(async () => {
    remoteQueued = false;
    try { await remote.set(progress); } catch { /* 次回の保存で再送される */ }
  });
}
async function connectRemote() {
  if (!window.claude?.use) return;
  const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
  const id = db && user ? await user.id() : null;
  if (!id) return;
  const ref = db.doc(`data/users/${id}/progress/main`);
  try {
    const snap = await ref.get();
    // 読み込み中に解いていたら、その進捗（解いている途中の話を含む）を優先して db に書く
    if (snap.exists && !localChanged) {
      progress = normalize(snap.data());
      if (view.name === "home") render();
    }
  } catch { return; /* db が使えなければ localStorage のみ */ }
  remote = ref;
  save(); // 最初の書き込みも通常の保存キューに載せ、書き込み中の変更も続けて送る
}

function record(q, correct) {
  const today = localDate();
  progress.stats = recordAnswer(progress.stats, q.id, correct, today);
  progress.days = markDay(progress.days, today);
}

// ---- 画面状態 ----
let view = { name: "home" };
let timerId = null;
let subPushed = false; // ホーム以外の画面用に履歴を積んだか

function go(next) {
  clearInterval(timerId); // 画面を離れるときはタイマーを必ず止める
  timerId = null;
  view = next;
  render();
  window.scrollTo(0, 0);
  // 端末の「戻る」でアプリを閉じず、ホームへ戻れるよう履歴を1つ積む
  if (next.name !== "home" && !subPushed) { history.pushState(null, ""); subPushed = true; }
  else if (next.name === "home" && subPushed) { subPushed = false; history.back(); }
}

function startSession(kind, title, questions, extra = {}) {
  go({ name: "session", kind, title, questions, i: 0, answers: [], revealed: false, confirming: false, combo: 0, best: 0, xp: 0, ...extra });
}

function startMock() {
  startSession("mock", "模擬試験", buildMockExam(questionsA, questionsB), { deadline: Date.now() + MOCK_MINUTES * 60000 });
}

const reviewQuestions = () => dueIds(progress.stats, localDate()).filter((id) => byId.has(id)).map((id) => byId.get(id));

const nextEpisode = () => episodes[progress.ep.next - 1];
// 話の手順を、保存できる文字列の並びにする（"s:0" = 場面、"g:DKIM" = 組み立て、それ以外は問題 ID）
function episodeSeq(e) {
  let n = 0;
  return e.steps.map((x) => (typeof x === "string" ? x : x.scene ? `s:${n++}` : `g:${x.game}`));
}
const validItem = (e, x) => (x.startsWith("s:") ? Number(x.slice(2)) < scenesOf(e).length : x.startsWith("g:") || byId.has(x));
// 途中の話（手順がすべて今も使えるときだけ続きから）
const currentOf = (e) => {
  const c = progress.ep.cur;
  return c?.no === e.no && Array.isArray(c.seq) && c.seq.every((x) => validItem(e, x)) ? c : null;
};

function startEpisode() {
  const e = nextEpisode();
  const cur = currentOf(e) ?? { no: e.no, seq: episodeSeq(e), follow: [], i: 0, first: {}, learned: [], before: score() };
  progress.ep.cur = cur;
  save();
  const s = { name: "session", kind: "episode", title: `第${e.no}話 ${e.title}`, ep: e, cur, i: cur.i, revealed: false, combo: 0, best: 0, xp: 0 };
  // 最後まで進めたのに結末を見ずに閉じていたら、そのまま結末へ
  if (cur.i >= cur.seq.length) { view = s; finishSession(); return; }
  go(s);
}

// ---- カギ（南京錠のマスコット）。状態: idle / ok / ng / hint ----
function kagi(state, cls = "") {
  const eye = {
    idle: (x) => `<g class="k-blink"><ellipse cx="${x}" cy="78" rx="6.5" ry="8" class="k-ink"/><circle cx="${x + 2}" cy="75" r="2.4" fill="#fff"/></g>`,
    ok: (x) => `<path d="M${x - 7} 80 q7 -10 14 0" fill="none" class="k-line"/>`,
    ng: (x, r) => `<path d="M${x + (r ? 5 : -5)} 73 l${r ? -10 : 10} 5 l${r ? 10 : -10} 5" fill="none" class="k-line"/>`,
    hint: (x) => `<ellipse cx="${x}" cy="78" rx="7.5" ry="9" class="k-ink"/><circle cx="${x + 2}" cy="75" r="3" fill="#fff"/><circle cx="${x - 2.5}" cy="81" r="1.4" fill="#fff"/>`,
  }[state];
  const mouth = state === "ok" ? `<path d="M52 92 q8 11 16 0 z" class="k-ink"/>` : `<circle cx="60" cy="95" r="3.6" class="k-ink"/><path d="M58 96 h4 l1 7 h-6z" class="k-ink"/>`;
  const fx = state === "ok" ? `<path class="k-sparkle" d="M14 34 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2z"/><path class="k-sparkle k-late" d="M102 24 l1.5 4.5 l4.5 1.5 l-4.5 1.5 l-1.5 4.5 l-1.5 -4.5 l-4.5 -1.5 l4.5 -1.5z"/>`
    : state === "ng" ? `<path class="k-drop" d="M100 52 q-5 8 0 11 q5 -3 0 -11z"/>` : "";
  return `<svg class="kagi ${cls}" viewBox="0 0 120 120" aria-hidden="true"><ellipse cx="60" cy="116" rx="30" ry="4" class="k-shadow"/>
    <g class="k-${state}"><path class="k-shackle" d="M38 56 V38 a22 22 0 0 1 44 0 V56"/>
    <rect x="20" y="50" width="80" height="62" rx="26" class="k-body"/><path d="M30 62 Q34 56 42 56" class="k-shine"/>
    ${eye(46)}${eye(74, true)}<ellipse cx="33" cy="90" rx="6" ry="4" class="k-cheek"/><ellipse cx="87" cy="90" rx="6" ry="4" class="k-cheek"/>${mouth}</g>${fx}</svg>`;
}

// ---- 描画 ----
function render() {
  if (view.name === "home") renderHome();
  else if (view.name === "session") renderSession();
  else if (view.name === "result") renderResult();
}

function renderHome() {
  const today = localDate();
  const streak = streakDays(progress.days, today);
  const review = reviewQuestions();
  const p = predictScore(progress.stats, allQuestions);
  const solved = episodes.filter((e) => progress.ep.results[e.no] != null);
  const plan = examPlan(progress.examDate, today, Math.max(0, PLANNED_EPISODES - solved.length));
  const gap = PASS_SCORE - p.score;
  const e = nextEpisode();
  const cur = e && currentOf(e);

  app.innerHTML = `
<header class="home-head">
  <h1>SG 合格トレーナー</h1>
  <span class="streak ${progress.days.includes(today) ? "on" : ""}">${streak}日連続</span>
</header>

<section class="next">
  ${e ? `${kagi("idle", "home-kagi")}
    <p class="ep-no">第${e.no}話${cur ? `　続きから（${cur.i} / ${cur.seq.length}）` : ""}</p>
    <h2 class="ep-title">${e.title}</h2>
    <button class="go" data-mode="episode">${cur ? "続きを読む" : "読み始める"}</button>`
    : `${kagi("ok", "home-kagi")}<h2 class="ep-title">公開中の話はすべて解決</h2><p class="sub">次の話は準備中です。後始末と模擬試験で力を保ちましょう。</p>`}
  ${review.length ? `<button class="go quiet" data-mode="review">後始末をする（復習 ${Math.min(review.length, REVIEW_MAX)}問）</button>` : ""}
</section>

<section class="block">
  <div class="row between"><h2>会社の安全度</h2><span class="sub">合格予測（目安）</span></div>
  <p class="score-line"><b class="num count" data-to="${p.score}">${p.score}</b> / 1000点</p>
  <div class="meter"><i style="--w:${p.score / 10}%"></i><span class="pass" title="合格ライン 600点"></span></div>
  <p class="sub">${gap > 0 ? `合格ライン 600点まで、あと ${gap}点` : "合格ラインを超えています"}</p>
</section>

<section class="block">
  <div class="row between"><h2>試験日</h2><input type="date" id="examDate" value="${progress.examDate ?? ""}" aria-label="試験日"></div>
  <p class="sub">${plan ? (plan.daysLeft
    ? `試験まであと ${plan.daysLeft}日。残り ${PLANNED_EPISODES - solved.length}話を終えるには、1日 ${plan.perDay}話のペースです。`
    : "今日は試験日です。")
    : `試験日を入れると、全${PLANNED_EPISODES}話を終えるペースを出します。`}</p>
</section>

${solved.length ? `<section class="block">
  <h2>事件ファイル</h2>
  ${solved.map((s) => `<details><summary>第${s.no}話 ${s.title}<span class="sub">正答率 ${Math.round(progress.ep.results[s.no] * 100)}%</span></summary>
    <ul class="hooks">${[...new Set(questionsOf(s).map((id) => pointOf.get(id)))].map((pt) => `<li><b>${pt.title}</b>${pt.hook}</li>`).join("")}</ul>
  </details>`).join("")}
</section>` : ""}

<section class="block">
  <h2>模擬試験</h2>
  <p class="sub">科目A 48問と科目B 12問を、本番と同じ ${MOCK_MINUTES}分で解きます。</p>
  <button class="go quiet" data-mode="mock">模擬試験を始める</button>
  ${progress.exams.length ? `<table class="records"><tr><th>日時</th><th>得点</th><th>判定</th></tr>
  ${progress.exams.slice().reverse().map((x) => `<tr><td>${new Date(x.date).toLocaleString("ja-JP")}</td><td class="r">${x.score}</td><td>${x.score >= PASS_SCORE ? "合格圏" : "不合格圏"}</td></tr>`).join("")}
  </table>` : ""}
</section>
<p class="note">物語・会社・人物は架空です。過去問以外の問題と、全ての解説・会話・決め手の1文は、シラバスの出題範囲に沿って作成したオリジナルです。過去問は IPA（独立行政法人情報処理推進機構）が公表している過去問題で、各問に出典を表示しています。予測点・得点は均等配点による目安で、本番（IRT方式）とは異なります。</p>`;

  app.querySelector('[data-mode="mock"]').onclick = startMock;
  const ep = app.querySelector('[data-mode="episode"]');
  if (ep) ep.onclick = startEpisode;
  const rv = app.querySelector('[data-mode="review"]');
  if (rv) rv.onclick = () => startSession("review", "後始末", shuffle(reviewQuestions()).slice(0, REVIEW_MAX));
  app.querySelector("#examDate").onchange = (ev) => {
    progress.examDate = ev.target.value || null;
    save();
    render();
  };
  countUp(app.querySelector(".count"));
}

// 数字を 0 から数え上げる
function countUp(el, suffix = "") {
  if (!el) return;
  const to = Number(el.dataset.to);
  if (reducedMotion()) { el.textContent = to + suffix; return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 700);
    el.textContent = Math.round(to * (1 - (1 - t) ** 3)) + suffix;
    if (t < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- 話・後始末・模擬試験の画面 ----
const itemOf = (s) => (s.kind === "episode" ? s.cur.seq[s.i] : s.questions[s.i].id);
const lengthOf = (s) => (s.kind === "episode" ? s.cur.seq.length : s.questions.length);

function topBar(s) {
  return `<div class="top">
    <button class="quit" id="quit" aria-label="中断してホームへ">✕</button>
    <div class="bar"><i style="width:${((s.i + 1) / lengthOf(s)) * 100}%"></i></div>
    ${s.kind === "mock" ? '<span class="timer" id="timer"></span>' : `<span class="chain" id="chain"${s.combo >= 3 ? "" : " hidden"}>${s.combo}重ロック</span><span class="xp" id="xp">${s.xp} XP</span>`}
  </div>`;
}

function lineHtml([who, text], lit = false) {
  if (who === "n") return `<p class="line narr">${text}</p>`;
  return `<div class="line${lit ? " lit" : ""}"><div class="name ${WHO[who][1]}">${WHO[who][0]}</div><div class="say">${text}</div></div>`;
}

function renderSession() {
  const s = view;
  const item = itemOf(s);
  if (item.startsWith("s:")) return renderScene(s, scenesOf(s.ep)[Number(item.slice(2))]);
  if (item.startsWith("g:")) return renderGame(s, item.slice(2));
  renderQuestion(s, byId.get(item));
}

// 場面: 会話はタップなしで上から順に流れて出る
function renderScene(s, sc) {
  const nextIsQuestion = byId.has(s.cur.seq[s.i + 1] ?? "");
  app.innerHTML = `${topBar(s)}<article class="scene"><p class="sub">${s.title}</p><h1>${sc.title}</h1>${sc.lines.map((l) => lineHtml(l)).join("")}</article>
    <div class="foot"><div><button class="go" id="next">${nextIsQuestion ? "読んだ。問題へ" : "次へ"}</button></div></div>`;
  linkTerms(app.querySelector(".scene"));
  app.querySelectorAll(".line").forEach((el, n) => anim(el, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: n * 120, fill: "backwards", easing: "ease-out" }));
  bindCommon();
  app.querySelector("#next").onclick = () => advance(s);
}

// 略語の組み立て: 1文字ずつ、正しい単語を3つの候補から選ぶ
function renderGame(s, term) {
  const g = byTerm.get(term);
  const words = acronymWords(term, g.en);
  s.gameAt ??= 0;
  s.gameChoices ??= {};
  const k = s.gameAt;
  const done = k >= words.length;
  if (!done) s.gameChoices[k] ??= shuffle([words[k], ...pickDecoys(words[k], WORD_POOL, 2)]);
  app.innerHTML = `${topBar(s)}<section class="game"><p class="sub">略語を組み立てる</p><h1>${term} を分解しよう</h1>
    <p class="sub">1文字ずつ、元の英単語を選んでください。</p>
    <div class="slots">${words.map((w, n) => `<div class="slot ${n < k ? "done" : n === k ? "now" : ""}"><span class="letter">${term[n]}</span>
      <span class="w">${n < k ? `${w}${g.ja ? `<br>${g.ja[n]}` : ""}` : ""}</span></div>`).join("")}</div>
    ${done ? `<p class="gist">${g.desc}</p>` : `<div class="picks">${s.gameChoices[k].map((w) => `<button class="pick">${w}</button>`).join("")}</div>`}</section>
    <div class="foot${done ? " ok" : ""}"><div>${done ? `<div class="verdict">${kagi("ok")}<div><b>組み立てた</b><small>+10 XP</small></div></div><button class="go" id="next">次へ</button>`
      : `<button class="go" disabled>文字に合う単語を選んでください</button>`}</div></div>`;
  bindCommon();
  if (done) {
    if (!s.gameScored) { s.gameScored = true; s.xp += 10; }
    app.querySelector("#next").onclick = () => { s.gameAt = undefined; s.gameChoices = undefined; s.gameScored = false; advance(s); };
    return;
  }
  app.querySelectorAll(".pick").forEach((b) => (b.onclick = () => {
    if (b.textContent === words[k]) {
      buzz(15);
      s.gameAt++;
      render();
      anim(app.querySelectorAll(".slot")[k], [{ transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
    } else {
      buzz([30, 40, 30]);
      anim(b, [0, -6, 6, -4, 4, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 280 });
    }
  }));
}

function choicesHtml(q, picked, reveal) {
  return `<ol class="choices">${q.choices.map((c, k) => {
    let cls = "";
    if (reveal && k === q.answer) cls = "ok";
    else if (reveal && k === picked) cls = "ng";
    else if (k === picked) cls = "picked";
    return `<li><button class="choice ${cls}" data-pick="${k}" ${reveal ? "disabled" : ""}><b>${LABELS[k]}</b><span>${c}</span></button></li>`;
  }).join("")}</ol>`;
}

const sourceOf = (q) => (q.exam ? `出典：${examTitle.get(q.exam)} 問${q.no}${q.modified ? "（一部改変）" : ""}` : "本番レベルの演習問題");

function renderQuestion(s, q) {
  const mock = s.kind === "mock";
  const picked = mock ? s.answers[s.i] ?? null : s.picked ?? null;
  const reveal = !mock && s.revealed;
  const ok = picked === q.answer;
  const p = pointOf.get(q.id);
  const hintScene = !mock && p && sceneOfPoint.get(p.id);
  const isFollow = s.kind === "episode" && s.cur.follow.includes(s.i);
  const answered = mock ? s.answers.filter((a) => a != null).length : 0;
  const state = reveal ? (ok ? "ok" : "ng") : s.hinted ? "hint" : "idle";

  app.innerHTML = `${topBar(s)}<section class="exam${reveal ? " revealed" : ""}">
  <div class="qhead"><p class="sub">${isFollow ? '<span class="tag">取り返しの1問</span>' : ""}${sourceOf(q)}</p>${mock ? "" : kagi(state)}</div>
  ${q.scenario ? `<div class="scenario">${q.scenario}</div>` : ""}
  <div class="ask">${q.question}</div>
  ${choicesHtml(q, picked, reveal)}
  ${hintScene && !reveal && !s.hinted ? '<button class="hint" id="hint">カギにヒントをもらう（XP が半分になります）</button>' : ""}
  ${hintScene && s.hinted ? `<div class="hintbox"><p class="sub">カギ「場面『${hintScene.title}』のここを思い出して」</p>${hintScene.lines.filter(([, t]) => t.includes("<mark>")).map((l) => lineHtml(l, true)).join("")}</div>` : ""}
  ${mock ? `<div class="grid">${s.questions.map((_, k) => `<button data-jump="${k}" class="${s.answers[k] != null ? "ans" : ""} ${k === s.i ? "cur" : ""}">${k + 1}</button>`).join("")}</div>
    <p class="sub">解答済み ${answered} / ${s.questions.length}</p>
    ${s.confirming ? `<div class="confirm"><p>未解答が ${s.questions.length - answered}問あります。試験を終了して採点しますか？</p>
      <div class="row"><button class="go" id="yes">終了して採点する</button><button class="go quiet" id="no">試験に戻る</button></div></div>` : ""}` : ""}
</section>
<div class="foot${reveal ? (ok ? " ok" : " ng") : ""}"><div>
  ${mock ? `<div class="row"><button class="go quiet" id="prev" ${s.i === 0 ? "disabled" : ""}>前へ</button><button class="go quiet" id="nextq" ${s.i === s.questions.length - 1 ? "disabled" : ""}>次へ</button></div>
    <button class="go" id="finish">試験を終了する</button>`
    : reveal ? `<div class="verdict">${kagi(ok ? "ok" : "ng")}<div><b>${ok ? "カチッ、守った" : "破られた…"}</b>
        <small>${ok ? `+${s.gain} XP${s.combo >= 5 ? "（5問連続以上で2倍）" : ""}` : `正解は ${LABELS[q.answer]}。明日の後始末にもう一度出ます`}</small></div></div>
      <div class="explain">${p ? `<p class="hook"><b>${p.title}</b>${p.hook}</p>` : ""}<p>${q.explanation}</p>
        ${s.queuedAt === s.i ? '<p class="retry">次は、同じ論点の取り返しの1問です。</p>' : ""}</div>
      <div class="row">${ok ? `<button class="go quiet small" id="unsure" ${s.unsure?.has(s.i) ? "disabled" : ""}>${s.unsure?.has(s.i) ? "明日の後始末に入れました" : "自信なし"}</button>` : ""}
        <button class="go" id="next">${s.i === lengthOf(s) - 1 ? "結果を見る" : "次へ"}</button></div>`
    : `<button class="go" disabled>答えを選んでください</button>`}
</div></div>`;
  linkTerms(app.querySelector(".ask"));
  app.querySelectorAll(".explain, .hintbox").forEach((el) => linkTerms(el));
  wrapTables();
  bindCommon();

  app.querySelectorAll("[data-pick]").forEach((b) => {
    b.onpointerdown = () => anim(b, [{ transform: "scale(1)" }, { transform: "scale(.97)" }], { duration: 90, fill: "forwards" });
    b.onclick = () => pick(Number(b.dataset.pick));
  });
  const hint = app.querySelector("#hint");
  if (hint) hint.onclick = () => { s.hinted = true; render(); anim(app.querySelector(".hintbox"), [{ opacity: 0 }, { opacity: 1 }], { duration: 240 }); };

  if (mock) {
    app.querySelector("#prev").onclick = () => move(s.i - 1);
    app.querySelector("#nextq").onclick = () => move(s.i + 1);
    app.querySelector("#finish").onclick = () => {
      if (answered === s.questions.length) finishSession();
      else { s.confirming = true; render(); }
    };
    app.querySelectorAll("[data-jump]").forEach((b) => (b.onclick = () => move(Number(b.dataset.jump))));
    if (s.confirming) {
      app.querySelector("#yes").onclick = finishSession;
      app.querySelector("#no").onclick = () => { s.confirming = false; render(); };
    }
    tick();
    if (!timerId) timerId = setInterval(tick, 1000);
    return;
  }
  if (!reveal) return;
  app.querySelector("#next").onclick = () => advance(s);
  const unsure = app.querySelector("#unsure");
  if (unsure) unsure.onclick = () => {
    progress.stats = markUnsure(progress.stats, q.id, localDate());
    save();
    (s.unsure ??= new Set()).add(s.i);
    render();
  };
  if (s.justAnswered) {
    s.justAnswered = false;
    const chosen = app.querySelector(`[data-pick="${picked}"]`);
    if (ok) {
      anim(chosen, [{ transform: "scale(.97)" }, { transform: "scale(1.02)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
      flyXP(chosen, s);
      pulseChain(s);
    } else {
      anim(chosen, [0, -6, 6, -4, 4, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 300 });
    }
    anim(app.querySelector(".foot > div"), [{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.9,.3,1)" });
  }
}

function bindCommon() {
  app.querySelector("#quit").onclick = () => go({ name: "home" });
}

// 「+20」が選んだ答えから XP の数字まで飛び、着いたら数え上がる
function flyXP(from, s) {
  const xpEl = app.querySelector("#xp");
  const shown = s.xp - s.gain;
  const finish = () => { if (xpEl.isConnected) { xpEl.dataset.to = s.xp; countFrom(xpEl, shown, s.xp); anim(xpEl, [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }], { duration: 260 }); } };
  xpEl.textContent = `${shown} XP`;
  if (reducedMotion() || !from) return finish();
  const a = from.getBoundingClientRect(), b = xpEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "fly";
  el.textContent = `+${s.gain}`;
  el.style.left = `${a.left + a.width / 2}px`;
  el.style.top = `${a.top}px`;
  document.body.append(el);
  el.animate([{ transform: "translate(-50%,0) scale(1)" }, { transform: "translate(-50%,-24px) scale(1.25)", offset: 0.3 },
    { transform: `translate(${b.left + b.width / 2 - a.left - a.width / 2 - 20}px, ${b.top - a.top}px) scale(.8)`, opacity: 0.9 }],
  { duration: 620, easing: "cubic-bezier(.5,0,.3,1)" }).finished.then(() => { el.remove(); finish(); }, () => el.remove());
}
function countFrom(el, from, to) {
  if (reducedMotion()) { el.textContent = `${to} XP`; return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 450); el.textContent = `${Math.round(from + (to - from) * (1 - (1 - k) ** 3))} XP`; if (k < 1 && el.isConnected) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// 3問連続から「◯重ロック」。5問・10問で大きく弾んで振動
function pulseChain(s) {
  const el = app.querySelector("#chain");
  if (!el || s.combo < 3) return;
  anim(el, [{ transform: "scale(1)" }, { transform: `scale(${s.combo >= 10 ? 1.5 : s.combo >= 5 ? 1.3 : 1.15})` }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
  if (s.combo === 5 || s.combo === 10) buzz([15, 40, 15]);
}

function tick() {
  const left = Math.max(0, view.deadline - Date.now());
  const el = document.getElementById("timer");
  if (el) el.textContent = `残り ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
  if (left === 0) finishSession();
}

function move(i) {
  view.i = i;
  view.confirming = false;
  render();
  window.scrollTo(0, 0);
}

function advance(s) {
  s.i++;
  s.revealed = false;
  s.picked = null;
  s.hinted = false;
  if (s.kind === "episode") { s.cur.i = s.i; save(); }
  if (s.i >= lengthOf(s)) return finishSession();
  render();
  window.scrollTo(0, 0);
}

function pick(k) {
  const s = view;
  if (s.kind === "mock") { s.answers[s.i] = k; render(); return; }
  const q = byId.get(itemOf(s));
  const ok = k === q.answer;
  s.picked = k;
  s.revealed = true;
  s.justAnswered = true;
  s.combo = ok ? s.combo + 1 : 0;
  s.best = Math.max(s.best, s.combo);
  s.gain = ok ? Math.round(XP_BASE * (s.combo >= 5 ? 2 : 1) * (s.hinted ? 0.5 : 1)) : 0;
  s.xp += s.gain;
  (s.results ??= []).push({ q, picked: k, ok });
  buzz(ok ? 15 : [40, 60, 40]);
  record(q, ok);
  if (s.kind === "episode") answerEpisode(s, q, ok);
  save();
  render();
}

// 話の1問ごとの記録。本来の問題を間違えたら、同じ論点の取り返し問題を次に差し込む（取り返し問題で間違えても重ねない）
function answerEpisode(s, q, ok) {
  const c = s.cur;
  const p = pointOf.get(q.id);
  const isFollow = c.follow.includes(s.i);
  if (!isFollow) c.first[q.id] = ok;
  if (ok && p && !c.learned.includes(p.id)) c.learned.push(p.id);
  if (!ok && !isFollow && p) {
    const f = followUp(p, new Set(c.seq), progress.stats, inEpisodes);
    if (f) {
      c.seq.splice(s.i + 1, 0, f);
      c.follow.push(s.i + 1);
      s.queuedAt = s.i;
    }
  }
  c.i = s.i + 1; // 閉じて開き直したら、次の手順から
}

function finishSession() {
  const s = view;
  let result = null;
  let episode = null;
  if (s.kind === "mock") {
    const answers = s.questions.map((_, k) => s.answers[k] ?? null);
    result = scoreExam(s.questions, answers);
    s.questions.forEach((q, k) => record(q, answers[k] === q.answer));
    progress.exams = [...progress.exams, { date: new Date().toISOString(), score: result.score }].slice(-MAX_EXAMS);
    s.results = s.questions.map((q, k) => ({ q, picked: answers[k], ok: answers[k] === q.answer }));
  }
  if (s.kind === "episode") {
    const firsts = Object.values(s.cur.first);
    const rate = firsts.length ? firsts.filter(Boolean).length / firsts.length : 0;
    episode = { rate, before: s.cur.before, after: score(), learned: s.cur.learned };
    progress.ep.results[s.ep.no] = rate;
    progress.ep.next = Math.max(progress.ep.next, s.ep.no + 1);
    progress.ep.cur = null;
  }
  save();
  go({ name: "result", session: s, result, episode });
}

// ---- 結果 ----
function renderResult() {
  const { session: s, result: r, episode } = view;
  if (episode) return renderEpisodeResult(s, episode);
  const results = s.results ?? [];
  const right = results.filter((x) => x.ok).length;
  const wrong = results.filter((x) => !x.ok);
  const rate = results.length ? Math.round((right / results.length) * 100) : 0;
  app.innerHTML = `
<section class="result">
  ${kagi(s.kind === "mock" ? (r.passed ? "ok" : "ng") : rate >= 60 ? "ok" : "ng", "big")}
  <h1>${s.title}の結果</h1>
  ${s.kind === "mock" ? `<p class="score-line"><b class="num">${r.score}</b> / 1000点　${r.passed ? "合格圏（600点以上）" : "合格の目安は600点"}</p>` : ""}
  <p>${right} / ${results.length}問正解（${rate}%）</p>
  ${s.kind === "mock" ? `<table class="records"><tr><th>分野</th><th>正解</th><th>正答率</th></tr>
    ${Object.entries(r.byChapter).map(([ch, b]) => `<tr><td>${chapterName(ch)}</td><td class="r">${b.correct}/${b.total}</td><td class="r">${Math.round((b.correct / b.total) * 100)}%</td></tr>`).join("")}
  </table>` : ""}
</section>
${wrong.length ? `<section class="block"><h2>間違えた問題（${wrong.length}問）</h2><p class="sub">明日の後始末にもう一度出ます。</p>
  ${wrong.map(({ q, picked }) => `<details><summary>${q.question.replace(/<[^>]+>/g, " ").slice(0, 60)}…</summary>
    <div class="ask">${q.question}</div>${choicesHtml(q, picked, true)}
    <div class="explain">${pointOf.has(q.id) ? `<p class="hook"><b>${pointOf.get(q.id).title}</b>${pointOf.get(q.id).hook}</p>` : ""}<p>${q.explanation}</p></div>
  </details>`).join("")}</section>` : ""}
<div class="foot"><div><button class="go" id="home">ホームへ</button></div></div>`;
  wrapTables();
  app.querySelectorAll(".explain").forEach((el) => linkTerms(el));
  app.querySelector("#home").onclick = () => go({ name: "home" });
}

// 話の結末: ここだけ順番に見せる
function renderEpisodeResult(s, { rate, before, after, learned }) {
  const level = endingIndex(rate);
  app.innerHTML = `
<section class="result">
  ${kagi(level < 2 ? "ok" : "ng", "big")}
  <h1>第${s.ep.no}話　${["解決", "なんとか収束", "苦い結末"][level]}</h1>
  <p class="ending">${s.ep.endings[level]}</p>
  <div class="stats"><div><span>正答率</span><b data-to="${Math.round(rate * 100)}">0</b></div><div><span>最高連続</span><b data-to="${s.best}">0</b></div><div><span>XP</span><b data-to="${s.xp}">0</b></div></div>
  <p class="sub">会社の安全度 ${before} → ${after}${after > before ? `（+${after - before}）` : ""}</p>
  ${learned.length ? `<div class="learned"><h2>今日わかるようになったこと</h2><ul class="hooks">${learned.slice(0, LEARNED_MAX).map((id) => pointById.get(id)).filter(Boolean)
    .map((p) => `<li><b>${p.title}</b>${p.hook}</li>`).join("")}</ul></div>` : ""}
</section>
<div class="foot"><div><button class="go" id="home">ホームへ</button></div></div>`;
  [...app.querySelectorAll(".result > *")].forEach((el, n) => anim(el, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 360, delay: 120 + n * 140, fill: "backwards", easing: "ease-out" }));
  app.querySelectorAll("[data-to]").forEach((el, n) => setTimeout(() => countUp(el, n === 0 ? "%" : ""), reducedMotion() ? 0 : 500 + n * 150));
  buzz([20, 60, 20, 60, 40]);
  app.querySelector("#home").onclick = () => go({ name: "home" });
}

// 表を横スクロール可能な枠で包む（狭い画面対策）
function wrapTables(root = app) {
  root.querySelectorAll(".scenario table, .ask table").forEach((t) => {
    if (t.parentElement.classList.contains("tablewrap")) return;
    const w = document.createElement("div");
    w.className = "tablewrap";
    t.replaceWith(w);
    w.append(t);
  });
}

// 用語集にある語に下線を付け、タップで意味を出せるようにする（各用語は最初の1か所だけ）
function linkTerms(root) {
  if (!root) return;
  const used = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("h1, h2, h3, th, tr > td:first-child, button, summary, .verdict, .name") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const found = findTerms(node.data, TERMS, used);
    if (!found.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const { term, start, end } of found) {
      used.add(term);
      frag.append(node.data.slice(pos, start));
      const b = document.createElement("button");
      b.type = "button";
      b.className = "term";
      b.dataset.term = term;
      b.textContent = node.data.slice(start, end);
      frag.append(b);
      pos = end;
    }
    frag.append(node.data.slice(pos));
    node.replaceWith(frag);
  }
}

// 用語の意味を画面下に表示する。略語は頭文字ごとに分解して見せる
const sheet = document.createElement("div");
sheet.className = "sheet";
sheet.hidden = true;
document.body.append(sheet);
function termSheet(g) {
  const words = acronymWords(g.term, g.en);
  const parts = words ? `<div class="parts">${words.map((w, n) => `<div class="part"><span class="letter">${w[0]}</span><span class="word"><b>${w[0]}</b>${w.slice(1)}${g.ja ? `<small>${g.ja[n]}</small>` : ""}</span></div>`).join("")}</div>`
    : g.en ? `<small class="en">${g.en}</small>` : "";
  return `<div class="sheet-head"><b>${g.term}</b><button type="button" class="sheet-close" aria-label="閉じる">✕</button></div>${parts}<p class="gist">${g.desc}</p>`;
}
document.addEventListener("click", (e) => {
  const t = e.target.closest?.(".term");
  if (t) {
    sheet.innerHTML = termSheet(byTerm.get(t.dataset.term));
    sheet.hidden = false;
    anim(sheet, [{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,.9,.3,1)" });
    sheet.querySelectorAll(".part").forEach((el, n) => anim(el, [{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }], { duration: 220, delay: 120 + n * 90, fill: "backwards" }));
  } else if (!sheet.hidden && (!sheet.contains(e.target) || e.target.closest(".sheet-close"))) {
    sheet.hidden = true;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sheet.hidden) sheet.hidden = true;
});

// 端末の「戻る」: ホーム以外の画面→ホーム、ホーム→通常どおり終了
window.addEventListener("popstate", () => {
  if (subPushed) { subPushed = false; go({ name: "home" }); }
});

render();
connectRemote();
// インストール版（manifest のあるページ）だけ、オフライン用の Service Worker を登録する
if (document.querySelector('link[rel="manifest"]') && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* 登録できなくても通常どおり使える */ });
}
