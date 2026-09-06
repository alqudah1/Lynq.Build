// Blockout geometry builders — DEV ONLY. Produces no GLB and writes nothing
// to public/models/. See ./evidence.ts for what each number is worth.
//
// INDEPENDENT GEOMETRY: every product's silhouette is generated from its OWN
// traced parameter set. The builder below is shared *infrastructure* (like
// the viewer and the material presets); the meshes it emits are not shared
// and no product's outline is derived from another's. Changing Nova's
// numbers cannot change Vault's mesh — they never touch the same values.

// Imports only `three` and the sibling evidence table — no path aliases — so
// scripts/render-blockout-elevations.ts can run this same code under plain
// `node` and emit elevations from the exact geometry the viewer draws.
import * as THREE from "three";
import type { BlockoutSpec } from "./evidence";

/**
 * Front-elevation outline of one product's body, as a closed THREE.Shape.
 * Centred on X, base at Y=0, expressed in body-width units (width = 1).
 */
export function bodyProfile(spec: BlockoutSpec): THREE.Shape {
  const shape = outerProfile(spec);
  // Vault and Loco carry their grip as a horizontal slot cut through a raised
  // top band — the band either side of the cut IS the handle. That is a hole
  // in the body outline, not a separate part, which is why neither product
  // requires its own `handle` node. Mini Luna's arch is the opposite case and
  // is built as real tube geometry in handleCurve().
  if (spec.handle.style.value === "slot-in-band") {
    const h = spec.heightRatio.value;
    const band = spec.handle.bandHeight.value;
    const sw = spec.handle.slotWidth.value / 2;
    const sh = Math.max(band * 0.42, 0.02);
    const cy = h - band * 0.52;
    const r = Math.min(sh, sw) * 0.9;
    const hole = new THREE.Path();
    hole.moveTo(-sw + r, cy - sh / 2);
    hole.lineTo(sw - r, cy - sh / 2);
    hole.quadraticCurveTo(sw, cy - sh / 2, sw, cy - sh / 2 + r);
    hole.lineTo(sw, cy + sh / 2 - r);
    hole.quadraticCurveTo(sw, cy + sh / 2, sw - r, cy + sh / 2);
    hole.lineTo(-sw + r, cy + sh / 2);
    hole.quadraticCurveTo(-sw, cy + sh / 2, -sw, cy + sh / 2 - r);
    hole.lineTo(-sw, cy - sh / 2 + r);
    hole.quadraticCurveTo(-sw, cy - sh / 2, -sw + r, cy - sh / 2);
    shape.holes.push(hole);
  }
  return shape;
}

function outerProfile(spec: BlockoutSpec): THREE.Shape {
  const tw = spec.topWidth.value / 2;
  const bw = spec.bottomWidth.value / 2;
  const h = spec.heightRatio.value;
  const rt = Math.min(spec.topCorner.value, h / 2, tw);
  const rb = Math.min(spec.bottomCorner.value, h / 2, bw);

  const s = new THREE.Shape();
  s.moveTo(-bw + rb, 0);
  s.lineTo(bw - rb, 0);
  s.quadraticCurveTo(bw, 0, bw, rb);
  s.lineTo(tw, h - rt);
  s.quadraticCurveTo(tw, h, tw - rt, h);
  s.lineTo(-tw + rt, h);
  s.quadraticCurveTo(-tw, h, -tw, h - rt);
  s.lineTo(-bw, rb);
  s.quadraticCurveTo(-bw, 0, -bw + rb, 0);
  s.closePath();
  return s;
}

/** The arch handle's centreline, in the same units as bodyProfile(). */
export function handleCurve(spec: BlockoutSpec): THREE.CatmullRomCurve3 | null {
  // Only a true arch is separate geometry. A slot-in-band grip is part of the
  // body outline (see bodyProfile) and must not also be drawn as a tube.
  if (!spec.handle.present.value || spec.handle.style.value !== "arch") return null;
  const h = spec.heightRatio.value;
  const half = spec.handle.span.value / 2;
  const rise = spec.handle.rise.value;
  // Attach slightly below the top edge so the arch reads as worked into the
  // body rather than balanced on top of it.
  const y0 = h - spec.handle.thickness.value;
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-half, y0, 0),
    new THREE.Vector3(-half * 0.92, y0 + rise * 0.62, 0),
    new THREE.Vector3(0, y0 + rise, 0),
    new THREE.Vector3(half * 0.92, y0 + rise * 0.62, 0),
    new THREE.Vector3(half, y0, 0),
  ]);
}

export interface BlockoutMeshes {
  /** Named to match model-contract.ts so the blockout is contract-shaped. */
  body: THREE.BufferGeometry;
  handle: THREE.BufferGeometry | null;
  /** Loco only: the envelope the fringe occupies. Indication, never geometry. */
  fringeEnvelope: THREE.BufferGeometry | null;
}

export function buildBlockout(spec: BlockoutSpec): BlockoutMeshes {
  const depth = spec.depthRatio.value;
  // Bevel gives the soft, pillowy edge a stuffed crochet bag actually has.
  // A hard-edged extrusion would read as a rigid leather box — wrong family
  // of object, and the specific failure the brief warns about.
  const bevel = Math.min(depth * 0.42, 0.07);
  const body = new THREE.ExtrudeGeometry(bodyProfile(spec), {
    depth: Math.max(depth - bevel * 2, 0.02),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
    curveSegments: 24,
  });
  body.translate(0, 0, -depth / 2 + bevel);
  body.computeVertexNormals();

  const curve = handleCurve(spec);
  const handle = curve
    ? new THREE.TubeGeometry(curve, 48, spec.handle.thickness.value, 16, false)
    : null;

  let fringeEnvelope: THREE.BufferGeometry | null = null;
  if (spec.fringe) {
    // A plain box marking the volume the fringe occupies. Deliberately crude:
    // it must never be mistaken for modelled strands. Strand count, spacing
    // and anchoring are UNRESOLVED and prohibited from being invented.
    const totalH = spec.heightRatio.value / (1 - spec.fringe.lengthRatio.value);
    const fringeH = totalH - spec.heightRatio.value;
    fringeEnvelope = new THREE.BoxGeometry(spec.bottomWidth.value, fringeH, depth * 0.9);
    fringeEnvelope.translate(0, -fringeH / 2, 0);
  }

  return { body, handle, fringeEnvelope };
}

/**
 * Silhouette outline as SVG path data, INCLUDING any grip opening.
 * THREE.Shape.getPoints() returns only the outer contour, so the hole has to
 * be appended as its own subpath — without it a slot-in-band product draws as
 * a solid blob and the comparison silently loses the feature it exists to
 * show. fill-rule="evenodd" on the <path> then knocks the hole through.
 */
export function profileToSvgPath(spec: BlockoutSpec, scale = 100): string {
  const shape = bodyProfile(spec);
  const toPath = (pts: THREE.Vector2[]) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * scale).toFixed(2)},${(-p.y * scale).toFixed(2)}`)
      .join(" ") + " Z";
  return [toPath(shape.getPoints(160)), ...shape.holes.map((h) => toPath(h.getPoints(80)))].join(" ");
}

export function handleToSvgPath(spec: BlockoutSpec, scale = 100): string | null {
  const curve = handleCurve(spec);
  if (!curve) return null;
  return curve
    .getPoints(64)
    .map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * scale).toFixed(2)},${(-p.y * scale).toFixed(2)}`)
    .join(" ");
}
