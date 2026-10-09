import { chapters } from "./data/chapters.js";
import { questionsA } from "./data/questions-a.js";
import { questionsB } from "./data/questions-b.js";
import { glossary } from "./data/glossary.js";
import {
  QUIZ_SIZE, MOCK_MINUTES, PASS_SCORE, shuffle, isQuizPassed, recordAnswer, buildMockExam, scoreExam,
  localDate, dueIds, predictScore, streakDays, markDay, examPlan, findTerms,
} from "./core.js";

const LABELS = "アイウエオカキクケコ";
const ICONS = { 1: "🛡️", 2: "🦠", 3: "🔑", 4: "🧱", 5: "📋", 6: "🚨", 7: "⚖️", 8: "💻", 9: "📊", 10: "🧩" };
const KEY = "sg-trainer-progress";
const MAX_EXAMS = 20;
const app = document.getElementById("app");
const allQuestions = [...questionsA, ...questionsB];
const byId = new Map(allQuestions.map((q) => [q.id, q]));
const poolOf = (ch) => (ch === 10 ? questionsB : questionsA.filter((q) => q.chapter === ch));
const chapterName = (ch) => (Number(ch) === 10 ? "科目B" : `第${ch}章 ${chapters[ch - 1].title}`);
const TERMS = glossary.map((g) => g.term);
const byTerm = new Map(glossary.map((g) => [g.term, g]));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---- 進捗の保存（localStorage、使えれば claude.ai の db にも） ----
const normalize = (p) => ({
  passed: p?.passed ?? {}, stats: p?.stats ?? {}, exams: p?.exams ?? [], days: p?.days ?? [], examDate: p?.examDate ?? null,
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

function go(next) {
  clearInterval(timerId); // 画面を離れるときはタイマーを必ず止める
  timerId = null;
  view = next;
  render();
  window.scrollTo(0, 0);
}

function startSession(kind, title, questions, extra = {}) {
  go({ name: "session", kind, title, questions, i: 0, answers: [], revealed: false, confirming: false, combo: 0, ...extra });
}

function startMock() {
  startSession("mock", "🏆 模擬試験", buildMockExam(questionsA, questionsB), { deadline: Date.now() + MOCK_MINUTES * 60000 });
}

const reviewQuestions = () => dueIds(progress.stats, localDate()).filter((id) => byId.has(id)).map((id) => byId.get(id));

function startField(ch) {
  startSession("practice", `${ICONS[ch]} ${ch === 10 ? "科目B演習" : `分野別演習: ${chapters[ch - 1].title}`}`, shuffle(poolOf(ch)));
}

// ---- 描画 ----
function render() {
  if (view.name === "home") renderHome();
  else if (view.name === "chapter") renderChapter();
  else if (view.name === "session") renderSession();
  else if (view.name === "result") renderResult();
}

function renderHome() {
  const today = localDate();
  const streak = streakDays(progress.days, today);
  const doneToday = progress.days.includes(today);
  const started = Object.keys(progress.stats).length > 0;
  const review = reviewQuestions();
  const p = predictScore(progress.stats, allQuestions);
  const unanswered = allQuestions.filter((q) => !progress.stats[q.id]).length;
  const plan = examPlan(progress.examDate, today, unanswered);
  const gap = PASS_SCORE - p.score;

  app.innerHTML = `
<header class="hero-head">
  <div><div class="eyebrow">情報セキュリティマネジメント試験</div><h1>SG 合格トレーナー</h1></div>
  <div class="streak ${doneToday ? "on" : ""}" title="連続学習日数"><span class="flame">🔥</span><b class="num">${streak}</b><small>日連続</small></div>
</header>

<section class="card meter-card pop-in">
  <div class="row between"><span class="label">合格予測メーター</span><span class="muted small">目安</span></div>
  <div class="big"><b class="num count" data-to="${p.score}">${p.score}</b><small> / 1000点</small></div>
  <div class="meter"><i style="--w:${p.score / 10}%"></i><span class="line" title="合格ライン 600点"></span></div>
  <p class="meter-msg">${gap > 0 ? `合格ラインまで <b>あと ${gap} 点</b>` : "🎉 <b>合格圏です！</b> このまま維持しよう"}</p>
  ${p.focus ? `<button class="chip" data-field="${p.focus.chapter}">${ICONS[p.focus.chapter]} ${chapterName(p.focus.chapter)} を伸ばすと <b>+${p.focus.gain}点</b> →</button>` : ""}
</section>

<section class="card review-card pop-in" style="--d:.06s">
  ${review.length
    ? `<button class="cta" data-mode="review"><span class="cta-emoji">🔁</span><span class="cta-text"><b>今日の復習</b><small>${review.length}問 が復習日です</small></span><span class="go">GO!</span></button>`
    : `<div class="done-msg"><span class="cta-emoji">${started ? "🎉" : "👋"}</span><div><b>${started ? "今日の復習はおわり！" : "まずは好きな章から解いてみよう"}</b>
       <small class="muted">${started ? "新しい問題に挑戦すると、予測点がもっと上がります" : "解いた問題は、忘れかけた頃に「今日の復習」に出てきます"}</small></div></div>`}
</section>

<section class="card exam-card pop-in" style="--d:.12s">
  <div class="row between">
    <span class="label">📅 試験日</span>
    <input type="date" id="examDate" value="${progress.examDate ?? ""}" aria-label="試験日">
  </div>
  ${plan ? (plan.daysLeft
    ? `<p class="plan">試験まで <b class="num">あと ${plan.daysLeft} 日</b>。まだ解いていない ${unanswered}問 を終えるには <b class="num">1日 ${plan.perDay}問</b> ペース</p>`
    : `<p class="plan">試験日です。がんばって！💪</p>`)
    : `<p class="muted small">試験日を入れると、1日に解く問題数の目安を出します</p>`}
</section>

<section class="card">
  <h2>📚 テキストと確認テスト</h2>
  <p class="muted small">第1章から読むのがおすすめ。どの章からでも開けます。バーは章ごとの実力です。</p>
  <ol class="chapters">
    ${chapters.map((c) => `<li>
      <button class="ch" data-chapter="${c.id}">
        <span class="ch-icon">${ICONS[c.id]}</span>
        <span class="ch-body"><span class="ch-title">${c.id}. ${c.title}</span>
          <span class="mini"><i style="--w:${Math.round(p.rates[c.id] * 100)}%"></i></span></span>
        ${progress.passed[c.id] ? '<span class="badge">合格</span>' : ""}
      </button></li>`).join("")}
  </ol>
</section>

<section class="card">
  <h2>🎯 演習</h2>
  <div class="modes">
    <button class="mode mock" data-mode="mock"><span class="mode-emoji">🏆</span><b>模擬試験</b><small>科目A 48問 + 科目B 12問 / ${MOCK_MINUTES}分</small></button>
    <button class="mode" data-field="10"><span class="mode-emoji">🧩</span><b>科目B演習</b><small>事例問題 ${questionsB.length}問</small></button>
  </div>
  <p class="label" style="margin-top:16px">分野別演習（科目A）</p>
  <div class="fields">
    ${chapters.filter((c) => c.id <= 9).map((c) => `<button data-field="${c.id}" title="${c.title}">${ICONS[c.id]} ${c.title}</button>`).join("")}
  </div>
</section>

${progress.exams.length ? `<section class="card"><h2>🏆 模擬試験の記録</h2>
  <table class="result"><tr><th>日時</th><th>得点</th><th>判定</th></tr>
  ${progress.exams.slice().reverse().map((e) => `<tr><td>${new Date(e.date).toLocaleString("ja-JP")}</td><td class="r">${e.score}</td><td>${e.score >= PASS_SCORE ? "合格圏" : "不合格圏"}</td></tr>`).join("")}
  </table></section>` : ""}
<p class="muted small">問題・解説はシラバスの出題範囲に沿って作成したオリジナルです。予測点・得点は均等配点による目安で、本番（IRT方式）とは異なります。</p>`;

  app.querySelectorAll("[data-chapter]").forEach((b) => (b.onclick = () => go({ name: "chapter", id: Number(b.dataset.chapter) })));
  app.querySelectorAll("[data-field]").forEach((b) => (b.onclick = () => startField(Number(b.dataset.field))));
  app.querySelector('[data-mode="mock"]').onclick = startMock;
  const rv = app.querySelector('[data-mode="review"]');
  if (rv) rv.onclick = () => startSession("review", "🔁 今日の復習", shuffle(reviewQuestions()));
  app.querySelector("#examDate").onchange = (e) => {
    progress.examDate = e.target.value || null;
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

function renderChapter() {
  const c = chapters[view.id - 1];
  app.innerHTML = `
<button class="back" id="home">← ホーム</button>
<article class="card text">
  <div class="eyebrow">${ICONS[c.id]} 第${c.id}章</div>
  <h1>${c.title}</h1>
  <p class="goal"><b>🎯 この章のゴール:</b> ${c.goal}</p>
  ${c.body}
</article>
<div class="row"><button class="primary" id="quiz">✏️ 確認テストを受ける（${QUIZ_SIZE}問）</button>
${progress.passed[c.id] ? '<span class="badge">合格済み</span>' : ""}</div>`;
  wrapTables();
  const text = app.querySelector(".text");
  // この章で太字にして説明している用語は、そばに説明があるので下線を付けない
  const bold = [...text.querySelectorAll("b")].map((b) => b.textContent);
  linkTerms(text, new Set(TERMS.filter((t) => bold.some((b) => b.includes(t)))));
  app.querySelector("#home").onclick = () => go({ name: "home" });
  app.querySelector("#quiz").onclick = () =>
    startSession("quiz", `${ICONS[c.id]} 第${c.id}章 確認テスト`, shuffle(poolOf(c.id)).slice(0, QUIZ_SIZE), { chapterId: c.id });
}

function questionHtml(q, picked, reveal) {
  return `
${q.scenario ? `<div class="scenario">${q.scenario}</div>` : ""}
<div class="qtext">${q.question}</div>
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

function renderSession() {
  const s = view;
  const q = s.questions[s.i];
  const picked = s.answers[s.i] ?? null;
  const mock = s.kind === "mock";
  const reveal = !mock && s.revealed;
  const ok = picked === q.answer;
  const answeredCount = s.answers.filter((a) => a != null).length;

  app.innerHTML = `
<div class="row between">
  <button class="back" id="quit">← 中断してホームへ</button>
  ${mock ? '<span class="timer" id="timer"></span>' : s.combo >= 2 ? `<span class="combo">🔥 ${s.combo} コンボ!</span>` : ""}
</div>
<section class="card qcard">
  <div class="row between">
    <span class="label">${s.title}</span>
    <span class="num muted">${s.i + 1} / ${s.questions.length}</span>
  </div>
  <div class="bar"><i style="--w:${((s.i + 1) / s.questions.length) * 100}%"></i></div>
  <div class="eyebrow">${q.chapter === 10 ? "🧩 科目B" : `${ICONS[q.chapter]} 科目A ・ 第${q.chapter}章`}</div>
  ${questionHtml(q, picked, reveal)}
  ${reveal ? `<div class="explain ${ok ? "ok" : "ng"}">
    <div class="verdict ${ok ? "ok" : "ng"}">${ok ? "⭕ 正解！" : `❌ 不正解（正解は ${LABELS[q.answer]}）`}</div>
    <p>${q.explanation}</p></div>` : ""}
</section>
<div class="row">
  ${mock ? `<button id="prev" ${s.i === 0 ? "disabled" : ""}>前の問題</button>
            <button id="next" ${s.i === s.questions.length - 1 ? "disabled" : ""}>次の問題</button>
            <button class="primary" id="finish">試験を終了する</button>`
    : reveal ? `<button class="primary next" id="next">${s.i === s.questions.length - 1 ? "結果を見る 🎊" : "次の問題 →"}</button>` : ""}
</div>
${mock ? `<section class="card">
  <div class="muted">解答済み ${answeredCount} / ${s.questions.length}</div>
  <div class="grid">${s.questions.map((_, k) =>
    `<button data-jump="${k}" class="${s.answers[k] != null ? "ans" : ""} ${k === s.i ? "cur" : ""}">${k + 1}</button>`).join("")}</div>
  ${s.confirming ? `<div class="confirm"><p>未解答が ${s.questions.length - answeredCount} 問あります。試験を終了して採点しますか？</p>
    <div class="row"><button class="primary" id="yes">終了して採点する</button><button id="no">試験に戻る</button></div></div>` : ""}
</section>` : ""}`;
  wrapTables();
  app.querySelectorAll(".explain").forEach((e) => linkTerms(e));

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
    if (s.justAnswered) {
      s.justAnswered = false;
      if (ok) burst(app.querySelector(".choice.correct"));
      app.querySelector(".explain").scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
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
  save();
  render();
}

function finishSession() {
  const s = view;
  const answers = s.questions.map((_, k) => s.answers[k] ?? null);
  const result = scoreExam(s.questions, answers);
  if (s.kind === "mock") {
    s.questions.forEach((q, k) => record(q, answers[k] === q.answer));
    progress.exams = [...progress.exams, { date: new Date().toISOString(), score: result.score }].slice(-MAX_EXAMS);
  }
  if (s.kind === "quiz" && isQuizPassed(result.correct, result.total)) progress.passed[s.chapterId] = true;
  save();
  go({ name: "result", session: s, answers, result });
}

function renderResult() {
  const { session: s, answers, result: r } = view;
  const wrong = s.questions.map((q, k) => ({ q, a: answers[k] })).filter((x) => x.a !== x.q.answer);
  const rate = Math.round((r.correct / r.total) * 100);
  let headline;
  if (s.kind === "quiz") {
    const ok = isQuizPassed(r.correct, r.total);
    headline = `<div class="result-emoji">${ok ? "🎉" : "💪"}</div><div class="verdict ${ok ? "ok" : "ng"}">${ok ? "合格！ この章はクリアです" : "あと少し！ テキストを見直して再挑戦しよう"}</div>`;
  } else if (s.kind === "mock") {
    headline = `<div class="result-emoji">${r.passed ? "🏆" : "📈"}</div><div class="score num">${r.score}<small> / 1000点</small></div>
      <div class="verdict ${r.passed ? "ok" : "ng"}">${r.passed ? "合格圏（600点以上）！" : "合格目安は600点。弱い分野を伸ばそう"}</div>`;
  } else {
    headline = `<div class="result-emoji">${rate >= 80 ? "🌟" : rate >= 60 ? "👍" : "💪"}</div><div class="verdict">${rate >= 80 ? "すばらしい！" : rate >= 60 ? "いい調子！" : "間違えた問題は、明日の復習に出てきます"}</div>`;
  }

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
  <p class="muted small">明日の「今日の復習」にもう一度出てきます。</p>
  ${wrong.map(({ q, a }) => `<details>
    <summary>${q.chapter === 10 ? "🧩 科目B" : `${ICONS[q.chapter]} 第${q.chapter}章`}: ${q.question.replace(/<[^>]+>/g, " ").slice(0, 60)}…</summary>
    ${questionHtml(q, a, true)}
    <div class="explain"><p>あなたの解答: ${a == null ? "未解答" : LABELS[a]} / 正解: ${LABELS[q.answer]}</p><p>${q.explanation}</p></div>
  </details>`).join("")}</section>` : ""}
<div class="row">
  ${s.kind === "quiz" && !progress.passed[s.chapterId] ? '<button class="primary" id="again">テキストに戻る</button>' : ""}
  <button id="home2">ホームへ</button>
</div>`;
  wrapTables();
  app.querySelectorAll(".explain").forEach((e) => linkTerms(e));
  app.querySelector("#home").onclick = app.querySelector("#home2").onclick = () => go({ name: "home" });
  const again = app.querySelector("#again");
  if (again) again.onclick = () => go({ name: "chapter", id: s.chapterId });
}

// 表を横スクロール可能な枠で包む（狭い画面対策）
function wrapTables() {
  app.querySelectorAll(".text table, .scenario table, .qtext table").forEach((t) => {
    if (t.parentElement.classList.contains("tablewrap")) return;
    const w = document.createElement("div");
    w.className = "tablewrap";
    t.replaceWith(w);
    w.append(t);
  });
}

// 用語集にある語に下線を付け、タップで意味を出せるようにする（各用語は最初の1か所だけ）
function linkTerms(root, skip = new Set()) {
  const used = new Set(skip);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("b, h1, h2, h3, th, tr > td:first-child, button, summary") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
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
      <p>${g.desc}</p><small class="muted">📖 ${chapterName(g.ch)}</small>`;
    sheet.hidden = false;
  } else if (!sheet.hidden && (!sheet.contains(e.target) || e.target.closest(".sheet-close"))) {
    sheet.hidden = true;
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") sheet.hidden = true; });

render();
connectRemote();
// インストール版（manifest のあるページ）だけ、オフライン用の Service Worker を登録する
if (document.querySelector('link[rel="manifest"]') && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* 登録できなくても通常どおり使える */ });
}
