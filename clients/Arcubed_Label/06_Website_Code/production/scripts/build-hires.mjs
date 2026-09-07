// High-resolution alpha cut-outs, rebuilt from the 6000x4000 originals.
//
// WHY: the storefront's cut-outs were 1200px, and the homepage draws the hero
// bag at 950 CSS px (1900 device px on a 2x screen) while Next was serving a
// 828px derivative. Measured upscale at 1440 was 1.18x on the hero and worse
// on the product stage. Upscaling a 1200px derivative cannot fix that; the
// only fix is more real detail.
//
// HOW: colour comes from the original at full resolution; the MATTE is still
// computed by the proven 1600px path (scripts/lib-matte.mjs) and its alpha is
// then resized up to meet it. That split is deliberate — the matte is a soft
// mask where a smooth resize costs nothing visible, while the colour channel
// is where every stitch lives and must not be invented.
//
// Usage: node scripts/build-hires.mjs [--force]
import sharp from "sharp";
import { existsSync } from "node:fs";
import { analyzeFrame } from "./lib-mask.mjs";
import { objectMatte } from "./lib-matte.mjs";
import { allFrames, REJECTED_CUTOUTS } from "./media-manifest.mjs";

const SRC = "../../03_Images";
const OUT = "public/media";
/** Must match build-media.mjs, so the object box lands in the same space. */
const MATTE_W = 1600;
/**
 * Target width of the BAG, not of the frame.
 *
 * Sizing the frame to 2400 meant the extracted object was only whatever
 * fraction of the frame it happened to fill: the hero cut-out came out at
 * 1775px, and the homepage draws it at 1022 CSS px, which is under 2x for a
 * retina display and read as soft. Scaling so the OBJECT lands on the target
 * makes the number mean what it says.
 */
const TARGET = 2600;
/** Guard on the intermediate full-frame resize, which is what costs memory. */
const MAX_FRAME_W = 7000;
const force = process.argv.includes("--force");

let built = 0, skipped = 0;
for (const frame of allFrames()) {
  const dst = `${OUT}/${frame}-cut-${TARGET}.webp`;
  if (!force && existsSync(dst)) { skipped++; continue; }
  // Frames whose matte failed QA are never shown as cut-outs, so a
  // high-resolution version of a rejected matte would be wasted bytes.
  if (REJECTED_CUTOUTS.has(frame)) { skipped++; continue; }

  const src = `${SRC}/${frame}.JPG`;
  const a = await analyzeFrame(src, { probeWidth: MATTE_W, dev: 20 });
  if (!a) { console.log(`${frame}: no object, skipped`); continue; }

  const probe = await sharp(src).rotate().resize({ width: MATTE_W }).raw().toBuffer({ resolveWithObject: true });
  const { width: pw, height: ph, channels } = probe.info;
  const alpha = await objectMatte(src, pw, ph, probe.data, channels);

  // Scale the frame so the OBJECT lands on TARGET, then extract. Never
  // enlarged past the original: the frame is 6000px wide, so a bag filling a
  // third of it can still reach 2600 without inventing detail.
  const objectFractionOfFrame = a.box.width / pw;
  const frameW = Math.min(MAX_FRAME_W, Math.round(TARGET / objectFractionOfFrame));
  const rgbBuf = await sharp(src).rotate().resize({ width: frameW, withoutEnlargement: true }).removeAlpha().png().toBuffer();
  const rm = await sharp(rgbBuf).metadata();

  // Matte up to meet it. Blur is applied at probe scale first so the edge
  // stays as soft as the 1200px asset's, not softer.
  const matte = await sharp(alpha, { raw: { width: pw, height: ph, channels: 1 } })
    .blur(1.1).resize({ width: rm.width, height: rm.height }).png().toBuffer();

  const cut = await sharp(rgbBuf).joinChannel(matte).png().toBuffer();

  // Object box, scaled from probe space into target space.
  const k = rm.width / pw;
  const pad = Math.max(a.box.width, a.box.height) * 0.05;
  const left = Math.max(0, Math.round((a.box.x0 - pad) * k));
  const top = Math.max(0, Math.round((a.box.y0 - pad) * k));
  const region = {
    left, top,
    width: Math.min(rm.width - left, Math.round((a.box.width + pad * 2) * k)),
    height: Math.min(rm.height - top, Math.round((a.box.height + pad * 2) * k)),
  };

  await sharp(cut).extract(region).webp({ quality: 86, alphaQuality: 92 }).toFile(dst);
  const om = await sharp(dst).metadata();
  built++;
  console.log(`${frame}  object ${om.width}x${om.height}  (frame scaled to ${frameW}px)`);
}
console.log(`\nbuilt ${built}, skipped ${skipped}`);
