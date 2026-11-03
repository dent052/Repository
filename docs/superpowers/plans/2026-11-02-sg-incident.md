# SG合格トレーナー 事件対応型 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 体系テキスト中心の作りをやめ、15分で終わる「事件の1話」を過去問中心に解き、間違えたら決め手の1文と取り返し問題で「わかった」で終わる形にする。

**Architecture:** 既存の静的 Web アプリ（`web/`、素の JS・ES モジュール、`core.js` は純粋関数、`app.js` は画面）をそのまま使う。データに `points.js`（論点と決め手の1文）と `episodes.js`（話）を足し、章テキスト・確認テスト・分野別演習・過去問一覧・途中再開・テキスト表示を消す。

**Tech Stack:** HTML/CSS/JS（外部パッケージなし）、`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-02-sg-incident-design.md`

## Global Constraints

- 1話は15分以内（目安10問＋取り返し数問）。片手で押せること（既存の大きな選択肢ボタンを使う）。
- 決め手の1文（`hook`）は1〜2文、80字程度まで（テストでは100字以内）。定義の羅列ではなく「目印」か「違いはここだけ」の形。
- 物語・会社・人物はオリジナル。既存作品の名前は使わない。
- 後方互換・データ移行はしない。古い `passed`・`resume` は読み捨てる。
- 実装はすべて Claude、レビューは Codex（PR に `@codex review` を投稿）。
- 最初の公開は第1〜7話。予定の総話数は30話（`PLANNED_EPISODES = 30`）。

## Review Focus

- 取り返し問題の候補がない論点（全問をすでに使った）: 取り返しを出さず、そのまま次へ進む。→ Task 1 のテスト
- 話の途中で閉じて再び開く: 同じ問題列（取り返し問題を含む）の続きから始まる。→ Task 3 で `progress.ep.cur` に ids と取り返しの位置を保存
- 全話を終えた: 「次の話は準備中」と出し、ボタンを押しても壊れない。→ Task 3
- 論点のない問題が復習に出る（模擬試験で解いた問題など）: 決め手の1文なしで、解説をそのまま表示する。→ Task 3
- 同じ問題が2つの論点に入っている: データ検査で落とす。→ Task 2 のテスト

---

### Task 1: 取り返し問題の選び方と結末の段階（core.js）

**Files:**
- Modify: `web/core.js`（`QUIZ_SIZE`・`PASS_RATE`・`isQuizPassed`・`reviewTarget`・`resumeIds` を削除）
- Test: `test/core.test.js`

**Interfaces:**
- Produces: `followUp(point: {questions: string[]}, used: Set<string>, stats: object, inEpisodes: Set<string>) -> string | null`
  — `used` に含まれない同じ論点の問題から、(1) どの話にも入っていない未解答 (2) どの話にも入っていない (3) 未解答 (4) それ以外、の順で最初のものを返す。候補がなければ `null`。
- Produces: `endingIndex(rate: number) -> 0 | 1 | 2` — 0.8 以上で 0、0.5 以上で 1、それ未満で 2。

- [ ] テスト: `followUp` が上の優先順で選ぶこと、全問 `used` なら `null`。`endingIndex(0.8)=0, (0.79)=1, (0.5)=1, (0.49)=2`。
- [ ] 失敗を確認 → 実装 → `npm test` が通る → コミット。

### Task 2: 論点と話のデータ、データ検査

**Files:**
- Create: `web/data/points.js` — `export const points = [{ id, title, hook, questions: [問題ID…] }]`
- Create: `web/data/episodes.js` — `export const PLANNED_EPISODES = 30; export const episodes = [{ no, title, intro, questions: [ID…], endings: [文, 文, 文] }]`
- Delete: `web/data/chapters.js`、`web/data/questions-a.js` の `level: "basic"` の問題（8問）と全問の `level` 項目
- Modify: `web/data/glossary.js`（どこにも出てこなくなった語を削除）
- Test: `test/data.test.js`

- [ ] テスト（`test/data.test.js`）:
  - 話は 1 から連番、`intro`・`endings`（3つ）がある。問題は 8〜12 問で、全て存在し、話の間で重複しない。
  - 話の全ての問題が、ちょうど1つの論点に入っている。論点の問題は全て存在し、論点の間で重複しない。
  - `hook` は 100 字以内。論点 ID は一意。
  - 章テキスト関連のテスト（章の本文、出題傾向の用語、太字の並べすぎ）と `level` のテストは削除。用語集の「登場する」判定の対象は、解説・事例文・`hook`・話の `intro`。
- [ ] 第1〜7話と、その論点（約45）を書く。
- [ ] `npm test` が通る → コミット。

### Task 3: 画面（app.js / index.html）

**Files:**
- Modify: `web/app.js`, `web/index.html`（CSS）, `web/sw.js`, `build.js`, `test/pwa.test.js`, `test/build.test.js`, `dist/sg-trainer.html`

**進捗の形:** `{ stats, exams, days, examDate, ep: { next: 1, results: { "1": 0.8 }, cur: { no, ids, follow: [添字], i, first: { id: bool }, learned: [論点ID] } | null } }`

- [ ] ホーム: 後始末（復習がある日だけ、最大15問）→ 次の話（または続きから／準備中）→ 会社の安全度（予測点）→ 試験日（残り日数と「残りK話 → 1日X話」）→ 事件ファイル（解決した話と、その論点の1文）→ 模擬試験と記録。
- [ ] 話: 導入 → 問題。解答後は判定・決め手の1文・「くわしく」（解説の全文、閉じた状態）。不正解で `followUp` があれば次に差し込む。1問ごとに `ep.cur` を保存。
- [ ] 結末: `endingIndex`（話の本来の問題の1回目の正誤だけ）で文を選び、正答率、わかるようになったこと（最大3つ）、安全度の変化を出す。`ep.results` と `ep.next` を更新し、`cur` を消す。
- [ ] 後始末（復習）も同じ解答表示（論点があれば1文を出す）。
- [ ] 消す: 章画面・確認テスト・分野別演習・科目B演習・過去問演習の一覧・途中再開・テキストを重ねる表示。用語の説明シートは残す（「章を読む」ボタンは消す）。
- [ ] `build.js` の連結順を `core.js → data/questions-a.js → data/questions-b.js → data/questions-past.js → data/glossary.js → data/points.js → data/episodes.js → app.js` に。`sw.js` の FILES も同じファイルに。テストの期待値を合わせる。
- [ ] `npm run build && npm test` が通る。Playwright でスマートフォン幅（390px）に第1話を通し、閉じて開き直して続きから始まることを確かめる → コミット。

### Task 4: 資料と仕上げ

- [ ] `docs/design.md` と `README.md` を新しい形に書き直す（Task 1 の前に行う。資料ファースト）。
- [ ] 不要コード・資料との矛盾がないか確認 → コミット → PR → `@codex review`（決め手の1文の事実確認も依頼）。
