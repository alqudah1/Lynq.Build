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
import { TEXTURE_CROPS, DETAIL_CROPS } from "./media-manifest.mjs";

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
  // DSC05774 (the red hero bag) is the WORST frame in the archive for a macro:
  // its object box covers only 67% of the sensor, against 90-95% for others,
  // so every crop taken from it has the fewest real pixels available. That is
  // why the material moment stayed soft no matter how the output was sized.
  //
  // These two come from the frames with the most sensor coverage, and they are
  // different PRODUCTS from the hero, so the story stops repeating one bag.
  // PORTRAIT-ish on purpose. The material panel is roughly 892x900, and a
  // 2.5:1 crop placed in it with object-fit:cover is scaled to fill the
  // HEIGHT, which upscaled a 373px-tall derivative by 2.4x. `sizes` only ever
  // describes width, so it cannot prevent that: the crop's aspect has to be
  // close to the box's.
  // `rel` is a fraction of the DETECTED OBJECT BOX, not of the sensor, so
  // w:0.44 meant "44% of the bag's width" — about six stitch rows blown
  // across a 890px panel. That is why the material moment still read as
  // pixelated wallpaper after the resolution work: the fault was the crop
  // window, not the pixel count. At 0.72 x 0.74 the frame keeps the top edge
  // and the handle join, so it reads as a crocheted OBJECT with loops,
  // ribbon and shine rather than as an abstract gold pattern.
  // NOTE the id: renamed from `macro-ribbon` because Next's optimizer keys
  // derivatives on the URL and kept serving the old crop after an in-place
  // rebuild, even across a dev restart and a cleared image cache.
  //
  // `t` is NEGATIVE on purpose. It is a fraction of the object box, so 0.10
  // started the window a tenth of the way DOWN the bag, below the apex of the
  // handle, and the arch was sliced flat by the top edge of the frame at every
  // width. Starting 6% above the box includes the studio ground over the
  // handle, so the arch reads as a complete object. Width and height are
  // unchanged, so the output ratio the CSS box matches is unchanged too.
  { id: "macro-material", frame: "DSC04874", rel: { l: 0.14, t: -0.06, w: 0.72, h: 0.74 } },
  // Two-tone banding rather than the fringe: DSC05765's fringe is dark brown
  // on dark and reads as a muddy rectangle at detail size, whereas the silver
  // and gold bands are legible small and add a third colourway to the story.
  // Squarer than before: at 2.98:1 it was a letterboxed sliver.
  { id: "macro-twotone", frame: "DSC04866", rel: { l: 0.30, t: 0.18, w: 0.40, h: 0.62 } },
  // A narrow band of ribbon for the MATERIAL -> FORM handoff. Carries the
  // real texture into the section that introduces the four silhouettes, so
  // the two moments read as one transition instead of texture, then a poster.
  // NOTE the id changed from `macro-thread`: Next's image optimizer keys its
  // derivatives on the URL, and overwriting a file in place kept serving the
  // previous crop even after clearing .next/cache/images and restarting the
  // dev server. A rebuilt crop needs a new name to be certain it ships.
  // Kept inside the object across its FULL width: at l:0.16 w:0.68 the window
  // ran off the bag at t:0.30 (where the body narrows toward the handle) and
  // the band faded into studio white, which read as a gradient rather than as
  // yarn. Mid body, where the form is at its widest.
  { id: "macro-ribbon-band", frame: "DSC04870", rel: { l: 0.09, t: 0.56, w: 0.64, h: 0.20 } },
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

/**
 * Gallery detail frames (DETAIL_CROPS).
 *
 * Same extraction as the macros above, two differences that matter:
 *
 *  - TWO widths, because these are real gallery frames and need a thumbnail
 *    as well as a main image.
 *  - the large one is named `-full`, not `-2600`, because it is whatever the
 *    crop actually contains and is never enlarged to hit a number. The
 *    archive already has files called `-1600` that are 1184px wide and that
 *    misnaming cost a whole audit pass; a crop cannot honestly claim a width
 *    it does not have.
 */
export async function buildDetails(log = console.log) {
  const geom = {};
  for (const t of DETAIL_CROPS) {
    const src = `${SRC}/${t.frame}.JPG`;
    const a = await analyzeFrame(src, { probeWidth: PROBE_W, dev: 20 });
    const probe = {
      left: a.box.x0 + a.box.width * t.rel.l,
      top: a.box.y0 + a.box.height * t.rel.t,
      width: a.box.width * t.rel.w,
      height: a.box.height * t.rel.h,
    };
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

    const outW = Math.min(OUT_W, r.width);
    // 88, matching the macros: this is shown large and the whole point of it
    // is texture, which is the first thing a low quality setting destroys.
    await sharp(full).extract(r).resize({ width: outW }).webp({ quality: 88 })
      .toFile(`${OUT}/${t.id}-full.webp`);
    await sharp(full).extract(r).resize({ width: 800 }).webp({ quality: 86 })
      .toFile(`${OUT}/${t.id}-800.webp`);
    geom[t.id] = { ratio: +(r.width / r.height).toFixed(4) };
    log(`${t.id.padEnd(18)} ${t.frame}  source crop ${r.width}x${r.height}  ->  ${outW}px wide + 800px thumb`);
  }
  return geom;
}

// pathToFileURL, not string concatenation: this repo lives under a path with
// a space in it, which import.meta.url percent-encodes and process.argv does
// not, so the naive comparison never matched and the script silently did
// nothing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildTextures();
  await buildDetails();
}
