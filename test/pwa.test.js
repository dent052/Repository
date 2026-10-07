import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { bundle } from "../build.js";

const web = (path) => new URL(`../web/${path}`, import.meta.url);
const manifest = JSON.parse(readFileSync(web("manifest.webmanifest"), "utf8"));

test("manifest は全画面で起動し、192px と 512px の maskable アイコンを持つ", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.ok(manifest.name && manifest.short_name);
  for (const size of ["192x192", "512x512"]) {
    const icon = manifest.icons.find((i) => i.sizes === size);
    assert.ok(icon, size);
    assert.match(icon.purpose, /maskable/);
    assert.ok(existsSync(web(icon.src)), icon.src);
  }
});

test("index.html は manifest を参照し、Service Worker が保存するファイルは全て存在する", () => {
  assert.match(readFileSync(web("index.html"), "utf8"), /<link rel="manifest" href="manifest.webmanifest">/);
  const files = JSON.parse(readFileSync(web("sw.js"), "utf8").match(/const FILES = (\[[\s\S]*?\]);/)[1]);
  for (const f of files.filter((f) => f !== "./")) assert.ok(existsSync(web(f)), f);
  for (const f of ["index.html", "app.js", "core.js", "data/chapters.js", "data/questions-a.js", "data/questions-b.js"]) {
    assert.ok(files.includes(f), f);
  }
});

test("1ファイル版には manifest のリンクがない（Service Worker を登録しない）", () => {
  assert.doesNotMatch(bundle(), /<link rel="manifest"/);
});
