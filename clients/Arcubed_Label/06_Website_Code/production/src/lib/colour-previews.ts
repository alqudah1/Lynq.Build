// Approved colour previews — the tier BELOW real photography.
//
// A colour preview is an authentic Arcubed photograph with only the yarn
// colour changed (same pixels, same silhouette, stitches, shadows and
// perspective). It exists for one case: a confirmed colourway Rand offers
// before it has been photographed. It is never shown when a real photograph
// of that colourway exists, and never shown unlabelled — the gallery names it
// a preview and says which photograph it was made from.
//
// HAND-MAINTAINED AND EMPTY ON PURPOSE. As of 2026-10-08 every confirmed
// colourway of all four bags has real photography (src/lib/media-manifest.ts),
// so there is nothing for a preview to stand in for. Add an entry only when
// ALL of these hold:
//   1. the colour is confirmed by Rand and active in the catalogue
//   2. no real photograph of it exists yet
//   3. Rand has looked at this exact image and approved it
// The October 2026 proof of concept (Nova Gold -> Champagne / Silver) found
// small shifts within the same yarn family convincing and large ones not:
// Gold -> Silver read as dull pewter beside the real Silver yarn. Judge every
// preview against a real swatch of the yarn before proposing it.

import type { Frame } from "./media-manifest";
import { productKey } from "./product-media";
import type { Bag } from "./types";

export interface ColourPreview {
  frames: Frame[];
  /** The real colourway the source photograph shows, named in the label. */
  sourceColour: string;
  /** Who approved it and when — an unapproved preview does not belong here. */
  approvedBy: string;
  approvedOn: string;
}

/** product slug -> catalogue colour name -> approved preview. */
export const APPROVED_PREVIEWS: Record<string, Record<string, ColourPreview>> = {};

export function previewFor(bag: Pick<Bag, "slug" | "name">, colourName: string | null | undefined): ColourPreview | null {
  if (!colourName) return null;
  return APPROVED_PREVIEWS[productKey(bag)]?.[colourName] ?? null;
}
