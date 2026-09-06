// Full orientation-normalized measurement sweep. Writes .blockouts/measurements.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { analyzeFrame, splitArch, detectFringe } from "./lib-mask.mjs";

const SRC = "../../03_Images";
const SETS = {
  vault: ["DSC04876","DSC04877","DSC04878","DSC05788","DSC05789","DSC05790","DSC05791","DSC05792","DSC05793"],
  "mini-luna": ["DSC04870","DSC04871","DSC04872","DSC04873","DSC04874","DSC04875","DSC05774","DSC05775"],
  loco: ["DSC05764","DSC05765","DSC05766","DSC05770","DSC05772","DSC05773"],
  nova: ["DSC04860","DSC04861","DSC04862","DSC04863","DSC04864","DSC04865","DSC04866","DSC04867","DSC04868","DSC04869",
         "DSC05776","DSC05777","DSC05778","DSC05779","DSC05780","DSC05781","DSC05782","DSC05783","DSC05784","DSC05785","DSC05786","DSC05787"],
};

const out = {};
for (const [product, files] of Object.entries(SETS)) {
  out[product] = [];
  for (const f of files) {
    const a = await analyzeFrame(`${SRC}/${f}.JPG`);
    if (!a) { out[product].push({ frame: f, error: "no object" }); continue; }
    const arch = splitArch(a);
    const rec = {
      frame: f,
      orientationNormalized: true,
      exifOrientation: 8,
      totalWidthHeight: +a.widthHeight.toFixed(3),
      openingDetected: !!arch,
      openingAreaFrac: arch ? +arch.openingAreaFrac.toFixed(4) : null,
      openingWidthFrac: arch ? +arch.openingWidthFrac.toFixed(3) : null,
      handleHeightFrac: arch ? +arch.handleHeightFrac.toFixed(3) : null,
      largestHoleAreaFrac: +(a.holes?.[0]?.areaFrac ?? 0).toFixed(4),
      bodyWidthHeight: arch ? +arch.bodyWidthHeight.toFixed(3) : +a.widthHeight.toFixed(3),
      bodyIsWholeObject: !arch,
    };
    if (product === "loco") {
      const fr = await detectFringe(`${SRC}/${f}.JPG`);
      rec.fringe = fr;
    }
    out[product].push(rec);
  }
}
mkdirSync(".blockouts", { recursive: true });
writeFileSync(".blockouts/measurements.json", JSON.stringify(out, null, 2));

for (const [p, rows] of Object.entries(out)) {
  const ok = rows.filter((r) => !r.error);
  const arches = ok.filter((r) => r.openingDetected);
  const bodies = ok.map((r) => r.bodyWidthHeight).sort((a, b) => a - b);
  const med = bodies[bodies.length >> 1];
  console.log(`\n${p.toUpperCase()}  (${ok.length} frames)`);
  console.log(`  total W:H   min ${Math.min(...ok.map(r=>r.totalWidthHeight)).toFixed(2)}  median ${ok.map(r=>r.totalWidthHeight).sort((a,b)=>a-b)[ok.length>>1].toFixed(2)}  max ${Math.max(...ok.map(r=>r.totalWidthHeight)).toFixed(2)}`);
  console.log(`  body  W:H   median ${med?.toFixed(2)}   (spread ${bodies[0]?.toFixed(2)}–${bodies[bodies.length-1]?.toFixed(2)})`);
  console.log(`  THROUGH-OPENING in ${arches.length}/${ok.length} frames${arches.length?`, opening bottom at ${(arches.reduce((s,r)=>s+r.handleHeightFrac,0)/arches.length*100).toFixed(0)}% down (mean), opening area ${(arches.reduce((s,r)=>s+r.openingAreaFrac,0)/arches.length*100).toFixed(1)}% of box`:""}`);
  console.log(`  largest hole seen (all frames): ${Math.max(...ok.map(r=>r.largestHoleAreaFrac||0)).toFixed(4)} of box`);
  if (p === "loco") {
    const f = ok.filter((r) => r.fringe?.fringeDetected);
    console.log(`  fringe detected in ${f.length}/${ok.length}${f.length?`, starts at ${(f.reduce((s,r)=>s+r.fringe.fringeStartFrac,0)/f.length*100).toFixed(0)}% down, max runs/row ${Math.max(...f.map(r=>r.fringe.maxRuns))}`:""}`);
  }
}
console.log("\nWrote .blockouts/measurements.json");
