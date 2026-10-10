// Builds the inputs of the colour-preview renderer (src/lib/recolour/).
//
// Nothing here makes a recoloured image. It prepares two things from Rand's
// authentic photography, and the browser does the recolouring:
//
//   1. SOURCE + MASK per source frame (public/media/recolour/):
//        <frame>-src-1600.webp   the frame's alpha cut-out at 1600px — the
//                                pixels the renderer reads
//        <frame>-mask-1600.png   8-bit weight: 255 = crochet yarn that takes
//                                the new colour, 0 = everything that must keep
//                                its own colour (backdrop, the soft floor
//                                shadow, hardware). The cut-out's matte alone
//                                carries the floor shadow as low alpha, so the
//                                weight ramps in from alpha .80 to .95 —
//                                recolouring that shadow tinted it.
//      Hardware (clasps, chains, rings) is cut out of the mask by hand-drawn
//      ellipses in EXCLUDE below. A colour rule cannot separate a silver
//      chain from silver yarn, so this is not left to colour.
//
//   2. YARN PROFILES (src/lib/recolour/profiles.generated.json): for each real
//      photographed colourway of a bag, how its yarn's lightness is
//      distributed (33 quantiles) and how its colour strength varies from
//      shadow to highlight. A preview colour borrows the lightness
//      distribution of the real yarns nearest to it in lightness, so a dark
//      colour gets the compressed, sheen-topped look Rand's real Black yarn
//      has, and a mid colour the wide metallic range of her Gold.
//
// Run from 06_Website_Code/production: node scripts/build-recolour-maps.mjs

import sharp from "sharp";
import fs from "node:fs";
import { COLOUR_MEDIA } from "../src/lib/media-manifest.ts";

const MEDIA = "public/media";
const OUT = `${MEDIA}/recolour`;
const W = 1600;
const Q = 33;

// Material families. A preview borrows lightness and colour behaviour only
// from real yarns of the SAME material: Nova and Mini Luna are crocheted in
// the same metallic raffia (pooled, so Mini Luna's real Red teaches every
// red preview how red foil yarn behaves), Vault in a matte cotton cord, Loco
// in a matte cord with a fringe. A family is never borrowed across.
const FAMILIES = {
  "metallic-raffia": ["nova", "mini-luna"],
  "matte-cord": ["vault"],
  "fringe-cord": ["loco"],
};

// Source frames the renderer may recolour. Front views only: they lead the
// gallery, and a front view is what a preview has to stand in for.
const SOURCES = {
  nova: ["DSC05786", "DSC04868", "DSC05780", "DSC05782"], // Gold, Silver, Black fronts; Black open (hardware test)
  "mini-luna": ["DSC04875"],             // Silver: neutral yarn and shadow
  vault: ["DSC05790"],                   // Light Brown: the lightest Vault yarn
  loco: ["DSC05772"],                    // Burgundy: the lighter Loco yarn
};

// How the yarn is told apart from the contact shadow, per source:
//   energy — keep pixels whose texture energy exceeds this fraction of the
//            median over the body (higher = stricter)
//   minChroma — also keep any body pixel at least this colourful (Lab
//            chroma). A grey shadow never is; a coloured yarn's dimly lit
//            bottom row of stitches is, though its texture energy is low.
const YARN_RULE = {
  DSC05786: { energy: 0.35, minChroma: 14 }, // Gold: colour rescues the dim bottom stitches
  DSC04868: { energy: 0.35 },                // Silver: texture alone is clean
  DSC05780: { energy: 0.6 },                 // Black: yarn and shadow both dark, so stricter
  // Black, open: studio light shows through gaps in the stitches as near-
  // white dots inside the bag. Black yarn's sheen never passes L* ~42, so
  // anything brighter than 70 is light, not yarn, and keeps its own pixels.
  DSC05782: { energy: 0.6, keepAbove: 70 },
  // Loco: fringe strands, with backdrop showing between them. Texture is
  // everywhere in a fringe (strand edges), so texture cannot separate yarn
  // from the gaps; darkness can — the cord is dark, the seamless is light.
  // Weight ramps from 1 at L* 45 to 0 at L* 62.
  DSC05772: { dark: [45, 62] },
  // Vault: matte cord, evenly textured to the floor, so the automatic floor
  // trim (below) separates it from its contact shadow cleanly.
  DSC05790: { energy: 0.35, trim: true },
};

