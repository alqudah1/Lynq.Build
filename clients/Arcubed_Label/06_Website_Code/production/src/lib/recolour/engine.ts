// Colour-preview renderer: recolours the crochet yarn of an authentic
// photograph in the browser. No network request, no AI generation — the
// output is the source photograph with only the yarn's colour changed.
//
// HOW (per source photograph, done once):
//   every yarn pixel's CIELAB lightness is measured, and the photograph's
//   yarn lightness distribution (CDF) is built from the mask-weighted pixels.
//
// HOW (per colour, a 1024-entry lookup table, < 1ms):
//   for each source lightness, its rank in the source distribution (0..1) is
//   mapped to the lightness at that same rank in the TARGET yarn's
//   distribution. That distribution is not invented: it is interpolated
//   between Rand's real photographed yarns nearest to the target in
//   lightness (profiles.generated.json). So a stitch that is the 80th
//   percentile highlight in the Gold photograph is the 80th percentile
//   highlight of the new yarn, shadows stay shadows, and a dark target takes
//   on the compressed, sheen-topped spread of the real Black yarn.
//   Colour strength follows the real chromatic yarns' shadow-to-highlight
//   shape, so highlights and shadows are not one flat tint.
//
// HOW (per colour, per pixel): out = source * (1 - w) + lut[L] * w, where w
//   is the mask weight. Only yarn moves; backdrop, the soft floor shadow and
//   excluded hardware keep their own pixels.
//
// WHAT IT CANNOT DO (measured, see the lab page): it changes colour, not
// material. Every Nova yarn photographed is a metallic raffia, so every
// preview inherits that sheen. A matte cotton yarn, a glitter yarn or a
// mixed two-tone yarn would need its own photographed reference.

export interface YarnProfile {
  colour: string;
  frame: string;
  median: number;
  quantiles: number[];
  chromaShape: number[] | null;
  /** Hue drift from shadow to highlight, radians from the mid-tone hue. */
  hueShape: number[] | null;
  /** Which bag the reference photograph is of. */
  product: string;
  /** The yarn's mid-tone as Lab — what a PreviewColour's value describes. */
  midLab: number[];
}

export interface PreviewColour {
  /** Stable id. */
  key: string;
  /** Customer-facing name. */
  name: string;
  /** Swatch fill shown in the selector. */
  swatch: string;
  /** The yarn's mid-tone as sRGB hex — measured from a yarn swatch photo. */
  value: string;
  /** Product slugs this colour may be previewed on. */
  products: string[];
  /** Optional tuning: chroma multiplier (default 1), contrast multiplier (default 1). */
  render?: { chroma?: number; contrast?: number };
  /** A real photograph of this colourway, when one exists: always preferred. */
  photographed?: boolean;
}

const BINS = 1024;

// ---- colour maths ---------------------------------------------------------
const LIN = new Float32Array(256);
for (let v = 0; v < 256; v++) { const c = v / 255; LIN[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const fx = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const fy = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const fz = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const g = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055)));
export function labToSrgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  return [
    g(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z),
    g(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z),
    g(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z),
  ];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---- per source -----------------------------------------------------------
export interface SourceAnalysis {
  /** Lightness bin (0..1023) of every pixel. */
  bins: Uint16Array;
  /** Rank (0..1) of each lightness bin within the yarn pixels. */
  rank: Float32Array;
}

/** Done once per source photograph. Y depends only on the three channels, so
 *  lightness is computed from linear luminance without the full Lab step. */
export function analyseSource(rgba: Uint8ClampedArray, mask: Uint8ClampedArray | Uint8Array): SourceAnalysis {
  const n = mask.length;
  const bins = new Uint16Array(n);
  const hist = new Float64Array(BINS);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const y = 0.2126729 * LIN[rgba[i]] + 0.7151522 * LIN[rgba[i + 1]] + 0.072175 * LIN[rgba[i + 2]];
    const L = 116 * f(y) - 16;
    const bin = Math.min(BINS - 1, Math.max(0, Math.round((L / 100) * (BINS - 1))));
    bins[p] = bin;
    if (mask[p]) hist[bin] += mask[p];
  }
  const total = hist.reduce((s, v) => s + v, 0) || 1;
  const rank = new Float32Array(BINS);
  let acc = 0;
  for (let k = 0; k < BINS; k++) { rank[k] = (acc + hist[k] / 2) / total; acc += hist[k]; }
  return { bins, rank };
}

// ---- per colour -----------------------------------------------------------
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Value of a 33-point quantile curve at rank p (0..1). */
function curveAt(q: number[], p: number): number {
  const x = p * q.length - 0.5;
  if (x <= 0) return q[0];
  if (x >= q.length - 1) return q[q.length - 1];
  const i = Math.floor(x);
  return lerp(q[i], q[i + 1], x - i);
}

