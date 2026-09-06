// THE single source of truth for "where is the bag in this frame".
//
// Everything downstream — bounding box, body/handle split, fringe split,
// media import crops — reads from this one mask, so no two measurements can
// disagree about the object's extent.
//
// ORIENTATION: every read goes through .rotate(), which bakes in EXIF
// orientation (all 45 archive frames are orientation=8). There is deliberately
// no code path in this file that reads stored pixels un-normalized.
//
// Why a background model rather than edge detection: the backdrop is a lit
// seamless with a strong gradient (sampled 154 -> 231 within one frame), so a
// flat-colour trim finds nothing. An edge/Laplacian mask works on chunky matte
// yarn but collapses on smooth metallic colourways, where the interior of the
// bag has almost no local contrast. Modelling the backdrop per row and taking
// the deviation works on every colourway in the archive, including silver on
// grey.

import sharp from "sharp";

const PROBE = 500;
const MARGIN = 0.06;   // fraction of width sampled at each edge as "background"
const DEV = 24;        // per-channel deviation that counts as object
const GAP = 0.02;      // runs closer than this (fraction of width) are merged

/**
 * Background regions fully enclosed by the object — i.e. you can see the
 * backdrop THROUGH the bag. This is the only reliable way to tell a real
 * handle opening from a pouch's gathered top: a gathered top produces two
 * runs on a row (which a run-count test mistakes for arch legs) but never an
 * enclosed hole. Returns holes sorted largest-first, sized as a fraction of
 * the object's bounding box.
 */
function findEnclosedHoles(mask, w, h, box) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  // Flood the background inward from the frame border; anything background-
  // coloured left unvisited is enclosed.
  let sp = 0;
  const push = (i) => { if (!seen[i] && mask[i] === 0) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const holes = [];
  const label = new Int32Array(w * h).fill(-1);
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const i = y * w + x;
      if (mask[i] !== 0 || seen[i] || label[i] !== -1) continue;
      let sp2 = 0, area = 0, minY = h, maxY = 0, minX = w, maxX = 0;
      stack[sp2++] = i; label[i] = 1;
      while (sp2 > 0) {
        const q = stack[--sp2];
        const qx = q % w, qy = (q / w) | 0;
        area++;
        if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
        if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
        for (const n of [q - 1, q + 1, q - w, q + w]) {
          if (n >= 0 && n < w * h && mask[n] === 0 && !seen[n] && label[n] === -1) { label[n] = 1; stack[sp2++] = n; }
        }
      }
      holes.push({
        areaFrac: area / (box.width * box.height),
        topFrac: (minY - box.y0) / box.height,
        bottomFrac: (maxY - box.y0) / box.height,
        widthFrac: (maxX - minX + 1) / box.width,
        heightFrac: (maxY - minY + 1) / box.height,
      });
    }
  }
  return holes.sort((a, b) => b.areaFrac - a.areaFrac);
}

