// Preview colours: colours the renderer can show on a bag WITHOUT a
// photograph of that colourway. Adding one is data, not code:
//
//   key        stable id
//   name       what the customer reads
//   swatch     the chip shown in the selector
//   value      the yarn's MID-TONE as sRGB hex. Measure it, don't pick it:
//              photograph a flat swatch of the yarn under the studio lights
//              and take the colour of the middle band of its brightness —
//              the profile builder records exactly this for every real yarn
//              (profiles.generated.json `midLab`), so a measured value
//              matches how the real colourways were calibrated
//   products   which bags it may be previewed on
//   render     optional tuning (chroma, contrast multipliers; default 1)
//   approved   false until Rand has seen this preview and approved it
//
// A colour with real photography never comes from here: the gallery always
// prefers the photograph (src/components/customizer/ProductGallery.tsx).
//
// NONE OF THESE ARE ARCUBED COLOURS. They are illustrative values that test
// the renderer across the cases that matter — saturated warm, light, dark
// and cool, muted — and are shown only on the admin-only colour lab. Nothing
// here is purchasable, and nothing here reaches the storefront.

import type { PreviewColour } from "./engine";

export interface DefinedPreviewColour extends PreviewColour {
  approved: boolean;
}

const ALL = ["nova", "mini-luna", "vault", "loco"];
export const PREVIEW_COLOURS: DefinedPreviewColour[] = [
  { key: "red", name: "Red", swatch: "#a3222a", value: "#a3222a", products: ALL, approved: false },
  { key: "pink", name: "Pink", swatch: "#d97a9a", value: "#d97a9a", products: ALL, approved: false },
  { key: "navy", name: "Navy", swatch: "#263a63", value: "#263a63", products: ALL, approved: false },
  { key: "cream", name: "Cream", swatch: "#d9cdb2", value: "#d9cdb2", products: ALL, approved: false },
  { key: "dusty-rose", name: "Dusty Rose", swatch: "#a07f7f", value: "#a07f7f", products: ALL, approved: false },
];

export interface PreviewSource {
  frame: string;
  /** The real colourway the photograph shows. */
  colour: string;
  label: string;
  note: string;
  /** Lightest yarn (L*) this photograph can show convincingly. */
  maxLightness?: number;
  /** Evaluation only: never offered for an approved preview. */
  evaluation?: boolean;
  /** The bag's LOCKED photograph: every colour, real or previewed, is shown
   *  by recolouring this one image (first entry of each bag). */
  locked?: boolean;
}

/** Which photograph each bag's colours are recoloured from, and why. The
 *  locked photographs were chosen on 2026-10-11 by scoring and inspecting
 *  every authentic frame of each bag (sharpness, clipped highlights and
 *  crushed shadows, angle, handle visibility, mask quality) and validating
 *  every real colourway rendered from them against Rand's own photograph
 *  of that colour (docs/colour-previews.md). */
export const PREVIEW_SOURCES: Record<string, PreviewSource[]> = {
  nova: [
    { frame: "DSC05776", colour: "Gold", label: "Gold front, handle", locked: true, note: "Locked. The sharpest crochet of all 19 Nova frames and the handle in view (With Handle is the default). Its floor shadow is neutralised (gold bounce light tinted it) and the tile's matte keeps the space under the handle as backdrop." },
    { frame: "DSC04868", colour: "Silver", label: "Silver front", note: "Alternative. Neutral yarn and the cleanest light, but no handle in view." },
    { frame: "DSC05786", colour: "Gold", label: "Gold front", note: "Alternative. The hero angle without the handle. Its shadow was neutralised for previews (gold bounce light tinted it)." },
    { frame: "DSC05780", colour: "Black", label: "Black front", evaluation: true, note: "Evaluation only. A dark photograph stores little shadow detail, so light colours come out grainy." },
    { frame: "DSC05782", colour: "Black", label: "Black open (hardware test)", evaluation: true, note: "Evaluation only. The two metal clasps on the rim stay metal while the yarn around them recolours. Known failure: studio light shining through the stitch gaps inside the bag is tinted by the new colour — open, backlit views are not usable as preview sources." },
  ],
  "mini-luna": [
    { frame: "DSC04875", colour: "Silver", label: "Silver front", locked: true, note: "Locked. Same metallic raffia as Nova, calibrated with Nova's and Mini Luna's real yarns together. The handle is crochet and recolours with the body; the space inside the handle stays backdrop." },
  ],
  vault: [
    { frame: "DSC05790", colour: "Light Brown", label: "Light Brown front", locked: true, note: "Locked. Matte cotton cord, calibrated only against Vault's own three yarns (never Nova's metallic sheen). All three are dark earth tones, so light colours are extrapolated — check them against a real swatch." },
  ],
  loco: [
    { frame: "DSC05772", colour: "Burgundy", label: "Burgundy front", locked: true, maxLightness: 45, note: "Locked. Fringe cord. The strands are masked by darkness so the backdrop between them never changes. The source is dark and both reference yarns are dark: colours lighter than L* 45 (pink, cream, dusty rose) came out speckled and washed out, so they are refused." },
  ],
};
