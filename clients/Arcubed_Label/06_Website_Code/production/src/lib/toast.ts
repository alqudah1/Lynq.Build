"use client";

// Arcubed Label — minimal toast utility, ported from the prototype's showUndoToast.
// A plain window event instead of another context provider — one <Toaster/> in the
// root layout listens and renders; anywhere else just calls showToast(message).

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent("arcubed:toast", { detail: message }));
}
