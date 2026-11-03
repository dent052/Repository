// 画面に依存しない学習ロジック（純粋関数）

export const MOCK_A = 48;
export const MOCK_B = 12;
export const MOCK_MINUTES = 120;
export const PASS_SCORE = 600;
// 模擬試験の科目A配分（章: 問題数）。本番の内訳 セキュリティ30（章1〜6）・法務4（章7）・その他14（章8・9）に合わせる。
export const MOCK_QUOTA = { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 4, 8: 5, 9: 9 };

export function shuffle(arr, rng = Math.random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- 日付（端末の現地日付を "YYYY-MM-DD" で扱う） ----
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// ---- 間隔反復 ----
export const INTERVALS = [1, 1, 3, 7, 14, 30]; // 習熟段階 box ごとの、次の復習までの日数

export function recordAnswer(stats, id, correct, today) {
  const s = stats[id] ?? { c: 0, w: 0, box: 0 };
  const box = correct ? Math.min(s.box + 1, INTERVALS.length - 1) : 0;
  return {
    ...stats,
    [id]: {
      c: s.c + (correct ? 1 : 0),
      w: s.w + (correct ? 0 : 1),
      last: correct,
      box,
      due: addDays(today, INTERVALS[box]),
    },
  };
}

// 正解したが自信がない問題: 正解の記録は残し、習熟段階を0に戻して翌日の復習に入れる
export function markUnsure(stats, id, today) {
  return { ...stats, [id]: { ...stats[id], box: 0, due: addDays(today, INTERVALS[0]) } };
}

export function dueIds(stats, today) {
  return Object.keys(stats).filter((id) => stats[id].due <= today);
}

// ---- 合格予測 ----
const EXAM_QUOTA = { ...MOCK_QUOTA, 10: MOCK_B };
const EXAM_TOTAL = MOCK_A + MOCK_B;

export function predictScore(stats, questions) {
  const rates = {};
  for (const ch in EXAM_QUOTA) {
    const answered = questions.filter((q) => String(q.chapter) === ch && stats[q.id]);
    const right = answered.filter((q) => stats[q.id].last).length;
    rates[ch] = right / (answered.length + 5); // 解いた数が少ないうちは低めに出す
  }
  const pt = (ch, rate) => (1000 / EXAM_TOTAL) * EXAM_QUOTA[ch] * rate;
  const score = Math.round(Object.keys(EXAM_QUOTA).reduce((t, ch) => t + pt(ch, rates[ch]), 0));
  return { score, rates };
}

// ---- 連続日数 ----
export function markDay(days, today) {
  return days.includes(today) ? days : [...days, today].slice(-400);
}

// 今日（未学習なら昨日）からさかのぼって数える。1日だけの休みは7日に1回まで許す。
export function streakDays(days, today) {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let count = 0;
  let forgiven = null;
  while (true) {
    if (set.has(d)) count++;
    else if (count > 0 && set.has(addDays(d, -1)) && (!forgiven || daysBetween(d, forgiven) >= 7)) forgiven = d;
    else break;
    d = addDays(d, -1);
  }
  return count;
}

// ---- 試験日 ----
export function examPlan(examDate, today, unanswered) {
  if (!examDate) return null;
  const daysLeft = Math.max(0, daysBetween(today, examDate));
  return { daysLeft, perDay: daysLeft ? Math.ceil(unanswered / daysLeft) : 0 };
}

export function buildMockExam(questionsA, questionsB, rng = Math.random) {
  const partA = Object.entries(MOCK_QUOTA).flatMap(([ch, n]) =>
    shuffle(questionsA.filter((q) => String(q.chapter) === ch), rng).slice(0, n),
  );
  return [...partA, ...shuffle(questionsB, rng).slice(0, MOCK_B)];
}

// answers[i] は questions[i] で選んだ選択肢の添字（未回答は null）
export function scoreExam(questions, answers) {
  const byChapter = {};
  let correct = 0;
  questions.forEach((q, i) => {
    const ok = answers[i] === q.answer;
    const b = (byChapter[q.chapter] ??= { correct: 0, total: 0 });
    b.total++;
    if (ok) {
      b.correct++;
      correct++;
    }
  });
  const score = Math.round((correct / questions.length) * 1000);
  return { correct, total: questions.length, score, passed: score >= PASS_SCORE, byChapter };
}

// ---- 用語集の照合 ----
// text 中の用語を、長い用語を優先して重ならないように探す。各用語は最初の1か所だけ。
// 英字・カタカナの用語は、前後が同じ種類の文字のときは拾わない（"IPsec" の中の "IPS"、「プログラム」の中の「ログ」）。
export function findTerms(text, terms, skip = new Set()) {
  const kind = (ch) => (/[A-Za-z]/.test(ch ?? "") ? "alpha" : /[ァ-ヶー]/.test(ch ?? "") ? "kana" : null);
  const taken = [];
  const found = [];
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    if (skip.has(term)) continue;
    for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
      const end = i + term.length;
      if (kind(term[0]) && kind(term[0]) === kind(text[i - 1])) continue;
      if (kind(term.at(-1)) && kind(term.at(-1)) === kind(text[end])) continue;
      if (taken.some(([s, e]) => i < e && s < end)) continue;
      taken.push([i, end]);
      found.push({ term, start: i, end });
      break;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// ---- 話 ----
// 取り返し問題: 同じ論点で、まだこの話で出していない問題。どの話にも入っていない問題、未解答の問題を優先する
export function followUp(point, used, stats, inEpisodes) {
  const rank = (id) => (inEpisodes.has(id) ? 2 : 0) + (stats[id] ? 1 : 0);
  const rest = point.questions.filter((id) => !used.has(id));
  return rest.length ? rest.reduce((best, id) => (rank(id) < rank(best) ? id : best)) : null;
}

// 結末の段階（0 が最良）
export function endingIndex(rate) {
  return rate >= 0.8 ? 0 : rate >= 0.5 ? 1 : 2;
}
