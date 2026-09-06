// Produces true alpha cut-outs of each product from the archive frames.
//
// WHY: the catalogue frames sit on a LIT GREY seamless, not white. The
// editorial layout composites objects over pink and navy colour fields, and
// `mix-blend-mode: multiply` only erases a pure-white backdrop — against grey
// it leaves a visible rectangle (confirmed in a real browser screenshot).
// A real alpha channel is the only thing that lets an object sit on any field.
//
// The matte is derived from the same background model used for measurement
// (lib-mask.mjs), computed at high resolution and feathered so edges don't
// alias. Nothing is painted or invented — this only removes backdrop.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { analyzeFrame } from "./lib-mask.mjs";

const SRC = "../../03_Images";
const OUT = "public/media";
mkdirSync(OUT, { recursive: true });

const ITEMS = [
  { id: "nova-gold", file: "DSC05787" },
  { id: "nova-black", file: "DSC05780" },
  { id: "nova-silver-gold", file: "DSC05779" },
  { id: "vault-brown", file: "DSC05790" },
  { id: "mini-luna-red", file: "DSC05774" },
  { id: "loco-brown", file: "DSC05765" },
  { id: "loco-burgundy", file: "DSC05772" },
];

const MATTE_W = 1500;

for (const it of ITEMS) {
  const src = `${SRC}/${it.file}.JPG`;
  const a = await analyzeFrame(src, { probeWidth: MATTE_W, dev: 20 });
  if (!a) { console.log(`${it.id}: NO OBJECT`); continue; }

  // Rebuild the mask as an image at matte resolution, then feather it.
  const { data, info } = await sharp(src).rotate().resize({ width: MATTE_W }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const alpha = Buffer.alloc(w * h);
  // Re-derive per row (same model as lib-mask) so the matte matches the box.
  const m = Math.max(4, Math.round(w * 0.06));
  const med = (arr) => arr.slice().sort((p, q) => p - q)[arr.length >> 1];
  for (let y = 0; y < h; y++) {
    // Model the backdrop as a LINEAR RAMP across the row, sampled at both
    // margins, rather than one median. The seamless is lit from one side and
    // falls off by ~50 levels across a single frame; a single median makes one
    // half of every row read "darker than background" and survive the matte,
    // which is what left a pale box behind each bag.
    const L = [[], [], []], R = [[], [], []];
    for (let x = 0; x < m; x++) {
      const li = (y * w + x) * channels, ri = (y * w + (w - 1 - x)) * channels;
      for (let c = 0; c < 3; c++) { L[c].push(data[li + c]); R[c].push(data[ri + c]); }
    }
    const lbg = [med(L[0]), med(L[1]), med(L[2])];
    const rbg = [med(R[0]), med(R[1]), med(R[2])];
    const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const f = x / (w - 1);
      const bg0 = lbg[0] + (rbg[0] - lbg[0]) * f;
      const bg1 = lbg[1] + (rbg[1] - lbg[1]) * f;
      const bg2 = lbg[2] + (rbg[2] - lbg[2]) * f;
      const bgLum = lum(bg0, bg1, bg2);
      const bgSat = sat(bg0, bg1, bg2);
      // DIRECTIONAL test. An absolute deviation also matches backdrop that is
      // BRIGHTER than the row median (the lit part of the seamless), which is
      // why the first pass left white patches around the bags. Every Arcubed
      // bag is darker and/or more saturated than the backdrop, never brighter,
      // so only those two directions count as object.
      const darker = bgLum - lum(r, g, b);
      const colourful = sat(r, g, b) - bgSat;
      const d = Math.max(darker, colourful * 1.25);
      // Soft ramp, not a hard threshold: preserves Loco's individual fringe
      // strands, which a binary cut chops off.
      alpha[y * w + x] = d <= 10 ? 0 : d >= 28 ? 255 : Math.round(((d - 10) / 18) * 255);
    }
  }

  // Both must be ENCODED buffers — joinChannel cannot infer the geometry of a
  // bare raw buffer.
  const matte = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(1.1).png().toBuffer();
  const rgb = await sharp(src).rotate().resize({ width: MATTE_W }).removeAlpha().png().toBuffer();
  const cut = await sharp(rgb).joinChannel(matte).png().toBuffer();

  const box = a.box;
  const pad = Math.round(Math.max(box.width, box.height) * 0.03);
  const region = {
    left: Math.max(0, box.x0 - pad), top: Math.max(0, box.y0 - pad),
    width: Math.min(w - Math.max(0, box.x0 - pad), box.width + pad * 2),
    height: Math.min(h - Math.max(0, box.y0 - pad), box.height + pad * 2),
  };
  const trimmed = sharp(cut).extract(region);
  for (const width of [1200, 600]) {
    await trimmed.clone().resize({ width, withoutEnlargement: true }).webp({ quality: 86, alphaQuality: 90 }).toFile(`${OUT}/${it.id}-cut-${width}.webp`);
  }
  console.log(`${it.id.padEnd(18)} ${it.file}  cutout ${region.width}x${region.height}  objW:H ${(box.width / box.height).toFixed(2)}`);
}
console.log("\nAlpha cut-outs written. Backdrop removed only — no pixels painted.");
