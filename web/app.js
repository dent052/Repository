import { chapters } from "./data/chapters.js";
import { questionsA } from "./data/questions-a.js";
import { questionsB } from "./data/questions-b.js";
import {
  QUIZ_SIZE, MOCK_MINUTES, PASS_SCORE, shuffle, isChapterUnlocked, isPracticeUnlocked,
  isQuizPassed, recordAnswer, weakIds, buildMockExam, scoreExam,
} from "./core.js";

const LABELS = "アイウエオカキクケコ";
const KEY = "sg-trainer-progress";
const MAX_EXAMS = 20;
const app = document.getElementById("app");
const chapterIds = chapters.map((c) => c.id);
const byId = new Map([...questionsA, ...questionsB].map((q) => [q.id, q]));
const poolOf = (ch) => (ch === 10 ? questionsB : questionsA.filter((q) => q.chapter === ch));

// ---- 進捗の保存（localStorage、使えれば claude.ai の db にも） ----
const normalize = (p) => ({ passed: p?.passed ?? {}, stats: p?.stats ?? {}, exams: p?.exams ?? [] });
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
  go({ name: "session", kind, title, questions, i: 0, answers: [], revealed: false, confirming: false, ...extra });
}

function startMock() {
  startSession("mock", "模擬試験", buildMockExam(questionsA, questionsB), { deadline: Date.now() + MOCK_MINUTES * 60000 });
}

// ---- 描画 ----
function render() {
  if (view.name === "home") renderHome();
  else if (view.name === "chapter") renderChapter();
  else if (view.name === "session") renderSession();
  else if (view.name === "result") renderResult();
}

function renderHome() {
  const unlocked = isPracticeUnlocked(chapterIds, progress.passed);
  const stats = Object.values(progress.stats);
  const answered = stats.reduce((n, s) => n + s.c + s.w, 0);
  const correct = stats.reduce((n, s) => n + s.c, 0);
  const weak = weakIds(progress.stats).filter((id) => byId.has(id));
  const doneCount = chapterIds.filter((id) => progress.passed[id]).length;
  const last = progress.exams.at(-1);

  app.innerHTML = `
<header class="row" style="justify-content:space-between">
  <div><div class="eyebrow">情報セキュリティマネジメント試験</div><h1>SG 合格トレーナー</h1></div>
</header>
<section class="panel stats">
  <div class="stat"><span class="muted">体系学習</span><b>${doneCount}<small> / ${chapterIds.length} 章</small></b></div>
  <div class="stat"><span class="muted">解答数</span><b>${answered}</b></div>
  <div class="stat"><span class="muted">正答率</span><b>${answered ? Math.round((correct / answered) * 100) : 0}<small>%</small></b></div>
  <div class="stat"><span class="muted">直近の模擬試験</span><b>${last ? last.score : "—"}<small>${last ? " 点" : ""}</small></b></div>
</section>
<section class="panel">
  <h2>1. 体系学習</h2>
  <p class="muted">章を順に読み、確認テスト（${QUIZ_SIZE}問中${Math.ceil(QUIZ_SIZE * 0.8)}問以上）に合格すると次の章が開きます。</p>
  <ol class="chapters">
    ${chapters.map((c) => {
      const open = isChapterUnlocked(chapterIds, progress.passed, c.id);
      const pill = progress.passed[c.id] ? '<span class="pill done">合格</span>'
        : open ? '<span class="pill open">学習中</span>' : '<span class="pill lock">未開放</span>';
      return `<li><span class="no">${String(c.id).padStart(2, "0")}</span>
        <span>${open ? `<button class="back" data-chapter="${c.id}">${c.title}</button>` : `<span class="muted">${c.title}</span>`}</span>${pill}</li>`;
    }).join("")}
  </ol>
</section>
<section class="panel">
  <h2>2. 演習</h2>
  ${unlocked ? "" : '<p class="muted">全章の確認テストに合格すると開きます。</p>'}
  <div class="modes">
    <button class="mode primary" data-mode="mock" ${unlocked ? "" : "disabled"}><b>模擬試験</b><span>科目A 48問 + 科目B 12問 / ${MOCK_MINUTES}分</span></button>
    <button class="mode" data-mode="b" ${unlocked ? "" : "disabled"}><b>科目B演習</b><span class="muted">事例問題 ${questionsB.length}問</span></button>
    <button class="mode" data-mode="weak" ${unlocked && weak.length ? "" : "disabled"}><b>弱点復習</b><span class="muted">${weak.length ? `${weak.length}問` : "弱点はまだありません"}</span></button>
  </div>
  <p class="muted" style="margin-top:16px">分野別演習（科目A）</p>
  <div class="row">
    ${chapters.filter((c) => c.id <= 9).map((c) => `<button data-field="${c.id}" ${unlocked ? "" : "disabled"} title="${c.title}">${c.id}. ${c.title}</button>`).join("")}
  </div>
</section>
${progress.exams.length ? `<section class="panel"><h2>模擬試験の記録</h2>
  <table class="result"><tr><th>日時</th><th>得点</th><th>判定</th></tr>
  ${progress.exams.slice().reverse().map((e) => `<tr><td>${new Date(e.date).toLocaleString("ja-JP")}</td><td class="r">${e.score}</td><td>${e.score >= PASS_SCORE ? "合格圏" : "不合格圏"}</td></tr>`).join("")}
  </table></section>` : ""}
<p class="muted">問題・解説はシラバスの出題範囲に沿って作成したオリジナルです。得点は均等配点による目安で、本番（IRT方式）とは異なります。</p>`;

  app.querySelectorAll("[data-chapter]").forEach((b) => (b.onclick = () => go({ name: "chapter", id: Number(b.dataset.chapter) })));
  app.querySelectorAll("[data-field]").forEach((b) => (b.onclick = () => {
    const c = chapters[Number(b.dataset.field) - 1];
    startSession("practice", `分野別演習: ${c.title}`, shuffle(poolOf(c.id)));
  }));
  app.querySelector('[data-mode="mock"]').onclick = startMock;
  app.querySelector('[data-mode="b"]').onclick = () => startSession("practice", "科目B演習", shuffle(questionsB));
  app.querySelector('[data-mode="weak"]').onclick = () => startSession("practice", "弱点復習", shuffle(weak.map((id) => byId.get(id))));
}

