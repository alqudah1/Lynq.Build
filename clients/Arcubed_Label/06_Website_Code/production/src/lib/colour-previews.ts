// Approved colour previews — what a CUSTOMER sees for a confirmed colourway
// that has not been photographed yet.
//
// The order of preference on the product page never changes:
//   1. a real photograph of the selected colourway (always wins)
//   2. an APPROVED digital colour preview, defined here: an authentic
//      photograph of the same bag with only the yarn recoloured in the
//      browser (src/lib/recolour/), labelled as a digital preview
//   3. another colourway's photograph, labelled as such
//
// HOW A COLOUR GETS HERE. Never by adding a colour on its own:
//   - the colour must already be a confirmed, purchasable colour of that bag
//     in the catalogue (Supabase product_colours) — this file never creates
//     a colour, so nothing here can make an unconfirmed colour orderable
//   - `value` is MEASURED from a swatch photograph of the real yarn (see
//     docs/colour-previews.md), not picked
//   - Rand (or Mustafa) has looked at that exact preview in the admin colour
//     lab and approved it; `approvedBy` and `approvedOn` record that
//
// Empty on purpose: every confirmed colourway of all four bags is
// photographed today.

import type { Bag } from "./types";
import { productKey, framesForColour } from "./product-media";

export interface ApprovedPreview {
  /** The yarn's measured mid-tone, sRGB hex. */
  value: string;
  /** Optional renderer tuning (chroma/contrast multipliers). */
  render?: { chroma?: number; contrast?: number };
  /** Source photograph (see PREVIEW_SOURCES) and the colourway it shows. */
  frame: string;
  sourceColour: string;
  approvedBy: string;
  approvedOn: string;
}

/** product slug -> catalogue colour name -> approved preview. */
export const APPROVED_PREVIEWS: Record<string, Record<string, ApprovedPreview>> = {};

export function previewFor(
  bag: Pick<Bag, "slug" | "name">,
  colourName: string | null | undefined,
  approved: Record<string, Record<string, ApprovedPreview>> = APPROVED_PREVIEWS,
): ApprovedPreview | null {
  if (!colourName) return null;
  return approved[productKey(bag)]?.[colourName] ?? null;
}

/** True when the customer will see a digital preview, not a photograph. */
export function isPreviewOnly(
  bag: Pick<Bag, "slug" | "name">,
  colourName: string | null | undefined,
  approved: Record<string, Record<string, ApprovedPreview>> = APPROVED_PREVIEWS,
): boolean {
  return framesForColour(bag, colourName).length === 0 && previewFor(bag, colourName, approved) !== null;
}
