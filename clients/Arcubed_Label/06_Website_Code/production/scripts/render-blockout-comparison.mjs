// Four-product side-by-side comparison. DEV ONLY — never a customer asset.
//
// Answers one question: do these read as four different products?
//
// SCALE HONESTY: no real-world dimension is known for any Arcubed bag, so the
// four are normalized to equal BODY WIDTH. That makes SHAPE comparable and
// makes size deliberately incomparable — the banner says so, because a viewer
// would otherwise read the drawing as a size chart.
import { writeFileSync, mkdirSync } from "node:fs";
import { BLOCKOUTS, EVIDENCE_LABEL, productionBlockers } from "../src/lib/three/blockouts/evidence.ts";
import { profileToSvgPath, handleToSvgPath } from "../src/lib/three/blockouts/geometry.ts";

const W = 300, GAP = 26, PAD = 30, TOP = 96, BOTTOM = 190;
const COL = { CONFIRMED_FROM_PHOTOS: "#143562", CONFIRMED_FROM_VIDEO: "#143562", CONFIRMED_BY_RAND: "#143562", APPROXIMATION_FOR_BLOCKOUT: "#b07d2b", UNRESOLVED: "#a33" };
const specs = Object.values(BLOCKOUTS);

let maxTop = 0, maxBot = 0;
for (const s of specs) {
  const rise = s.handle.style.value === "arch" ? s.handle.rise.value + s.handle.thickness.value : 0;
  maxTop = Math.max(maxTop, (s.heightRatio.value + rise) * W);
  if (s.fringe) maxBot = Math.max(maxBot, (s.heightRatio.value / (1 - s.fringe.lengthRatio.value) - s.heightRatio.value) * W);
}
const H = TOP + maxTop + maxBot + BOTTOM;
const totalW = PAD * 2 + specs.length * W + (specs.length - 1) * GAP;
const baseY = TOP + maxTop;

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${H}" viewBox="0 0 ${totalW} ${H}">
<rect width="${totalW}" height="${H}" fill="#faf6f1"/>
<text x="${PAD}" y="34" font-family="ui-monospace,monospace" font-size="17" fill="#143562" font-weight="bold">ARCUBED — BLOCKOUT COMPARISON (DEV ONLY, NOT PRODUCTION GEOMETRY)</text>
<text x="${PAD}" y="56" font-family="ui-monospace,monospace" font-size="13" fill="#a33" font-weight="bold">RELATIVE PRODUCT SCALE NOT CONFIRMED — normalized to equal BODY WIDTH so shape is comparable and size is not</text>
<text x="${PAD}" y="74" font-family="ui-monospace,monospace" font-size="11" fill="#6f665e">navy = confirmed from photos · amber = approximation for blockout · red = unresolved</text>`;

specs.forEach((s, i) => {
  const x = PAD + i * (W + GAP) + W / 2;
  const body = profileToSvgPath(s, W);
  const handle = handleToSvgPath(s, W);
  const stroke = COL[s.heightRatio.grade];
  const blockers = productionBlockers(s);
  const fringeH = s.fringe ? (s.heightRatio.value / (1 - s.fringe.lengthRatio.value) - s.heightRatio.value) * W : 0;

  svg += `\n<g transform="translate(${x},${baseY})">`;
  svg += `<line x1="${-W / 2 - 8}" y1="0" x2="${W / 2 + 8}" y2="0" stroke="#d8cfc4" stroke-width="1" stroke-dasharray="4 4"/>`;
  if (s.fringe) {
    svg += `<rect x="${(-s.bottomWidth.value / 2) * W}" y="0" width="${s.bottomWidth.value * W}" height="${fringeH}" fill="none" stroke="#a33" stroke-width="1.5" stroke-dasharray="6 5"/>`;
    svg += `<text x="0" y="${fringeH + 16}" font-family="ui-monospace,monospace" font-size="9.5" fill="#a33" text-anchor="middle">FRINGE ENVELOPE — NOT MODELLED</text>`;
  }
  svg += `<path d="${body}" fill="#143562" fill-opacity="0.09" fill-rule="evenodd" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round"/>`;
  if (handle) svg += `<path d="${handle}" fill="none" stroke="${stroke}" stroke-width="${s.handle.thickness.value * W * 2}" stroke-linecap="round"/>`;
  svg += `</g>`;

  // Fact block
  const rows = [
    ["body W:H", (1 / s.heightRatio.value).toFixed(2) + " : 1", s.heightRatio.grade],
    ["grip", s.handle.style.value, s.handle.style.grade],
    ["opening depth", s.handle.style.value === "none" ? "n/a" : (s.handle.style.value === "arch" ? (s.handle.rise.value * 100).toFixed(0) : (s.handle.bandHeight.value * 100).toFixed(0)) + "% of height", s.handle.style.value === "arch" ? s.handle.rise.grade : s.handle.bandHeight.grade],
    ["depth (front-back)", s.depthRatio.grade === "UNRESOLVED" ? "UNRESOLVED" : "approx " + s.depthRatio.value.toFixed(2) + "w", s.depthRatio.grade],
    ["fringe", s.fringe ? "structural, layout UNRESOLVED" : "none", s.fringe ? "UNRESOLVED" : "CONFIRMED_FROM_PHOTOS"],
  ];
  let ty = baseY + maxBot + 44;
  svg += `\n<text x="${x}" y="${ty}" font-family="ui-monospace,monospace" font-size="16" fill="#143562" text-anchor="middle" font-weight="bold">${s.label.toUpperCase()}</text>`;
  ty += 20;
  for (const [k, v, g] of rows) {
    svg += `<text x="${x - W / 2}" y="${ty}" font-family="ui-monospace,monospace" font-size="10.5" fill="#6f665e">${k}</text>`;
    svg += `<text x="${x + W / 2}" y="${ty}" font-family="ui-monospace,monospace" font-size="10.5" fill="${COL[g]}" text-anchor="end">${v}</text>`;
    ty += 15;
  }
  svg += `<text x="${x - W / 2}" y="${ty + 6}" font-family="ui-monospace,monospace" font-size="11" fill="${blockers.length ? "#a33" : "#143562"}" font-weight="bold">${blockers.length} blocker${blockers.length === 1 ? "" : "s"} to production</text>`;
  const frames = s.frames.value.length;
  svg += `<text x="${x + W / 2}" y="${ty + 6}" font-family="ui-monospace,monospace" font-size="10" fill="#6f665e" text-anchor="end">${frames} source frame${frames === 1 ? "" : "s"}</text>`;
});

svg += `\n</svg>\n`;
mkdirSync(".blockouts", { recursive: true });
writeFileSync(".blockouts/comparison.svg", svg);
console.log(".blockouts/comparison.svg", `${totalW}x${Math.round(H)}`);
for (const s of specs) console.log(`  ${s.label.padEnd(11)} bodyW:H ${(1 / s.heightRatio.value).toFixed(2)}  grip ${s.handle.style.value.padEnd(13)} blockers ${productionBlockers(s).length}`);