function renderChapter() {
  const c = chapters[view.id - 1];
  app.innerHTML = `
<button class="back" id="home">← ホーム</button>
<article class="panel text">
  <div class="eyebrow">第${c.id}章</div>
  <h1>${c.title}</h1>
  <p class="goal"><b>この章のゴール:</b> ${c.goal}</p>
  ${c.body}
</article>
<div class="row"><button class="primary" id="quiz">確認テストを受ける（${QUIZ_SIZE}問）</button>
${progress.passed[c.id] ? '<span class="pill done">合格済み</span>' : ""}</div>`;
  wrapTables();
  app.querySelector("#home").onclick = () => go({ name: "home" });
  app.querySelector("#quiz").onclick = () =>
    startSession("quiz", `第${c.id}章 確認テスト`, shuffle(poolOf(c.id)).slice(0, QUIZ_SIZE), { chapterId: c.id });
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
  const answeredCount = s.answers.filter((a) => a != null).length;

  app.innerHTML = `
<div class="row" style="justify-content:space-between">
  <button class="back" id="quit">← 中断してホームへ</button>
  ${mock ? '<span class="timer" id="timer"></span>' : ""}
</div>
<section class="panel">
  <div class="row" style="justify-content:space-between">
    <span class="eyebrow">${s.title}</span>
    <span class="num muted">${s.i + 1} / ${s.questions.length}</span>
  </div>
  <div class="bar" style="margin:8px 0 16px"><i style="width:${((s.i + 1) / s.questions.length) * 100}%"></i></div>
  <div class="eyebrow">${q.chapter === 10 ? "科目B" : `科目A ・ 第${q.chapter}章`}</div>
  ${questionHtml(q, picked, reveal)}
  ${reveal ? `<div class="explain">
    <div class="verdict ${picked === q.answer ? "ok" : "ng"}">${picked === q.answer ? "正解" : `不正解（正解は ${LABELS[q.answer]}）`}</div>
    <p>${q.explanation}</p></div>` : ""}
</section>
<div class="row">
  ${mock ? `<button id="prev" ${s.i === 0 ? "disabled" : ""}>前の問題</button>
            <button id="next" ${s.i === s.questions.length - 1 ? "disabled" : ""}>次の問題</button>
            <button class="primary" id="finish">試験を終了する</button>`
    : reveal ? `<button class="primary" id="next">${s.i === s.questions.length - 1 ? "結果を見る" : "次の問題"}</button>` : ""}
</div>
${mock ? `<section class="panel">
  <div class="muted">解答済み ${answeredCount} / ${s.questions.length}</div>
  <div class="grid" style="margin-top:8px">${s.questions.map((_, k) =>
    `<button data-jump="${k}" class="${s.answers[k] != null ? "ans" : ""} ${k === s.i ? "cur" : ""}">${k + 1}</button>`).join("")}</div>
  ${s.confirming ? `<div class="confirm" style="margin-top:12px"><p>未解答が ${s.questions.length - answeredCount} 問あります。試験を終了して採点しますか？</p>
    <div class="row"><button class="primary" id="yes">終了して採点する</button><button id="no">試験に戻る</button></div></div>` : ""}
</section>` : ""}`;
  wrapTables();

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
  }
}

