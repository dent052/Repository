import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shuffle, isQuizPassed,
  recordAnswer, MOCK_QUOTA, MOCK_A, buildMockExam, scoreExam,
  addDays, dueIds, predictScore, streakDays, markDay, examPlan, findTerms, markUnsure,
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

test("addDays は日付文字列に日数を足す（月・年をまたぐ）", () => {
  assert.equal(addDays("2026-10-07", 1), "2026-10-08");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("recordAnswer は正解で習熟段階を上げ、不正解で0に戻して次の復習日を決める", () => {
  const s0 = {};
  const s1 = recordAnswer(s0, "q", true, "2026-10-07");
  assert.deepEqual(s0, {});
  assert.deepEqual(s1.q, { c: 1, w: 0, last: true, box: 1, due: "2026-10-08" });
  const s2 = recordAnswer(s1, "q", true, "2026-10-08");
  assert.deepEqual(s2.q, { c: 2, w: 0, last: true, box: 2, due: "2026-10-11" });
  const s3 = recordAnswer(s2, "q", false, "2026-10-11");
  assert.deepEqual(s3.q, { c: 2, w: 1, last: false, box: 0, due: "2026-10-12" });
  let s = {};
  for (let i = 0; i < 8; i++) s = recordAnswer(s, "q", true, "2026-10-07");
  assert.equal(s.q.box, 5);
  assert.equal(s.q.due, "2026-11-06");
});

test("dueIds は復習日が今日以前の問題を返す", () => {
  const stats = {
    a: { due: "2026-10-06" }, b: { due: "2026-10-07" }, c: { due: "2026-10-08" },
  };
  assert.deepEqual(dueIds(stats, "2026-10-07").sort(), ["a", "b"]);
});

test("predictScore は章ごとの実力を本番の配分で重み付けし、伸ばすと効く章を示す", () => {
  assert.equal(predictScore({}, [{ id: "x", chapter: 1 }]).score, 0);
  const qs = [];
  const stats = {};
  for (let ch = 1; ch <= 10; ch++) {
    for (let i = 0; i < 15; i++) {
      const id = `${ch}-${i}`;
      qs.push({ id, chapter: ch });
      stats[id] = { last: ch === 9 ? i < 5 : true }; // 章9 だけ 5/15 正解、他は全問正解
    }
  }
  const r = predictScore(stats, qs);
  assert.equal(r.rates[1], 15 / 20);
  assert.equal(r.rates[9], 5 / 20);
  // 1000 × (51 × 0.75 + 9 × 0.25) / 60
  assert.equal(r.score, Math.round((1000 * (51 * 0.75 + 9 * 0.25)) / 60));
  assert.equal(r.focus.chapter, 9);
  assert.equal(r.focus.gain, Math.round((1000 / 60) * 9 * (0.8 - 0.25)));
});

test("streakDays は連続日数を数え、7日に1回まで1日の休みを許す", () => {
  const t = "2026-10-10";
  assert.equal(streakDays([], t), 0);
  assert.equal(streakDays(["2026-10-08", "2026-10-09", "2026-10-10"], t), 3);
  assert.equal(streakDays(["2026-10-08", "2026-10-09"], t), 2); // 今日はまだ
  assert.equal(streakDays(["2026-10-07", "2026-10-08"], t), 0); // 昨日も今日もしていない
  assert.equal(streakDays(["2026-10-06", "2026-10-07", "2026-10-09", "2026-10-10"], t), 4); // 8日の休みを許す
  assert.equal(streakDays(["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-10"], t), 3); // 2回目の休みは許さない
  assert.equal(streakDays(["2026-10-06", "2026-10-09", "2026-10-10"], t), 2); // 2日続けて休むと途切れる
});

test("markDay は学習した日を重複なく追加し、直近400日分だけ残す", () => {
  assert.deepEqual(markDay(["2026-10-06"], "2026-10-07"), ["2026-10-06", "2026-10-07"]);
  assert.deepEqual(markDay(["2026-10-07"], "2026-10-07"), ["2026-10-07"]);
  const many = Array.from({ length: 400 }, (_, i) => addDays("2025-01-01", i));
  const out = markDay(many, "2026-10-07");
  assert.equal(out.length, 400);
  assert.equal(out.at(-1), "2026-10-07");
});

test("examPlan は試験日までの残り日数と1日あたりの目安を返す", () => {
  assert.equal(examPlan(null, "2026-10-07", 100), null);
  assert.deepEqual(examPlan("2026-10-17", "2026-10-07", 95), { daysLeft: 10, perDay: 10 });
  assert.deepEqual(examPlan("2026-10-07", "2026-10-07", 95), { daysLeft: 0, perDay: 0 });
  assert.deepEqual(examPlan("2026-10-01", "2026-10-07", 95), { daysLeft: 0, perDay: 0 });
});

test("模擬試験の科目A配分は本番の内訳（セキュリティ30・法務4・その他14）に合わせる", () => {
  const sum = (chs) => chs.reduce((t, ch) => t + MOCK_QUOTA[ch], 0);
  assert.equal(sum([1, 2, 3, 4, 5, 6, 7, 8, 9]), MOCK_A);
  assert.equal(sum([1, 2, 3, 4, 5, 6]), 30);
  assert.equal(MOCK_QUOTA[7], 4);
  assert.equal(sum([8, 9]), 14);
});

test("buildMockExam は本番レベルの科目A 48問 + 科目B 12問を重複なく組む", () => {
  const qa = Array.from({ length: 216 }, (_, i) => ({ id: `a${i}`, chapter: (i % 9) + 1, level: i < 108 ? "exam" : "basic" }));
  const qb = Array.from({ length: 15 }, (_, i) => ({ id: `b${i}`, chapter: 10 }));
  const exam = buildMockExam(qa, qb, fixedRng);
  assert.equal(exam.length, 60);
  assert.equal(new Set(exam.map((q) => q.id)).size, 60);
  assert.equal(exam.filter((q) => q.chapter === 10).length, 12);
  assert.ok(exam.slice(0, 48).every((q) => q.chapter !== 10));
  for (let ch = 1; ch <= 9; ch++) {
    assert.equal(exam.filter((q) => q.chapter === ch).length, MOCK_QUOTA[ch], `章${ch}`);
  }
  assert.ok(exam.slice(0, 48).every((q) => q.level === "exam"));
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

test("findTerms は長い用語を優先し、各用語の最初の1か所だけを重ならずに返す", () => {
  const terms = ["DNS", "DNSキャッシュポイズニング", "キャッシュ"];
  const text = "DNSキャッシュポイズニングはDNSのキャッシュを汚す。DNSは名前解決。";
  assert.deepEqual(findTerms(text, terms).map((m) => [m.term, m.start]), [
    ["DNSキャッシュポイズニング", 0],
    ["DNS", 15],
    ["キャッシュ", 19],
  ]);
});

test("findTerms は英字の用語を、前後が英字のときは拾わない", () => {
  assert.deepEqual(findTerms("IPsec と IPS", ["IPS"]).map((m) => m.start), [8]);
  assert.deepEqual(findTerms("IDS/IPS", ["IDS", "IPS"]).map((m) => m.term), ["IDS", "IPS"]);
});

test("findTerms は skip に含まれる用語を拾わない", () => {
  assert.deepEqual(findTerms("SPF と DKIM", ["SPF", "DKIM"], new Set(["SPF"])).map((m) => m.term), ["DKIM"]);
});

test("findTerms はカタカナの用語を、前後がカタカナのときは拾わない", () => {
  assert.deepEqual(findTerms("プログラムのログ", ["ログ"]).map((m) => m.start), [6]);
  assert.deepEqual(findTerms("キャッシュサーバ", ["キャッシュ"]), []);
  assert.deepEqual(findTerms("ログを取る", ["ログ"]).map((m) => m.start), [0]);
});

test("markUnsure は正解の記録を残したまま、習熟段階を0に戻して翌日の復習に入れる", () => {
  const s1 = recordAnswer(recordAnswer({}, "q", true, "2026-10-07"), "q", true, "2026-10-08");
  const s2 = markUnsure(s1, "q", "2026-10-08");
  assert.deepEqual(s2.q, { c: 2, w: 0, last: true, box: 0, due: "2026-10-09" });
  assert.equal(s1.q.box, 2);
});
