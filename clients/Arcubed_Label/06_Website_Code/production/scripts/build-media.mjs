// Builds every customer-facing media asset from the archive, and emits the
// typed manifest the app imports. Single source of truth — replaces the
// earlier import-product-media.mjs / make-cutouts.mjs pair.
//
// Per frame it produces:
//   <frame>-{2600,1600,800}.webp framed photo, cropped to the object + margin
//   <frame>-cut-{1200,600}.webp  alpha cut-out for editorial composition
//
// The framed photo is the honest default for galleries (it is the client's
// actual product photography). The cut-out exists so objects can sit on the
// pink/navy colour fields without the grey seamless showing as a rectangle.
//
// Run: node scripts/build-media.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { analyzeFrame } from "./lib-mask.mjs";
import { PRODUCT_MEDIA, TEXTURE_CROPS, DETAIL_CROPS, allFrames, REJECTED_CUTOUTS, HIRES_PHOTOS, HIRES_CUTS } from "./media-manifest.mjs";
import { objectMatte } from "./lib-matte.mjs";
import { buildTextures, buildDetails } from "./build-textures.mjs";

const SRC = "../../03_Images";
const OUT = "public/media";
const MATTE_W = 1600;
// Proxy width for the framed-photo crop. Must be a whole multiple of MATTE_W
// so the analysed region maps onto it exactly.
const HIRES_W = 3200;
mkdirSync(OUT, { recursive: true });

const geom = {};

function geomFor(a, w, h) {
  const pad = Math.round(Math.max(a.box.width, a.box.height) * 0.05);
  const left = Math.max(0, a.box.x0 - pad), top = Math.max(0, a.box.y0 - pad);
  const width = Math.max(1, Math.min(a.box.width + pad * 2, w - left));
  const height = Math.max(1, Math.min(a.box.height + pad * 2, h - top));
  return { ratio: +(width / height).toFixed(4), objectRatio: +(a.box.width / a.box.height).toFixed(4) };
}