// Hand-traced floor lines, [x, y] in 0..1 of the frame: everything below the
// line is floor (contact shadow), never yarn. Used where no automatic rule
// separates them — on the Black front the yarn and its shadow are equally
// dark and smooth. Traced at 2x zoom from the source photograph.
const FLOOR = {
  // Mini Luna Silver front.
  DSC04875: [[0, 0.80], [0.10, 0.82], [0.14, 0.875], [0.18, 0.905], [0.22, 0.918], [0.30, 0.928], [0.40, 0.932],
             [0.52, 0.932], [0.60, 0.927], [0.66, 0.92], [0.70, 0.905], [0.72, 0.89], [0.75, 0.86], [0.80, 0.80], [1, 0.78]],
  // Gold front: light bouncing off the gold yarn warms its contact shadow,
  // so the colour rule alone pulled the shadow in.
  DSC05786: [[0, 0.70], [0.18, 0.70], [0.20, 0.73], [0.24, 0.77], [0.28, 0.80], [0.32, 0.81], [0.36, 0.818],
             [0.50, 0.822], [0.64, 0.82], [0.68, 0.815], [0.72, 0.80], [0.76, 0.785], [0.80, 0.765], [0.84, 0.74],
             [0.88, 0.71], [1, 0.68]],
  DSC05780: [[0, 0.68], [0.10, 0.74], [0.16, 0.785], [0.20, 0.81], [0.28, 0.83], [0.36, 0.837], [0.50, 0.84],
             [0.64, 0.834], [0.72, 0.822], [0.80, 0.805], [0.84, 0.785], [0.88, 0.75], [0.92, 0.71], [1, 0.68]],
};

// Sources whose floor shadow carries the yarn's own colour (light bounced off
// a gold bag tints its shadow warm). A Navy preview casting a gold-tinted
// shadow reads wrong, so for these the non-yarn pixels lose 85% of their
// chroma. Only the preview source is changed, never the published photograph.
const NEUTRALISE_SHADOW = new Set(["DSC05786"]);

// Hand-placed hardware search areas, as ellipses in 0..1 frame coordinates:
// [cx, cy, rx, ry, metalAbove?]. Inside one, pixels brighter than
// metalAbove (L*) are hardware and keep their own colour. The Nova front frames carry no hardware (the frame and
// handle are crocheted), so they need none.
const EXCLUDE = {
  // Black, open: the two metal magnetic clasps on the rim.
  DSC05782: [[0.327, 0.381, 0.032, 0.014], [0.741, 0.236, 0.027, 0.014]],
};

// ---- colour maths, identical to src/lib/recolour/engine.ts ---------------
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
function lab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// THE YARN, not just the cut-out. The cut-out's matte keeps the dark contact
// shadow under the bag opaque, so a mask from alpha alone recoloured the
// floor. Crochet is dense, sharp-edged texture and a shadow is smooth, so the
// yarn is where local edge energy is high (the same signal
// scripts/lib-object-bbox.mjs uses to find the bag): energy = box-blurred
// gradient magnitude of luminance, kept where it is above a fraction of the
// median energy over the solid body, then closed, hole-filled and cut to its
// largest component, and finally feathered 1.5px so the edge anti-aliases.
// Returns 0..255 weight per pixel.
function yarnBody(data, w, h, rule, floor) {
  const n = w * h;
  const solid = solidBody(data, w, h);
  const Y = new Float32Array(n);
  for (let p = 0; p < n; p++) Y[p] = 0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];
  const grad = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    grad[p] = Math.abs(Y[p + 1] - Y[p - 1]) + Math.abs(Y[p + w] - Y[p - w]);
  }
  const energy = boxBlur(grad, w, h, 9);
  const inside = [];
  for (let p = 0; p < n; p += 13) if (solid[p]) inside.push(energy[p]);
  inside.sort((a, b) => a - b);
  const thr = rule.energy * inside[Math.floor(inside.length / 2)];
  let m = new Uint8Array(n);
  if (rule.dark) {
    // Strand-level weights straight from lightness; no closing or filling,
    // which would bridge the gaps between strands.
    const [lo, hi] = rule.dark, out = new Uint8Array(n);
    const fy = floorLineY(floor, w, h);
    for (let p = 0; p < n; p++) {
      if (!solid[p] || Math.floor(p / w) >= fy[p % w]) continue;
      const L = lab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])[0];
      out[p] = Math.round(Math.min(1, Math.max(0, (hi - L) / (hi - lo))) * 255);
    }
    return out;
  }
  for (let p = 0; p < n; p++) {
    if (!solid[p]) continue;
    if (energy[p] > thr) { m[p] = 1; continue; }
    // A shadow can be tinted by light bouncing off a gold bag, but it is
    // still smooth: colour only rescues a pixel that has some texture.
    if (rule.minChroma && energy[p] > 0.12 * inside[Math.floor(inside.length / 2)]) {
      const [, a, b] = lab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
      if (Math.hypot(a, b) >= rule.minChroma) m[p] = 1;
    }
  }
  m = fillAndKeepLargest(morph(morph(m, w, h, 5, true), w, h, 5, false), w, h);
  // FLOOR TRIM, automatic: closing the mask bridges the bottom row of
  // stitches onto the smooth contact shadow below it. Walking up each column
  // from the bottom, mask pixels are dropped while the surface is smooth,
  // stopping at the first crochet texture.
  // Opt-in per source: on a metallic yarn the smooth highlights and dimly
  // lit bottom stitches read as "smooth" too, and the trim removed real yarn
  // (Gold Nova, Silver Mini Luna) — those use a traced floor line instead.
  const trim = 0.6 * inside[Math.floor(inside.length / 2)];
  if (rule.trim) for (let x = 0; x < w; x++) {
    for (let y = h - 1; y >= 0; y--) {
      const p = y * w + x;
      if (!m[p]) continue;
      if (energy[p] >= trim) break;
      m[p] = 0;
    }
  }
  if (floor) {
    for (let x = 0; x < w; x++) {
      const fx = x / w;
      const k = Math.max(0, floor.findIndex(([px]) => px >= fx) - 1);
      const [x0, y0] = floor[k], [x1, y1] = floor[Math.min(k + 1, floor.length - 1)];
      const yLine = (y0 + (x1 > x0 ? ((fx - x0) / (x1 - x0)) * (y1 - y0) : 0)) * h;
      for (let y = Math.ceil(yLine); y < h; y++) m[y * w + x] = 0;
    }
  }
  const soft = boxBlur(Float32Array.from(m), w, h, 2);
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) out[p] = Math.round(Math.min(1, soft[p]) * 255);
  return out;
}

