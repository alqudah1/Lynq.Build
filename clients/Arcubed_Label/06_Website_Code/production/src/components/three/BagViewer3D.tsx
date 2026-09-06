"use client";

// The reusable 3D product viewer. Public surface for the rest of the app —
// ProductGallery renders this when a Bag has model3D data, passing the
// current colour/strap/chain/handle selection straight through as props.
//
// Layout (sticky-left-on-desktop, full-width-first-on-mobile) is the
// caller's CSS concern, same as the existing BagArt crossfade — this
// component just fills whatever box it's given.

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Object3D } from "three";
import type { Model3DRef } from "@/lib/types";
import Bag3DErrorBoundary from "./Bag3DErrorBoundary";
import { isWebGLAvailable, useReducedMotionPreference } from "./webgl-support";
import type { Canvas3DHandle } from "./Canvas3D";

const Canvas3D = dynamic(() => import("./Canvas3D"), {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});

function ViewerSkeleton() {
  return (
    <div className="viewer3d-skeleton" aria-hidden="true">
      <div className="skeleton-pulse" style={{ width: "60%", height: "60%", borderRadius: "50%" }} />
    </div>
  );
}

// SSR-safe "has this mounted on the client yet" check — the same
// useSyncExternalStore trick already used by cart-context.tsx and
// MobileMenu.tsx, so the server render and the client's first hydration
// pass match exactly (WebGL availability can only be known in the browser).
function subscribeNoop() {
  return () => {};
}
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

export interface BagViewer3DProps {
  label: string;
  body: Model3DRef;
  primaryColourHex: string | null;
  secondaryColourHex?: string | null;
  strap?: Model3DRef;
  chain?: Model3DRef;
  handle?: Model3DRef;
  /** Rendered instead of the 3D canvas: before mount, when WebGL is unavailable, or after a load failure. */
  fallback: ReactNode;
  /** Dev-inspector-only: extra scene content (e.g. attach-point markers), forwarded to Canvas3D. Unused by the real storefront viewer. */
  overlay?: ReactNode;
  /** Dev-inspector-only: exposes the live loaded/cloned scene for a debug UI to read node names/attach positions from. Unused by the real storefront viewer. */
  onSceneReady?: (scene: Object3D) => void;
}

export default function BagViewer3D({
  label,
  body,
  primaryColourHex,
  secondaryColourHex,
  strap,
  chain,
  handle,
  fallback,
  overlay,
  onSceneReady,
}: BagViewer3DProps) {
  const mounted = useMounted();
  const [failed, setFailed] = useState(false);
  const reducedMotion = useReducedMotionPreference();
  const controlsRef = useRef<Canvas3DHandle>(null);

  if (!mounted) return <>{fallback}</>;
  if (!isWebGLAvailable()) return <>{fallback}</>;
  if (failed) return <>{fallback}</>;

  return (
    <div className="viewer3d">
      <Bag3DErrorBoundary
        fallback={fallback}
        onError={(error) => {
          console.error("3D viewer failed, falling back:", error);
          setFailed(true);
        }}
      >
        <Canvas3D
          ref={controlsRef}
          label={label}
          reducedMotion={reducedMotion}
          bodyUrl={body.glbUrl}
          primaryColourHex={primaryColourHex}
          secondaryColourHex={secondaryColourHex}
          strapUrl={strap?.glbUrl}
          chainUrl={chain?.glbUrl}
          handleUrl={handle?.glbUrl}
          overlay={overlay}
          onSceneReady={onSceneReady}
        />
      </Bag3DErrorBoundary>
      <button
        type="button"
        className="viewer3d-reset"
        onClick={() => controlsRef.current?.resetView()}
        aria-label="Reset view"
      >
        Reset View
      </button>
    </div>
  );
}
