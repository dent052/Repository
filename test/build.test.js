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
  for (const name of ["const chapters", "const questionsA", "const questionsB", "const glossary", "function buildMockExam"]) {
    assert.ok(script.includes(name), name);
  }
});

test("dist/sg-trainer.html は最新のビルド結果である", () => {
  assert.equal(readFileSync(new URL("../dist/sg-trainer.html", import.meta.url), "utf8"), html);
});

test("1ファイル版にはアイコンが data URI で埋め込まれている", () => {
  for (const rel of ["icon", "apple-touch-icon"]) {
    assert.match(html, new RegExp(`<link rel="${rel}"[^>]*href="data:image/png;base64,[A-Za-z0-9+/=]{100,}"`));
  }
});