// y (pixels) of the traced floor line at every x, or Infinity without one.
function floorLineY(floor, w, h) {
  const out = new Float32Array(w).fill(Infinity);
  if (!floor) return out;
  for (let x = 0; x < w; x++) {
    const fx = x / w;
    const k = Math.max(0, floor.findIndex(([px]) => px >= fx) - 1);
    const [x0, y0] = floor[k], [x1, y1] = floor[Math.min(k + 1, floor.length - 1)];
    out[x] = (y0 + (x1 > x0 ? ((fx - x0) / (x1 - x0)) * (y1 - y0) : 0)) * h;
  }
  return out;
}

// EDGE CLEAN-UP. Silhouette pixels are part bag, part studio backdrop, so
// their colour is the yarn mixed with light grey. Recoloured as they are,
// they read as a pale rim round a dark preview (seen on Navy at 2x). Here
// the yarn colour of the interior is pushed outward into those pixels
// (three passes of neighbour averaging), their alpha is kept, and they are
// marked as yarn. Only pixels LIGHTER than the yarn beside them are touched
// — the backdrop is light, a contact shadow is dark — and never below a
// traced floor line.
function cleanEdges(data, mask, w, h, floorY) {
  const n = w * h;
  const isYarn = (p) => mask[p] >= 200;
  for (let pass = 0; pass < 3; pass++) {
    const fill = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, a = data[p * 4 + 3];
      if (mask[p] >= 200 || a === 0 || a >= 250 || y >= floorY[x]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (const q of [p - 1, p + 1, p - w, p + w, p - w - 1, p - w + 1, p + w - 1, p + w + 1]) {
        if (isYarn(q)) { r += data[q * 4]; g += data[q * 4 + 1]; b += data[q * 4 + 2]; c++; }
      }
      if (!c) continue;
      const own = lab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])[0];
      const near = lab(r / c, g / c, b / c)[0];
      if (own <= near + 5) continue;
      fill.push([p, r / c, g / c, b / c]);
    }
    for (const [p, r, g, b] of fill) { data[p * 4] = r; data[p * 4 + 1] = g; data[p * 4 + 2] = b; mask[p] = 255; }
  }
  return n;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / k;
      s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// The bag as one solid region (1 inside, 0 outside):
// alpha > .5, closed (dilate then erode, radius 6) to bridge stitch gaps,
// holes filled by flooding the outside from the frame border, largest
// component kept (drops matte specks).
// The soft floor shadow sits below .5 alpha and stays outside.
function solidBody(data, w, h) {
  const n = w * h;
  let m = new Uint8Array(n);
  for (let p = 0; p < n; p++) m[p] = data[p * 4 + 3] > 127 ? 1 : 0;
  m = morph(morph(m, w, h, 6, true), w, h, 6, false);
  return fillAndKeepLargest(m, w, h);
}

