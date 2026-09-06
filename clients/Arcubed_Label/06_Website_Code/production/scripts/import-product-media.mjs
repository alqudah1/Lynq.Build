// Imports real Arcubed product photography into public/media/.
//
// Source: clients/Arcubed_Label/03_Images/*.JPG — 6000x4000 DSLR frames, all
// carrying EXIF orientation 8. `.rotate()` bakes that in; without it every bag
// comes out on its side (raw-pixel tools don't apply EXIF, browsers do).
//
// The frames are catalogue shots on a LIT GREY SEAMLESS (sampled 154->209
// across one frame), not flat white — so sharp's .trim() finds no edge and
// returns the whole frame. lib-object-bbox.mjs locates the bag by edge energy
// instead: crochet is dense high-frequency texture, the backdrop is smooth.
// We crop to that box plus breathing room, which is what turns a catalogue
// shot into a cut-out editorial object.
//
// NOTHING here invents imagery. Crops are crops of real frames.
// Run: node scripts/import-product-media.mjs

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { findObjectBox } from "./lib-object-bbox.mjs";

const SRC = "../../03_Images";
const OUT = "public/media";

/** Full-object cutouts. Trimmed to the bag, padded, exported at 2 widths. */
const OBJECTS = [
  { id: "nova-gold", file: "DSC05787" },
  { id: "nova-black", file: "DSC05780" },
  { id: "nova-silver-gold", file: "DSC05779" },
  { id: "vault-brown", file: "DSC05790" },
  { id: "vault-dark-brown", file: "DSC04876" },
  { id: "mini-luna-red", file: "DSC05774" },
  { id: "loco-brown", file: "DSC05765" },
  { id: "loco-burgundy", file: "DSC05772" },
];

/** Macro details, cropped from the same 24MP originals — real texture, not stock. */
const MACROS = [
  { id: "texture-metallic", file: "DSC05774", rel: { l: 0.05, t: 0.42, w: 0.4, h: 0.34 } },
  { id: "texture-fringe", file: "DSC05765", rel: { l: 0.04, t: 0.3, w: 0.4, h: 0.5 } },
  { id: "texture-chunky", file: "DSC04876", rel: { l: 0.08, t: 0.2, w: 0.42, h: 0.36 } },
];

mkdirSync(OUT, { recursive: true });

async function emit(name, pipeline, widths) {
  for (const w of widths) {
    const suffix = widths.length > 1 ? `-${w}` : "";
    await pipeline.clone().resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 82 }).toFile(`${OUT}/${name}${suffix}.webp`);
  }
}

const boxes = {};
for (const o of OBJECTS) {
  const box = await findObjectBox(`${SRC}/${o.file}.JPG`);
  if (!box) throw new Error(`no object found in ${o.file}`);
  boxes[o.file] = box;
  const pad = Math.round(Math.max(box.width, box.height) * 0.05);
  const region = {
    left: Math.max(0, box.left - pad),
    top: Math.max(0, box.top - pad),
    width: Math.min(box.frame.w - Math.max(0, box.left - pad), box.width + pad * 2),
    height: Math.min(box.frame.h - Math.max(0, box.top - pad), box.height + pad * 2),
  };
  const cropped = await sharp(`${SRC}/${o.file}.JPG`).rotate().extract(region).toBuffer();
  await emit(o.id, sharp(cropped), [1400, 700]);
  console.log(`${o.id.padEnd(18)} ${o.file}  ${region.width}x${region.height}  objW:H ${(box.width / box.height).toFixed(2)}`);
}

// Macros are cropped RELATIVE TO THE DETECTED OBJECT, not the frame, so they
// always land on stitchwork rather than on empty backdrop.
for (const m of MACROS) {
  const box = boxes[m.file] ?? (await findObjectBox(`${SRC}/${m.file}.JPG`));
  const region = {
    left: Math.round(box.left + box.width * m.rel.l),
    top: Math.round(box.top + box.height * m.rel.t),
    width: Math.round(box.width * m.rel.w),
    height: Math.round(box.height * m.rel.h),
  };
  const cropped = await sharp(`${SRC}/${m.file}.JPG`).rotate().extract(region).toBuffer();
  await emit(m.id, sharp(cropped), [1100]);
  console.log(`${m.id.padEnd(18)} ${m.file}  macro ${region.width}x${region.height}`);
}

console.log("\nAll assets are crops/resizes of real Arcubed frames. No imagery generated.");
