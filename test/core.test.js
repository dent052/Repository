import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shuffle, isQuizPassed,
  recordAnswer, weakIds, MOCK_QUOTA, MOCK_A, buildMockExam, scoreExam,
} from "../web/core.js";

const fixedRng = () => 0;

test("shuffle は元の配列を変えず、同じ要素を返す", () => {
  const src = [1, 2, 3, 4];
  const out = shuffle(src, Math.random);
  assert.deepEqual(src, [1, 2, 3, 4]);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4]);
});

test("確認テストは80%以上で合格", () => {
  assert.equal(isQuizPassed(4, 5), true);
  assert.equal(isQuizPassed(3, 5), false);
});

test("recordAnswer は正誤と連続正解を記録し、元の stats を変えない", () => {
  const s0 = {};
  const s1 = recordAnswer(s0, "q", false);
  const s2 = recordAnswer(s1, "q", true);
  const s3 = recordAnswer(s2, "q", true);
  assert.deepEqual(s0, {});
  assert.deepEqual(s1.q, { c: 0, w: 1, streak: 0, last: false });
  assert.deepEqual(s3.q, { c: 2, w: 1, streak: 2, last: true });
});

test("weakIds は直近不正解と、間違えたことがあり2連続正解していない問題を返す", () => {
  const stats = {
    a: { c: 0, w: 1, streak: 0, last: false },
    b: { c: 1, w: 1, streak: 1, last: true },
    c: { c: 2, w: 1, streak: 2, last: true },
    d: { c: 1, w: 0, streak: 1, last: true },
  };
  assert.deepEqual(weakIds(stats).sort(), ["a", "b"]);
});

test("模擬試験の科目A配分は本番の内訳（セキュリティ30・法務4・その他14）に合わせる", () => {
  const sum = (chs) => chs.reduce((t, ch) => t + MOCK_QUOTA[ch], 0);
  assert.equal(sum([1, 2, 3, 4, 5, 6, 7, 8, 9]), MOCK_A);
  assert.equal(sum([1, 2, 3, 4, 5, 6]), 30);
  assert.equal(MOCK_QUOTA[7], 4);
  assert.equal(sum([8, 9]), 14);
});

test("buildMockExam は科目A 48問 + 科目B 12問を重複なく組む", () => {
  const qa = Array.from({ length: 108 }, (_, i) => ({ id: `a${i}`, chapter: (i % 9) + 1 }));
  const qb = Array.from({ length: 15 }, (_, i) => ({ id: `b${i}`, chapter: 10 }));
  const exam = buildMockExam(qa, qb, fixedRng);
  assert.equal(exam.length, 60);
  assert.equal(new Set(exam.map((q) => q.id)).size, 60);
  assert.equal(exam.filter((q) => q.chapter === 10).length, 12);
  assert.ok(exam.slice(0, 48).every((q) => q.chapter !== 10));
  for (let ch = 1; ch <= 9; ch++) {
    assert.equal(exam.filter((q) => q.chapter === ch).length, MOCK_QUOTA[ch], `章${ch}`);
  }
});

test("scoreExam は1000点換算で600点以上を合格とし、章別に集計する", () => {
  const qs = [
    { chapter: 1, answer: 0 }, { chapter: 1, answer: 1 },
    { chapter: 2, answer: 2 }, { chapter: 2, answer: 3 }, { chapter: 2, answer: 0 },
  ];
  const r = scoreExam(qs, [0, 1, 2, null, 1]);
  assert.equal(r.correct, 3);
  assert.equal(r.total, 5);
  assert.equal(r.score, 600);
  assert.equal(r.passed, true);
  assert.deepEqual(r.byChapter, { 1: { correct: 2, total: 2 }, 2: { correct: 1, total: 3 } });
});
