// Verification-only script — not part of the app. Exercises validateSummary
// (the pure rule-checking half of validate-model.ts) against synthetic
// ModelSummary objects, with zero GLTF loading/WebGL involved. Run with:
// node scripts/test-validate-model.ts

import { validateSummary, type ModelSummary } from "../src/lib/three/validate-model.ts";
import { BODY_NODE_NAMES, ATTACH_POINT_NAMES } from "../src/lib/three/model-contract.ts";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}
function includesMatch(list: string[], substring: string): boolean {
  return list.some((s) => s.includes(substring));
}

function baseSummary(overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    nodeNames: [BODY_NODE_NAMES.primaryBody, BODY_NODE_NAMES.hardware, ATTACH_POINT_NAMES.strap, ATTACH_POINT_NAMES.chain],
    meshCount: 2,
    materialCount: 2,
    materialTypes: ["MeshStandardMaterial", "MeshStandardMaterial"],
    textures: [],
    triangleCount: 5000,
    boundingSize: { x: 0.3, y: 0.28, z: 0.14 },
    cameraCount: 0,
    lightCount: 0,
    attachPointsWithGeometry: [],
    fileSizeBytes: 1_000_000,
    hasDraco: true,
    hasMeshopt: false,
    ...overrides,
  };
}

// ------------------------------------------------------------------
// 1. Product-specific contracts, per the PRODUCT-GEOMETRY-MAP.md visual
// audit correction:
//   - Nova requires secondaryBody; handle is now OPTIONAL (the standard/
//     reference Nova photo shows no handle — requiring the node would
//     incorrectly reject a standard-construction body).
//   - Vault requires neither secondaryBody nor a separate handle NODE
//     (Vault's confirmed integrated handle/opening is required geometry,
//     but may be sculpted into bag_body_primary instead of its own node
//     — see vault-spec.md §1).
//   - Mini Luna requires secondaryBody AND now handle (its confirmed large
//     arched handle is required as its own node).
//   - Loco requires neither secondaryBody nor handle, but now requires
//     fringe (its confirmed hanging fringe is identity-critical).
// ------------------------------------------------------------------
{
  const minimalBody = baseSummary(); // no bag_body_secondary, no handle, no fringe

  const nova = validateSummary(minimalBody, "body", "nova");
  assert(!nova.ok, "Nova: missing bag_body_secondary fails validation");
  assert(includesMatch(nova.errors, BODY_NODE_NAMES.secondaryBody), "Nova: reports missing bag_body_secondary");
  assert(!includesMatch(nova.errors, `"${BODY_NODE_NAMES.handle}"`), "Nova: does NOT require handle (correctly optional, unresolved construction)");

  const vault = validateSummary(minimalBody, "body", "vault");
  assert(vault.ok, "Vault: the same minimal body (no secondary/handle node/fringe) is valid for Vault");

  const locoMinimal = validateSummary(minimalBody, "body", "loco");
  assert(!locoMinimal.ok, "Loco: missing fringe fails validation");
  assert(includesMatch(locoMinimal.errors, BODY_NODE_NAMES.fringe), "Loco: reports missing fringe specifically");

  const locoFull = validateSummary(baseSummary({ nodeNames: [...minimalBody.nodeNames, BODY_NODE_NAMES.fringe] }), "body", "loco");
  assert(locoFull.ok, "Loco: a body with primary+hardware+fringe+attach points passes");

  const miniLunaMinimal = validateSummary(minimalBody, "body", "mini-luna");
  assert(!miniLunaMinimal.ok, "Mini Luna: missing bag_body_secondary and/or handle fails (both required)");
  assert(includesMatch(miniLunaMinimal.errors, BODY_NODE_NAMES.secondaryBody), "Mini Luna: reports missing bag_body_secondary");
  assert(includesMatch(miniLunaMinimal.errors, BODY_NODE_NAMES.handle), "Mini Luna: reports missing handle (now required, confirmed arched handle)");

  const miniLunaFull = validateSummary(
    baseSummary({ nodeNames: [...minimalBody.nodeNames, BODY_NODE_NAMES.secondaryBody, BODY_NODE_NAMES.handle] }),
    "body",
    "mini-luna"
  );
  assert(miniLunaFull.ok, "Mini Luna: a body with primary+secondary+handle+hardware+attach points passes");

  const novaFull = validateSummary(
    baseSummary({ nodeNames: [...minimalBody.nodeNames, BODY_NODE_NAMES.secondaryBody, BODY_NODE_NAMES.handle] }),
    "body",
    "nova"
  );
  assert(novaFull.ok, "Nova: a body with primary+secondary+handle+hardware+attach points still passes (handle allowed, just not required)");
}

