// Small swatch images for the Colour Atelier: one 192x192 WebP per
// photographed colourway, a close-up of the yarn on the body of its own
// photograph (the same crop the swatch used to cut out of a full 1200px tile
// in the browser, which made every product page download ~1.5MB of
// photographs to show 64px circles).
//
//   node scripts/build-swatches.mjs   (Node 22: imports the TS manifests)
//   -> public/media/swatch/<frameId>.webp
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { COLOUR_MEDIA } from "../src/lib/media-manifest.ts";
import { SWATCH_FOCUS, SWATCH_SPAN } from "../src/lib/swatch.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sharp = createRequire(path.join(ROOT, "package.json"))("sharp");
const OUT = path.join(ROOT, "public/media/swatch");
fs.mkdirSync(OUT, { recursive: true });

let n = 0;
for (const [slug, colours] of Object.entries(COLOUR_MEDIA)) {
  const [fx, fy] = SWATCH_FOCUS[slug] ?? [0.5, 0.55];
  for (const [colour, frames] of Object.entries(colours)) {
    const frame = frames.find((f) => !f.detail);
    if (!frame) continue;
    const src = path.join(ROOT, `public/media/${frame.frameId}-tile-1200.webp`);
    const { width: w, height: h } = await sharp(src).metadata();
    const span = Math.round(w * SWATCH_SPAN);
    const left = Math.max(0, Math.min(w - span, Math.round(w * fx - span / 2)));
    const top = Math.max(0, Math.min(h - span, Math.round(h * fy - span / 2)));
    await sharp(src).extract({ left, top, width: span, height: span }).resize(192, 192).flatten({ background: "#ffffff" })
      .webp({ quality: 82 }).toFile(path.join(OUT, `${frame.frameId}.webp`));
    n++;
    console.log(`${slug} ${colour}: ${frame.frameId}`);
  }
}
console.log(`${n} swatches -> public/media/swatch/`);
