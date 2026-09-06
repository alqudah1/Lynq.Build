// Builds every customer-facing media asset from the archive, and emits the
// typed manifest the app imports. Single source of truth — replaces the
// earlier import-product-media.mjs / make-cutouts.mjs pair.
//
// Per frame it produces:
//   <frame>-{1600,800}.webp      framed photo, cropped to the object + margin
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
import { PRODUCT_MEDIA, TEXTURE_CROPS, allFrames, REJECTED_CUTOUTS } from "./media-manifest.mjs";

const SRC = "../../03_Images";
const OUT = "public/media";
const MATTE_W = 1600;
mkdirSync(OUT, { recursive: true });

const geom = {};

function geomFor(a, w, h) {
  const pad = Math.round(Math.max(a.box.width, a.box.height) * 0.05);
  const left = Math.max(0, a.box.x0 - pad), top = Math.max(0, a.box.y0 - pad);
  const width = Math.max(1, Math.min(a.box.width + pad * 2, w - left));
  const height = Math.max(1, Math.min(a.box.height + pad * 2, h - top));
  return { ratio: +(width / height).toFixed(4), objectRatio: +(a.box.width / a.box.height).toFixed(4) };
}

async function objectMatte(file, w, h, data, channels) {
  const alpha = Buffer.alloc(w * h);
  const m = Math.max(4, Math.round(w * 0.06));
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
  for (let y = 0; y < h; y++) {
    const L = [[], [], []], R = [[], [], []];
    for (let x = 0; x < m; x++) {
      const li = (y * w + x) * channels, ri = (y * w + (w - 1 - x)) * channels;
      for (let c = 0; c < 3; c++) { L[c].push(data[li + c]); R[c].push(data[ri + c]); }
    }
    const lbg = [med(L[0]), med(L[1]), med(L[2])];
    const rbg = [med(R[0]), med(R[1]), med(R[2])];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const f = x / (w - 1);
      const b0 = lbg[0] + (rbg[0] - lbg[0]) * f;
      const b1 = lbg[1] + (rbg[1] - lbg[1]) * f;
      const b2 = lbg[2] + (rbg[2] - lbg[2]) * f;
      // Directional: objects are darker and/or more saturated than the lit
      // seamless, never brighter. An absolute deviation keeps backdrop
      // highlights and leaves a pale box behind the bag.
      const d = Math.max(lum(b0, b1, b2) - lum(data[i], data[i+1], data[i+2]),
                         (sat(data[i], data[i+1], data[i+2]) - sat(b0, b1, b2)) * 1.25);
      alpha[y * w + x] = d <= 10 ? 0 : d >= 28 ? 255 : Math.round(((d - 10) / 18) * 255);
    }
  }
  return alpha;
}

for (const frame of allFrames()) {
  const src = `${SRC}/${frame}.JPG`;
  const a = await analyzeFrame(src, { probeWidth: MATTE_W, dev: 20 });
  if (!a) { console.log(`${frame}: NO OBJECT — skipped`); continue; }

  const done = [1600, 800].every((x) => existsSync(`${OUT}/${frame}-${x}.webp`))
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

  // Alpha cut-out.
  const alpha = await objectMatte(src, w, h, data, channels);
  const matte = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(1.1).png().toBuffer();
  const rgb = await sharp(src).rotate().resize({ width: MATTE_W }).removeAlpha().png().toBuffer();
  const cutBuf = await sharp(rgb).joinChannel(matte).png().toBuffer();
  for (const width of [1200, 600]) {
    await sharp(cutBuf).extract(region).resize({ width, withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 90 }).toFile(`${OUT}/${frame}-cut-${width}.webp`);
  }

  geom[frame] = { ratio: +(region.width / region.height).toFixed(4), objectRatio: +(a.box.width / a.box.height).toFixed(4) };
  process.stdout.write(".");
}
console.log("");

for (const t of TEXTURE_CROPS) {
  const a = await analyzeFrame(`${SRC}/${t.frame}.JPG`, { probeWidth: MATTE_W, dev: 20 });
  const r = {
    left: Math.round(a.box.x0 + a.box.width * t.rel.l), top: Math.round(a.box.y0 + a.box.height * t.rel.t),
    width: Math.round(a.box.width * t.rel.w), height: Math.round(a.box.height * t.rel.h),
  };
  // One resize per pipeline — resizing after .extract() invalidates the
  // region, same failure the framed/cut paths hit.
  const tBuf = await sharp(`${SRC}/${t.frame}.JPG`).rotate().resize({ width: MATTE_W }).png().toBuffer();
  const tm = await sharp(tBuf).metadata();
  r.left = Math.max(0, Math.min(r.left, tm.width - 1));
  r.top = Math.max(0, Math.min(r.top, tm.height - 1));
  r.width = Math.max(1, Math.min(r.width, tm.width - r.left));
  r.height = Math.max(1, Math.min(r.height, tm.height - r.top));
  await sharp(tBuf).extract(r).resize({ width: 1100 }).webp({ quality: 84 }).toFile(`${OUT}/${t.id}.webp`);
  geom[t.id] = { ratio: +(r.width / r.height).toFixed(4) };
  console.log(`${t.id.padEnd(18)} ${t.frame}  ${r.width}x${r.height}`);
}

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
lines.push("}");
lines.push("");
lines.push("function f(id: string, ratio: number, cutOk = true): Frame {");
lines.push("  return {");
lines.push("    photo: `/media/${id}-1600.webp`,");
lines.push("    photoSmall: `/media/${id}-800.webp`,");
lines.push("    cut: `/media/${id}-cut-1200.webp`,");
lines.push("    cutSmall: `/media/${id}-cut-600.webp`,");
lines.push("    ratio,");
lines.push("    frameId: id,");
lines.push("    cutOk,");
lines.push("  };");
lines.push("}");
lines.push("");
lines.push("export const COLOUR_MEDIA: Record<string, Record<string, Frame[]>> = {");
for (const [slug, p] of Object.entries(PRODUCT_MEDIA)) {
  lines.push(`  ${JSON.stringify(slug)}: {`);
  for (const [colour, v] of Object.entries(p.colours)) {
    const all = [...v.frames, ...(v.withHandle ?? [])].filter((x) => geom[x]);
    lines.push(`    ${JSON.stringify(colour)}: [${all.map((x) => `f(${JSON.stringify(x)}, ${geom[x].ratio}${REJECTED_CUTOUTS.has(x) ? ", false" : ""})`).join(", ")}],`);
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
