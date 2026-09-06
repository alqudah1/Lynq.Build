"use client";

// Loads a bag's body GLB and applies the current colour selection to its
// named material zones, then attaches any selected strap/chain/handle GLBs
// at the body's attach_* empty nodes — the runtime half of the contract
// documented in src/lib/three/model-contract.ts and docs/3d-assets.md.
//
// Node presence, not a database flag, decides what actually renders: if a
// body GLB has no bag_body_secondary node, a secondary colour selection
// simply has nothing to apply to. That keeps the DB and the asset as the
// only two sources of truth instead of three.

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { Object3D, Mesh, MeshStandardMaterial } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { BODY_NODE_NAMES, ATTACH_POINT_NAMES, COMPONENT_NODE_NAMES, DRACO_DECODER_PATH } from "@/lib/three/model-contract";
import { computeFraming, type ModelFraming } from "@/lib/three/framing";

useGLTF.setDecoderPath(DRACO_DECODER_PATH);

// Neutral placeholder tint — same honest "no colour data yet" convention as
// BagArt.tsx's PLACEHOLDER_HEX, applied here to a 3D material instead of an
// SVG fill. Never a guess at the real colour.
const PLACEHOLDER_HEX = "#D9CFC2";

function recolorNamedMesh(scene: Object3D, nodeName: string, hex: string | null) {
  const node = scene.getObjectByName(nodeName) as Mesh | undefined;
  if (!node || !("material" in node)) return;
  const material = node.material as MeshStandardMaterial;
  material.color.set(hex ?? PLACEHOLDER_HEX);
}

/** One swappable strap/chain/handle GLB, portaled onto its body attach point. */
function AttachedPart({ url, attachTo, nodeName }: { url: string; attachTo: Object3D; nodeName: string }) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => scene.clone(true), [scene]);
  // Sanity check only — a malformed asset (wrong node name) shouldn't crash
  // the viewer, just silently not render that part.
  useEffect(() => {
    if (!clone.getObjectByName(nodeName)) {
      console.warn(`3D asset at ${url} has no node named "${nodeName}" — expected by the model contract.`);
    }
  }, [clone, nodeName, url]);
  return createPortal(<primitive object={clone} />, attachTo);
}

export interface BagModelProps {
  bodyUrl: string;
  primaryColourHex: string | null;
  secondaryColourHex?: string | null;
  strapUrl?: string;
  chainUrl?: string;
  handleUrl?: string;
  /** Slow, subtle idle rotation — skipped entirely under prefers-reduced-motion. */
  autoRotate?: boolean;
  /** The shared OrbitControls ref (owned by Canvas3D) — auto-framing sets its target and saves the framed state as the reset-view baseline. */
  controlsRef?: RefObject<OrbitControlsImpl | null>;
  /** Lifted to Canvas3D so sibling elements (ContactShadows, min/maxDistance) can react to the model's actual measured size. */
  onFramingChange?: (framing: ModelFraming) => void;
  /** Dev-inspector-only hook: exposes the live cloned scene once per load, so a debug UI can read node names/attach-point positions straight from what's actually rendering rather than a second independent parse. Unused in the real storefront viewer. */
  onSceneReady?: (scene: Object3D) => void;
}

