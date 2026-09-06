# Photo Asset Map — Confirmed Drive Photography → Each Bag

> **Not the canonical geometry source.** `3d-production/PRODUCT-GEOMETRY-MAP.md`
> is, and it now carries a generated frame-by-frame evidence table with
> measured proportions. This file covers Drive folder → product mapping and
> the client-request policy only. If the two disagree about a shape, the
> geometry map wins.

Maps the photography Rand has confirmed by name (from the real-data briefs
— see `clients/Arcubed_Label/01_Client_Info/product-matrix.md`) to each
product. Used by both the 3D production pipeline (`docs/3d-production/`,
particularly `photo-reference.md`, which now points here) and, eventually,
the real product photography import for `product_images` and
`ready_for_delivery_item_images`.

**UPDATE — the archive has now been audited.** Rand's full Arcubed Google
Drive archive has been opened and reviewed. It is substantially larger than
the named references below assumed.

| Year | Folders |
|---|---|
| 2025 | Product Shots · Generic · Arcubed Phone Vids · Arcubed shoot folder |
| 2026 / March | PHOTOS · VIDEOS |

Dozens of high-resolution DSC photographs, many phone MOV clips, and newer
professional video.

**Video counts as geometric evidence** — a clip panning around a bag settles
side, base and back geometry as well as a still, often better.

**Professional sequences confirmed against products:**

| Product | Sequence | Establishes |
|---|---|---|
| Nova | Gold Nova photography | Compact rounded / oval-ish body · crochet construction · metallic material |
| Vault | DSC04876 | Taller-than-wide boxy body · prominent integrated opening / handle |
| Mini Luna | DSC05774 | Compact rounded-rectangle body · large integrated arched handle · metallic Red |
| Loco | DSC05765 | Rectangular body · integrated opening / handle · long structural fringe |

**Client-request policy: do not ask Rand to recreate evidence merely
because our internal mapping is incomplete.** An angle is not a gap because
nobody has catalogued it yet. The remaining work here is *mapping the
archive we already have*, not collecting more.

## CONFIRMED BY RAND — "Luna" folder ambiguity

**All Drive folders containing "Luna" are now confirmed to belong to Mini
Luna.** This was previously excluded pending confirmation; Rand has now
confirmed it directly. Folders such as "Silver Luna," "Gold Luna," "Black
Luna," and "Luna Gold & Silver" are Mini Luna references.

## Nova

