// web/ の HTML・JS・問題データを1つの HTML ファイルにまとめる（file:// で開けるようにモジュールを使わない）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(`web/${path}`, import.meta.url), "utf8");
const icon = () => `data:image/png;base64,${readFileSync(new URL("web/icon-192.png", import.meta.url)).toString("base64")}`;
const ORDER = ["core.js", "data/chapters.js", "data/questions-a.js", "data/questions-b.js", "app.js"];

export function bundle() {
  const script = ORDER.map((path) =>
    read(path)
      .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "")
      .replace(/^export /gm, ""),
  ).join("\n");
  return read("index.html").replaceAll('href="icon-192.png"', `href="${icon()}"`).replace(
    /<script type="module" src="app.js"><\/script>/,
    () => `<script>\n${script.replaceAll("</script", "<\\/script")}</script>`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(new URL("dist/", import.meta.url), { recursive: true });
  writeFileSync(new URL("dist/sg-trainer.html", import.meta.url), bundle());
  console.log("dist/sg-trainer.html を作成しました");
}
