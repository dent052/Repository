import { test } from "node:test";
import assert from "node:assert/strict";
import { questionsA } from "../web/data/questions-a.js";
import { questionsB } from "../web/data/questions-b.js";
import { glossary } from "../web/data/glossary.js";
import { pastExams, pastQuestions } from "../web/data/questions-past.js";
import { points } from "../web/data/points.js";
import { episodes } from "../web/data/episodes.js";
import { MOCK_B, MOCK_QUOTA } from "../web/core.js";

const all = [...questionsA, ...questionsB, ...pastQuestions];

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

test("模擬試験に必要な問題数がある", () => {
  for (let ch = 1; ch <= 9; ch++) {
    const n = questionsA.filter((q) => q.chapter === ch).length;
    assert.ok(n >= MOCK_QUOTA[ch] * 3, `章${ch} は模擬試験3回分に足りない`);
  }
  assert.ok(questionsB.length >= MOCK_B * 8, `科目B は ${questionsB.length} 問しかない`);
});

test("科目B の事例文は本番並みの長さ（タグを除いて800〜1,500字）", () => {
  for (const q of questionsB) {
    const n = q.scenario.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    assert.ok(n >= 800 && n <= 1500, `${q.id} の事例文は ${n} 字`);
  }
});

test("科目B には本番と同じ10択（解答群から組合せを選ぶ）問題がある", () => {
  const n = questionsB.filter((q) => q.choices.length === 10).length;
  assert.ok(n >= 6, `10択の科目B問題が ${n} 問しかない`);
});

test("正解の位置が偏らない（科目A）", () => {
  const counts = [0, 0, 0, 0];
  for (const q of questionsA) counts[q.answer]++;
  for (const n of counts) assert.ok(n >= questionsA.length * 0.15, `正解位置の分布: ${counts}`);
});

test("用語集は一意で、80字以内の説明を持ち、話・決め手の1文・解説・事例文のどこかに登場する", () => {
  const terms = glossary.map((g) => g.term);
  assert.equal(new Set(terms).size, terms.length);
  const plain = (s) => s.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&");
  const corpus = [
    ...episodes.map((e) => plain(e.intro)), ...points.map((p) => p.hook),
    ...all.map((q) => plain(q.explanation)), ...all.map((q) => plain(q.scenario ?? "")),
  ].join("\n");
  for (const g of glossary) {
    assert.ok(g.desc.length >= 10 && g.desc.length <= 80, `${g.term}: 説明の長さ ${g.desc.length}`);
    assert.ok(corpus.includes(g.term), `${g.term} がどこにも出てこない`);
  }
});

test("科目Aは選択肢の長さで正解が分からない（正解が唯一の最長である問題は3割以下）", () => {
  const exam = questionsA;
  const longest = exam.filter((q) => {
    const len = q.choices.map((c) => c.length);
    const max = Math.max(...len);
    return len[q.answer] === max && len.filter((x) => x === max).length === 1;
  });
  assert.ok(longest.length / exam.length <= 0.3, `正解が最長の問題: ${longest.length} / ${exam.length}`);
});

test("過去問は回ごとに問番号順で、ID・章・出典の情報がそろっている", () => {
  const keys = pastExams.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const e of pastExams) assert.match(e.title, /情報セキュリティマネジメント試験/);
  for (const q of pastQuestions) {
    assert.ok(keys.includes(q.exam), q.id);
    assert.equal(q.id, `p-${q.exam}-${String(q.no).padStart(2, "0")}`);
    assert.ok(q.chapter >= 1 && q.chapter <= 10, q.id);
    assert.ok(q.choices.length >= 4 && q.choices.length <= 10, q.id);
    assert.ok(q.modified === undefined || q.modified === true, q.id);
  }
  for (const key of keys) {
    const nos = pastQuestions.filter((q) => q.exam === key).map((q) => q.no);
    assert.ok(nos.length > 0, `${key} に問題がない`);
    assert.deepEqual(nos, [...nos].sort((a, b) => a - b), `${key} が問番号順でない`);
  }
});

test("新制度の公開問題（令和5〜8年度）は各回15問を全て収録している", () => {
  for (const key of ["r05", "r06", "r07", "r08"]) {
    assert.equal(pastQuestions.filter((q) => q.exam === key).length, 15, key);
  }
});

test("英字の略語を含む用語は、何の頭文字かが分かる正式名称（en）を持つ", () => {
  const names = ["PowerShell", "Emotet", "Cookie"]; // 略語ではない固有名・一般名
  for (const g of glossary.filter((g) => /[A-Z]/.test(g.term) && !names.includes(g.term))) {
    assert.ok(/[A-Za-z]{3,}/.test(g.en ?? ""), `${g.term} に正式名称がない`);
  }
});

test("問題に level を付けない（全て本番レベル）", () => {
  for (const q of all) assert.equal(q.level, undefined, q.id);
});

const byId = new Map(all.map((q) => [q.id, q]));

test("論点は一意で、決め手の1文は100字以内、問題は全て存在し論点の間で重複しない", () => {
  assert.equal(new Set(points.map((p) => p.id)).size, points.length);
  const seen = new Set();
  for (const p of points) {
    assert.ok(p.title && p.hook, p.id);
    assert.ok(p.hook.length <= 100, `${p.id}: 決め手の1文が ${p.hook.length} 字`);
    assert.ok(p.questions.length >= 1, p.id);
    for (const id of p.questions) {
      assert.ok(byId.has(id), `${p.id}: ${id} がない`);
      assert.ok(!seen.has(id), `${id} が2つの論点に入っている`);
      seen.add(id);
    }
  }
});

test("話は1からの連番で、導入と3つの結末と 8〜12問を持ち、問題は全て論点に入り話の間で重複しない", () => {
  assert.deepEqual(episodes.map((e) => e.no), episodes.map((_, i) => i + 1));
  const inPoint = new Set(points.flatMap((p) => p.questions));
  const seen = new Set();
  for (const e of episodes) {
    assert.ok(e.title && e.intro, e.no);
    assert.equal(e.endings.length, 3, `第${e.no}話の結末`);
    assert.ok(e.questions.length >= 8 && e.questions.length <= 12, `第${e.no}話は ${e.questions.length} 問`);
    for (const id of e.questions) {
      assert.ok(byId.has(id), `第${e.no}話: ${id} がない`);
      assert.ok(inPoint.has(id), `第${e.no}話: ${id} に論点がない`);
      assert.ok(!seen.has(id), `${id} が2つの話に入っている`);
      seen.add(id);
    }
  }
});
