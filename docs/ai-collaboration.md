# Claude と Codex の自動連携

対象: `dent052/Repository` / 既定ブランチ: `master`

Claude が実装を保存して PR を作成し、同じ PR に `@codex review` を投稿して
公式 Codex ボットにレビューを依頼します。Claude のクラウドルーティンが指摘を検討し、
必要な修正を同じ PR に保存して再レビューを依頼します。

## 確認済みの範囲

2026-10-07 に [PR #2 のレビュー依頼](https://github.com/dent052/Repository/pull/2#issuecomment-6038028925)を
GitHub 連携から投稿し、公式ボットの実行と
[「重大な問題なし」という結果](https://github.com/dent052/Repository/pull/2#issuecomment-6038049571)を確認しました。
Claude 自身による依頼と、Claude Routines の修正まで通した実行は未確認です。

レビュー依頼は `CLAUDE.md` の作業ルールで行います。
Codex の設定画面で Automatic review を探す必要はありません。
ChatGPT の定期タスクも使用しません。レビューの実行はサービスの利用枠に依存します。

## 初回だけ行う設定

この変更を `master` に取り込んだ後、Claude の修正ルーティンを作成します。
ファイルを置くだけでは、Claude の定期実行は有効になりません。

[Claude の Routines](https://claude.ai/code/routines)で作成します。

- 名前: `Codex の指摘を自動修正`
- リポジトリ: `dent052/Repository`
- Instructions: [claude-routine-prompt.md](claude-routine-prompt.md) のコードブロック内
- 環境: このプロジェクトで使っているクラウド環境
- Trigger: Schedule / 毎時
- GitHub: PR・レビューの読み取り、コメント投稿、作業ブランチへの保存ができる接続

作成後に一度実行して接続を確認してください。
ルーティンは毎回新しいクラウドセッションで動き、元のチャットが閉じていても実行されます。
Routines はリサーチプレビュー機能です。利用可否は Claude のアカウントで確認してください。
この ChatGPT セッションには、Claude 側のルーティンを直接作成・有効化する操作はありません。

## 設定後の使い方

Claude に作りたい機能を依頼します。`CLAUDE.md` に従い、実装後は PR 作成と
レビュー依頼まで行います。以後の指摘確認・修正・再レビュー依頼をルーティンが担当します。
結果は GitHub の PR と Claude Routines の実行履歴で確認できます。

- 対象は `dent052` が作成した、このリポジトリ内の `claude/` ブランチから `master` への通常の PR。
- 同じコミットへのレビュー依頼はマーカーと公式ボットの結果で重複を防ぎます。
- ルーティンは不足しているレビュー依頼も補完します。
- 指摘を採用するかは Claude が判断し、見送る場合は理由を記録します。
- 修正処理は PR ごとに最大 3 回。以後の判断は人に引き継ぎます。
- PR の取り込みは人が行います。
- Claude Auto-fix と同時に有効化すると同じ PR を編集するため、この方式ではルーティンを修正担当にします。
- 元の会話履歴は転送されません。資料と PR の説明を作業の基準にします。
- 定期実行は利用枠を消費します。停止する場合は Claude のルーティンを無効にします。

## 動作確認

1. Claude に小さな実装を依頼し、PR とレビュー依頼コメントが作成されることを確認する。
2. 公式 Codex ボットのレビュー結果を確認する。
3. 具体的な指摘があれば、ルーティンが同じ PR を修正し、再レビューを依頼することを確認する。
4. 再実行して、処理済みのレビューとレビュー依頼が重複しないことを確認する。

## 公式情報

- [Codex の GitHub レビュー](https://learn.chatgpt.com/docs/third-party/github)
- [Claude のクラウドルーティン](https://code.claude.com/docs/ja/routines)
