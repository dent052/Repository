// 画面に依存しない学習ロジック（純粋関数）

export const QUIZ_SIZE = 5;
export const PASS_RATE = 0.8;
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

export function isChapterUnlocked(chapterIds, passed, id) {
  const i = chapterIds.indexOf(id);
  return i === 0 || (i > 0 && Boolean(passed[chapterIds[i - 1]]));
}

export function isPracticeUnlocked(chapterIds, passed) {
  return chapterIds.every((id) => passed[id]);
}

export function isQuizPassed(correct, total) {
  return correct / total >= PASS_RATE;
}

export function recordAnswer(stats, id, correct) {
  const s = stats[id] ?? { c: 0, w: 0, streak: 0, last: null };
  return {
    ...stats,
    [id]: {
      c: s.c + (correct ? 1 : 0),
      w: s.w + (correct ? 0 : 1),
      streak: correct ? s.streak + 1 : 0,
      last: correct,
    },
  };
}

export function weakIds(stats) {
  return Object.keys(stats).filter((id) => {
    const s = stats[id];
    return s.last === false || (s.w > 0 && s.streak < 2);
  });
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
