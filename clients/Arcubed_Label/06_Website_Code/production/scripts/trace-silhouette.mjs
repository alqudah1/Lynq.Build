// Extracts a product's real outline from a front-on photograph.
//
// This is how the Mini Luna mesh gets its shape: the outer contour and the
// handle opening are traced from the actual frame, not invented from
// parameters. Anything the photograph cannot show (depth, back) stays an
// explicit approximation elsewhere — it is never smuggled in here.
//
// Output: normalised polygons in a Y-up coordinate space where the body's
// widest point is x = -0.5..0.5 and y = 0 at the base.
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { analyzeFrame } from "./lib-mask.mjs";

const SRC = "../../03_Images";

/** Marching-square-free contour: for each row, the mask's left and right edge. */
export async function traceOutline(frame, { probeWidth = 700 } = {}) {
  const file = `${SRC}/${frame}.JPG`;
  const a = await analyzeFrame(file, { probeWidth, dev: 20 });
  if (!a) throw new Error(`no object in ${frame}`);

  const { box, rows } = a;
  const W = box.width, H = box.height;

  // Per row: outer left/right, and the widest interior gap (the handle opening).
  const left = [], right = [], holeL = [], holeR = [];
  for (const r of rows) {
    if (r.left < 0) { left.push(null); right.push(null); holeL.push(null); holeR.push(null); continue; }
    left.push((r.left - box.x0) / W);
    right.push((r.right - box.x0) / W);
    holeL.push(null); holeR.push(null);
  }
  return { frame, W, H, widthHeight: W / H, left, right, rowCount: rows.length, box };
}

/** Row-level run detail, used to find the arch opening. */
export async function traceRuns(frame, { probeWidth = 700 } = {}) {
  const file = `${SRC}/${frame}.JPG`;
  const { data, info } = await sharp(file).rotate().resize({ width: probeWidth }).raw().toBuffer({ resolveWithObject: true });
  const a = await analyzeFrame(file, { probeWidth, dev: 20 });
  const { width: w, channels } = info;
  const box = a.box;
  const med = (arr) => arr.slice().sort((p, q) => p - q)[arr.length >> 1];
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

  const out = [];
  for (let y = box.y0; y <= box.y1; y++) {
    const m = Math.max(4, Math.round(w * 0.06));
    const L = [[], [], []], R = [[], [], []];
    for (let x = 0; x < m; x++) {
      const li = (y * w + x) * channels, ri = (y * w + (w - 1 - x)) * channels;
      for (let c = 0; c < 3; c++) { L[c].push(data[li + c]); R[c].push(data[ri + c]); }
    }
    const lbg = [med(L[0]), med(L[1]), med(L[2])], rbg = [med(R[0]), med(R[1]), med(R[2])];
    const on = [];
    for (let x = box.x0; x <= box.x1; x++) {
      const i = (y * w + x) * channels;
      const f = x / (w - 1);
      const b0 = lbg[0] + (rbg[0] - lbg[0]) * f, b1 = lbg[1] + (rbg[1] - lbg[1]) * f, b2 = lbg[2] + (rbg[2] - lbg[2]) * f;
      const d = Math.max(lum(b0, b1, b2) - lum(data[i], data[i + 1], data[i + 2]),
                         (sat(data[i], data[i + 1], data[i + 2]) - sat(b0, b1, b2)) * 1.25);
      on.push(d > 16 ? 1 : 0);
    }
    // runs of object pixels
    const runs = []; let s = -1;
    for (let x = 0; x <= on.length; x++) {
      if (on[x] === 1 && s < 0) s = x;
      if ((on[x] !== 1 || x === on.length) && s >= 0) { if (x - s > box.width * 0.012) runs.push([s, x - 1]); s = -1; }
    }
    out.push({ y: (y - box.y0) / box.height, runs: runs.map(([s, e]) => [s / box.width, e / box.width]) });
  }
  return { frame, box, rows: out, widthHeight: box.width / box.height };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const frame = process.argv[2] || "DSC04874";
  const t = await traceRuns(frame);
  writeFileSync(`.blockouts/${frame}-runs.json`, JSON.stringify(t, null, 1));
  const two = t.rows.filter((r) => r.runs.length >= 2);
  console.log(`${frame}  object W:H ${t.widthHeight.toFixed(3)}  rows ${t.rows.length}`);
  console.log(`  rows with an opening (2+ runs): ${two.length}  (y ${two.length ? two[0].y.toFixed(2) : "-"} .. ${two.length ? two[two.length - 1].y.toFixed(2) : "-"})`);
  const sample = [0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 0.99];
  for (const s of sample) {
    const r = t.rows[Math.min(t.rows.length - 1, Math.round(s * (t.rows.length - 1)))];
    console.log(`  y=${r.y.toFixed(2)}  runs=${r.runs.length}  ${r.runs.map(([a, b]) => `[${a.toFixed(3)}..${b.toFixed(3)}]`).join(" ")}`);
  }
}
