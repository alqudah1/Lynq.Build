// Pure bounding-box → camera-framing math. No WebGL/DOM dependency (Box3/
// Vector3/Object3D are plain THREE math/scene-graph classes) — deliberately
// kept this way so it's unit-testable in plain Node (see
// scripts/test-framing.mjs) without a browser.
//
// Replaces the old approach of hand-tuned camera constants in Canvas3D.tsx
// that only looked right for the ~1-unit-scale dev placeholder. Every real
// asset — 0.2m, 0.4m, 1m, whatever it actually measures — gets framed
// correctly because every output here is derived proportionally from the
// model's own measured bounding box, not a fixed number.

import { Box3, type Object3D, Vector3 } from "three";

export interface ModelFraming {
  /** World-space center of the model's bounding box — this is what OrbitControls should orbit around, not world origin. */
  center: Vector3;
  /** Lowest Y of the bounding box — where the model actually rests, for ground-shadow placement. */
  minY: number;
  /** Half the bounding box's diagonal — a conservative "fits everything" sphere radius. */
  boundingRadius: number;
  /** Camera distance from `center` that frames the whole model with headroom, for the given vertical FOV. */
  distance: number;
  /** OrbitControls minDistance — stays outside the bounding sphere so the camera never clips into the model. */
  minDistance: number;
  /** OrbitControls maxDistance — a reasonable zoom-out ceiling relative to the model's own size. */
  maxDistance: number;
}

// Headroom so the model doesn't touch the frame edges at the default distance.
const FRAME_MARGIN = 1.35;
// How close the camera may zoom in, as a multiple of the bounding radius —
// keeps it outside the model regardless of scale.
const MIN_DISTANCE_RADIUS_FACTOR = 1.2;
// Zoom-in floor relative to the framed distance itself, for models with an
// unusually small bounding radius where the radius-based floor alone would
// let the camera get uncomfortably close.
const MIN_DISTANCE_FRAME_FACTOR = 0.35;
// How far the camera may zoom out, as a multiple of the framed distance.
const MAX_DISTANCE_FRAME_FACTOR = 2.4;

/** Guard against a degenerate (empty/zero-size) box — e.g. a body with no geometry at all. */
const MIN_RADIUS = 0.001;

export function computeFramingFromBox(box: Box3, fovDegrees: number): ModelFraming {
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const boundingRadius = Math.max(size.length() / 2, MIN_RADIUS);

  const fovRadians = (fovDegrees * Math.PI) / 180;
  const fitDistance = boundingRadius / Math.sin(fovRadians / 2);
  const distance = fitDistance * FRAME_MARGIN;

  return {
    center,
    minY: box.min.y,
    boundingRadius,
    distance,
    minDistance: Math.max(boundingRadius * MIN_DISTANCE_RADIUS_FACTOR, distance * MIN_DISTANCE_FRAME_FACTOR),
    maxDistance: distance * MAX_DISTANCE_FRAME_FACTOR,
  };
}

/** Convenience wrapper — computes the bounding box of a live Object3D first. */
export function computeFraming(object: Object3D, fovDegrees: number): ModelFraming {
  const box = new Box3().setFromObject(object);
  return computeFramingFromBox(box, fovDegrees);
}