for (const frame of allFrames()) {
  const src = `${SRC}/${frame}.JPG`;
  const a = await analyzeFrame(src, { probeWidth: MATTE_W, dev: 20 });
  if (!a) { console.log(`${frame}: NO OBJECT — skipped`); continue; }

  // A rejected cut-out means the framed photo IS the hero, and HIRES_PHOTOS
  // names the frames whose framed photo is drawn large even though their
  // cut-out is fine. Both need the crop re-cut from the 3200px proxy.
  const needsHiRes = REJECTED_CUTOUTS.has(frame) || HIRES_PHOTOS.has(frame);
  const needsHiResCut = HIRES_CUTS.has(frame);
  const done = [1600, 800].every((x) => existsSync(`${OUT}/${frame}-${x}.webp`))
    && (!needsHiRes || existsSync(`${OUT}/${frame}-2600.webp`))
    && (!needsHiResCut || existsSync(`${OUT}/${frame}-cut-2600.webp`))
    && [1200, 600].every((x) => existsSync(`${OUT}/${frame}-cut-${x}.webp`));

  const { data, info } = await sharp(src).rotate().resize({ width: MATTE_W }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const pad = Math.round(Math.max(a.box.width, a.box.height) * 0.05);
  const region = {
    left: Math.max(0, a.box.x0 - pad), top: Math.max(0, a.box.y0 - pad),
    width: Math.min(w - Math.max(0, a.box.x0 - pad), a.box.width + pad * 2),
    height: Math.min(h - Math.max(0, a.box.y0 - pad), a.box.height + pad * 2),
  };

  // Clamp defensively: a box touching the frame edge can otherwise produce a
  // region that runs past the image and sharp fails with "bad extract area".
  region.left = Math.max(0, Math.min(region.left, w - 1));
  region.top = Math.max(0, Math.min(region.top, h - 1));
  region.width = Math.max(1, Math.min(region.width, w - region.left));
  region.height = Math.max(1, Math.min(region.height, h - region.top));
  if (region.width < 32 || region.height < 32) {
    console.log(`\n${frame}: region too small (${region.width}x${region.height}) in ${w}x${h} — skipped`);
    continue;
  }

  if (done) {
    geom[frame] = geomFor(a, w, h);
    process.stdout.write("=");
    continue;
  }

  // Framed photo (real photography, backdrop intact).
  // Materialise the resized frame first: sharp allows only ONE resize per
  // pipeline, so resizing again after .extract() silently invalidates the
  // extract region and fails with "bad extract area".
  const baseBuf = await sharp(src).rotate().resize({ width: MATTE_W }).png().toBuffer();
  for (const width of [1600, 800]) {
    await sharp(baseBuf).extract(region).resize({ width, withoutEnlargement: true })
      .webp({ quality: 84 }).toFile(`${OUT}/${frame}-${width}.webp`);
  }

  // The framed photo used to top out at 1600px because it was cropped out of
  // the 1600px matte proxy, which throws away the 6000px original before the
  // crop ever happens. Products with no usable cut-out (Loco) show this framed
  // photo as a full-bleed main image, where 1600px is under half the device
  // pixels a 1440px-wide retina viewport asks for. This re-does the same crop
  // against a HIRES_W proxy, so the region has real pixels behind it.
  // Only products with no usable cut-out show this framed photo as a large
  // full-bleed main, so only those frames earn a 2600px file. Generating it
  // for all 53 added 68MB of images that nothing renders at that size.
  if (needsHiRes) {
  const scale = HIRES_W / MATTE_W;
  const hiRegion = {
    left: Math.round(region.left * scale), top: Math.round(region.top * scale),
    width: Math.round(region.width * scale), height: Math.round(region.height * scale),
  };
  const hiBuf = await sharp(src).rotate().resize({ width: HIRES_W }).png().toBuffer();
  const hiMeta = await sharp(hiBuf).metadata();
  hiRegion.width = Math.min(hiRegion.width, hiMeta.width - hiRegion.left);
  hiRegion.height = Math.min(hiRegion.height, hiMeta.height - hiRegion.top);
  await sharp(hiBuf).extract(hiRegion).resize({ width: 2600, withoutEnlargement: true })
    .webp({ quality: 82 }).toFile(`${OUT}/${frame}-2600.webp`);
  }

  // Alpha cut-out.
  const alpha = await objectMatte(src, w, h, data, channels);
  const matte = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(1.1).png().toBuffer();
  const rgb = await sharp(src).rotate().resize({ width: MATTE_W }).removeAlpha().png().toBuffer();
  const cutBuf = await sharp(rgb).joinChannel(matte).png().toBuffer();
  for (const width of [1200, 600]) {
    await sharp(cutBuf).extract(region).resize({ width, withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 90 }).toFile(`${OUT}/${frame}-cut-${width}.webp`);
  }

  // THE LARGE CUT-OUT COMES FROM THE ORIGINAL, NOT FROM THE PROXY.
  //
  // Everything above composites onto RGB from the 1600px matte proxy, which
  // is right for a swatch and wrong for the biggest object on the homepage:
  // DSC05792's crop out of that proxy is 1452px and the file it was written
  // to is 2860px, a 1.97x enlargement sold as a 2600-class asset.
  //
  // Here the SAME crop rectangle is scaled from probe space onto the
  // 6000x4000 original, so the region carries 5445 real pixels and 2600 is a
  // downsample. Only the matte is enlarged — a blurred edge mask has no fine
  // detail to lose, and every pixel the viewer actually looks at is the
  // photograph's.
  if (needsHiResCut) {
    const fullRgb = await sharp(src).rotate().removeAlpha().png().toBuffer();
    const fm = await sharp(fullRgb).metadata();
    const k = fm.width / MATTE_W;
    const hiRegion = {
      left: Math.max(0, Math.round(region.left * k)),
      top: Math.max(0, Math.round(region.top * k)),
      width: Math.round(region.width * k),
      height: Math.round(region.height * k),
    };
    hiRegion.width = Math.max(1, Math.min(hiRegion.width, fm.width - hiRegion.left));
    hiRegion.height = Math.max(1, Math.min(hiRegion.height, fm.height - hiRegion.top));
    const hiMatte = await sharp(matte)
      .resize({ width: fm.width, height: fm.height, fit: "fill" }).toBuffer();
    const hiCut = await sharp(fullRgb).joinChannel(hiMatte).png().toBuffer();
    await sharp(hiCut).extract(hiRegion).resize({ width: 2600, withoutEnlargement: true })
      // 90/92 rather than 86/90: this one is drawn at poster scale and its
      // whole subject is crochet texture, which is the first thing a lower
      // setting destroys.
      .webp({ quality: 90, alphaQuality: 92 }).toFile(`${OUT}/${frame}-cut-2600.webp`);
    console.log(`\n${frame}: hi-res cut-out ${hiRegion.width}x${hiRegion.height} -> 2600px (was a ${region.width}px crop enlarged)`);
  }

  geom[frame] = { ratio: +(region.width / region.height).toFixed(4), objectRatio: +(a.box.width / a.box.height).toFixed(4) };
  process.stdout.write(".");
}
console.log("");

// Textures come from scripts/build-textures.mjs, which crops the FULL
// resolution originals. Doing it here used to crop an already-downscaled
// 1600px proxy and then upscale the result — running this file would silently
// undo the macro fix, so it delegates instead of duplicating.
Object.assign(geom, await buildTextures());
// Gallery detail frames — same extraction, but they are appended to a real
// colourway below rather than exported as editorial texture.
Object.assign(geom, await buildDetails());

// Emit the typed manifest the app imports.
const lines = [];
lines.push("// AUTO-GENERATED by scripts/build-media.mjs — do not edit by hand.");
lines.push("// Product+colourway -> real archive photography. See scripts/media-manifest.mjs");
lines.push("// for how each assignment was established (object-pixel colour analysis +");
lines.push("// visual confirmation against the live catalogue colour list).");
lines.push("");
lines.push("export interface Frame {");
lines.push("  /** Framed real photography — the honest default for galleries. */");
lines.push("  photo: string;");
lines.push("  photoSmall: string;");
lines.push("  /** Alpha cut-out — for editorial composition over colour fields. */");
lines.push("  cut: string;");
lines.push("  cutSmall: string;");
lines.push("  /** width/height of the framed crop. */");
lines.push("  ratio: number;");
lines.push("  /** false when visual QA rejected the cut-out — use `photo`, never `cut`. */");
lines.push("  cutOk: boolean;")
lines.push("  frameId: string;");
lines.push("  /** True for a macro crop of another frame rather than a whole-bag view. */");
lines.push("  detail?: true;");
lines.push("  /** Set only on detail frames, which the generic alt would describe wrongly. */");
lines.push("  alt?: string;");
lines.push("}");
lines.push("");
lines.push("function f(id: string, ratio: number, cutOk = true, hires = !cutOk): Frame {");
lines.push("  return {");
lines.push("    // `hires` is its own axis, not a synonym for a failed cut-out. It");
lines.push("    // defaults to !cutOk, because a frame with no usable cut-out is shown");
lines.push("    // as a large photograph by definition — but a frame with a perfectly");
lines.push("    // good cut-out can ALSO be drawn large somewhere (see HIRES_PHOTOS),");
lines.push("    // and 1600 is not enough for that. Note that -1600 is a ceiling, not a");
lines.push("    // width: the crop is whatever the object box occupies, 1184 to 1552px.");
lines.push("    photo: hires ? `/media/${id}-2600.webp` : `/media/${id}-1600.webp`,");
lines.push("    photoSmall: `/media/${id}-800.webp`,");
lines.push("    cut: `/media/${id}-cut-2600.webp`,");
lines.push("    cutSmall: `/media/${id}-cut-600.webp`,");
lines.push("    ratio,");
lines.push("    frameId: id,");
lines.push("    cutOk,");
lines.push("  };");
lines.push("}");
lines.push("");
lines.push("/**");
lines.push(" * A macro DETAIL crop of a real frame (scripts/media-manifest.mjs,");
lines.push(" * DETAIL_CROPS). It is a rectangle out of the full-resolution original, so");
lines.push(" * there is no cut-out and no whole-bag silhouette: the crop IS the image,");
lines.push(" * and `-full` is its true size rather than a width it was enlarged to hit.");
lines.push(" */");
lines.push("function d(id: string, ratio: number, alt: string): Frame {");
lines.push("  return {");
lines.push("    photo: `/media/${id}-full.webp`,");
lines.push("    photoSmall: `/media/${id}-800.webp`,");
lines.push("    cut: `/media/${id}-full.webp`,");
lines.push("    cutSmall: `/media/${id}-800.webp`,");
lines.push("    ratio,");
lines.push("    frameId: id,");
lines.push("    cutOk: false,");
lines.push("    detail: true,");
lines.push("    alt,");
lines.push("  };");
lines.push("}");
lines.push("");
lines.push("export const COLOUR_MEDIA: Record<string, Record<string, Frame[]>> = {");
for (const [slug, p] of Object.entries(PRODUCT_MEDIA)) {
  lines.push(`  ${JSON.stringify(slug)}: {`);
  for (const [colour, v] of Object.entries(p.colours)) {
    const all = [...v.frames, ...(v.withHandle ?? [])].filter((x) => geom[x]);
    const parts = all.map((x) => {
      const cutOk = !REJECTED_CUTOUTS.has(x);
      // Only spell out the third and fourth arguments when they differ from
      // what f() would infer, so the manifest stays readable.
      const args = !cutOk ? ", false" : HIRES_PHOTOS.has(x) ? ", true, true" : "";
      return `f(${JSON.stringify(x)}, ${geom[x].ratio}${args})`;
    });
    // Detail crops go LAST: the gallery leads on the whole bag, and a macro
    // as frames[0] would become the swatch, the cart thumbnail and the wall
    // tile as well, none of which can read a close-up.
    for (const t of DETAIL_CROPS) {
      if (t.slug !== slug || t.colour !== colour || !geom[t.id]) continue;
      parts.push(`d(${JSON.stringify(t.id)}, ${geom[t.id].ratio}, ${JSON.stringify(t.alt)})`);
    }
    lines.push(`    ${JSON.stringify(colour)}: [${parts.join(", ")}],`);
  }
  lines.push("  },");
}
lines.push("};");
lines.push("");
lines.push("/** Photographed but NOT purchasable — editorial use only, never as a product option. */");
lines.push("export const EDITORIAL_ONLY: Record<string, Frame[]> = {");
for (const [slug, p] of Object.entries(PRODUCT_MEDIA)) {
  const all = Object.values(p.editorialOnly ?? {}).flat().filter((x) => geom[x]);
  if (all.length) lines.push(`  ${JSON.stringify(slug)}: [${all.map((x) => `f(${JSON.stringify(x)}, ${geom[x].ratio}${REJECTED_CUTOUTS.has(x) ? ", false" : ""})`).join(", ")}],`);
}
lines.push("};");
lines.push("");
lines.push("export const TEXTURES = {");
for (const t of TEXTURE_CROPS) {
  lines.push(`  ${JSON.stringify(t.id.replace("texture-", ""))}: { src: ${JSON.stringify(`/media/${t.id}.webp`)}, ratio: ${geom[t.id].ratio} },`);
}
lines.push("} as const;");
lines.push("");
writeFileSync("src/lib/media-manifest.ts", lines.join("\n"));
console.log(`\nGenerated src/lib/media-manifest.ts for ${Object.keys(geom).length} assets.`);
