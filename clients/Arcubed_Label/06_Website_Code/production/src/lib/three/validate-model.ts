// DEVELOPMENT-ONLY GLB validation utility. Not imported by any real
// storefront code path — only src/app/dev/3d-inspector/ uses this, and that
// route 404s in production (src/proxy.ts). Never used to gate what the
// production customizer renders; production trusts is_placeholder=false
// model_assets rows because a human ran this + qa-checklist.md by hand
// first — see docs/3d-production/ingest-workflow.md.
//
// Split into a pure rule-checking function (validateSummary) and an async
// browser-only extraction function (extractModelSummary) on purpose: the
// rules are unit-testable in plain Node (see scripts/test-validate-model.mjs)
// against synthetic input, independent of ever loading a real GLTF.

import { Box3, Vector3, type Object3D, type Mesh, type Material, type Texture } from "three";
import {
  BODY_NODE_NAMES,
  ATTACH_POINT_NAMES,
  COMPONENT_NODE_NAMES,
  PART_BUDGETS,
  EXPECTED_BAG_SCALE_METERS,
  PRODUCT_PART_REQUIREMENTS,
  type ProductKey,
} from "./model-contract";

export type AssetKind = "body" | "strap" | "chain" | "handle";

export interface TextureInfo {
  name: string;
  width: number;
  height: number;
}

/** Everything the validator's rules need, extracted once from a loaded GLTF (or synthesized for a test). */
export interface ModelSummary {
  nodeNames: string[];
  meshCount: number;
  materialCount: number;
  materialTypes: string[];
  textures: TextureInfo[];
  triangleCount: number;
  boundingSize: { x: number; y: number; z: number };
  cameraCount: number;
  lightCount: number;
  /** Nodes that are attach_* points but have mesh geometry directly on them (should be empty transforms). */
  attachPointsWithGeometry: string[];
  fileSizeBytes: number | null;
  hasDraco: boolean;
  hasMeshopt: boolean;
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
  summary: ModelSummary;
}

function countDuplicates(nodeNames: string[], name: string): number {
  return nodeNames.filter((n) => n === name).length;
}

/**
 * Pure rule-checking — no loading, no browser APIs. `product` is REQUIRED
 * for kind="body" (validation requirements depend on product type per the
 * task); optional/ignored for strap/chain/handle, which are a shared
 * catalog not scoped to one product.
 */
