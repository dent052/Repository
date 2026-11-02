import { questionsA } from "./data/questions-a.js";
import { questionsB } from "./data/questions-b.js";
import { glossary } from "./data/glossary.js";
import { pastExams, pastQuestions } from "./data/questions-past.js";
import { points } from "./data/points.js";
import { episodes, PLANNED_EPISODES } from "./data/episodes.js";
import {
  MOCK_MINUTES, PASS_SCORE, shuffle, recordAnswer, buildMockExam, scoreExam,
  localDate, dueIds, predictScore, streakDays, markDay, examPlan, findTerms, markUnsure, followUp, endingIndex,
} from "./core.js";

const LABELS = "アイウエオカキクケコ";
const ICONS = { 1: "🛡️", 2: "🦠", 3: "🔑", 4: "🧱", 5: "📋", 6: "🚨", 7: "⚖️", 8: "💻", 9: "📊", 10: "🧩" };
const CHAPTERS = {
  1: "情報セキュリティの基本", 2: "脅威と攻撃手法", 3: "暗号と認証", 4: "技術的セキュリティ対策", 5: "情報セキュリティマネジメント",
  6: "インシデント対応と組織", 7: "法務と標準・ガイドライン", 8: "テクノロジの基礎", 9: "マネジメント・ストラテジ",
};
const KEY = "sg-trainer-progress";
const MAX_EXAMS = 20;
const REVIEW_MAX = 15;
const LEARNED_MAX = 3;
const app = document.getElementById("app");
const allQuestions = [...questionsA, ...questionsB, ...pastQuestions];
const byId = new Map(allQuestions.map((q) => [q.id, q]));
const examTitle = new Map(pastExams.map((e) => [e.key, e.title]));
const pointOf = new Map(points.flatMap((p) => p.questions.map((id) => [id, p])));
const pointById = new Map(points.map((p) => [p.id, p]));
const inEpisodes = new Set(episodes.flatMap((e) => e.questions));
const chapterName = (ch) => (Number(ch) === 10 ? "科目B" : `第${ch}章 ${CHAPTERS[ch]}`);
const TERMS = glossary.map((g) => g.term);
const byTerm = new Map(glossary.map((g) => [g.term, g]));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* 保存できない環境では保持しない */ }
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
    if (snap.exists) {
      progress = normalize(snap.data());
      save();
      if (view.name === "home") render();
    } else {
      await ref.set(progress);
    }
    remote = ref;
  } catch { /* db が使えなければ localStorage のみ */ }
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
  go({ name: "session", kind, title, questions, i: 0, answers: [], revealed: false, confirming: false, combo: 0, ...extra });
}

function startMock() {
  startSession("mock", "🏆 模擬試験", buildMockExam(questionsA, questionsB), { deadline: Date.now() + MOCK_MINUTES * 60000 });
}

const reviewQuestions = () => dueIds(progress.stats, localDate()).filter((id) => byId.has(id)).map((id) => byId.get(id));

const nextEpisode = () => episodes[progress.ep.next - 1];
// 途中の話（問題がすべて残っているときだけ続きから）
const currentOf = (e) => {
  const c = progress.ep.cur;
  return c?.no === e.no && c.ids.every((id) => byId.has(id)) ? c : null;
};

