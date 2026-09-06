// Finds the bag inside a catalogue frame.
//
// The seamless backdrop is a smoothly-lit grey gradient (sampled: 154 in one
// corner, 209 in another), so sharp's flat-colour .trim() can never find the
// edge — it was returning the full frame. Crochet, by contrast, is dense
// high-frequency texture. A Laplacian edge pass ignores smooth gradients
// entirely and lights up only on the stitchwork, which makes the object's
// bounding box trivial to read off. Works for every colourway, including
// silver-on-grey where a luminance threshold would fail.

import sharp from "sharp";

const LAPLACIAN = { width: 3, height: 3, kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0] };

export async function findObjectBox(file, { probeWidth = 400, edgeThreshold = 26, coverage = 0.012 } = {}) {
  // .metadata() reports the STORED dimensions and does not account for a
  // pending .rotate(). These frames are EXIF orientation 8, so the displayed
  // image is the stored one turned 90° — swap the axes or every mapped
  // coordinate lands in the wrong place.
  const meta = await sharp(file).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const full = turned
    ? { w: meta.height, h: meta.width }
    : { w: meta.width, h: meta.height };

  const { data, info } = await sharp(file)
    .rotate()
    .resize({ width: probeWidth })
    .greyscale()
    .convolve(LAPLACIAN)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;
  const colHits = new Array(w).fill(0);
  const rowHits = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] > edgeThreshold) {
        colHits[x]++;
        rowHits[y]++;
      }
    }
  }
  // A row/column counts as "object" only if enough of it is textured — one
  // stray speck of sensor noise must not widen the box.
  const minCol = Math.max(2, Math.round(h * coverage));
  const minRow = Math.max(2, Math.round(w * coverage));
  const first = (arr, min) => arr.findIndex((v) => v >= min);
  const last = (arr, min) => arr.length - 1 - [...arr].reverse().findIndex((v) => v >= min);

  const x0 = first(colHits, minCol), x1 = last(colHits, minCol);
  const y0 = first(rowHits, minRow), y1 = last(rowHits, minRow);
  if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) return null;

  const sx = full.w / w, sy = full.h / h;
  return {
    left: Math.round(x0 * sx), top: Math.round(y0 * sy),
    width: Math.round((x1 - x0) * sx), height: Math.round((y1 - y0) * sy),
    frame: full,
  };
}
