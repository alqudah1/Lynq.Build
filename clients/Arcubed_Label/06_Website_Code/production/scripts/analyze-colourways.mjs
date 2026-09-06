// Objective colourway analysis of every archive frame.
//
// Samples the OBJECT pixels only (via the shared mask), so the lit grey
// backdrop never skews the reading, and reports mean colour, saturation and
// lightness. This is what the customer-facing colour->media map is built from
// — assigning colourways by eye across 45 frames is exactly how a Gold frame
// ends up labelled Champagne.
import sharp from "sharp";
import { readdirSync, writeFileSync } from "node:fs";
import { analyzeFrame } from "./lib-mask.mjs";

const SRC = "../../03_Images";
const files = readdirSync(SRC).filter((f) => /\.JPG$/i.test(f)).sort();
const out = [];

for (const f of files) {
  const path = `${SRC}/${f}`;
  const a = await analyzeFrame(path, { probeWidth: 400 });
  if (!a) { out.push({ frame: f.replace(".JPG",""), error: "no object" }); continue; }

  const { data, info } = await sharp(path).rotate().resize({ width: 400 }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, channels } = info;
  // Sample the middle band of the object box — avoids the rim highlight and
  // the contact shadow, both of which distort a whole-object mean.
  const y0 = a.box.y0 + Math.round(a.box.height * 0.3);
  const y1 = a.box.y0 + Math.round(a.box.height * 0.75);
  const x0 = a.box.x0 + Math.round(a.box.width * 0.2);
  const x1 = a.box.x0 + Math.round(a.box.width * 0.8);
  let r = 0, g = 0, b = 0, n = 0, maxL = 0, minL = 255;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * channels;
    const L = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    r += data[i]; g += data[i+1]; b += data[i+2]; n++;
    if (L > maxL) maxL = L; if (L < minL) minL = L;
  }
  r = Math.round(r/n); g = Math.round(g/n); b = Math.round(b/n);
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
  const sat = mx === 0 ? 0 : Math.round(((mx - mn) / mx) * 100);
  const lum = Math.round(0.299*r + 0.587*g + 0.114*b);
  // Specular range is how "metallic" a yarn reads: metallic ribbon swings
  // hard between highlight and shadow, matte cotton does not.
  const specular = Math.round(maxL - minL);
  let hue = 0;
  const d = mx - mn;
  if (d !== 0) {
    if (mx === r) hue = 60 * (((g - b) / d) % 6);
    else if (mx === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
    if (hue < 0) hue += 360;
  }
  out.push({ frame: f.replace(".JPG",""), rgb: [r,g,b], hex: "#"+[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join(""), hue: Math.round(hue), sat, lum, specular });
}

writeFileSync(".blockouts/colourways.json", JSON.stringify(out, null, 2));
console.log("frame     hex      hue  sat  lum  spec");
for (const o of out) {
  if (o.error) { console.log(o.frame, o.error); continue; }
  console.log(o.frame.padEnd(9), o.hex.padEnd(8), String(o.hue).padStart(3), String(o.sat).padStart(4), String(o.lum).padStart(4), String(o.specular).padStart(5));
}
