// Dev inspection tool: builds a labelled contact sheet from named frames,
// ALWAYS orientation-normalized and optionally cropped to the detected object.
//
// Usage:
//   node scripts/inspect-frames.mjs out.jpg DSC04876 DSC05790 ...
//   node scripts/inspect-frames.mjs out.jpg --top DSC04876 DSC05790   (top 45% only)
//   node scripts/inspect-frames.mjs out.jpg --cols 3 ...
//
// Every frame goes through .rotate() so EXIF orientation 8 is baked in before
// anything is measured or looked at. There is no code path here that shows a
// raw stored frame.

import sharp from "sharp";
import { findObjectBox } from "./lib-object-bbox.mjs";

const SRC = "../../03_Images";
const args = process.argv.slice(2);
const out = args.shift();
let cols = 3, topOnly = false, region = null;
const frames = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cols") cols = Number(args[++i]);
  else if (args[i] === "--top") topOnly = true;
  else if (args[i] === "--region") region = args[++i].split(",").map(Number);
  else frames.push(args[i]);
}

const CW = 620, LABEL = 26;
const tiles = [];
let maxH = 0;
const prepared = [];

for (const f of frames) {
  const box = await findObjectBox(`${SRC}/${f}.JPG`);
  const pad = Math.round(Math.max(box.width, box.height) * 0.04);
  let ext = {
    left: Math.max(0, box.left - pad),
    top: Math.max(0, box.top - pad),
    width: Math.min(box.frame.w - Math.max(0, box.left - pad), box.width + pad * 2),
    height: Math.min(box.frame.h - Math.max(0, box.top - pad), box.height + pad * 2),
  };
  if (topOnly) ext.height = Math.round(ext.height * 0.45);
  if (region) {
    ext = {
      left: Math.round(box.left + box.width * region[0]),
      top: Math.round(box.top + box.height * region[1]),
      width: Math.round(box.width * region[2]),
      height: Math.round(box.height * region[3]),
    };
  }
  const buf = await sharp(`${SRC}/${f}.JPG`).rotate().extract(ext).resize({ width: CW }).toBuffer();
  const m = await sharp(buf).metadata();
  prepared.push({ f, buf, h: m.height, ratio: (box.width / box.height).toFixed(2) });
  maxH = Math.max(maxH, m.height);
}

const CH = maxH + LABEL;
const rows = Math.ceil(prepared.length / cols);
prepared.forEach((p, i) => {
  const x = (i % cols) * CW, y = Math.floor(i / cols) * CH;
  tiles.push({ input: p.buf, left: x, top: y });
  tiles.push({
    input: Buffer.from(
      `<svg width="${CW}" height="${LABEL}"><rect width="${CW}" height="${LABEL}" fill="#143562"/><text x="8" y="18" font-family="monospace" font-size="15" fill="#FFE0FD">${p.f}   objW:H ${p.ratio}   [orientation normalized]</text></svg>`,
    ),
    left: x, top: y + maxH,
  });
});

await sharp({ create: { width: cols * CW, height: rows * CH, channels: 3, background: "#ffffff" } })
  .composite(tiles).jpeg({ quality: 86 }).toFile(out);
console.log(`${out}  (${prepared.length} frames, ${cols} cols)`);
for (const p of prepared) console.log(`  ${p.f}  objW:H ${p.ratio}`);
