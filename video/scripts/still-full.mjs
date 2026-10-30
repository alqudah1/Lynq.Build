// Usage: node scripts/still-full.mjs <outDir> <compId> [<compId>...] : full-size JPEG stills
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
const [out, ...ids] = process.argv.slice(2);
const browserExecutable = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id, browserExecutable });
  await renderStill({ serveUrl, composition, frame: 0, output: path.join(out, `${id}.jpg`), imageFormat: "jpeg", jpegQuality: 92, browserExecutable });
}
console.log("done");