/** 4-connected flood fill; zeroes every component except the biggest. */
function keepLargestComponent(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let best = -1, bestSize = 0, next = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1 || label[i] !== -1) continue;
    const id = next++;
    let sp = 0, size = 0;
    stack[sp++] = i;
    label[i] = id;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] === 1 && label[p - 1] === -1) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] === 1 && label[p + 1] === -1) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] === 1 && label[p - w] === -1) { label[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] === 1 && label[p + w] === -1) { label[p + w] = id; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  for (let i = 0; i < mask.length; i++) if (label[i] !== best) mask[i] = 0;
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

/** Orientation-normalized object mask, bounding box and per-row run stats. */
export async function analyzeFrame(file, { probeWidth = PROBE, dev = DEV, __noGapClose = false } = {}) {
  const { data, info } = await sharp(file)
    .rotate()
    .resize({ width: probeWidth })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;

  const m = Math.max(4, Math.round(w * MARGIN));
  const mask = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    // Background for this row, taken from both margins so a left-to-right
    // gradient is modelled rather than fought.
    const lr = [[], [], []];
    for (let x = 0; x < m; x++) {
      for (const xx of [x, w - 1 - x]) {
        const i = (y * w + xx) * ch;
        lr[0].push(data[i]); lr[1].push(data[i + 1]); lr[2].push(data[i + 2]);
      }
    }
    const bg = [median(lr[0]), median(lr[1]), median(lr[2])];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const d = Math.max(
        Math.abs(data[i] - bg[0]),
        Math.abs(data[i + 1] - bg[1]),
        Math.abs(data[i + 2] - bg[2]),
      );
      if (d > dev) mask[y * w + x] = 1;
    }
  }

  // Keep only the largest connected blob. Several frames include a vertical
  // wall corner in the backdrop and all of them have a contact shadow; both
  // survive a pure deviation test and would otherwise inflate the bounding box
  // (one frame's box came out as the entire 500x750 probe). The bag is always
  // the largest single connected region.
  keepLargestComponent(mask, w, h);

  // Per-row runs, with small gaps closed so stitch holes don't fragment a
  // solid wall of crochet into dozens of runs.
  const gapPx = __noGapClose ? 0 : Math.max(2, Math.round(w * GAP));
  const minRun = __noGapClose ? 2 : Math.max(2, Math.round(w * 0.012));
  const rows = [];
  for (let y = 0; y < h; y++) {
    const raw = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[y * w + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) { raw.push([start, x - 1]); start = -1; }
    }
    const merged = [];
    for (const r of raw) {
      const last = merged[merged.length - 1];
      if (last && r[0] - last[1] <= gapPx) last[1] = r[1];
      else merged.push([...r]);
    }
    const runs = merged.filter(([s, e]) => e - s + 1 >= minRun);
    const fill = runs.reduce((a, [s, e]) => a + (e - s + 1), 0);
    rows.push({
      yPx: y,
      /** Merged run boundaries in probe pixels — used for silhouette tracing. */
      runList: runs,
      runs: runs.length,
      fill: fill / w,
      widest: runs.length ? Math.max(...runs.map(([s, e]) => (e - s + 1) / w)) : 0,
      left: runs.length ? runs[0][0] : -1,
      right: runs.length ? runs[runs.length - 1][1] : -1,
    });
  }

  // Object box: rows/cols carrying real coverage.
  const solidRows = rows.map((r) => r.fill > 0.02);
  const y0 = solidRows.indexOf(true);
  const y1 = solidRows.lastIndexOf(true);
  if (y0 < 0) return null;
  let x0 = w, x1 = 0;
  for (let y = y0; y <= y1; y++) {
    if (rows[y].left >= 0) { x0 = Math.min(x0, rows[y].left); x1 = Math.max(x1, rows[y].right); }
  }

  const box = { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const holes = findEnclosedHoles(mask, w, h, box);
  // Rows re-expressed relative to the object box.
  const boxRows = rows.slice(y0, y1 + 1).map((r) => ({
    ...r,
    y: (r.yPx - y0) / box.height,
    widestOfBox: r.widest * w / box.width,
    fillOfBox: r.fill * w / box.width,
  }));

  return { w, h, box, rows: boxRows, holes, widthHeight: box.width / box.height };
}

/**
 * Splits an arch-handle silhouette into handle and body.
 *
 * An arch region shows >=2 runs per row (its legs, with background between);
 * the body below is one wide run. The body top is the first row, scanning
 * down, from which the mask is continuously single-run and wide.
 *
 * Returns null when no arch is present (Nova) — absence here means "no arch
 * visible in THIS frame", never "this product has no handle".
 */
export function splitArch(analysis, { minHoleArea = 0.012 } = {}) {
  const hole = analysis.holes?.[0];
  if (!hole || hole.areaFrac < minHoleArea) return null;
  // The body begins at the bottom of the opening: everything above that row is
  // handle/opening structure, everything below is solid body.
  const handleFrac = hole.bottomFrac;
  if (handleFrac <= 0.02 || handleFrac >= 0.95) return null;
  return {
    handleHeightFrac: handleFrac,
    openingAreaFrac: hole.areaFrac,
    openingWidthFrac: hole.widthFrac,
    openingHeightFrac: hole.heightFrac,
    openingTopFrac: hole.topFrac,
    bodyWidthHeight: analysis.box.width / (analysis.box.height * (1 - handleFrac)),
    totalWidthHeight: analysis.widthHeight,
  };
}

/**
 * Fringe detection. Individual strands sit closer together than the run-gap
 * closing used for body analysis, so this re-scans the lower half with gap
 * closing effectively disabled and looks for rows that fragment into many
 * narrow runs. Establishes only WHERE fringe starts and how deep it is —
 * never strand count, spacing or attachment method.
 */
export async function detectFringe(file, { probeWidth = 900 } = {}) {
  const fine = await analyzeFrameRaw(file, { probeWidth });
  if (!fine) return null;
  const rows = fine.rows;
  let firstFragmented = -1, maxRuns = 0;
  for (let i = Math.floor(rows.length * 0.25); i < rows.length; i++) {
    maxRuns = Math.max(maxRuns, rows[i].runs);
    if (firstFragmented < 0 && rows[i].runs >= 4) firstFragmented = i;
  }
  if (firstFragmented < 0) return { fringeDetected: false, maxRuns };
  const frac = firstFragmented / rows.length;
  return {
    fringeDetected: true,
    fringeStartFrac: frac,
    bandHeightFrac: frac,
    fringeHeightFrac: 1 - frac,
    fringeToBandRatio: (1 - frac) / frac,
    bandWidthHeight: fine.box.width / (fine.box.height * frac),
    maxRuns,
  };
}

/** analyzeFrame with run-gap closing disabled, for strand-level structure. */
export async function analyzeFrameRaw(file, opts = {}) {
  return analyzeFrame(file, { ...opts, __noGapClose: true });
}
