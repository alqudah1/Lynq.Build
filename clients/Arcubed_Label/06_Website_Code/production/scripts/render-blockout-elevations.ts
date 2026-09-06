// Verification/reporting script — not part of the app, not imported by it.
// Emits front-elevation SVGs of each blockout from the SAME geometry code the
// dev viewer uses, so the drawing can never drift from the model. No browser,
// no WebGL — the profile and handle curve are plain THREE math.
//
// Run with: node scripts/render-blockout-elevations.ts
// Output:   .blockouts/<product>-elevation.svg  (gitignored, dev artefact)

import { mkdirSync, writeFileSync } from "node:fs";
import { BLOCKOUTS, EVIDENCE_LABEL, productionBlockers } from "../src/lib/three/blockouts/evidence.ts";
import { profileToSvgPath, handleToSvgPath } from "../src/lib/three/blockouts/geometry.ts";

const S = 260;
const OUT = ".blockouts";

const GRADE_COLOR: Record<string, string> = {
  CONFIRMED_FROM_PHOTOS: "#143562",
  CONFIRMED_FROM_VIDEO: "#143562",
  CONFIRMED_BY_RAND: "#143562",
  APPROXIMATION_FOR_BLOCKOUT: "#b07d2b",
  UNRESOLVED: "#a33",
};

mkdirSync(OUT, { recursive: true });

for (const spec of Object.values(BLOCKOUTS)) {
  const body = profileToSvgPath(spec, S);
  const handle = handleToSvgPath(spec, S);
  const stroke = GRADE_COLOR[spec.heightRatio.grade] ?? "#143562";

  const fringeH = spec.fringe
    ? (spec.heightRatio.value / (1 - spec.fringe.lengthRatio.value)) - spec.heightRatio.value
    : 0;

  const w = S * 1.3;
  const top = -(spec.heightRatio.value + (spec.handle.present.value ? spec.handle.rise.value : 0)) * S - 40;
  const bottom = fringeH * S + 40;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-w / 2} ${top} ${w} ${bottom - top}" width="${w}">
  <rect x="${-w / 2}" y="${top}" width="${w}" height="${bottom - top}" fill="#faf6f1"/>
  <line x1="${-w / 2}" y1="0" x2="${w / 2}" y2="0" stroke="#d8cfc4" stroke-width="1" stroke-dasharray="4 4"/>
${
  spec.fringe
    ? `  <rect x="${(-spec.bottomWidth.value / 2) * S}" y="0" width="${spec.bottomWidth.value * S}" height="${fringeH * S}" fill="none" stroke="#a33" stroke-width="1.5" stroke-dasharray="6 5"/>
  <text x="0" y="${fringeH * S + 22}" font-family="ui-monospace,monospace" font-size="11" fill="#a33" text-anchor="middle">FRINGE ENVELOPE — NOT MODELLED (strand layout UNRESOLVED)</text>`
    : ""
}
  <path d="${body}" fill="#143562" fill-opacity="0.10" fill-rule="evenodd" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>
${handle ? `  <path d="${handle}" fill="none" stroke="${stroke}" stroke-width="${spec.handle.thickness.value * S * 2}" stroke-linecap="round"/>` : ""}
  <text x="0" y="${top + 24}" font-family="ui-monospace,monospace" font-size="14" fill="#143562" text-anchor="middle">${spec.label} — front elevation (blockout)</text>
  <text x="0" y="${top + 42}" font-family="ui-monospace,monospace" font-size="10" fill="#8a8078" text-anchor="middle">W:H ${(1 / spec.heightRatio.value).toFixed(2)}:1 · proportions ${EVIDENCE_LABEL[spec.heightRatio.grade]}</text>
</svg>
`;
  writeFileSync(`${OUT}/${spec.key}-elevation.svg`, svg);

  const blockers = productionBlockers(spec);
  console.log(`\n${spec.label}  →  ${OUT}/${spec.key}-elevation.svg`);
  console.log(`  body W:H ${(1 / spec.heightRatio.value).toFixed(2)}:1 (${EVIDENCE_LABEL[spec.heightRatio.grade]})`);
  console.log(`  handle: ${spec.handle.style.value} (${EVIDENCE_LABEL[spec.handle.style.grade]})`);
  console.log(`  production blockers: ${blockers.length}`);
  for (const b of blockers) console.log(`    - ${b.field.padEnd(20)} ${EVIDENCE_LABEL[b.grade]}`);
}

console.log("\nNo GLB written. Nothing placed under public/models/.");
