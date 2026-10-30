// Usage: node scripts/stills.mjs <compId> <outDir> <sec,sec,...>
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
const [id, out, secs] = process.argv.slice(2);
const browserExecutable = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id, browserExecutable });
for (const s of secs.split(",").map(Number)) {
  await renderStill({ serveUrl, composition, frame: Math.min(composition.durationInFrames - 1, Math.round(s * 30)), output: path.join(out, `${id}-${s}.jpeg`), imageFormat: "jpeg", jpegQuality: 70, scale: 0.25, browserExecutable });
}
console.log("done");