function startEpisode() {
  const e = nextEpisode();
  const cur = currentOf(e) ?? { no: e.no, ids: [...e.questions], follow: [], i: 0, first: {}, learned: [], before: score() };
  progress.ep.cur = cur;
  save();
  const title = `📁 第${e.no}話 ${e.title}`;
  const questions = cur.ids.map((id) => byId.get(id));
  // 最後の問題を解いたあと結末を見ずに閉じていたら、そのまま結末へ
  if (cur.i >= questions.length) { view = { name: "session", kind: "episode", title, questions, answers: [], ep: e, cur }; finishSession(); return; }
  startSession("episode", title, questions, { ep: e, cur, i: cur.i });
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
  const doneToday = progress.days.includes(today);
  const review = reviewQuestions();
  const p = predictScore(progress.stats, allQuestions);
  const solved = episodes.filter((e) => progress.ep.results[e.no] != null);
  const plan = examPlan(progress.examDate, today, Math.max(0, PLANNED_EPISODES - solved.length));
  const gap = PASS_SCORE - p.score;
  const e = nextEpisode();
  const cur = e && currentOf(e);

  app.innerHTML = `
<header class="hero-head">
  <div><div class="eyebrow">情報セキュリティマネジメント試験</div><h1>SG 合格トレーナー</h1></div>
  <div class="streak ${doneToday ? "on" : ""}" title="連続学習日数"><span class="flame">🔥</span><b class="num">${streak}</b><small>日連続</small></div>
</header>

<section class="card review-card pop-in">
  ${review.length ? `<button class="cta clean" data-mode="review"><span class="cta-emoji">🧹</span><span class="cta-text"><b>後始末</b><small>復習日の問題 ${Math.min(review.length, REVIEW_MAX)}問</small></span><span class="go">GO!</span></button>` : ""}
  ${e
    ? `<button class="cta" data-mode="episode"><span class="cta-emoji">📁</span><span class="cta-text"><b>第${e.no}話 ${e.title}</b>
        <small>${cur ? `続きから（${cur.i} / ${cur.ids.length}問）` : "約15分"}</small></span><span class="go">GO!</span></button>`
    : `<div class="done-msg"><span class="cta-emoji">🎉</span><div><b>公開中の話はすべて解決！</b>
       <small class="muted">次の話は準備中です。後始末と模擬試験で力を保とう</small></div></div>`}
</section>

<section class="card meter-card pop-in" style="--d:.06s">
  <div class="row between"><span class="label">🏢 会社の安全度（合格予測）</span><span class="muted small">目安</span></div>
  <div class="big"><b class="num count" data-to="${p.score}">${p.score}</b><small> / 1000点</small></div>
  <div class="meter"><i style="--w:${p.score / 10}%"></i><span class="line" title="合格ライン 600点"></span></div>
  <p class="meter-msg">${gap > 0 ? `合格ラインまで <b>あと ${gap} 点</b>` : "🎉 <b>合格圏です！</b> このまま維持しよう"}</p>
</section>

<section class="card exam-card pop-in" style="--d:.12s">
  <div class="row between">
    <span class="label">📅 試験日</span>
    <input type="date" id="examDate" value="${progress.examDate ?? ""}" aria-label="試験日">
  </div>
  <p class="plan">今日の目安: <b>1話</b></p>
  ${plan ? (plan.daysLeft
    ? `<p class="plan">試験まで <b class="num">あと ${plan.daysLeft} 日</b>。残り ${PLANNED_EPISODES - solved.length}話 を終えるには <b class="num">1日 ${plan.perDay}話</b> ペース</p>`
    : `<p class="plan">試験日です。がんばって！💪</p>`)
    : `<p class="muted small">試験日を入れると、試験までに全${PLANNED_EPISODES}話を終えるペースを出します</p>`}
</section>

${solved.length ? `<section class="card">
  <h2>🗂️ 事件ファイル</h2>
  <p class="muted small">解決した事件と、そこで押さえた決め手の1文です。</p>
  ${solved.map((s) => `<details><summary>第${s.no}話 ${s.title} <span class="muted small">正答率 ${Math.round(progress.ep.results[s.no] * 100)}%</span></summary>
    <ul class="hooks">${[...new Set(s.questions.map((id) => pointOf.get(id)))].map((pt) => `<li><b>${pt.title}</b><br>${pt.hook}</li>`).join("")}</ul>
  </details>`).join("")}
</section>` : ""}

<section class="card">
  <h2>🏆 模擬試験</h2>
  <button class="mode mock" data-mode="mock"><b>本番と同じ形式で解く</b><small>科目A 48問 + 科目B 12問 / ${MOCK_MINUTES}分</small></button>
  ${progress.exams.length ? `<table class="result"><tr><th>日時</th><th>得点</th><th>判定</th></tr>
  ${progress.exams.slice().reverse().map((x) => `<tr><td>${new Date(x.date).toLocaleString("ja-JP")}</td><td class="r">${x.score}</td><td>${x.score >= PASS_SCORE ? "合格圏" : "不合格圏"}</td></tr>`).join("")}
  </table>` : ""}
</section>
<p class="muted small">物語・会社・人物は架空です。過去問以外の問題と、全ての解説・決め手の1文は、シラバスの出題範囲に沿って作成したオリジナルです。過去問は IPA（独立行政法人情報処理推進機構）が公表している過去問題で、各問に出典を表示しています。予測点・得点は均等配点による目安で、本番（IRT方式）とは異なります。</p>`;

  app.querySelector('[data-mode="mock"]').onclick = startMock;
  const ep = app.querySelector('[data-mode="episode"]');
  if (ep) ep.onclick = startEpisode;
  const rv = app.querySelector('[data-mode="review"]');
  if (rv) rv.onclick = () => startSession("review", "🧹 後始末", shuffle(reviewQuestions()).slice(0, REVIEW_MAX));
  app.querySelector("#examDate").onchange = (ev) => {
    progress.examDate = ev.target.value || null;
    save();
    render();
  };
  countUp();
}