export default function BagModel({
  bodyUrl,
  primaryColourHex,
  secondaryColourHex,
  strapUrl,
  chainUrl,
  handleUrl,
  autoRotate = false,
  controlsRef,
  onFramingChange,
  onSceneReady,
}: BagModelProps) {
  const { scene } = useGLTF(bodyUrl);
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);

  // Cloned once per loaded body — drei caches the raw GLTF scene across
  // every viewer instance, so mutating it in place would leak material
  // changes between, say, a shop-grid thumbnail and the product page.
  const clone = useMemo(() => {
    const cloned = scene.clone(true);
    // Only the two colour-driven zones need their own material instance;
    // everything else (hardware, etc.) can keep sharing the cached one.
    for (const nodeName of [BODY_NODE_NAMES.primaryBody, BODY_NODE_NAMES.secondaryBody]) {
      const node = cloned.getObjectByName(nodeName) as Mesh | undefined;
      if (node && "material" in node && node.material) {
        node.material = (node.material as MeshStandardMaterial).clone();
      }
    }
    return cloned;
  }, [scene]);

  useEffect(() => {
    recolorNamedMesh(clone, BODY_NODE_NAMES.primaryBody, primaryColourHex);
  }, [clone, primaryColourHex]);

  useEffect(() => {
    if (clone.getObjectByName(BODY_NODE_NAMES.secondaryBody)) {
      recolorNamedMesh(clone, BODY_NODE_NAMES.secondaryBody, secondaryColourHex ?? null);
    }
  }, [clone, secondaryColourHex]);

  useEffect(() => {
    onSceneReady?.(clone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clone]);

  // Auto-framing: measure the ACTUAL loaded geometry's bounding box and
  // derive camera distance/target/zoom-limits from it — see
  // src/lib/three/framing.ts. Never mutates `clone`'s geometry/transform;
  // only the camera and OrbitControls (both external to the model) move.
  // Recomputes whenever `clone` changes (a new bodyUrl — e.g. switching
  // products or to a size-specific body — produces a new clone).
  const cameraFov = "fov" in camera ? camera.fov : 35;
  const framing = useMemo(() => computeFraming(clone, cameraFov), [clone, cameraFov]);

  // react-hooks/immutability flags this whole effect (and the two lines
  // below) because `camera` and `controls` are values reached from hooks
  // (useThree/controlsRef). The rule's model assumes hook-sourced values
  // are React-owned and should never be reassigned in place — correct for
  // ordinary React state, but `camera` and `controls` here are plain
  // three/three-stdlib class instances (PerspectiveCamera, OrbitControls),
  // not React state: R3F exposes them specifically so imperative code can
  // mutate their fields every frame, which is the library's normal,
  // documented usage pattern (see any r3f camera-control example). There is
  // no React-owned copy of `camera.near` or `controls.minDistance` to update
  // "the right way" instead — the mutation *is* the update. Scoped to this
  // exact effect rather than disabled file- or rule-wide.
  // eslint-disable-next-line react-hooks/immutability -- imperative Three.js/R3F object mutation, not React state (see comment above)
  useEffect(() => {
    const controls = controlsRef?.current;
    camera.position
      .copy(framing.center)
      .add(new THREE.Vector3(0, framing.boundingRadius * 0.12, framing.distance));
    // eslint-disable-next-line react-hooks/immutability -- `camera` is a Three.js PerspectiveCamera instance; near/far are meant to be set imperatively before updateProjectionMatrix()
    camera.near = Math.max(framing.distance / 100, 0.01);
    camera.far = framing.distance * 20;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(framing.center);
      // eslint-disable-next-line react-hooks/immutability -- `controls` is a three-stdlib OrbitControls instance; min/maxDistance are meant to be set imperatively, mirroring camera.near/far above
      controls.minDistance = framing.minDistance;
      controls.maxDistance = framing.maxDistance;
      controls.update();
      // Captures THIS framing as what OrbitControls.reset() returns to —
      // makes "Reset View" return to the calculated canonical framing
      // rather than whatever the pre-auto-framing hardcoded camera was.
      controls.saveState();
    }
    onFramingChange?.(framing);
    // onFramingChange is expected to be a stable callback (useCallback/
    // useState setter) from the caller — including it would re-run this
    // purely-imperative effect on every parent render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framing, camera, controlsRef]);

  const attachStrap = clone.getObjectByName(ATTACH_POINT_NAMES.strap);
  const attachChain = clone.getObjectByName(ATTACH_POINT_NAMES.chain);
  const attachHandle = clone.getObjectByName(ATTACH_POINT_NAMES.handle);

  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.15;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={clone} />
      {strapUrl && attachStrap ? (
        <AttachedPart url={strapUrl} attachTo={attachStrap} nodeName={COMPONENT_NODE_NAMES.strap} />
      ) : null}
      {chainUrl && attachChain ? (
        <AttachedPart url={chainUrl} attachTo={attachChain} nodeName={COMPONENT_NODE_NAMES.chain} />
      ) : null}
      {handleUrl && attachHandle ? (
        <AttachedPart url={handleUrl} attachTo={attachHandle} nodeName={COMPONENT_NODE_NAMES.handle} />
      ) : null}
    </group>
  );
}
