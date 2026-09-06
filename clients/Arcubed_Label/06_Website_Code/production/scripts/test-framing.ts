// Verification-only script — not part of the app, not imported by anything.
// Runs framing.ts's pure math against synthetic bounding boxes at several
// real-world scales, with zero WebGL/DOM dependency (Box3/Vector3 are plain
// THREE math classes). Run with: node scripts/test-framing.ts

import { Box3, Vector3 } from "three";
import { computeFramingFromBox } from "../src/lib/three/framing.ts";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

function boxOfSize(size: number, center: [number, number, number] = [0, 0, 0]): Box3 {
  const half = size / 2;
  return new Box3(
    new Vector3(center[0] - half, center[1] - half, center[2] - half),
    new Vector3(center[0] + half, center[1] + half, center[2] + half)
  );
}

const FOV = 35;
const scales = [0.2, 0.4, 1.0];
const results = scales.map((s) => ({ scale: s, framing: computeFramingFromBox(boxOfSize(s), FOV) }));

console.log("--- computed framing per scale ---");
for (const { scale, framing } of results) {
  console.log(
    `scale=${scale}m -> distance=${framing.distance.toFixed(4)} minDistance=${framing.minDistance.toFixed(4)} maxDistance=${framing.maxDistance.toFixed(4)} boundingRadius=${framing.boundingRadius.toFixed(4)}`
  );
}

// 1. Distance must scale up monotonically with model size.
assert(results[0].framing.distance < results[1].framing.distance, "0.2m frames closer than 0.4m");
assert(results[1].framing.distance < results[2].framing.distance, "0.4m frames closer than 1.0m");

// 2. Distance-to-size ratio should be constant (pure proportionality) —
// this is the actual "works at any scale" guarantee, not just "bigger is farther".
const ratios = results.map((r) => r.framing.distance / r.scale);
const ratioSpread = Math.max(...ratios) - Math.min(...ratios);
assert(ratioSpread < 1e-9, `distance/scale ratio is constant across scales (spread=${ratioSpread})`);

// 3. minDistance must stay outside the bounding sphere (never clips into the model), at every scale.
for (const { scale, framing } of results) {
  assert(framing.minDistance > framing.boundingRadius, `minDistance clears the bounding radius at scale=${scale}m`);
}

// 4. maxDistance must exceed minDistance (a valid, non-inverted zoom range) at every scale.
for (const { scale, framing } of results) {
  assert(framing.maxDistance > framing.minDistance, `maxDistance > minDistance at scale=${scale}m`);
}

// 5. Center must reflect an OFF-ORIGIN box correctly (not hardcoded to [0,0,0]).
const offsetBox = boxOfSize(0.3, [1.5, 0.2, -0.7]);
const offsetFraming = computeFramingFromBox(offsetBox, FOV);
assert(
  Math.abs(offsetFraming.center.x - 1.5) < 1e-9 &&
    Math.abs(offsetFraming.center.y - 0.2) < 1e-9 &&
    Math.abs(offsetFraming.center.z - (-0.7)) < 1e-9,
  "center matches an off-origin box's real center, not world origin"
);

// 6. minY reflects the box's actual floor, for ground-shadow placement.
assert(Math.abs(offsetFraming.minY - (0.2 - 0.15)) < 1e-9, "minY reflects the box's actual lowest point");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