// 予測点を 0 から数え上げる演出
function countUp() {
  const el = app.querySelector(".count");
  if (!el || reducedMotion()) return;
  const to = Number(el.dataset.to);
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 700);
    el.textContent = Math.round(to * (1 - (1 - t) ** 3));
    if (t < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function questionHtml(q, picked, reveal) {
  return `
${q.scenario ? `<div class="scenario">${q.scenario}</div>` : ""}
<div class="qtext">${q.question}</div>
${q.exam ? `<p class="src">出典：${examTitle.get(q.exam)} 問${q.no}${q.modified ? "（一部改変）" : ""}</p>` : ""}
<ol class="choices">
  ${q.choices.map((c, k) => {
    let cls = "";
    if (reveal && k === q.answer) cls = "correct";
    else if (reveal && k === picked) cls = "wrong";
    else if (k === picked) cls = "picked";
    return `<li><button class="choice ${cls}" data-pick="${k}" ${reveal ? "disabled" : ""}><span class="lab">${LABELS[k]}</span><span>${c}</span></button></li>`;
  }).join("")}
</ol>`;
}

// 解答後の表示: 判定 → 決め手の1文 → 「くわしく」（解説の全文）。論点のない問題は解説をそのまま出す
function explainHtml(q, ok, s) {
  const p = pointOf.get(q.id);
  const verdict = s.kind === "episode"
    ? (ok ? "🛡️ 防いだ！" : `💥 被害が出た…（正解は ${LABELS[q.answer]}）`)
    : (ok ? "⭕ 正解！" : `❌ 不正解（正解は ${LABELS[q.answer]}）`);
  return `<div class="explain ${ok ? "ok" : "ng"}">
  <div class="verdict ${ok ? "ok" : "ng"}">${verdict}</div>
  ${p ? `<p class="hook"><b>🔑 ${p.title}</b><br>${p.hook}</p><details><summary>くわしく</summary><p>${q.explanation}</p></details>` : `<p>${q.explanation}</p>`}
  ${s.queuedAt === s.i ? '<p class="retry">↓ 同じ論点の問題で取り返そう</p>' : ""}
</div>`;
}

function renderSession() {
  const s = view;
  const q = s.questions[s.i];
  const picked = s.answers[s.i] ?? null;
  const mock = s.kind === "mock";
  const reveal = !mock && s.revealed;
  const ok = picked === q.answer;
  const answeredCount = s.answers.filter((a) => a != null).length;
  const isFollow = s.kind === "episode" && s.cur.follow.includes(s.i);

  app.innerHTML = `
<div class="row between">
  <button class="back" id="quit">← ${s.kind === "episode" ? "中断してホームへ（続きから再開できます）" : "中断してホームへ"}</button>
  ${mock ? '<span class="timer" id="timer"></span>' : s.combo >= 2 ? `<span class="combo">🔥 ${s.combo} コンボ!</span>` : ""}
</div>
${s.kind === "episode" && s.i === 0 ? `<section class="card intro">
  <div class="eyebrow">📁 第${s.ep.no}話</div><h2>${s.ep.title}</h2>${s.ep.intro}</section>` : ""}
<section class="card qcard">
  <div class="row between">
    <span class="label">${s.title}</span>
    <span class="num muted">${s.i + 1} / ${s.questions.length}</span>
  </div>
  <div class="bar"><i style="--w:${((s.i + 1) / s.questions.length) * 100}%"></i></div>
  <div class="eyebrow">${isFollow ? '<span class="lv retry-tag">🔁 取り返しのチャンス</span> ' : ""}${q.chapter === 10 ? "🧩 科目B" : `${ICONS[q.chapter]} 科目A ・ 第${q.chapter}章`}${q.exam ? ' <span class="lv past">過去問</span>' : ""}</div>
  ${questionHtml(q, picked, reveal)}
  ${reveal ? explainHtml(q, ok, s) : ""}
</section>
<div class="row">
  ${mock ? `<button id="prev" ${s.i === 0 ? "disabled" : ""}>前の問題</button>
            <button id="next" ${s.i === s.questions.length - 1 ? "disabled" : ""}>次の問題</button>
            <button class="primary" id="finish">試験を終了する</button>`
    : reveal ? `<button class="primary next" id="next">${s.i === s.questions.length - 1 ? (s.kind === "episode" ? "事件の結末へ 📁" : "結果を見る 🎊") : "次の問題 →"}</button>
      ${ok ? `<button id="unsure" ${s.unsure?.has(s.i) ? "disabled" : ""}>${s.unsure?.has(s.i) ? "🤔 明日の後始末に入れました" : "🤔 自信なし"}</button>` : ""}` : ""}
</div>
${mock ? `<section class="card">
  <div class="muted">解答済み ${answeredCount} / ${s.questions.length}</div>
  <div class="grid">${s.questions.map((_, k) =>
    `<button data-jump="${k}" class="${s.answers[k] != null ? "ans" : ""} ${k === s.i ? "cur" : ""}">${k + 1}</button>`).join("")}</div>
  ${s.confirming ? `<div class="confirm"><p>未解答が ${s.questions.length - answeredCount} 問あります。試験を終了して採点しますか？</p>
    <div class="row"><button class="primary" id="yes">終了して採点する</button><button id="no">試験に戻る</button></div></div>` : ""}
</section>` : ""}`;
  wrapTables();
  app.querySelectorAll(".explain, .intro").forEach((e) => linkTerms(e));

  app.querySelector("#quit").onclick = () => go({ name: "home" });
  app.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => pick(Number(b.dataset.pick))));
  if (mock) {
    app.querySelector("#prev").onclick = () => move(s.i - 1);
    app.querySelector("#next").onclick = () => move(s.i + 1);
    app.querySelector("#finish").onclick = () => {
      if (answeredCount === s.questions.length) finishSession();
      else { s.confirming = true; render(); }
    };
    app.querySelectorAll("[data-jump]").forEach((b) => (b.onclick = () => move(Number(b.dataset.jump))));
    if (s.confirming) {
      app.querySelector("#yes").onclick = finishSession;
      app.querySelector("#no").onclick = () => { s.confirming = false; render(); };
    }
    tick();
    if (!timerId) timerId = setInterval(tick, 1000);
  } else if (reveal) {
    app.querySelector("#next").onclick = () => {
      if (s.i === s.questions.length - 1) finishSession();
      else { s.i++; s.revealed = false; render(); window.scrollTo(0, 0); }
    };
    const unsure = app.querySelector("#unsure");
    if (unsure) unsure.onclick = () => {
      progress.stats = markUnsure(progress.stats, q.id, localDate());
      save();
      (s.unsure ??= new Set()).add(s.i);
      render();
    };
    if (s.justAnswered) {
      s.justAnswered = false;
      if (ok) burst(app.querySelector(".choice.correct"));
      // 片手でもすぐ押せるよう、解説と「次へ」が両方見える位置まで送る
      app.querySelector("#next").scrollIntoView({ block: "end", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }
}

// 正解の選択肢から絵文字が飛び散る演出（表示が終わったら要素を消す）
function burst(target) {
  if (!target || reducedMotion()) return;
  const box = document.createElement("span");
  box.className = "burst";
  box.innerHTML = ["✨", "🎉", "⭐", "💮", "✨", "🌟", "🎊", "⭐"]
    .map((e, k) => `<i style="--a:${k * 45}deg">${e}</i>`).join("");
  target.append(box);
  setTimeout(() => box.remove(), 900);
}

function tick() {
  const left = Math.max(0, view.deadline - Date.now());
  const el = document.getElementById("timer");
  if (el) {
    const m = Math.floor(left / 60000);
    el.textContent = `⏱ 残り ${m}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
  }
  if (left === 0) finishSession();
}

function move(i) {
  view.i = i;
  view.confirming = false;
  render();
  window.scrollTo(0, 0);
}

function pick(k) {
  const s = view;
  s.answers[s.i] = k;
  if (s.kind === "mock") { render(); return; }
  const q = s.questions[s.i];
  const ok = k === q.answer;
  s.revealed = true;
  s.justAnswered = true;
  s.combo = ok ? s.combo + 1 : 0;
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
    const f = followUp(p, new Set(c.ids), progress.stats, inEpisodes);
    if (f) {
      c.ids.splice(s.i + 1, 0, f);
      c.follow.push(s.i + 1);
      s.questions.splice(s.i + 1, 0, byId.get(f));
      s.queuedAt = s.i;
    }
  }
  c.i = s.i + 1;
}

function finishSession() {
  const s = view;
  const answers = s.questions.map((_, k) => s.answers[k] ?? null);
  const result = scoreExam(s.questions, answers);
  if (s.kind === "mock") {
    s.questions.forEach((q, k) => record(q, answers[k] === q.answer));
    progress.exams = [...progress.exams, { date: new Date().toISOString(), score: result.score }].slice(-MAX_EXAMS);
  }
  let episode = null;
  if (s.kind === "episode") {
    const firsts = Object.values(s.cur.first);
    const rate = firsts.filter(Boolean).length / firsts.length;
    episode = { rate, before: s.cur.before, after: score(), learned: s.cur.learned };
    progress.ep.results[s.ep.no] = rate;
    progress.ep.next = Math.max(progress.ep.next, s.ep.no + 1);
    progress.ep.cur = null;
  }
  save();
  go({ name: "result", session: s, answers, result, episode });
}

function renderResult() {
  const { session: s, answers, result: r, episode } = view;
  if (episode) return renderEpisodeResult(s, episode);
  const wrong = s.questions.map((q, k) => ({ q, a: answers[k] })).filter((x) => x.a !== x.q.answer);
  const rate = Math.round((r.correct / r.total) * 100);
  const headline = s.kind === "mock"
    ? `<div class="result-emoji">${r.passed ? "🏆" : "📈"}</div><div class="score num">${r.score}<small> / 1000点</small></div>
      <div class="verdict ${r.passed ? "ok" : "ng"}">${r.passed ? "合格圏（600点以上）！" : "合格目安は600点。間違えた問題は後始末に出てきます"}</div>`
    : `<div class="result-emoji">${rate >= 80 ? "🌟" : rate >= 60 ? "👍" : "💪"}</div><div class="verdict">${rate >= 80 ? "すばらしい！" : rate >= 60 ? "いい調子！" : "間違えた問題は、明日の後始末に出てきます"}</div>`;

  app.innerHTML = `
<button class="back" id="home">← ホーム</button>
<section class="card result-card pop-in">
  <div class="label">${s.title} の結果</div>
  ${headline}
  <p class="num">${r.correct} / ${r.total} 問正解（${rate}%）</p>
  ${s.kind === "mock" ? `<div class="tablewrap"><table class="result"><tr><th>分野</th><th>正解</th><th>正答率</th></tr>
    ${Object.entries(r.byChapter).map(([ch, b]) => `<tr><td>${ICONS[ch]} ${chapterName(ch)}</td>
      <td class="r">${b.correct}/${b.total}</td><td class="r">${Math.round((b.correct / b.total) * 100)}%</td></tr>`).join("")}
  </table></div>` : ""}
</section>
${wrong.length ? `<section class="card"><h2>間違えた問題（${wrong.length}問）</h2>
  <p class="muted small">明日の「後始末」にもう一度出てきます。</p>
  ${wrong.map(({ q, a }) => `<details>
    <summary>${q.chapter === 10 ? "🧩 科目B" : `${ICONS[q.chapter]} 第${q.chapter}章`}: ${q.question.replace(/<[^>]+>/g, " ").slice(0, 60)}…</summary>
    ${questionHtml(q, a, true)}
    <div class="explain"><p>あなたの解答: ${a == null ? "未解答" : LABELS[a]} / 正解: ${LABELS[q.answer]}</p>
    ${pointOf.has(q.id) ? `<p class="hook"><b>🔑 ${pointOf.get(q.id).title}</b><br>${pointOf.get(q.id).hook}</p>` : ""}<p>${q.explanation}</p></div>
  </details>`).join("")}</section>` : ""}
<div class="row"><button id="home2">ホームへ</button></div>`;
  wrapTables();
  app.querySelectorAll(".explain").forEach((e) => linkTerms(e));
  app.querySelector("#home").onclick = app.querySelector("#home2").onclick = () => go({ name: "home" });
}

function renderEpisodeResult(s, { rate, before, after, learned }) {
  const level = endingIndex(rate);
  const diff = after - before;
  app.innerHTML = `
<button class="back" id="home">← ホーム</button>
<section class="card result-card pop-in">
  <div class="label">第${s.ep.no}話 ${s.ep.title}</div>
  <div class="result-emoji">${["🎉", "😮‍💨", "💪"][level]}</div>
  <div class="verdict ${level === 0 ? "ok" : level === 2 ? "ng" : ""}">${["事件解決！", "なんとか収束", "苦い結末…"][level]}</div>
  <p class="ending">${s.ep.endings[level]}</p>
  <p class="num">1回目の正答率 ${Math.round(rate * 100)}%</p>
  <p>🏢 会社の安全度 <b class="num">${before} → ${after}</b>${diff > 0 ? ` <span class="up">（+${diff}）</span>` : ""}</p>
</section>
${learned.length ? `<section class="card">
  <h2>💡 今日わかるようになったこと</h2>
  <ul class="hooks">${learned.slice(0, LEARNED_MAX).map((id) => pointById.get(id)).filter(Boolean)
    .map((p) => `<li><b>${p.title}</b><br>${p.hook}</li>`).join("")}</ul>
</section>` : ""}
<div class="row"><button class="primary" id="home2">ホームへ</button></div>`;
  app.querySelector("#home").onclick = app.querySelector("#home2").onclick = () => go({ name: "home" });
}

// 表を横スクロール可能な枠で包む（狭い画面対策）
function wrapTables(root = app) {
  root.querySelectorAll(".scenario table, .qtext table").forEach((t) => {
    if (t.parentElement.classList.contains("tablewrap")) return;
    const w = document.createElement("div");
    w.className = "tablewrap";
    t.replaceWith(w);
    w.append(t);
  });
}

// 用語集にある語に下線を付け、タップで意味を出せるようにする（各用語は最初の1か所だけ）
function linkTerms(root) {
  const used = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("h1, h2, h3, th, tr > td:first-child, button, summary, .verdict") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
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

// 用語の意味を画面下に表示する。外側をタップするか閉じるボタンで消す
const sheet = document.createElement("div");
sheet.className = "sheet";
sheet.hidden = true;
document.body.append(sheet);
document.addEventListener("click", (e) => {
  const t = e.target.closest?.(".term");
  if (t) {
    const g = byTerm.get(t.dataset.term);
    sheet.innerHTML = `<div class="sheet-head"><b>${g.term}</b><button type="button" class="sheet-close" aria-label="閉じる">✕</button></div>
      ${g.en ? `<small class="en">${g.en}</small>` : ""}<p>${g.desc}</p>`;
    sheet.hidden = false;
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
