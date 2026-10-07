import { test } from "node:test";
import assert from "node:assert/strict";
import { chapters } from "../web/data/chapters.js";
import { questionsA } from "../web/data/questions-a.js";
import { questionsB } from "../web/data/questions-b.js";
import { QUIZ_SIZE, MOCK_A, MOCK_B } from "../web/core.js";

const all = [...questionsA, ...questionsB];

test("章は 1〜10 の連番で、本文がある", () => {
  assert.deepEqual(chapters.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const c of chapters) {
    assert.ok(c.title && c.goal && c.body.length > 500, `章${c.id} の本文が不足`);
  }
});

test("問題 ID は一意で、命名規則に従う", () => {
  assert.equal(new Set(all.map((q) => q.id)).size, all.length);
  for (const q of questionsA) assert.match(q.id, new RegExp(`^a${q.chapter}-\\d{2}$`));
  for (const q of questionsB) assert.match(q.id, /^b-\d{2}$/);
});

test("科目A は章1〜9・四肢択一", () => {
  for (const q of questionsA) {
    assert.ok(q.chapter >= 1 && q.chapter <= 9, q.id);
    assert.equal(q.choices.length, 4, q.id);
    assert.equal(q.scenario, undefined, q.id);
  }
});

test("科目B は章10・事例文つき・選択肢4〜10個", () => {
  for (const q of questionsB) {
    assert.equal(q.chapter, 10, q.id);
    assert.ok(q.scenario && q.scenario.length > 100, q.id);
    assert.ok(q.choices.length >= 4 && q.choices.length <= 10, q.id);
  }
});

test("全問題に設問・正解・解説があり、選択肢が重複しない", () => {
  for (const q of all) {
    assert.ok(q.question, q.id);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length, q.id);
    assert.ok(q.explanation && q.explanation.length >= 30, q.id);
    assert.equal(new Set(q.choices).size, q.choices.length, q.id);
  }
});

test("確認テストと模擬試験に必要な問題数がある", () => {
  for (let ch = 1; ch <= 9; ch++) {
    const n = questionsA.filter((q) => q.chapter === ch).length;
    assert.ok(n >= 25, `章${ch} は ${n} 問しかない`);
  }
  assert.ok(questionsA.length >= MOCK_A * 2);
  assert.ok(questionsB.length >= MOCK_B * 2);
});

test("正解の位置が偏らない（科目A）", () => {
  const counts = [0, 0, 0, 0];
  for (const q of questionsA) counts[q.answer]++;
  for (const n of counts) assert.ok(n >= questionsA.length * 0.15, `正解位置の分布: ${counts}`);
});