function morph(src, w, h, r, dilate) {
  const n = w * h, tmp = new Uint8Array(n), out = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let d = -r; d <= r; d++) { const xx = x + d; const s = xx < 0 || xx >= w ? 0 : src[y * w + xx]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } }
    tmp[y * w + x] = v;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let v = dilate ? 0 : 1;
    for (let d = -r; d <= r; d++) { const yy = y + d; const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } }
    out[y * w + x] = v;
  }
  return out;
}

// Fills holes (flood the outside from the border) and keeps the largest component.
function fillAndKeepLargest(m, w, h) {
  const n = w * h;
  // flood the outside from the border; anything not reached is inside
  const outside = new Uint8Array(n), stack = [];
  const push = (p) => { if (!outside[p] && !m[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  // Fill only SMALL holes (gaps between stitches). A large enclosed hole is
  // the backdrop seen through a handle's arch: filling it would recolour the
  // background. "Large" = more than 0.4% of the frame.
  const solid = new Uint8Array(n);
  for (let p = 0; p < n; p++) solid[p] = outside[p] ? 0 : 1;
  const seen = new Uint8Array(n), maxHole = n * 0.004;
  for (let s = 0; s < n; s++) {
    if (m[s] || outside[s] || seen[s]) continue;
    const comp = [], st = [s]; seen[s] = 1;
    while (st.length) {
      const p = st.pop(), x = p % w; comp.push(p);
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < n && !m[q] && !outside[q] && !seen[q]) { seen[q] = 1; st.push(q); }
    }
    if (comp.length > maxHole) for (const p of comp) solid[p] = 0;
  }
  // largest component
  const label = new Int32Array(n); let best = 0, bestSize = 0, next = 1;
  for (let s = 0; s < n; s++) {
    if (!solid[s] || label[s]) continue;
    let size = 0; const st = [s]; label[s] = next;
    while (st.length) {
      const p = st.pop(), x = p % w; size++;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < n && solid[q] && !label[q]) { label[q] = next; st.push(q); }
    }
    if (size > bestSize) { bestSize = size; best = next; }
    next++;
  }
  for (let p = 0; p < n; p++) solid[p] = label[p] === best ? 1 : 0;
  return solid;
}

function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (q) => (q ** 3 > 216 / 24389 ? q ** 3 : (116 * q - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const g = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055)));
  return [g(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z), g(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z), g(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z)];
}

async function rgba(frame, width) {
  const { data, info } = await sharp(`${MEDIA}/${frame}-cut-2600.webp`)
    .resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

fs.mkdirSync(OUT, { recursive: true });

// 1. sources + masks
const sourceInfo = {};
for (const [slug, frames] of Object.entries(SOURCES)) {
  for (const frame of frames) {
    const { data, w, h } = await rgba(frame, W);
    const body = yarnBody(data, w, h, YARN_RULE[frame] ?? { energy: 0.35 }, FLOOR[frame]);
    const mask = Buffer.alloc(w * h);
    const ex = EXCLUDE[frame] ?? [];
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
      // Inside the solid body: full weight, and fully opaque — the cut-out
      // made bright silver highlights partly transparent (they resemble the
      // grey seamless), which left them unrecoloured. On the body's rim the
      // matte's own ramp is kept so the edge stays soft.
      let wgt = body[p] / 255;
      const keepAbove = (YARN_RULE[frame] ?? {}).keepAbove;
      if (wgt && keepAbove && lab(data[i], data[i + 1], data[i + 2])[0] > keepAbove) wgt = 0;
      if (wgt && ex.length) {
        const fx = (p % w) / w, fy = Math.floor(p / w) / h;
        // The ellipse is where to LOOK, not what to cut: inside it, only
        // pixels bright enough to be metal (L* above `metalAbove`, default
        // 35) are excluded, so the yarn around a clasp still recolours. A
        // whole-ellipse cut left a black oval of untouched yarn round it.
        for (const [cx, cy, rx, ry, metalAbove = 35] of ex) {
          if (((fx - cx) / rx) ** 2 + ((fy - cy) / ry) ** 2 <= 1 && lab(data[i], data[i + 1], data[i + 2])[0] > metalAbove) wgt = 0;
        }
      }
      // Yarn is opaque: lift the matte's alpha to the yarn weight.
      data[i + 3] = Math.max(data[i + 3], Math.round(wgt * 255));
      if (NEUTRALISE_SHADOW.has(frame) && wgt < 0.5 && data[i + 3] > 0) {
        const [L, a, b] = lab(data[i], data[i + 1], data[i + 2]);
        const [r, g, bb] = labToRgb(L, a * 0.15, b * 0.15);
        data[i] = r; data[i + 1] = g; data[i + 2] = bb;
      }
      mask[p] = Math.round(wgt * 255);
    }
    cleanEdges(data, mask, w, h, floorLineY(FLOOR[frame], w, h));
    // q97: the renderer stretches the source's lightness, so compression
    // blocks in a q92 file became visible squares in bright highlights.
    await sharp(data, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 97, alphaQuality: 100, smartSubsample: true }).toFile(`${OUT}/${frame}-src-${W}.webp`);
    await sharp(mask, { raw: { width: w, height: h, channels: 1 } }).png({ compressionLevel: 9 }).toFile(`${OUT}/${frame}-mask-${W}.png`);
    sourceInfo[frame] = { slug, width: w, height: h };
    console.log(`source ${frame}: ${w}x${h}`);
  }
}

