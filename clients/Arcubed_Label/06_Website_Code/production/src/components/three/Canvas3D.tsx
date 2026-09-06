"use client";

// The actual WebGL canvas — split out from BagViewer3D.tsx so that file can
// next/dynamic-import this one with ssr:false and a lightweight loading
// prop, keeping three.js/@react-three out of the server bundle and off the
// critical path until a viewer is actually needed.
//
// Camera/controls framing is NOT hardcoded here — BagModel.tsx measures the
// actual loaded geometry's bounding box every time it changes and drives the
// camera position, OrbitControls target/min/maxDistance, and (via
// onFramingChange, below) this component's ContactShadows placement. See
// src/lib/three/framing.ts.

import { Suspense, useImperativeHandle, useRef, useState, forwardRef, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Loader } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import BagModel, { type BagModelProps } from "./BagModel";
import type { ModelFraming } from "@/lib/three/framing";

export interface Canvas3DHandle {
  resetView: () => void;
}

interface Canvas3DProps extends BagModelProps {
  label: string;
  reducedMotion: boolean;
  /** Dev-inspector-only extension point (e.g. attach-point marker gizmos) — rendered inside the same Canvas, after the model. Unused by the real storefront viewer. */
  overlay?: ReactNode;
}

// Sensible ground-shadow placement before the first real framing has been
// computed (one-frame window right after mount) — not a claim about any
// particular model's real scale.
const FALLBACK_SHADOW_POSITION: [number, number, number] = [0, -0.3, 0];
const FALLBACK_SHADOW_SCALE = 2;

const Canvas3D = forwardRef<Canvas3DHandle, Canvas3DProps>(function Canvas3D(
  { label, reducedMotion, overlay, ...modelProps },
  ref
) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [framing, setFraming] = useState<ModelFraming | null>(null);

  useImperativeHandle(ref, () => ({
    // Returns to the framing BagModel computed and saved via
    // controls.saveState() — the calculated canonical framing for whatever
    // model is currently loaded, not a fixed camera position.
    resetView: () => controlsRef.current?.reset(),
  }));

  const shadowPosition: [number, number, number] = framing
    ? [framing.center.x, framing.minY, framing.center.z]
    : FALLBACK_SHADOW_POSITION;
  const shadowScale = framing ? framing.boundingRadius * 3.5 : FALLBACK_SHADOW_SCALE;

  return (
    <>
      <Canvas
        // Capped DPR — a big perf win on high-density phone screens, where
        // rendering at native 3x pixel density buys nothing visible but
        // costs real frame time.
        dpr={[1, 2]}
        camera={{ fov: 35 }}
        gl={{ antialias: true, alpha: true }}
        style={{ touchAction: "none" }}
        aria-label={`${label} — interactive 3D preview`}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 2]} intensity={1.1} castShadow={false} />
        <directionalLight position={[-3, 2, -2]} intensity={0.35} />
        <Suspense fallback={null}>
          <Environment preset="apartment" environmentIntensity={0.5} />
          <BagModel
            {...modelProps}
            autoRotate={!reducedMotion}
            controlsRef={controlsRef}
            onFramingChange={setFraming}
          />
          <ContactShadows position={shadowPosition} opacity={0.35} scale={shadowScale} blur={2.4} far={shadowScale * 0.3} />
          {overlay}
        </Suspense>
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enablePan={false}
          enableDamping={!reducedMotion}
          dampingFactor={0.12}
          minPolarAngle={Math.PI * 0.15}
          maxPolarAngle={Math.PI * 0.85}
        />
      </Canvas>
      <Loader
        containerStyles={{ background: "rgba(250,246,241,0.92)" }}
        innerStyles={{ width: "140px" }}
        barStyles={{ background: "#143562" }}
        dataStyles={{ color: "#2e2a26", fontSize: "12px" }}
      />
    </>
  );
});

export default Canvas3D;
