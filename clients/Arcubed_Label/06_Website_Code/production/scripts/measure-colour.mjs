// Per-colourway base colour, measured off the photography rather than picked.
// Reports the median of the brighter half of the bag's pixels: crochet is a
// deeply shadowed surface, so a plain mean reads far darker than the yarn.
import sharp from "sharp";
const FRAMES = { Red: "DSC05774", Silver: "DSC04875", Gold: "DSC04874", Black: "DSC04872", "Silver & Gold": "DSC04870" };
for (const [name, id] of Object.entries(FRAMES)) {
  const { data, info } = await sharp(`public/media/${id}-cut-1200.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const C = info.channels;
  const px = [];
  for (let i = 0; i < data.length; i += C) {
    if (data[i + 3] < 250) continue;
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    px.push([l, data[i], data[i + 1], data[i + 2]]);
  }
  px.sort((a, b) => a[0] - b[0]);
  const lit = px.slice(Math.floor(px.length * 0.55), Math.floor(px.length * 0.85));
  const med = (k) => { const v = lit.map((p) => p[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const [r, g, b] = [med(1), med(2), med(3)];
  const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  console.log(`${name.padEnd(15)} ${id}  ${hex}  rgb(${r},${g},${b})  n=${px.length}`);
}
