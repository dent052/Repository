import { test } from "node:test";
import assert from "node:assert/strict";
import { chapters } from "../web/data/chapters.js";
import { questionsA } from "../web/data/questions-a.js";
import { questionsB } from "../web/data/questions-b.js";
import { glossary } from "../web/data/glossary.js";
import { MOCK_A, MOCK_B, MOCK_QUOTA } from "../web/core.js";

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
    assert.ok(n >= 30, `章${ch} は ${n} 問しかない`);
    assert.ok(n >= MOCK_QUOTA[ch] * 3, `章${ch} は模擬試験3回分に足りない`);
  }
  assert.ok(questionsA.length >= MOCK_A * 3);
  assert.ok(questionsB.length >= MOCK_B * 3, `科目B は ${questionsB.length} 問しかない`);
});

test("科目B には本番と同じ10択（解答群から組合せを選ぶ）問題がある", () => {
  const n = questionsB.filter((q) => q.choices.length === 10).length;
  assert.ok(n >= 6, `10択の科目B問題が ${n} 問しかない`);
});

// 新制度の公開問題（サンプル、令和5〜8年度）で問われた論点。docs/design.md の「出題傾向」と対応する。
const examTerms = {
  1: ["不正のトライアングル", "ラベル付け", "ゼロトラスト", "状況的犯罪予防"],
  2: ["サイバーキルチェーン", "ルートキット", "ビジネスメール詐欺", "C&amp;C", "パスワードリスト攻撃",
    "DNSキャッシュポイズニング", "ランダムサブドメイン攻撃", "SEOポイズニング"],
  3: ["ハイブリッド暗号", "メッセージ認証コード", "リスクベース認証", "CAPTCHA", "チャレンジレスポンス", "CRYPTREC"],
  4: ["SPF", "プレースホルダ", "SIEM", "DMZ", "ビヘイビア法", "動的解析", "ポートスキャナ", "VDI",
    "アンチパスバック", "ホワイトボックステスト", "セキュアOS"],
  5: ["リスク特定", "リスク分析", "リスク評価", "リスク受容", "リスクレベル", "残留リスク",
    "サポートユーティリティ", "情報セキュリティ管理基準"],
  6: ["デジタルフォレンジックス", "CSIRTマテリアル", "国家サイバー統括室", "現状評価基準"],
  7: ["生存する個人", "電子署名法", "特定電子メール法", "電子計算機損壊等業務妨害", "職務著作"],
  8: ["RASIS", "デュプレックスシステム", "プロキシサーバ", "cookie", "ネットワークアドレス",
    "データウェアハウス", "データマート", "監査ログ"],
  9: ["フォローアップ", "統制活動", "サービスレベル目標", "サービス満足度", "エラープルーフ", "WBS",
    "BPM", "BPO", "RPA", "デジタイゼーション", "特性要因図", "期待値", "データクレンジング", "損益計算書"],
};

test("公開問題で問われた論点が、対応する章の学習テキストに載っている", () => {
  for (const [ch, terms] of Object.entries(examTerms)) {
    const body = chapters[ch - 1].body;
    const missing = terms.filter((t) => !body.includes(t));
    assert.deepEqual(missing, [], `第${ch}章に載っていない用語`);
  }
});

test("正解の位置が偏らない（科目A）", () => {
  const counts = [0, 0, 0, 0];
  for (const q of questionsA) counts[q.answer]++;
  for (const n of counts) assert.ok(n >= questionsA.length * 0.15, `正解位置の分布: ${counts}`);
});

test("テキストは用語を並べただけにしない（太字には一言の説明を付ける）", () => {
  const bare = [];
  for (const c of chapters) {
    for (const m of c.body.matchAll(/<(li|p)>([\s\S]*?)<\/\1>/g)) {
      const inner = m[2].replace(/<(ul|ol)>[\s\S]*$/, "");
      const terms = [...inner.matchAll(/<b>([^<]*)<\/b>/g)].map((x) => x[1]);
      const text = inner.replace(/<[^>]+>/g, "");
      if (terms.length >= 3 && terms.join("").length / text.length > 0.45) bare.push(`第${c.id}章: ${text.slice(0, 40)}`);
    }
  }
  assert.deepEqual(bare, []);
});

test("用語集は一意で、80字以内の説明と章を持ち、テキストか解説に登場する", () => {
  const terms = glossary.map((g) => g.term);
  assert.equal(new Set(terms).size, terms.length);
  const plain = (s) => s.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&");
  const corpus = [...chapters.map((c) => plain(c.body)), ...all.map((q) => plain(q.explanation))].join("\n");
  for (const g of glossary) {
    assert.ok(g.desc.length >= 10 && g.desc.length <= 80, `${g.term}: 説明の長さ ${g.desc.length}`);
    assert.ok(g.ch >= 1 && g.ch <= 10, g.term);
    assert.ok(corpus.includes(g.term), `${g.term} がどこにも出てこない`);
  }
  assert.ok(glossary.length >= 150, `用語集が ${glossary.length} 語しかない`);
});
