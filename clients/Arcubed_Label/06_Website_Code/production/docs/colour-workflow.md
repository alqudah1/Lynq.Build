# Adding a new colour

How a supplier yarn becomes a colour customers can order, in the admin at
**/admin/colours** (sign in at /admin first). Set up 2026-10-15.

Nothing is for sale until the very last step. Uploading, measuring,
approving and choosing bags never put a colour on the shop.

## The steps

1. **Add colour.** Name it (one yarn: no "&") and choose the yarn's material.
   A colour can only ever go on bags of the same material:

   | Material | Bags |
   |---|---|
   | Metallic raffia | Nova, Mini Luna |
   | Matte cord | Vault |
   | Fringe cord | Loco |

   A different material would need its own photographed bag. Recolouring
   changes colour, never material.
2. **Yarn photograph.** Upload Rand's photo of the yarn (daylight or the
   studio lights, no filters). Drag a box over an even area of yarn. The page
   measures the yarn's mid-tone there (40th–60th percentile of brightness,
   the same definition used for the photographed colours).
3. **Calibrate** (only if needed). If the measured colour doesn't match the
   yarn in your hand, nudge lightness, colour strength or hue. Save.
4. **On each bag.** The page draws every bag of that material in the colour,
   from the same locked photograph the shop uses: exactly what customers
   will see. Bags it can't show faithfully are marked with the reason (Loco:
   nothing lighter than L* 45).
5. **Bags.** Tick the bags it should be offered on.
6. **Review.** Submit, then **Approve** (type who approved: Rand or Mustafa)
   or **Reject** with a note. Any later change to the photo, colour or bags
   withdraws the approval.
7. **Supplier.** Tick "Rand has confirmed her supplier can provide this yarn"
   and note the supplier or yarn code.
8. **Publish.** Only possible when approved, supplier confirmed and bags
   chosen. It adds the colour to those bags at each bag's normal price.

**Colours on sale** (same page) turns any colour on or off per bag. Off means
it disappears from the shop and checkout refuses it; on brings it back. A bag
always keeps at least one colour.

## What it changes in the database

- `colour_candidates` (new, migration `20261015180000_colour_workflow.sql`):
  the colours in progress. Server-only: RLS on, no policies, no access for
  the public or signed-in roles.
- Publishing writes the existing catalogue tables, through one atomic
  function (`publish_colour_candidate`):
  - a `colours` row with the calibrated code in `hex_value`. If a colour of
    the same name already exists (the same yarn on another bag) it is reused,
    and refused if its code differs.
  - a `product_colours` row per bag, `active = true`, `price_delta = 0`.
- On/off is `product_colours.active` (`set_product_colour_active`), the
  column the shop and the checkout already obey.

## How the shop shows a published colour

The product page draws the bag's locked photograph recoloured to the colour's
`hex_value`. It borrows shading, sheen and hue drift from Rand's photographed
yarns of the same material. Cart, checkout and order thumbnails do the same.
Order snapshots record the code (`colourHex`).

When Rand later photographs a bag in that colour, add the photos to the media
manifest as usual. The stage then uses that photographed yarn, and the photos
appear under "Photographed in …".
