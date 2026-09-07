// Macro texture crops, rebuilt from the FULL-RESOLUTION originals.
//
// THE BUG THIS FIXES: build-media.mjs took its texture crops from a frame it
// had already downscaled to 1600px wide (MATTE_W, the width the matte prober
// works at), then upscaled the result to 1100px. A crop of roughly 40% of the
// object box out of a 1600px proxy is about 600px of real detail — blown up
// to 1100 and then displayed across a 1440px viewport at 119% width and 1.2x
// scale, which is where the visible pixelation came from.
//
// The archive originals are 6000x4000. The crop rectangle is still computed in
// the 1600px probe space (that is where the object box is measured), then
// scaled up to full-resolution coordinates before extraction. Same crop, same
// framing, roughly six times the real detail, and DOWN-sampled to the output
// width instead of up.
//
// Usage: node scripts/build-textures.mjs
import sharp from "sharp";
import { pathToFileURL } from "node:url";
import { analyzeFrame } from "./lib-mask.mjs";
import { TEXTURE_CROPS } from "./media-manifest.mjs";

const SRC = "../../03_Images";
const OUT = "public/media";
/** The width the object box is measured at — must match build-media.mjs. */
const PROBE_W = 1600;
/** Output width. Above the largest viewport this is ever drawn across. */
const OUT_W = 2600;

/**
 * A wider close crop, for the one place a macro is drawn full-bleed: the
 * homepage material moment.
 *
 * The shared TEXTURE_CROPS window is 40% of the object box, which is only
 * about 1076px even out of a 6000px original — well under the ~1714px that
 * moment is drawn across at 1440, so it still had to upscale. This window is
 * wider (72% of the box) and lands around 1900px, so it renders at or above
 * 1:1 at rest. Same frame as the hero bag, deliberately: the material moment
 * is that exact object's own yarn.
 */
const HOMEPAGE_MACROS = [
  { id: "macro-metallic", frame: "DSC05774", rel: { l: 0.12, t: 0.44, w: 0.72, h: 0.44 } },
  // About draws its texture full-bleed at 1440. The shared chunky crop is
  // 1318px, so it was being enlarged by more than half again.
  { id: "macro-chunky", frame: "DSC05790", rel: { l: 0.08, t: 0.30, w: 0.84, h: 0.40 } },
];

export async function buildTextures(log = console.log) {
  const geom = {};
  for (const t of [...TEXTURE_CROPS, ...HOMEPAGE_MACROS]) {
    const src = `${SRC}/${t.frame}.JPG`;
    const a = await analyzeFrame(src, { probeWidth: PROBE_W, dev: 20 });

    // Crop rectangle in probe space, from the detected object box.
    const probe = {
      left: a.box.x0 + a.box.width * t.rel.l,
      top: a.box.y0 + a.box.height * t.rel.t,
      width: a.box.width * t.rel.w,
      height: a.box.height * t.rel.h,
    };

    // Full-resolution, correctly oriented. .rotate() applies the EXIF
    // orientation (every frame in this archive is orientation 8), so the
    // probe's coordinate space and this one agree.
    const full = await sharp(src).rotate().toBuffer();
    const fm = await sharp(full).metadata();
    const k = fm.width / PROBE_W;

    const r = {
      left: Math.max(0, Math.round(probe.left * k)),
      top: Math.max(0, Math.round(probe.top * k)),
      width: Math.round(probe.width * k),
      height: Math.round(probe.height * k),
    };
    r.width = Math.max(1, Math.min(r.width, fm.width - r.left));
    r.height = Math.max(1, Math.min(r.height, fm.height - r.top));

    // Never upscale: if the crop is smaller than the target, keep it native.
    const outW = Math.min(OUT_W, r.width);
    await sharp(full).extract(r).resize({ width: outW }).webp({ quality: 88 }).toFile(`${OUT}/${t.id}.webp`);
    geom[t.id] = { ratio: +(r.width / r.height).toFixed(4) };
    log(`${t.id.padEnd(18)} ${t.frame}  source crop ${r.width}x${r.height}  ->  ${outW}px wide  (was 1100 from a ~${Math.round(r.width / k)}px crop)`);
  }
  return geom;
}

// pathToFileURL, not string concatenation: this repo lives under a path with
// a space in it, which import.meta.url percent-encodes and process.argv does
// not, so the naive comparison never matched and the script silently did
// nothing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) await buildTextures();