/** The target yarn's lightness quantile curve, from the real yarns nearest it. */
export function targetCurve(profiles: YarnProfile[], Lt: number): number[] {
  const ps = [...profiles].sort((a, b) => a.median - b.median);
  const lo = ps[0], hi = ps[ps.length - 1];
  let base: number[];
  if (Lt <= lo.median) {
    // Darker than the darkest real yarn: scale it toward black.
    base = lo.quantiles.map((v) => v * (Lt / lo.median));
  } else if (Lt >= hi.median) {
    base = hi.quantiles.map((v) => v + (Lt - hi.median));
  } else {
    const j = ps.findIndex((p) => p.median >= Lt);
    const a = ps[j - 1], b = ps[j];
    const t = (Lt - a.median) / (b.median - a.median);
    base = a.quantiles.map((v, k) => lerp(v, b.quantiles[k], t));
    const mid = base[(base.length - 1) / 2];
    base = base.map((v) => v + (Lt - mid));
  }
  // Soft shoulder above L 92 so a light colour's highlights do not clip flat.
  return base.map((v) => (v > 92 ? 92 + 8 * (1 - Math.exp(-(v - 92) / 8)) : Math.max(0, v)));
}

/**
 * Shadow-to-highlight colour strength and hue drift, from the real chromatic
 * yarns WEIGHTED BY HOW CLOSE THEIR HUE IS to the target. A red preview
 * learns from Rand's real red yarn (its glints run orange and stay
 * saturated) rather than from an average dominated by golds.
 */
export function colourShape(profiles: YarnProfile[], hue: number): { chroma: number[]; hue: number[] } {
  const shaped = profiles.filter((p) => p.chromaShape && p.hueShape);
  if (!shaped.length) return { chroma: new Array(33).fill(1), hue: new Array(33).fill(0) };
  const weights = shaped.map((p) => {
    const h = Math.atan2(p.midLab[2], p.midLab[1]);
    const d = Math.atan2(Math.sin(h - hue), Math.cos(h - hue));
    return Math.exp(-((d / 0.6) ** 2)) + 0.02; // ~35° falloff, never exactly zero
  });
  const total = weights.reduce((s, v) => s + v, 0);
  const at = (k: number, key: "chromaShape" | "hueShape") => shaped.reduce((s, p, i) => s + p[key]![k] * weights[i], 0) / total;
  return {
    chroma: shaped[0].chromaShape!.map((_, k) => at(k, "chromaShape")),
    hue: shaped[0].hueShape!.map((_, k) => at(k, "hueShape")),
  };
}

/** Steepest lightness rise allowed per source bin (bins are 0.098 L* apart):
 *  4x. Where many source pixels share a narrow brightness band, matching
 *  ranks would stretch that band — and the photograph's compression blocks
 *  with it — into visible squares. */
const MAX_STEP = 0.098 * 4;

/** 1024 x RGB lookup from source lightness bin to the new yarn colour. */
export function buildLut(colour: PreviewColour, profiles: YarnProfile[], src: SourceAnalysis): Uint8ClampedArray {
  const [Lt, at, bt] = srgbToLab(...hexToRgb(colour.value));
  const Ct = Math.hypot(at, bt) * (colour.render?.chroma ?? 1);
  const h = Math.atan2(bt, at);
  const contrast = colour.render?.contrast ?? 1;
  const curve = targetCurve(profiles, Lt);
  const shape = colourShape(profiles, h);
  const Ls = new Float32Array(BINS);
  for (let k = 0; k < BINS; k++) Ls[k] = Math.min(100, Math.max(0, Lt + (curveAt(curve, src.rank[k]) - Lt) * contrast));
  // Limit the stretch, then pull the curve back to the target median so the
  // limit does not move the colour's overall lightness.
  for (let k = 1; k < BINS; k++) Ls[k] = Math.min(Ls[k], Ls[k - 1] + MAX_STEP);
  for (let k = BINS - 2; k >= 0; k--) Ls[k] = Math.max(Ls[k], Ls[k + 1] - MAX_STEP);
  let mid = 0;
  while (mid < BINS - 1 && src.rank[mid] < 0.5) mid++;
  const shift = Lt - Ls[mid];
  const lut = new Uint8ClampedArray(BINS * 3);
  for (let k = 0; k < BINS; k++) {
    const p = src.rank[k];
    const L = Math.min(100, Math.max(0, Ls[k] + shift));
    const C = Ct * curveAt(shape.chroma, p);
    const hh = h + curveAt(shape.hue, p);
    const [r, gg, b] = labToSrgb(L, C * Math.cos(hh), C * Math.sin(hh));
    lut[k * 3] = r; lut[k * 3 + 1] = gg; lut[k * 3 + 2] = b;
  }
  return lut;
}

/** Writes the recoloured photograph into `out` (same size as the source). */
export function renderInto(
  out: Uint8ClampedArray,
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray | Uint8Array,
  src: SourceAnalysis,
  lut: Uint8ClampedArray,
): void {
  const n = mask.length, bins = src.bins;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const w = mask[p];
    if (w === 0) {
      out[i] = rgba[i]; out[i + 1] = rgba[i + 1]; out[i + 2] = rgba[i + 2];
    } else {
      const k = bins[p] * 3;
      if (w === 255) {
        out[i] = lut[k]; out[i + 1] = lut[k + 1]; out[i + 2] = lut[k + 2];
      } else {
        const v = w / 255, u = 1 - v;
        out[i] = rgba[i] * u + lut[k] * v;
        out[i + 1] = rgba[i + 1] * u + lut[k + 1] * v;
        out[i + 2] = rgba[i + 2] * u + lut[k + 2] * v;
      }
    }
    out[i + 3] = rgba[i + 3];
  }
}