| Confirmed reference | Use as |
|---|---|
| "Black Nova" | Shape reference (primary silhouette) + colour reference (Black) |
| "Champagne Nova" | Colour reference (Champagne) |
| "Gold Nova" | Colour reference (Gold — likely the metallic-yarn preset, see `3d-production/material-spec.md`) |
| "Silver Nova" | Colour reference (Silver — likely metallic-yarn preset) |
| "Gold Nova with Handle" | Handle reference (shape/attachment/proportions) + colour reference (Gold) — also the key reference for the open "is handle swappable?" question (`3d-production/nova-spec.md` §2) |
| "Nova Silver & Gold with Handle" | Two-tone reference — the confirmed real two-tone colourway (`is_two_tone = true`, shared with Mini Luna's "Luna Gold & Silver" — same real combination) — use as the primary/secondary zone split reference + handle reference |
| "Rose Gold Nova with Handle" | Colour reference (Rose Gold — metallic-yarn preset) + handle reference |

**Body geometry: SATISFIED BY EXISTING ARCHIVE.** The professional Gold
Nova photography establishes the compact rounded / oval-ish body, the
crochet construction and the metallic material appearance. Generic Nova
front/side/base/back requests are **withdrawn**.

**The one genuine Nova question is not a photography question at all.**
Whether the handle is standard on every Nova, specific to certain designs,
or an optional/custom feature is a **product configuration rule**. A
photograph can only show whether *one photographed Nova* has a handle — it
can never establish the rule. This is why folder names like "Gold Nova with
Handle" must not be read as evidence, and why this survives the archive
audit when every generic angle request did not. **Ask Rand directly.**

**Not yet located (check the archive before treating as absent):** hardware
close-ups and dedicated strap/chain reference. The Crochet Strap / Silver
Tone Chain / Gold Tone Chain names are confirmed, but no imagery has been
mapped to them yet. Search the 2025 and 2026 folders — including video —
before concluding any of it is missing, and never substitute stock imagery.

## Vault

| Confirmed reference | Use as |
|---|---|
| "Light Brown Vault" | Shape reference (primary silhouette) + colour reference (Light Brown) |
| "Olive Green Vault" | Colour reference (Olive Green) |
| "Brown Vault" | Colour reference (Brown) |

No two-tone reference needed (Vault has confirmed no two-tone support).

**Correction — handle reference IS needed.** This section previously said
"No handle reference needed (not in Vault's confirmed part list)." That is
stale: real photography confirms Vault has a **large opening / handle
structure built into the body**, and it is identity-defining geometry (see
`3d-production/PRODUCT-GEOMETRY-MAP.md`, Vault, contradiction C5).
**WITHDRAWN / SATISFIED BY EXISTING ARCHIVE.** An earlier revision of this
section asked Rand for a straight-on shot of the opening and called it the
single most valuable missing photo in the package. It is not missing — the
professional **DSC04876** sequence shows the integrated opening/handle
prominently, alongside the taller-than-wide boxy body. Every generic Vault
request (front, side, base, back, three-quarter opening) is withdrawn.
**There are no open client questions for Vault.** Resolve the remaining
detail from the archive.

## Mini Luna

| Confirmed reference | Use as |
|---|---|
| "Red Mini Luna" | Shape reference (primary silhouette) + colour reference (Red) |
| "Silver Luna" | Colour reference (Silver — shared colour catalog entry with Nova's Silver) |
| "Gold Luna" | Colour reference (Gold — shared colour catalog entry with Nova's Gold) |
| "Black Luna" | Colour reference (Black — shared colour catalog entry with Nova's Black) |
| "Luna Gold & Silver" | Two-tone reference — the same real "Silver & Gold" two-tone colourway shared with Nova |

Mini Luna now has the richest confirmed colour set of the four products.

**Correction — handle reference IS needed, and this one is backwards, not
just stale.** This section previously said "No handle reference needed."
Mini Luna has the package's only **mandatory separate `handle` node**
(`PRODUCT_PART_REQUIREMENTS["mini-luna"].handle = true`) — a large,
thick, integrated arched crochet handle confirmed from real photography
(see `3d-production/PRODUCT-GEOMETRY-MAP.md`, Mini Luna, contradiction
C10). **WITHDRAWN / SATISFIED BY EXISTING ARCHIVE.** An earlier revision asked
for a handle-join close-up, a base shot, and confirmation that Red is
metallic. The professional **DSC05774** sequence already establishes the
compact rounded-rectangle body, the large integrated arched handle, and the
metallic Red construction — which independently corroborates C9. Every
generic Mini Luna request is withdrawn. **There are no open client
questions for Mini Luna.** Do not request replacement photography.

## Loco

| Confirmed reference | Use as |
|---|---|
| "Brown Loco" | Shape reference (primary silhouette) + colour reference (Brown — same shared "Brown" colour catalog entry Vault also uses) |
| "Burgundy Loco" | Colour reference (Burgundy) |

No two-tone reference needed (Loco has confirmed no two-tone support).

**Correction — handle/opening reference IS needed.** This section
previously said "No handle reference needed." Loco's hand opening is
confirmed as built into the crocheted upper body (see
`3d-production/PRODUCT-GEOMETRY-MAP.md`, Loco, contradiction C14).

**Partly satisfied.** The professional **DSC05765** sequence confirms the
rectangular body, the integrated opening/handle, and the long fringe as
identity-critical structural geometry. The generic front/side/base/back
requests are **withdrawn**.

**Still open, but NOT yet a client ask — conditional on the video.** How
the strands anchor to the body, and what the body and base look like
beneath the fringe, are not yet established. **Check the phone MOV clips
and professional video first** — fringe moves as a bag is handled, so a
clip is far more likely to reveal the underside than any still. Only if no
frame in the entire archive shows it does this become a question for Rand.

**Strand count, length, spacing and anchoring remain prohibited from being
invented**, whatever the source of the eventual answer.

## Client questions — the complete current list

The 12-item "consolidated ask" that stood here is **withdrawn in full**. It
was written before the archive was audited and asked for evidence that
already exists. It must not be restored.

After the audit, exactly these remain:

| # | Question | Why it survives | Status |
|---|---|---|---|
| 1 | **Nova: is the handle part of every Nova, only certain Nova designs, or an optional / custom feature?** | **Photography cannot answer this.** A photo shows whether one photographed Nova has a handle; it cannot establish the product configuration rule. Only Rand can | **ASK** |
| 2 | **Yarn colour codes, if she has them** | Not obtainable from any photo or video. Physical yarn may have no digital value at all — so this is a soft ask, phrased "if you have them," never a demand for hex codes | **ASK** |
| 3 | Loco: where the fringe attaches, and the body beneath it | Conditional. Check the existing video first | **HOLD** |
| 4 | Where straps and chains physically attach | Conditional. Check the existing archive first | **HOLD** |

Nothing else. Vault and Mini Luna have **no** open client questions.

## Cross-cutting notes

- **No hardware reference has been MAPPED yet for any product** — which is
  not the same as none existing. Every body spec requires a `hardware`
  node. Search the archive (stills and video, both years) before treating
  this as a gap; a clasp or rivet is very likely visible somewhere in
  dozens of high-resolution product shots. Only escalate to Rand if the
  archive genuinely has nothing.
- **No chain photography has been MAPPED yet**, despite the chain *names*
  being confirmed (Silver Tone Chain, Gold Tone Chain). Same rule: search
  the archive first. Do not substitute stock/generic chain imagery, and do
  not ask Rand for a chain photo until the archive has been ruled out.
- **No confirmed hex codes accompany any of these photos.** A reference
  photo shows what a colourway *looks like*, but a hex code (or a proper
  material/texture reference) is a separate, still-unconfirmed piece of
  data — don't treat "visible in the photo" as equivalent to "hex
  confirmed." Never write a sampled/approximate hex into
  `colours.hex_value` without Rand's sign-off. **Ask softly and accept
  no:** Rand may have manufacturer/yarn codes, or she may have none at all
  — these are physical yarns, not digital swatches. "If you have them" is
  the ask; a demand for hex values is not.
- **The archive is audited but not yet fully mapped.** The remaining work
  is going through the 2025 and 2026 folders and recording, per product:
  (a) whether more colourways exist beyond the names above, (b) which
  frames establish hardware, strap and chain attachment, (c) which clips
  resolve base, back and side geometry, and — for Loco specifically —
  (d) whether any frame shows the fringe anchoring or the body beneath it.
  **This is our mapping work, not a request to Rand.** Nothing here becomes
  a client question until the archive has been exhausted.
- **Ready for Delivery** items will need their own real photos too (see
  `docs/ready-for-delivery.md`) — those are photos of one exact physical
  bag, not a colourway reference, so they don't map through this document
  the same way; they get uploaded directly against a specific
  `ready_for_delivery_items` row.