export function validateSummary(summary: ModelSummary, kind: AssetKind, product?: ProductKey): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  info.push(`${summary.meshCount} mesh(es), ${summary.materialCount} material(s), ${summary.textures.length} texture(s)`);
  info.push(`${summary.triangleCount.toLocaleString()} triangles`);
  info.push(
    `Bounding size: ${summary.boundingSize.x.toFixed(3)} × ${summary.boundingSize.y.toFixed(3)} × ${summary.boundingSize.z.toFixed(3)} m`
  );
  if (summary.fileSizeBytes !== null) {
    info.push(`File size: ${(summary.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  }
  info.push(`Draco: ${summary.hasDraco ? "yes" : "no"} · Meshopt: ${summary.hasMeshopt ? "yes" : "no"}`);

  if (kind === "body") {
    if (!product) {
      errors.push('kind="body" requires a product (nova/vault/mini-luna/loco) to validate against — none given.');
    } else {
      const req = PRODUCT_PART_REQUIREMENTS[product];

      // Always required for every body, regardless of product.
      checkRequiredNode(summary.nodeNames, BODY_NODE_NAMES.primaryBody, errors);
      checkRequiredNode(summary.nodeNames, BODY_NODE_NAMES.hardware, errors);
      checkRequiredNode(summary.nodeNames, ATTACH_POINT_NAMES.strap, errors);
      checkRequiredNode(summary.nodeNames, ATTACH_POINT_NAMES.chain, errors);

      // Conditional on this product's contract.
      checkConditionalNode(summary.nodeNames, BODY_NODE_NAMES.secondaryBody, req.secondaryBody, "two-tone", errors, warnings);
      checkConditionalNode(summary.nodeNames, BODY_NODE_NAMES.handle, req.handle, `${product}'s confirmed part list`, errors, warnings);
      checkConditionalNode(summary.nodeNames, BODY_NODE_NAMES.fringe, req.fringe, `${product}'s confirmed part list`, errors, warnings);

      // Never required today for any product — informational only if present.
      if (summary.nodeNames.includes(ATTACH_POINT_NAMES.handle)) {
        info.push(`Has "${ATTACH_POINT_NAMES.handle}" — not required by any product today; only meaningful if a swappable handle option is later confirmed.`);
      }

      // Duplicate-node check across every contract name, required or not.
      for (const name of [
        BODY_NODE_NAMES.primaryBody,
        BODY_NODE_NAMES.secondaryBody,
        BODY_NODE_NAMES.handle,
        BODY_NODE_NAMES.hardware,
        BODY_NODE_NAMES.fringe,
        ATTACH_POINT_NAMES.strap,
        ATTACH_POINT_NAMES.chain,
        ATTACH_POINT_NAMES.handle,
      ]) {
        const count = countDuplicates(summary.nodeNames, name);
        if (count > 1) errors.push(`Node name "${name}" appears ${count} times — must be unique. Only the first will ever be used at runtime; this is almost always an authoring mistake.`);
      }

      const budgetKey = `${product}-body` as keyof typeof PART_BUDGETS;
      checkTriangleBudget(summary.triangleCount, PART_BUDGETS[budgetKey].maxTriangles, warnings);
      checkScale(summary.boundingSize, warnings);
    }
  } else {
    // strap / chain / handle — shared catalog, single root node, no product scoping.
    const rootName = COMPONENT_NODE_NAMES[kind];
    checkRequiredNode(summary.nodeNames, rootName, errors);
    const count = countDuplicates(summary.nodeNames, rootName);
    if (count > 1) errors.push(`Node name "${rootName}" appears ${count} times — a component file should have exactly one root node with this name.`);
    checkTriangleBudget(summary.triangleCount, PART_BUDGETS[kind].maxTriangles, warnings);
  }

  if (summary.attachPointsWithGeometry.length > 0) {
    warnings.push(
      `Attach point(s) ${summary.attachPointsWithGeometry.join(", ")} have mesh geometry directly on them — attach points should be empty transform nodes. Geometry there will render (probably unintended) AND get duplicated when a real component attaches on top of it.`
    );
  }

  if (summary.cameraCount > 0) errors.push(`File contains ${summary.cameraCount} embedded camera(s) — the viewer supplies its own; remove before export.`);
  if (summary.lightCount > 0) errors.push(`File contains ${summary.lightCount} embedded light(s) — the viewer supplies its own; remove before export.`);

  for (const tex of summary.textures) {
    const textureBudgetKey: keyof typeof PART_BUDGETS =
      kind === "body" && product ? (`${product}-body` as keyof typeof PART_BUDGETS) : kind === "body" ? "hardware" : kind;
    const maxSize = PART_BUDGETS[textureBudgetKey].maxTextureSize;
    const dim = Math.max(tex.width, tex.height);
    if (dim > maxSize) {
      warnings.push(`Texture "${tex.name}" is ${tex.width}×${tex.height} — over the ${maxSize}px target. Consider downscaling.`);
    }
  }

  for (const type of summary.materialTypes) {
    if (type !== "MeshStandardMaterial" && type !== "MeshPhysicalMaterial") {
      warnings.push(`Material type "${type}" detected — the viewer recolors zones assuming MeshStandardMaterial-compatible PBR (metalness/roughness). An unsupported material type may not recolor or light correctly.`);
    }
  }

  if (!summary.hasDraco) {
    warnings.push("No Draco compression detected — see export-checklist.md. Not a blocking error (the file will still load), but production files should be Draco-compressed for mobile load time.");
  }

  return { ok: errors.length === 0, errors, warnings, info, summary };
}

function checkRequiredNode(nodeNames: string[], name: string, errors: string[]) {
  if (!nodeNames.includes(name)) errors.push(`Missing required node "${name}".`);
}

function checkConditionalNode(
  nodeNames: string[],
  name: string,
  required: boolean,
  reason: string,
  errors: string[],
  warnings: string[]
) {
  const present = nodeNames.includes(name);
  if (required && !present) errors.push(`Missing required node "${name}" — required by ${reason}.`);
  if (!required && present) warnings.push(`Node "${name}" is present but not required by ${reason} — confirm this is intentional (extra unused geometry, or a sign the wrong product's requirements were used).`);
}

function checkTriangleBudget(triangleCount: number, max: number, warnings: string[]) {
  if (triangleCount > max) {
    warnings.push(`${triangleCount.toLocaleString()} triangles exceeds the ${max.toLocaleString()} target — see export-checklist.md budget methodology. Not blocking by itself; a large excess is worth investigating.`);
  }
}

function checkScale(boundingSize: { x: number; y: number; z: number }, warnings: string[]) {
  const maxDim = Math.max(boundingSize.x, boundingSize.y, boundingSize.z);
  if (maxDim < EXPECTED_BAG_SCALE_METERS.min || maxDim > EXPECTED_BAG_SCALE_METERS.max) {
    warnings.push(
      `Largest bounding dimension is ${maxDim.toFixed(3)}m — outside the ${EXPECTED_BAG_SCALE_METERS.min}–${EXPECTED_BAG_SCALE_METERS.max}m soft range expected for a handbag-sized object. This is a heuristic, not a confirmed real dimension (none exist yet) — but double-check the model is actually authored at real-world meter scale (1 unit = 1 meter), not some other unit convention.`
    );
  }
}