// ------------------------------------------------------------------
// 2. Missing required node (always-required, not just conditional).
// ------------------------------------------------------------------
{
  const noHardware = baseSummary({ nodeNames: [BODY_NODE_NAMES.primaryBody, ATTACH_POINT_NAMES.strap, ATTACH_POINT_NAMES.chain] });
  const report = validateSummary(noHardware, "body", "vault");
  assert(!report.ok, "Missing hardware node fails validation");
  assert(includesMatch(report.errors, BODY_NODE_NAMES.hardware), "Reports the missing hardware node specifically");
}

// ------------------------------------------------------------------
// 3. A missing OPTIONAL node must not fail validation (explicit requirement).
// ------------------------------------------------------------------
{
  const vaultMinimal = baseSummary(); // no secondaryBody, no handle — both correctly optional for Vault
  const report = validateSummary(vaultMinimal, "body", "vault");
  assert(report.ok, "Vault with no secondaryBody/handle (both optional for Vault) still passes");
  assert(report.errors.length === 0, "No errors at all for a fully-compliant minimal Vault body");
}

// ------------------------------------------------------------------
// 4. Duplicate required node detection.
// ------------------------------------------------------------------
{
  const dup = baseSummary({
    nodeNames: [BODY_NODE_NAMES.primaryBody, BODY_NODE_NAMES.primaryBody, BODY_NODE_NAMES.hardware, ATTACH_POINT_NAMES.strap, ATTACH_POINT_NAMES.chain],
  });
  const report = validateSummary(dup, "body", "vault");
  assert(!report.ok, "Duplicate bag_body_primary node fails validation");
  assert(includesMatch(report.errors, "appears 2 times"), "Reports the duplicate count");
}
{
  // Component (strap) duplicate root node.
  const dupStrap: ModelSummary = baseSummary({ nodeNames: ["strap", "strap"], triangleCount: 1000 });
  const report = validateSummary(dupStrap, "strap");
  assert(!report.ok, "Duplicate strap root node fails validation");
}

// ------------------------------------------------------------------
// 5. Excessive triangle count -> warning, not a blocking error.
// ------------------------------------------------------------------
{
  const heavy = baseSummary({ triangleCount: 999_999 });
  const report = validateSummary(heavy, "body", "vault");
  assert(report.ok, "Excessive triangle count alone does not fail validation (warning only)");
  assert(includesMatch(report.warnings, "exceeds the"), "Reports an over-budget triangle warning");
}
{
  const fine = baseSummary({ triangleCount: 100 });
  const report = validateSummary(fine, "body", "vault");
  assert(!includesMatch(report.warnings, "exceeds the"), "A well-under-budget triangle count has no budget warning");
}

// ------------------------------------------------------------------
// 6. Excessive texture size -> warning.
// ------------------------------------------------------------------
{
  const bigTexture = baseSummary({ textures: [{ name: "albedo", width: 4096, height: 4096 }] });
  const report = validateSummary(bigTexture, "body", "vault");
  assert(includesMatch(report.warnings, "over the"), "Oversized texture produces a size warning");
}
{
  const smallTexture = baseSummary({ textures: [{ name: "albedo", width: 512, height: 512 }] });
  const report = validateSummary(smallTexture, "body", "vault");
  assert(!includesMatch(report.warnings, "over the"), "A within-budget texture has no size warning");
}

// ------------------------------------------------------------------
// 7. Embedded camera/light -> hard error (never allowed).
// ------------------------------------------------------------------
{
  const withCamera = baseSummary({ cameraCount: 1 });
  const report = validateSummary(withCamera, "body", "vault");
  assert(!report.ok, "An embedded camera fails validation");
}
{
  const withLight = baseSummary({ lightCount: 2 });
  const report = validateSummary(withLight, "body", "vault");
  assert(!report.ok, "An embedded light fails validation");
}

// ------------------------------------------------------------------
// 8. Attach point with geometry directly on it -> warning.
// ------------------------------------------------------------------
{
  const badAttach = baseSummary({ attachPointsWithGeometry: [ATTACH_POINT_NAMES.strap] });
  const report = validateSummary(badAttach, "body", "vault");
  assert(includesMatch(report.warnings, "empty transform nodes"), "Geometry on an attach point produces a warning");
}

// ------------------------------------------------------------------
// 9. kind="body" with no product given -> hard error (product-scoping is mandatory).
// ------------------------------------------------------------------
{
  const report = validateSummary(baseSummary(), "body", undefined);
  assert(!report.ok, "Validating a body with no product specified fails");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
