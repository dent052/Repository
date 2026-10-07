import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "../build.js";

const html = bundle();
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";

test("1ファイル版は外部の JS を読み込まず、import / export を含まない", () => {
  assert.doesNotMatch(html, /<script[^>]*src=/);
  assert.doesNotMatch(script, /^\s*(import|export)\b/m);
});

test("1ファイル版のスクリプトは構文として正しく、問題データを含む", () => {
  assert.doesNotThrow(() => new Function(script));
  for (const name of ["const chapters", "const questionsA", "const questionsB", "function buildMockExam"]) {
    assert.ok(script.includes(name), name);
  }
});

test("dist/sg-trainer.html は最新のビルド結果である", () => {
  assert.equal(readFileSync(new URL("../dist/sg-trainer.html", import.meta.url), "utf8"), html);
});