// ------------------------------------------------------------------
// Browser-only extraction — parses a live GLTF plus the raw GLB bytes.
// ------------------------------------------------------------------

function countTriangles(object: Object3D): number {
  let total = 0;
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!("isMesh" in mesh) || !mesh.isMesh) return;
    const geometry = mesh.geometry;
    if (!geometry) return;
    if (geometry.index) total += geometry.index.count / 3;
    else if (geometry.attributes.position) total += geometry.attributes.position.count / 3;
  });
  return Math.round(total);
}

function collectMaterialsAndTextures(object: Object3D): { materials: Material[]; textures: TextureInfo[] } {
  const materials = new Set<Material>();
  const textures: TextureInfo[] = [];
  const seenTextures = new Set<Texture>();
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!("isMesh" in mesh) || !mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      materials.add(mat);
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"] as const) {
        const tex = (mat as unknown as Record<string, Texture | undefined>)[key];
        const image = tex?.image as { width?: number; height?: number } | undefined;
        if (tex && image && !seenTextures.has(tex)) {
          seenTextures.add(tex);
          textures.push({ name: tex.name || key, width: image.width ?? 0, height: image.height ?? 0 });
        }
      }
    }
  });
  return { materials: [...materials], textures };
}

/** Parses just the GLB container header to check extensionsUsed, without a full THREE load. */
async function detectCompressionExtensions(buffer: ArrayBuffer): Promise<{ hasDraco: boolean; hasMeshopt: boolean }> {
  try {
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);
    if (magic !== 0x46546c67 /* "glTF" */) return { hasDraco: false, hasMeshopt: false };
    const jsonChunkLength = view.getUint32(12, true);
    const jsonBytes = new Uint8Array(buffer, 20, jsonChunkLength);
    const json = JSON.parse(new TextDecoder().decode(jsonBytes)) as { extensionsUsed?: string[] };
    const used = json.extensionsUsed ?? [];
    return {
      hasDraco: used.includes("KHR_draco_mesh_compression"),
      hasMeshopt: used.includes("EXT_meshopt_compression"),
    };
  } catch {
    return { hasDraco: false, hasMeshopt: false };
  }
}

/**
 * Loads and summarizes a GLB from a URL. Browser-only (fetch + GLTFLoader).
 * Throws if the file can't be fetched or parsed — callers should catch this
 * and report it as a hard "file loads successfully: NO" result rather than
 * letting it propagate as an unhandled error.
 */
export async function extractModelSummary(url: string): Promise<ModelSummary> {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/loaders/DRACOLoader.js"),
  ]);
  const { DRACO_DECODER_PATH } = await import("./model-contract");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  const fileSizeBytes = buffer.byteLength;
  const compression = await detectCompressionExtensions(buffer);

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);

  const gltf = await loader.parseAsync(buffer, "");

  const scene = gltf.scene;
  const nodeNames: string[] = [];
  let meshCount = 0;
  let cameraCount = 0;
  let lightCount = 0;
  const attachPointsWithGeometry: string[] = [];
  const attachNames: string[] = Object.values(ATTACH_POINT_NAMES);

  scene.traverse((node) => {
    if (node.name) nodeNames.push(node.name);
    if ((node as Mesh).isMesh) meshCount += 1;
    if ((node as unknown as { isCamera?: boolean }).isCamera) cameraCount += 1;
    if ((node as unknown as { isLight?: boolean }).isLight) lightCount += 1;
    if (attachNames.includes(node.name) && (node as Mesh).isMesh) {
      attachPointsWithGeometry.push(node.name);
    }
  });

  const { materials, textures } = collectMaterialsAndTextures(scene);
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3());

  return {
    nodeNames,
    meshCount,
    materialCount: materials.length,
    materialTypes: materials.map((m) => m.type),
    textures,
    triangleCount: countTriangles(scene),
    boundingSize: { x: size.x, y: size.y, z: size.z },
    cameraCount,
    lightCount,
    attachPointsWithGeometry,
    fileSizeBytes,
    hasDraco: compression.hasDraco,
    hasMeshopt: compression.hasMeshopt,
  };
}

/** Convenience: load + validate in one call. */
export async function validateModel(url: string, kind: AssetKind, product?: ProductKey): Promise<ValidationReport> {
  const summary = await extractModelSummary(url);
  return validateSummary(summary, kind, product);
}
