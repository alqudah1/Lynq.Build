# Arcubed Label — Product Matrix

**Status: real client data received 2026-09-02, sizes/straps/chains/photo-
mapping/return-policy/Ready-for-Delivery confirmed 2026-09-03** — all
imported into the live database (project ref `fnswiyxjbsabomktqizr`) via
the migrations listed inline below. Sections marked **UNRESOLVED** are
genuinely still open — nothing in this document was guessed to fill a gap.
Ask Rand before inventing any of them.

---

## Global / site-wide

- **Currency:** JOD ✅ confirmed
- **Standard production time (made-to-order):** 5–7 days ✅ confirmed
  (changed from 3–5 business days on 2026-09-19 at the client's request;
  `store_settings.production_time_label` and
  `supabase/migrations/20260919210000_production_time_five_to_seven.sql`)
- **Ready for Delivery fulfillment:** next day ✅ confirmed ("these would be
  delivered next day") — see the Ready for Delivery section below.
- **Shipping policy:** ✅ confirmed for Jordan, **UNRESOLVED for international**
  - Inside Amman: 3 JOD
  - Outside Amman (rest of Jordan): 5 JOD
  - Worldwide: **UNRESOLVED** — "depends on destination country." No rates
    or a rate table have been supplied. The storefront shows "calculated
    based on destination — contact us for a quote" rather than a number.
- **Return/exchange policy:** ✅ confirmed as a two-tier architecture (see
  "Return/exchange policy" section below) — custom orders are final sale;
  Ready for Delivery terms are **UNRESOLVED as an exact rule** (historically
  returnable when in-stock, but no specific window/process confirmed for
  the new site).
- **Materials & care:** **UNRESOLVED** — still showing the pre-existing
  placeholder ("100% cotton yarn, hand-crocheted. Spot clean, air dry.").
  Not part of any real-data brief so far; confirm or correct with Rand
  separately.

## Brand

- **Logo:** ✅ supplied — `02_Branding/ARCUBED LOGO - FAIRMONT.png` (navy bg,
  pale-pink wordmark) and `ARCUBED LOGO2 - FAIRMONT.png` (pale-pink bg, navy
  wordmark). Both cropped to transparent-background wordmarks in
  `06_Website_Code/production/public/brand/`.
- **Primary colours:** Navy `#143562`, Pale Pink `#FFE0FD` ✅ confirmed.
- **Tagline:** "YOUR NEW FAVOURITE BAG" ✅ confirmed.
- **Instagram:** `@arcubed__label` ✅ confirmed.

## Customization rules (apply to all four products unless noted)

- **Colours:** free (+0) ✅ confirmed
- **Two-tone colour:** free (+0) ✅ confirmed — **Nova and Mini Luna only**;
  **Vault and Loco have no confirmed two-tone support**. Modeled as a
  `colours.is_two_tone` flag. Nova's two-tone colourway ("Silver & Gold")
  is also linked to Mini Luna (see Photo Mapping below) — Mini Luna has no
  *separate* confirmed two-tone colourway of its own yet, but does support
  the capability.
- **Size upgrade:** ✅ confirmed, **product-specific** — see each product
  below. Not a flat rule across all four products (Loco has none yet).
- **Straps:** ✅ confirmed — **Crochet Strap, +5 JOD**, offered on all four
  products.
- **Chains:** ✅ confirmed — **Silver Tone Chain, +5 JOD** and **Gold Tone
  Chain, +5 JOD**, both offered on all four products. Rand does not
  currently have dedicated product photography for the chains — no chain
  imagery has been invented or sourced elsewhere.
  The missing piece is **photographic evidence, not product definition**:
  the commerce options are confirmed and live. Client reaffirmed 2026-09-08.
- **Nova handle:** ✅ confirmed 2026-09-08 — **With Handle** and **Without
  Handle**, both at the JOD 55 base price, `price_delta = 0`. A choice, not
  an upgrade. Applied to the database 2026-09-08 (migration
  `20260908120000_nova_handle_choice.sql`). **No handle photography exists
  for either option** — the selector is typographic and must stay that way
  until Rand supplies images of both.

---

## Product: Nova

- **Slug:** `nova`
- **Base price:** 55 JOD ✅
- **Sizes:** ✅ confirmed — Regular (default, +0), Medium (+5 JOD), Large
  (+5 JOD). **No real dimensions supplied for Medium/Large — do not invent
  them.**
- **Straps/Chains:** ✅ Crochet Strap (+5), Silver Tone Chain (+5), Gold Tone
  Chain (+5)
- **Colours (from supplied photography):** Gold, Black, Champagne, Silver,
  Rose Gold, Silver & Gold (two-tone) ✅ names confirmed, **hex codes
  UNRESOLVED**
- **Two-tone:** ✅ supported (Silver & Gold)
- **Photography noted but not yet mapped:** "Gold Nova with Handle", "Nova
  Silver & Gold with Handle", "Rose Gold Nova with Handle" — **UNRESOLVED:
  is "handle" a real customer-selectable option for Nova**, or just how
  those specific photographed pieces happen to be made? Still open — this
  round of confirmations didn't address it.

## Product: Vault

- **Slug:** `vault`
- **Base price:** 50 JOD ✅
- **Sizes:** ✅ confirmed — Regular (default, +0), Large (+5 JOD). **No real
  dimensions supplied — do not invent them.**
- **Straps/Chains:** ✅ Crochet Strap (+5), Silver Tone Chain (+5), Gold Tone
  Chain (+5)
- **Colours:** Light Brown, Olive Green, Brown ✅ names confirmed, hex
  UNRESOLVED
- **Two-tone:** ✅ confirmed NOT supported

## Product: Mini Luna

- **Slug:** `mini-luna`
- **Base price:** 50 JOD ✅
- **Sizes:** ✅ confirmed — Regular (default, +0), Small (+0 — **free
  size-up, do not price this at +5 JOD** like Nova/Vault's upsizes).
- **Straps/Chains:** ✅ Crochet Strap (+5), Silver Tone Chain (+5), Gold Tone
  Chain (+5)
- **Colours:** ✅ **RESOLVED — all "Luna" Drive folders are now confirmed to
  mean Mini Luna.** Red (original), plus Silver, Gold, Black, and the
  two-tone Silver & Gold (shared with Nova's colourway of the same real
  combination — "Luna Gold & Silver" and Nova's "Silver & Gold" are the
  same real two-tone colour). Hex codes still UNRESOLVED.
- **Two-tone:** ✅ supported (uses the shared Silver & Gold colourway)
- **Sizes note:** the "small size-up" phrasing is Rand's own — treat
  "Small" as the exact confirmed size name; do not rename it.

## Product: Loco

- **Slug:** `loco`
- **Base price:** 65 JOD ✅
- **Sizes:** **UNRESOLVED — explicitly kept unresolved per instruction.**
  Rand has not yet specified Loco's size options. No size rows exist for
  Loco in the database. Do not add any until confirmed.
- **Straps/Chains:** ✅ Crochet Strap (+5), Silver Tone Chain (+5), Gold Tone
  Chain (+5)
- **Colours:** Brown, Burgundy ✅ names confirmed, hex UNRESOLVED
- **Two-tone:** ✅ confirmed NOT supported

---

## Return/exchange policy

Architecture (`public.return_policies`, one row per order type):

- **Custom / made-to-order:** ✅ confirmed — **final sale**, no
  change-of-mind return or exchange. A legal/defect exception always
  applies regardless (defective item, damaged item, incorrect item, or any
  right required by applicable consumer law) — this exception path is
  structurally always shown alongside the policy, never omittable.
- **Ready for Delivery / in-stock:** **UNRESOLVED as an exact rule.** Rand's
  own words: existing/in-stock bags and staple colours have historically
  been returnable/exchangeable, and she wants the new Ready for Delivery
  line to keep configurable terms until she confirms the exact rule (return
  window, condition, process). No return window has been invented. The
  same legal/defect exception always applies here too.

## Ready for Delivery — new feature

Rand's own request: *"Can we add ready for delivery orders, to upload any
bags in stock, these would be delivered next day."* Approved and built —
see `docs/ready-for-delivery.md` for the full architecture. Separate
storefront section (`/ready-for-delivery`) and separate database tables
(`ready_for_delivery_items`, `ready_for_delivery_item_images`) from the
made-to-order customizer catalog. **No real in-stock items have been
uploaded yet** — the feature is built and ready to receive them the moment
Rand (or whoever manages the catalog) adds the first one; see that doc's
"what's needed to list the first item" section.

---

## Photography

- **Source:** two client Google Drive folders. **UNRESOLVED — blocked:**
  this Claude Code session does not have Google Drive access authorized
  (no OAuth in a non-interactive environment), so the actual image files
  have not been downloaded or mapped yet. Folder *names* were used to
  confirm real colour names and (as of this round) the Mini Luna mapping —
  no image file has actually been imported. See `docs/photo-asset-map.md`
  for the full folder → product mapping now that "Luna" = Mini Luna is
  resolved.
- **Mapping architecture:** ready — `product_images` has nullable
  `colour_id`/`strap_handle_id` columns; `ready_for_delivery_item_images`
  exists for Ready for Delivery photos. Once real files are available the
  import needs no further schema changes.
- **Current visual:** every made-to-order product still renders through the
  placeholder procedural bag illustration (`BagArt.tsx`) — real photography
  has not replaced it for any colourway yet.
- **Chains specifically:** Rand does not currently have dedicated chain
  photography (Silver Tone Chain / Gold Tone Chain) — no chain imagery has
  been sourced or invented as a substitute.
- **Next step once unblocked:** either grant this environment Drive access,
  or have Rand/the team export the folders (zip, or upload the files
  directly) so they can be placed in `03_Images/` and imported.