function tick() {
  const left = Math.max(0, view.deadline - Date.now());
  const el = document.getElementById("timer");
  if (el) {
    const m = Math.floor(left / 60000);
    el.textContent = `残り ${m}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
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
  s.revealed = true;
  progress.stats = recordAnswer(progress.stats, s.questions[s.i].id, k === s.questions[s.i].answer);
  save();
  render();
}

function finishSession() {
  const s = view;
  const answers = s.questions.map((_, k) => s.answers[k] ?? null);
  const result = scoreExam(s.questions, answers);
  if (s.kind === "mock") {
    s.questions.forEach((q, k) => (progress.stats = recordAnswer(progress.stats, q.id, answers[k] === q.answer)));
    progress.exams = [...progress.exams, { date: new Date().toISOString(), score: result.score }].slice(-MAX_EXAMS);
  }
  if (s.kind === "quiz" && isQuizPassed(result.correct, result.total)) progress.passed[s.chapterId] = true;
  save();
  go({ name: "result", session: s, answers, result });
}

function renderResult() {
  const { session: s, answers, result: r } = view;
  const wrong = s.questions.map((q, k) => ({ q, a: answers[k] })).filter((x) => x.a !== x.q.answer);
  let headline;
  if (s.kind === "quiz") {
    const ok = isQuizPassed(r.correct, r.total);
    headline = `<div class="verdict ${ok ? "ok" : "ng"}">${ok ? "合格です。次の章に進めます。" : "不合格です。テキストを復習して再挑戦しましょう。"}</div>`;
  } else if (s.kind === "mock") {
    headline = `<div class="score">${r.score}<small style="font-size:1rem"> / 1000点</small></div>
      <div class="verdict ${r.passed ? "ok" : "ng"}">${r.passed ? "合格圏（600点以上）" : "不合格圏（合格目安は600点）"}</div>`;
  } else headline = "";

  app.innerHTML = `
<button class="back" id="home">← ホーム</button>
<section class="panel">
  <div class="eyebrow">${s.title} の結果</div>
  ${headline}
  <p class="num">${r.correct} / ${r.total} 問正解（${Math.round((r.correct / r.total) * 100)}%）</p>
  ${s.kind === "mock" ? `<div class="tablewrap"><table class="result"><tr><th>分野</th><th>正解</th><th>正答率</th></tr>
    ${Object.entries(r.byChapter).map(([ch, b]) => `<tr><td>${ch === "10" ? "科目B" : `第${ch}章 ${chapters[ch - 1].title}`}</td>
      <td class="r">${b.correct}/${b.total}</td><td class="r">${Math.round((b.correct / b.total) * 100)}%</td></tr>`).join("")}
  </table></div>` : ""}
</section>
${wrong.length ? `<section class="panel"><h2>間違えた問題（${wrong.length}問）</h2>
  <p class="muted">「弱点復習」でもう一度出題されます。</p>
  ${wrong.map(({ q, a }) => `<details style="border-top:1px solid var(--line);padding:8px 0">
    <summary>${q.chapter === 10 ? "科目B" : `第${q.chapter}章`}: ${q.question.replace(/<[^>]+>/g, " ").slice(0, 60)}…</summary>
    ${questionHtml(q, a, true)}
    <div class="explain"><p>あなたの解答: ${a == null ? "未解答" : LABELS[a]} / 正解: ${LABELS[q.answer]}</p><p>${q.explanation}</p></div>
  </details>`).join("")}</section>` : ""}
<div class="row">
  ${s.kind === "quiz" && !progress.passed[s.chapterId] ? '<button class="primary" id="again">テキストに戻る</button>' : ""}
  <button id="home2">ホームへ</button>
</div>`;
  wrapTables();
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

render();
connectRemote();
