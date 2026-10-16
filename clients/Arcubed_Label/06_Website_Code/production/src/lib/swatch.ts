// Where each bag's swatch close-up is taken (fractions of the photograph): on
// the body's stitches, not Mini Luna's handle arch or Loco's fringe. Shared by
// scripts/build-swatches.mjs (photographed colours, built once) and the
// Atelier (colours drawn by the recolouring engine).
export const SWATCH_FOCUS: Record<string, [number, number]> = {
  nova: [0.5, 0.56], "mini-luna": [0.5, 0.74], vault: [0.5, 0.62], loco: [0.5, 0.34],
};
/** Width of the close-up, as a fraction of the photograph: a few stitches across. */
export const SWATCH_SPAN = 0.08;