// 2. yarn profiles from every real colourway's first frame
const profiles = {};
for (const [family, slugs] of Object.entries(FAMILIES)) {
  profiles[family] = [];
  for (const slug of slugs) for (const [colour, frames] of Object.entries(COLOUR_MEDIA[slug] ?? {})) {
    // A two-tone colourway mixes two yarns, so its lightness spread describes
    // neither of them.
    if (colour.includes("&")) continue;
    const frame = frames.find((f) => !f.detail)?.frameId;
    if (!frame) continue;
    const { data } = await rgba(frame, 1300);
    const Ls = [], Cs = [], As = [], Bs = [];
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 242) continue;
      const [L, a, b] = lab(data[i], data[i + 1], data[i + 2]);
      Ls.push(L); Cs.push(Math.hypot(a, b)); As.push(a); Bs.push(b); n++;
    }
    const order = Ls.map((_, i) => i).sort((x, y) => Ls[x] - Ls[y]);
    // The yarn's MID-TONE (40th-60th percentile of lightness): what a preview
    // colour's value means. The mean over all pixels is pulled pale by the
    // desaturated shadows and understates the yarn's colour.
    let ma = 0, mb = 0; const m0 = Math.floor(n * 0.4), m1 = Math.floor(n * 0.6);
    for (let j = m0; j < m1; j++) { ma += As[order[j]]; mb += Bs[order[j]]; }
    const quant = [], chroma = [], hueAt = [];
    for (let k = 0; k < Q; k++) {
      const lo = Math.floor((k / Q) * n), hi = Math.max(lo + 1, Math.floor(((k + 1) / Q) * n));
      let sL = 0, sC = 0, sa = 0, sb = 0;
      for (let j = lo; j < hi; j++) { sL += Ls[order[j]]; sC += Cs[order[j]]; sa += As[order[j]]; sb += Bs[order[j]]; }
      quant.push(+(sL / (hi - lo)).toFixed(2)); chroma.push(+(sC / (hi - lo)).toFixed(2)); hueAt.push(Math.atan2(sb, sa));
    }
    const midHue = Math.atan2(mb, ma);
    const median = quant[(Q - 1) / 2];
    const midChroma = chroma[(Q - 1) / 2];
    profiles[family].push({
      colour, frame, median,
      quantiles: quant,
      // Colour strength by lightness, relative to the mid-tone. Only
      // meaningful for chromatic yarns; neutral ones are flagged.
      chromaShape: midChroma > 8 ? chroma.map((c) => +(c / midChroma).toFixed(3)) : null,
      // How the hue drifts from shadow to highlight (radians from the mid-
      // tone's hue): real red foil runs orange in its glints, gold runs
      // yellow. Chromatic yarns only.
      hueShape: midChroma > 8 ? hueAt.map((hh) => +Math.atan2(Math.sin(hh - midHue), Math.cos(hh - midHue)).toFixed(3)) : null,
      product: slug,
      midLab: [median, ma / (m1 - m0), mb / (m1 - m0)].map((v) => +v.toFixed(2)),
    });
    console.log(`profile ${family}: ${slug}/${colour} (${frame}): median L ${median}, mid chroma ${midChroma}`);
  }
  profiles[family].sort((a, b) => a.median - b.median);
}
const familyOf = Object.fromEntries(Object.entries(FAMILIES).flatMap(([f, ss]) => ss.map((s) => [s, f])));

fs.writeFileSync(
  "src/lib/recolour/profiles.generated.json",
  JSON.stringify({ generatedBy: "scripts/build-recolour-maps.mjs", width: W, sources: sourceInfo, familyOf, profiles }, null, 1) + "\n"
);
console.log("wrote src/lib/recolour/profiles.generated.json");
