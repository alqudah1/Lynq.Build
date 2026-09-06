import { useSyncExternalStore } from "react";

// Cheap, synchronous WebGL availability check — run before ever mounting a
// <Canvas>, so a device/browser without WebGL (or with it disabled) never
// shows a broken viewer, it just never attempts one.
export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/**
 * Live prefers-reduced-motion state via useSyncExternalStore — same pattern
 * as cart-context.tsx/MobileMenu.tsx use for other browser-only state, so
 * the SSR pass and the client's first hydration render match exactly and no
 * setState-in-effect is needed to pick it up.
 */
export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot);
}
