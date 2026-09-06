# Product Geometry Map — Nova, Vault, Mini Luna, Loco

> **THIS IS THE CANONICAL 3D EVIDENCE DOCUMENT.** Where this file and any
> other disagree about geometry, this file wins.
> `../photo-asset-map.md` maps Drive folder names to products and records
> client-request policy; it defers to this file on anything geometric.
> Product specs (`vault-spec.md` etc.) are production instructions derived
> from this file, not independent evidence.
>
> The frame-level table near the end is **generated** from
> `.blockouts/measurements.json` by `scripts/write-frame-evidence.mjs`.
> Re-run `scripts/measure-products.mjs` then that script after adding media.

**Correction on record:** Arcubed does not have one generic bag design.
Nova, Vault, Mini Luna, and Loco are **four distinct physical products**,
each with its own real construction. Nothing about this package — the
shared node-name *vocabulary* (`bag_body_primary`, `attach_strap`, etc.),
the shared material *presets* (regular-yarn, metallic-yarn, metal), or the
shared export pipeline — means the products share actual geometry. A node
being named `bag_body_primary` on both Nova and Vault means both files use
the same **contract** so the same viewer code can load either one; it does
not mean either file's mesh data may ever be copied, reused, or
approximated from the other.

**Second correction on record:** the real geometry for each product must
be established by someone actually looking at that product's real
photography — not inferred from folder names, not inferred from another
product, and not modeled from assumption.

## 0. Status vocabulary used throughout this document

Every factual claim below is tagged with exactly one of these three labels
— no others are permitted anywhere in this package:

- **CONFIRMED BY RAND** — a fact the client stated directly (a name, a
  price, which folders belong to which product, whether a feature exists
  as a customer-selectable option). Not a visual observation.
- **CONFIRMED FROM PHOTOS** — a fact established by someone actually
  looking at that exact product's real photography and recording what they
  saw.
- **UNRESOLVED** — not yet established by either route. Never filled with
  a guess.

## 0.1 Evidence rounds — read this before trusting any row below

Photographic findings have arrived in two rounds, and **round 2 supersedes
round 1 wherever the two conflict.**

- **Round 1** — an earlier visual review. Recorded silhouette, proportion,
  base, and opening findings for all four products. Its raw text is
  archived verbatim at `archive/PRODUCT-GEOMETRY-MAP.round1.md`; the
  substance of every claim it made is either carried forward, corrected,
  or downgraded below — nothing was silently dropped.
- **Round 2 (2026-09-05)** — direct visual confirmation of real product
  photography for Gold Nova, Vault (dark brown), Red Mini Luna, and Loco
  (brown).
- **Round 3 — ARCHIVE AUDIT (2026-09-05)** — Rand's full Arcubed Google
  Drive archive was opened and audited. See §0.2.
- **Round 4 — DIRECT FRAME INSPECTION (2026-09-05)** — the named DSC frames
  were opened and inspected directly while building the first blockouts.
  **This is the current authority.** It produced two corrections and one
  process finding that affect every measurement taken so far — see §0.3.

## 0.3 Round 4 — what direct inspection of the frames changed

### Orientation is now handled by code, not by memory

All 45 archive frames carry **EXIF orientation 8** — verified across every
file, not sampled. The pipeline no longer depends on anyone remembering it:

| Guarantee | Where |
|---|---|
| Every pixel read goes through `.rotate()` (bakes EXIF in) | `scripts/lib-mask.mjs` — the single mask source |
| Stored vs displayed dimensions are swapped explicitly | `lib-object-bbox.mjs`, which corrects `.metadata()` (it reports STORED size and ignores a pending rotate — this caused a real mis-mapping) |
| Every measurement records that it was normalized | `orientationNormalized: true` + `exifOrientation: 8` on each row of `.blockouts/measurements.json` |
| Inspection images are normalized too | `scripts/inspect-frames.mjs` has no un-normalized code path, and stamps `[orientation normalized]` on every tile |

**Any width/height figure in this document was produced after
normalization.** Figures from before it are marked below where they were
corrected.

### The original process finding

Every frame is stored rotated, with EXIF orientation 8 telling a viewer to
turn it 90°. Browsers and `sharp().rotate()` honour that and show the bag
upright; raw-pixel readers do not, and show it on its side. **Any proportion
read off the stored pixels without correcting for this comes out inverted.**
This is the likely root of the Vault proportion conflict below.

### Vault's grip — resolved by measurement, after two wrong turns

**Final answer: a thick rolled crochet band runs along the top and rises into
a shallow arc, with a small THROUGH-opening beneath it.** Measured across the
three near-front frames (DSC05788 / DSC05790 / DSC05792): opening area
**1.6–2.3% of the object box**, bottom edge at **18–20% of total height**.

The distinction from Mini Luna is now quantitative rather than adjectival:

| | Vault | Mini Luna |
|---|---|---|
| Opening area (% of object box) | 1.6–2.3% | **7.0–11.6%** |
| Opening bottom (% of height) | 18–20% | **43–46%** |
| Reads as | tight grip slot in a raised band | large free-standing arch |

**Both earlier readings were wrong, in opposite directions**, and both came
from un-normalized frames: one pass called Vault a free-standing arch (it is
not — nothing rises clear of the body), a later pass called it a flat slot cut
in a flat band (also not — the band genuinely rolls and rises). Recorded so
neither is re-derived.

### Earlier framing of the same finding

**C4 is resolved: Vault's grip is a horizontal HAND-SLOT cut through a
raised top band.** The body's top rises into a band, and a slot is cut
through it; the band either side of the cut is the grip. Nothing rises clear
of the body. Confirmed at full resolution on DSC05790 and DSC04876.
**Vault's original spec language — "integrated horizontal hand opening" —
was correct all along.**

**Recorded because it nearly became a spec fact:** an earlier pass in this
same round called this an *arch handle*. That reading came from the
EXIF-rotated frame, where a top band plus slot reads convincingly as a
free-standing loop. It is wrong. Anyone reviewing on rotated pixels will
make the same mistake.

**Loco is the same construction** — raised top band, horizontal slot. **Mini
Luna is genuinely different**: a thick tube arching well clear of the rim
with open space beneath (DSC05774). So the four split two ways, and the
distinction is now CONFIRMED FROM PHOTOS:

| Grip type | Products |
|---|---|
| Hand-slot cut through a raised top band | Vault, Loco |
| True arch handle rising clear of the rim | Mini Luna |
| None in any attributed frame | Nova (business rule still open) |

Sharing a grip *type* is not permission to share geometry — Vault's deep
boxy body and Loco's fringed shallow band remain entirely different.

### Conflict — Vault's proportions

The round-3 summary recorded Vault as **taller than wide**. Direct tracing of
DSC04876 and DSC05790, with the 90° rotation corrected, gives a body
markedly **wider than tall** — roughly 1.35–1.4 : 1 including the handle,
consistent across both frames.

**RESOLVED.** Measured on orientation-normalized frames with the body taken
separately from the top band: **DSC05788 = 1.92, DSC05790 = 1.77,
DSC05792 = 1.89 — median 1.89 : 1 WIDER than tall**, three colourways
agreeing to within 8%. The round-3 "taller-than-wide / boxy" summary is
superseded. Three-quarter frames (DSC04876/04877/04878) are foreshortened and
were deliberately **not** averaged into this figure.

**Vault's proportions are therefore UNRESOLVED, not confirmed.** The
blockout uses the traced value so the disagreement is visible on screen
rather than buried. Resolve from the archive — this is not a client
question.

### Nova — candidate frames, and the round-1 reading may have been right

DSC04868 (silver) and DSC05780 (black) show a handle-less, compact, rounded
metallic bag consistent with Nova. **Their attribution to Nova is inferred
from shape and colour and is UNRESOLVED** — round 3 named "Gold Nova
photography" without file numbers. Both trace to roughly **1.8–2.1 : 1
wider than tall**, which supports round 1's "low, wide" reading that round 2
downgraded (C1). Not promoted, because the attribution is unconfirmed.

### Loco — fringe envelope

DSC05765 gives the fringe roughly **two thirds of the total silhouette
height**. That is an envelope proportion for massing only. **Strand count,
length, spacing and anchoring remain UNRESOLVED and prohibited from being
invented** — the existing video has not yet been exhausted.

## 0.2 The archive — what Rand has already given us

| Year | Folders |
|---|---|
| 2025 | Product Shots · Generic · Arcubed Phone Vids · Arcubed shoot folder |
| 2026 / March | PHOTOS · VIDEOS |

Dozens of high-resolution DSC photographs, many phone MOV clips, and newer
professional video.

**Video counts as geometric evidence.** A clip that pans around a bag, or a
bag turned in someone's hand, settles side, base and back geometry as well
as a still can — often better, because it shows the object from angles no
one thought to photograph. Any audit that treats the MOV/MP4 material as
non-evidence will manufacture gaps that do not exist.

**Sequences confirmed against products in this round:**

| Product | Existing professional media | What it establishes |
|---|---|---|
| Nova | Gold Nova photography | Compact rounded / oval-ish body · crochet construction · metallic material appearance |
| Vault | DSC04876 sequence | Taller-than-wide boxy body · prominent integrated opening / handle construction |
| Mini Luna | DSC05774 sequence | Compact rounded-rectangle body · large integrated arched handle · metallic Red construction |
| Loco | DSC05765 sequence | Rectangular body · integrated opening / handle · long fringe as identity-critical structural geometry |

### The client-request policy this establishes

**Do not ask Rand to recreate evidence merely because our internal mapping
is incomplete.** An angle is not a gap because we have not catalogued it
yet. Before anything reaches a client request it must be routed per each
product's §9 — and only a **CLIENT** route is ever asked.

The broad "front / side / back / base for every product" request written
before this audit is **withdrawn in full** and must not be restored.

Round 2 **contradicted round 1 on Vault's proportions, Mini Luna's
silhouette, and Nova's proportions**, and refined Loco's fringe extent.
Because round 1 proved wrong about the shape of the very photos round 2
re-examined, **round-1 claims about the same aspects (proportion, base,
opening geometry) that round 2 did not independently re-confirm have been
downgraded to UNRESOLVED** rather than carried forward on trust. Every one
of those downgrades is itemised in §Contradiction Log at the end of this
document. Round-1 claims about material/weave character — which round 2
corroborated in every case — are retained as CONFIRMED FROM PHOTOS.

## 1. The rule, restated plainly

| | Nova | Vault | Mini Luna | Loco |
|---|---|---|---|---|
| Own unique body geometry required | ✅ | ✅ | ✅ | ✅ |
| May reuse another product's geometry | ❌ never | ❌ never | ❌ never | ❌ never |
| May reuse its *own* geometry across its *own* colourways | ✅ (material swap only) | ✅ | ✅ | ✅ |
| Geometry may be inferred from another product | ❌ never | ❌ never | ❌ never | ❌ never |
| Unseen back/side geometry may be fabricated | ❌ never | ❌ never | ❌ never | ❌ never |

A colourway is a material change on one product's own file — Gold Nova,
Black Nova, Silver Nova, Champagne Nova, and Rose Gold Nova all load
`nova-body-v1.glb` with a different `bag_body_primary`/`bag_body_secondary`
colour applied at runtime. None of them are a different geometry file, and
none of Nova's colourways are ever a candidate substitute for Vault, Mini
Luna, or Loco.

Round 2 confirms this is not merely policy. The four are visibly different
designs: a compact rounded/oval-ish bag, a tall boxy rectangular bag with a
large built-in opening, a compact rounded-rectangular bag under a large
arched handle, and a rectangular bag carrying long structural fringe.

## 2. Acceptance gate — binding on every product

**No production GLB may be accepted for any product until that exact
product's geometry checklist (below) has no UNRESOLVED row remaining that
affects buildable geometry.** A model built before its checklist is
complete — no matter how plausible it looks — is not eligible to pass
`qa-checklist.md`, regardless of whether it otherwise satisfies the
node-name/material/export requirements. Passing the technical QA checklist
and having a complete visual audit are both required; neither substitutes
for the other.

**As of round 2, no product's checklist is complete.** Every product still
has UNRESOLVED rows. See §"Can we commission modeling yet?" at the end for
what that means in practice per product.

## 2.1 The checklist shape used for all four products

Every product below is audited against the same thirteen rows, so a gap in
one product is directly comparable to the same gap in another:

silhouette · proportions · top opening · base · handle · primary material
zone · secondary material zone · hardware · strap attachment · chain
attachment · fringe (where relevant) · unseen/back geometry · resolution
routing

**Read the status and the route together.** A row marked UNRESOLVED says
only that *we* have not established it yet. Each product's §9 says where
the answer comes from — the existing archive, a genuine question for Rand,
or media that does not exist anywhere. Most UNRESOLVED rows route to
ARCHIVE, which means nobody asks Rand anything.

---

## Nova

### 1. Confirmed photo folders — CONFIRMED BY RAND
Black Nova, Champagne Nova, Gold Nova, Silver Nova, Gold Nova with Handle,
Nova Silver & Gold with Handle, Rose Gold Nova with Handle (per
`docs/photo-asset-map.md`).

### 2. Geometry checklist — INCOMPLETE

Based only on Nova's own photos. Never inferred from Vault, Mini Luna, or
Loco. Round-2 evidence source: the Gold Nova reference.

| # | Category | Status |
|---|---|---|
| 1 | Silhouette | **CONFIRMED FROM PHOTOS** (round 2) — compact bag with a rounded / oval-ish body. Not angular, not boxy |
| 2 | Proportions | **UNRESOLVED** — round 1 recorded "low, wide clutch, much wider than it is tall, rounded trapezoid"; round 2 re-examined the reference and read it as **compact and rounded/oval-ish**, which does not establish a markedly wider-than-tall clutch proportion. The width:height ratio is not established. See Contradiction C1 |
| 3 | Top opening | **UNRESOLVED** — round 1 recorded a top edge narrower than the widest part of the body, softly rounded. Round 2 did not re-confirm this and it describes the same silhouette aspect round 1 got wrong. Closure hardware presence is separately unknown and must not be assumed |
| 4 | Base | **UNRESOLVED** — round 1 recorded a broad curved/oval base with rounded corners. Not re-confirmed in round 2; downgraded with the rest of the round-1 proportion reading. Do not model a "broad" base on the strength of round 1 alone |
| 5 | Handle | **UNRESOLVED** — round 2 explicitly re-confirms that the standard Gold Nova reference **did not clearly show a tall integrated handle**. Some Drive folders are named "…with Handle." **A folder name is not evidence of geometry.** It is not known whether handle is (a) a customer-selectable option, (b) a fixed feature of the standard body, or (c) a difference between individual photographed pieces. Do not resolve by guessing; do not build `handle` or `attach_handle` |
| 6 | Primary material zone | **CONFIRMED FROM PHOTOS** — thick, visibly textured crochet in a metallic gold ribbon-like yarn on the Gold colourway. Must read as metallic *thread*, never as smooth plastic or chrome. Round 1's "dense horizontal crochet rows" reading is corroborated by round 2's "thick textured crochet" and is retained |
| 7 | Secondary material zone | **UNRESOLVED** — two-tone *support* is CONFIRMED BY RAND (Silver & Gold). Where the primary/secondary zone boundary physically falls has never been observed in any round |
| 8 | Hardware | **UNRESOLVED** — no confirmed photo of any Arcubed clasp/buckle/rivet exists, for Nova or any product |
| 9 | Strap attachment | **UNRESOLVED** — no photo has established where a strap physically attaches to Nova's body |
| 10 | Chain attachment | **UNRESOLVED** — same; no chain photography exists for any product |
| 11 | Fringe | N/A — Nova has no fringe. **CONFIRMED FROM PHOTOS** that no reviewed image of any round shows fringe on Nova |
| 12 | Unseen / back geometry | **UNRESOLVED** — no back or side view has been reviewed. Stays unresolved; never fabricated |
| 13 | Remaining photography required | See §9 below |

### 3. Contradictions found this round
- **C1** — round 1's "much wider than it is tall / rounded trapezoid" vs
  round 2's "compact, rounded/oval-ish." Resolved in favour of round 2 for
  silhouette; proportion downgraded to UNRESOLVED (rows 2–4).
- **C2** — `nova-spec.md` and `NOVA-HANDOFF.md` both asserted the round-1
  proportion as confirmed fact. Both corrected this round.

### 4. Required unique model file
`public/models/arcubed/bodies/nova/nova-body-v1.glb` — does not exist yet
and cannot be accepted while rows 2–5, 7–10 and 12 are UNRESOLVED.

### 5. Required material zones
`bag_body_primary`, `bag_body_secondary` (two-tone — CONFIRMED BY RAND),
`hardware` (fixed metal). `handle` **not** built — see row 5. Six real
colourways CONFIRMED BY RAND: Gold, Black, Champagne, Silver, Rose Gold,
Silver & Gold (two-tone: primary = one metal, secondary = the other —
never one flattened texture). Hex values for all six: **UNRESOLVED**.

### 6. Required attach points
`attach_strap`, `attach_chain`. `attach_handle` **not** built — Nova's
handle status is UNRESOLVED (row 5) and must not be resolved by building
speculative geometry in either direction.

### 7. Sharing
May share: strap GLBs, chain GLBs, the material presets in
`material-spec.md`, the node-naming conventions in
`src/lib/three/model-contract.ts`, and the viewer infrastructure. May never
share or infer: Nova's `bag_body_primary`/`bag_body_secondary`/`hardware`
mesh data, in either direction, with any other product.

### 8. Current 3D readiness
**0% — no geometry exists; acceptance gate not clearable.**
`public/models/arcubed/bodies/nova/` is empty. Zero `product_models` rows
and zero real `product_images` rows for Nova. Storefront correctly shows
the photography/illustrative fallback.

### 9. Resolution routing — where each open row actually gets answered

Every UNRESOLVED row above is routed to exactly one of these. **The route,
not the status, decides whether Rand is asked anything.**

- **ARCHIVE** — answerable from media Rand has *already supplied*. **Never a
  client request.** Our mapping being incomplete is our gap, not hers.
- **CLIENT** — a product or business rule that no photograph or video can
  establish. Legitimate to ask.
- **HIDDEN** — genuinely not visible in any available media. Becomes a
  CLIENT ask *only* once the archive is exhausted and it is still absent.

| Open row | Route | Notes |
|---|---|---|
| 2 Proportions | **ARCHIVE** | Measure from the existing professional Gold Nova stills and the wider archive. Do not ask for a "front elevation" |
| 3 Top opening | **ARCHIVE** | Visible in existing stills/video |
| 4 Base | **ARCHIVE** | Check the phone clips — a bag turned in hand shows its base |
| **5 Handle** | **CLIENT** | **The one genuine Nova question.** Existing photography establishes Nova's body, crochet construction and metallic material — but a photograph can only show whether *one photographed Nova* has a handle. It cannot establish whether handles are standard across every Nova, specific to certain designs, or an optional/custom feature. **That is a product configuration rule, and only Rand can state it.** It survives the archive audit for that reason, not because an angle is missing |
| 7 Two-tone zone boundary | **ARCHIVE** | Silver & Gold sets exist in the archive |
| 8 Hardware | **ARCHIVE → HIDDEN** | Look first; only a genuine absence across all media makes this a client ask |
| 9–10 Strap / chain attachment | **ARCHIVE → HIDDEN** | Conditional. Ask only if existing evidence cannot establish the physical attachment points |
| 12 Unseen / back geometry | **ARCHIVE** | Video counts — a clip that pans around the bag settles back and side geometry |
| Colour values | **CLIENT (soft)** | Ask only whether Rand *has* manufacturer/yarn colour codes. She may not — these are physical yarns, not digital swatches. Never demand a hex, never sample one from a photo |

**WITHDRAWN:** the previous request for a Nova front elevation, side
elevation, top-down shot, base shot and back view. Existing professional
Gold Nova photography plus the wider archive covers the body. Do not ask
Rand to reshoot any of it.


---

## Vault

### 1. Confirmed photo folders — CONFIRMED BY RAND
Light Brown Vault, Olive Green Vault, Brown Vault (per
`docs/photo-asset-map.md`).

### 2. Geometry checklist — INCOMPLETE

Based only on Vault's own photos. Round-2 evidence source: the dark brown
Vault reference.

| # | Category | Status |
|---|---|---|
| 1 | Silhouette | **CONFIRMED FROM PHOTOS** (round 2) — rectangular / boxy structured bag. Round 1's "softened/rounded sides" is not contradicted but is not re-confirmed either; treat corner softness as a modeling judgment within a boxy rectangular envelope, not a confirmed radius |
| 2 | Proportions | **CONFIRMED FROM PHOTOS** (round 2) — **taller than wide.** This directly reverses round 1, which recorded "width greater than height." See Contradiction C3. The exact ratio is not established — "taller than wide" is a direction, not a measurement |
| 3 | Top opening | **CONFIRMED FROM PHOTOS** (round 2) — a **large opening built into the body structure**, integrated rather than added. **UNRESOLVED: whether that aperture is rectangular or arched** — round 2 read it as "rectangular or arched," and the two are genuinely different shapes to model. Round 1's "horizontal hand opening at the top" also assumed a horizontal orientation that a taller-than-wide body calls into question. See Contradiction C4 |
| 4 | Base | **UNRESOLVED** — round 1 recorded a "broad, relatively flat base with rounded lower corners." "Broad" is inconsistent with a taller-than-wide body (C3), so the round-1 base reading is downgraded. A flat base is plausible for a structured bag but is not confirmed |
| 5 | Handle | **CONFIRMED FROM PHOTOS** (rounds 1 and 2 agree) — Vault has a **built-in handle/opening integrated into the body structure**, with thick wrapped crochet around it (round 1). This is required geometry and is identity-defining. **It is never a detachable handle, never a shared handle GLB, never an `attach_handle` accessory.** Whether it is *the same feature* as row 3's opening or a distinct structure alongside it is **UNRESOLVED** — round 2 described it as one thing ("opening or handle"). A separate `handle` node remains optional (`PRODUCT_PART_REQUIREMENTS.vault.handle = false` — the *feature* is mandatory, the *separate node* is the modeler's choice) |
| 6 | Primary material zone | **CONFIRMED FROM PHOTOS** (rounds 1 and 2 agree) — **dense, chunky, large-loop crochet in thick yarn**, matte/soft. Regular-yarn preset. Dark brown on the round-2 reference |
| 7 | Secondary material zone | N/A — Vault is single-tone, CONFIRMED BY RAND. Do not include `bag_body_secondary` |
| 8 | Hardware | **UNRESOLVED** — no hardware reference photo exists |
| 9 | Strap attachment | **UNRESOLVED** |
| 10 | Chain attachment | **UNRESOLVED** |
| 11 | Fringe | N/A — Vault has no fringe. **CONFIRMED FROM PHOTOS** that no reviewed image of any round shows fringe on Vault |
| 12 | Unseen / back geometry | **UNRESOLVED** — no back/side/base view reviewed |
| 13 | Remaining photography required | See §9 below |

### 3. Contradictions found this round
- **C3** — round 1 "width greater than height" vs round 2 "taller than
  wide." **Directly reversed.** `vault-spec.md`'s intro asserted the round-1
  version and has been corrected this round.
- **C4** — round 1 "integrated *horizontal* hand opening" vs round 2 "large
  built-in **rectangular or arched** opening." Opening shape and
  orientation both downgraded to UNRESOLVED (row 3).
- **C5** — `docs/photo-asset-map.md` stated "No handle reference needed
  (not in Vault's confirmed part list)." That is stale and contradicts the
  confirmed integrated handle. Corrected this round.
- **C6** — the "no handle" language in the original `vault-spec.md` was
  corrected in a previous round and remains correct; it is recorded here so
  the correction is not accidentally reverted by anyone reading an old copy.

### 4. Required unique model file
`public/models/arcubed/bodies/vault/vault-body-v1.glb` — does not exist
yet; cannot be accepted while rows 3, 4, 5 (opening-vs-handle question),
8–10 and 12 are UNRESOLVED. **Do not reuse Nova geometry.**

### 5. Required material zones
`bag_body_primary` (single-tone, CONFIRMED BY RAND), `hardware`, plus the
confirmed integrated handle/opening as required body geometry — optionally
its own `handle` node. Three real colourways CONFIRMED BY RAND: Light
Brown, Olive Green, Brown; none confirmed metallic, so the regular-yarn
preset applies to all three. Hex values: **UNRESOLVED**.

### 6. Required attach points
`attach_strap`, `attach_chain`. No `attach_handle` — Vault's handle/opening
is fixed built-in construction, not a swappable option.

### 7. Sharing
Same shared list as Nova §7. Vault's `bag_body_primary`/`hardware`/
integrated-handle mesh data may never be shared, substituted, or inferred —
in particular, **Loco must never be built from Vault's file** despite both
having an integrated opening (see Loco §3, C10).

### 8. Current 3D readiness
**0% — no geometry exists; acceptance gate not clearable.**
`public/models/arcubed/bodies/vault/` is empty; zero `product_models` and
zero real `product_images` rows.

### 9. Resolution routing — where each open row actually gets answered

Every UNRESOLVED row above is routed to exactly one of these. **The route,
not the status, decides whether Rand is asked anything.**

- **ARCHIVE** — answerable from media Rand has *already supplied*. **Never a
  client request.** Our mapping being incomplete is our gap, not hers.
- **CLIENT** — a product or business rule that no photograph or video can
  establish. Legitimate to ask.
- **HIDDEN** — genuinely not visible in any available media. Becomes a
  CLIENT ask *only* once the archive is exhausted and it is still absent.

| Open row | Route | Notes |
|---|---|---|
| 3 Opening shape (rectangular vs arched) | **ARCHIVE** | The DSC04876 sequence shows the opening construction prominently. Resolve it there — this was previously our top client ask and it should not have been |
| 4 Base | **ARCHIVE** | |
| 5 Opening-and-handle: one feature or two | **ARCHIVE** | The same sequence, plus video, should settle this |
| 8 Hardware | **ARCHIVE → HIDDEN** | |
| 9–10 Strap / chain attachment | **ARCHIVE → HIDDEN** | Conditional, same as Nova |
| 12 Unseen / back geometry | **ARCHIVE** | |
| Colour values | **CLIENT (soft)** | Same soft ask as Nova — codes only if she has them |

**WITHDRAWN / SATISFIED BY EXISTING ARCHIVE:** every generic Vault
photography request — front elevation, side elevation, base shot, back
view, three-quarter opening shot. The professional DSC04876 sequence
already confirms Vault's taller-than-wide boxy body and its prominent
integrated opening/handle construction. **There are no open client
questions for Vault.** Do not ask Rand for generic Vault photos simply
because they have not yet been internally catalogued.


---

## Mini Luna

### 1. Confirmed photo folders — CONFIRMED BY RAND
Red Mini Luna, **plus** every Drive folder containing "Luna" — Silver Luna,
Gold Luna, Black Luna, Luna Gold & Silver — per Rand's explicit
confirmation recorded in `product-matrix.md` and `docs/photo-asset-map.md`.

### 2. Geometry checklist — INCOMPLETE

Based only on confirmed Mini Luna / Luna photos. Never inferred from Nova
— sharing the "Silver & Gold" colour name with Nova is a colour-catalog
fact, not a geometry fact. Round-2 evidence source: the Red Mini Luna
reference.

| # | Category | Status |
|---|---|---|
| 1 | Silhouette | **CONFIRMED FROM PHOTOS** (round 2) — compact **rounded-rectangular** body. This replaces round 1's "small rounded basket / mini bucket," which is a different shape. See Contradiction C7 |
| 2 | Proportions | **UNRESOLVED** — round 2 establishes "compact" but no width:height ratio. Round 1's "short rounded body with a relatively wide base" is downgraded with the bucket reading it belonged to. What *is* retained: the **handle occupies significant vertical space above the body**, so the model's overall bounding box is materially taller than the body alone. "Mini" in the product name is still **not** a confirmed measurement against the other three products |
| 3 | Top opening | **CONFIRMED FROM PHOTOS** (round 1, not contradicted by round 2) — open top, visible beneath the arch handle. Its exact aperture shape on a rounded-rectangular body (rather than the bucket round 1 assumed) is **UNRESOLVED** |
| 4 | Base | **UNRESOLVED** — round 1 recorded a "rounded/oval base," which followed directly from the bucket reading round 2 overturned. A rounded-rectangular body more likely implies a rounded-rectangular base, but that is inference, not evidence. **Do not model an oval base on round 1's authority** |
| 5 | Handle | **CONFIRMED FROM PHOTOS** (rounds 1 and 2 agree — the strongest-supported finding on this product) — a **large, thick, integrated arched crochet handle.** Required as **its own named node** (`PRODUCT_PART_REQUIREMENTS["mini-luna"].handle = true`), unlike Vault's optional split, because it is large and structurally distinct. Baked into the body construction — not swappable, no `attach_handle`. Round 1's "attached at both sides of the body" is inherent to an arch and is retained. Handle **cross-section thickness and where the arch roots into the body** are UNRESOLVED |
| 6 | Primary material zone | **CONFIRMED FROM PHOTOS** (round 2) — **shiny metallic crochet yarn on the Red colourway.** Round 1's "dense horizontal crochet rows with strong ribbon-yarn highlights" is corroborated |
| 7 | Secondary material zone | **UNRESOLVED** — two independent zones stay CONFIRMED BY RAND (Silver & Gold), but the zone boundary must come from confirmed two-tone Luna photography specifically, which has not been reviewed in either round |
| 8 | Hardware | **UNRESOLVED** — no hardware reference photo exists |
| 9 | Strap attachment | **UNRESOLVED** |
| 10 | Chain attachment | **UNRESOLVED** |
| 11 | Fringe | N/A — Mini Luna has no fringe. **CONFIRMED FROM PHOTOS** that no reviewed image of any round shows fringe on Mini Luna |
| 12 | Unseen / back geometry | **UNRESOLVED** — no back/side/base view reviewed |
| 13 | Remaining photography required | See §9 below |

### 3. Contradictions found this round
- **C7** — round 1 "small rounded basket / mini bucket" vs round 2
  "compact rounded rectangular body." A bucket and a rounded rectangle are
  not the same silhouette. Resolved in favour of round 2;
  `mini-luna-spec.md` corrected this round.
- **C8** — round 1's rounded/oval base was a consequence of the bucket
  reading and is downgraded with it (row 4).
- **C9** — **material:** `mini-luna-spec.md` §11 said "regular-yarn preset
  for both body zones and the handle by default," treating metallic as
  applying only to Silver/Gold/two-tone. Round 2 shows the **Red** Mini
  Luna in **shiny metallic yarn.** Red therefore takes the metallic-yarn
  preset, not the regular-yarn default. Corrected this round.
- **C10** — `docs/photo-asset-map.md` stated "No handle reference needed"
  for Mini Luna. That is not merely stale but backwards — Mini Luna has the
  package's only *mandatory* separate handle node. Corrected this round.

### 4. Required unique model file
`public/models/arcubed/bodies/mini-luna/mini-luna-body-v1.glb` — does not
exist yet; cannot be accepted while rows 2, 3 (aperture shape), 4, 5
(handle roots/thickness), 7–10 and 12 are UNRESOLVED. **Do not reuse Nova
or Vault geometry.**

### 5. Required material zones
`bag_body_primary`, `bag_body_secondary` (two-tone, CONFIRMED BY RAND —
boundary UNRESOLVED per row 7), `handle` (**required node**), `hardware`.
Confirmed real colourways (CONFIRMED BY RAND): Red, Silver, Gold, Black,
and the two-tone Silver & Gold. **Red is metallic-yarn per row 6 (C9), not
regular-yarn.** Whether Black is also metallic is **UNRESOLVED** — do not
assume either way. Hex values: **UNRESOLVED**.

### 6. Required attach points
`attach_strap`, `attach_chain`. No `attach_handle` — the arched handle is
baked into the body.

### 7. Sharing
Same shared list as Nova §7. Mini Luna's Silver & Gold two-tone is the
**same catalog colour row** Nova uses — a shared *colour catalog entry*,
not shared geometry. Mini Luna's body mesh and its handle are 100% its own
file and may never be inferred from Nova's or Vault's.

### 8. Current 3D readiness
**0% — no geometry exists; acceptance gate not clearable.**
`public/models/arcubed/bodies/mini-luna/` is empty; zero `product_models`
and zero real `product_images` rows.

### 9. Resolution routing — where each open row actually gets answered

Every UNRESOLVED row above is routed to exactly one of these. **The route,
not the status, decides whether Rand is asked anything.**

- **ARCHIVE** — answerable from media Rand has *already supplied*. **Never a
  client request.** Our mapping being incomplete is our gap, not hers.
- **CLIENT** — a product or business rule that no photograph or video can
  establish. Legitimate to ask.
- **HIDDEN** — genuinely not visible in any available media. Becomes a
  CLIENT ask *only* once the archive is exhausted and it is still absent.

| Open row | Route | Notes |
|---|---|---|
| 2 Proportions | **ARCHIVE** | The DSC05774 sequence plus video |
| 3 Top aperture shape | **ARCHIVE** | |
| 4 Base | **ARCHIVE** | |
| 5 Handle roots / cross-section | **ARCHIVE** | The arched handle is prominent in the existing sequence |
| 7 Two-tone zone boundary | **ARCHIVE** | Luna Gold & Silver sets exist |
| 8 Hardware | **ARCHIVE → HIDDEN** | |
| 9–10 Strap / chain attachment | **ARCHIVE → HIDDEN** | Conditional, same as Nova |
| 12 Unseen / back geometry | **ARCHIVE** | |
| Is Black metallic? | **ARCHIVE → CLIENT (soft)** | Black Luna photography exists — check it before asking. Bundle with the colour-code question only if the archive is genuinely ambiguous |
| Colour values | **CLIENT (soft)** | Codes only if she has them |

**WITHDRAWN / SATISFIED BY EXISTING ARCHIVE:** every generic Mini Luna
photography request — front elevation, side elevation, base shot, back
view, handle-join close-up. The professional DSC05774 sequence already
confirms the compact rounded-rectangle body, the large integrated arched
handle, and the metallic Red construction (which also independently
corroborates contradiction C9). **There are no open client questions for
Mini Luna.** Do not request generic replacement photography.


---

## Loco

### 1. Confirmed photo folders — CONFIRMED BY RAND
Brown Loco, Burgundy Loco (per `docs/photo-asset-map.md`).

### 2. Geometry checklist — INCOMPLETE

Based only on Loco's own photos. Never inferred from Vault, despite both
having an integrated opening. Round-2 evidence source: the brown Loco
reference.

| # | Category | Status |
|---|---|---|
| 1 | Silhouette | **CONFIRMED FROM PHOTOS** (rounds 1 and 2 agree) — **rectangular body** carrying long fringe. The bag reads as a rectangle, not a rounded or bucket form |
| 2 | Proportions | **UNRESOLVED** — round 1 recorded "short… wide compact upper body." Round 2 confirms only "rectangular body" and does not establish short-and-wide. The body's width:height ratio is not established. What *is* retained from round 1 and consistent with round 2: **the fringe extends the model's overall visual height well beyond the body's own height**, so the bounding box is much taller than the structured body alone |
| 3 | Top opening | **CONFIRMED FROM PHOTOS** (rounds 1 and 2 agree) — an opening/handle **integrated into the crocheted upper body**, not a tall external arch. Round 1 read the aperture as horizontal and rectangular; round 2 confirms integration but not the aperture's precise shape, so **exact aperture shape is UNRESOLVED** |
| 4 | Base | **UNRESOLVED** — the body beneath the fringe has never been seen. Round 1 noted it "appears rounded/soft," which is an appearance through fringe, not a confirmed shape. **Do not fabricate it, and do not copy Vault's base** |
| 5 | Handle | **CONFIRMED FROM PHOTOS** — the hand opening *is* the handle; it is built into the upper body. No separate `handle` node, no `attach_handle`, not swappable |
| 6 | Primary material zone | **CONFIRMED FROM PHOTOS** (rounds 1 and 2 agree) — thick matte yarn, chunky crochet rows in the upper section. Regular-yarn preset. Brown on the round-2 reference |
| 7 | Secondary material zone | N/A — Loco is single-tone, CONFIRMED BY RAND. Do not include `bag_body_secondary` |
| 8 | Hardware | **UNRESOLVED** — no hardware reference photo exists |
| 9 | Strap attachment | **UNRESOLVED** |
| 10 | Chain attachment | **UNRESOLVED** |
| 11 | **Fringe** | **CONFIRMED FROM PHOTOS — identity-critical, and it is structural geometry, not a texture.** Long individual hanging yarn / tassel strands run along the **lower and side portions** of the body (round 2's reading; round 1 said "most of the lower outer body" — round 2 adds the sides and does not confirm "most," so **exact coverage and how far the fringe wraps around the sides is UNRESOLVED**). **Strand count, strand length, strand spacing, and how the strands are anchored to the body are all UNRESOLVED and must not be invented.** The fringe must be built as real geometry with genuine depth and separation between strands — see `loco-spec.md` §12 for the permitted approaches and the explicitly forbidden ones |
| 12 | Unseen / back geometry | **UNRESOLVED** — no back/side/base view reviewed, and the fringe hides the lower body in every reviewed shot |
| 13 | Remaining photography required | See §9 below |

### 3. Contradictions found this round
- **C11** — round 1 "fringe covers most of the lower outer body" vs round
  2 "along the lower/side portion." Round 2 extends the fringe onto the
  sides but does not support "most." Coverage extent downgraded to
  UNRESOLVED (row 11).
- **C12** — round 1's "short / wide compact upper body" is not supported by
  round 2's plain "rectangular body." Proportions downgraded (row 2).
- **C13** — **`loco-spec.md` §12 offered a third production approach: "a
  textured shell/skirt shape with strong normal-map or alpha-cutout detail
  simulating strand ends."** That is a texture standing in for the fringe,
  which is explicitly not acceptable — fringe must be structural geometry.
  Approach 3 has been removed as a permitted approach this round and is now
  listed among the forbidden substitutes.
- **C14** — `docs/photo-asset-map.md` stated "No handle reference needed"
  for Loco. Stale — the integrated opening is confirmed. Corrected this
  round.
- **C10 (restated)** — Loco's required node/attach-point *list* happens to
  match Vault's shape. That is a contract-shape coincidence and **not**
  permission to reuse or infer from Vault's file. Vault is a tall boxy bag
  with no fringe; Loco is a rectangular bag whose defining feature is
  structural fringe.

### 4. Required unique model file
`public/models/arcubed/bodies/loco/loco-body-v1.glb` — does not exist yet;
cannot be accepted while rows 2, 3 (aperture shape), 4, 8–12 are
UNRESOLVED. **Do not reuse Vault geometry.**

### 5. Required material zones
`bag_body_primary` (single-tone, CONFIRMED BY RAND), `hardware`, `fringe`
(**required node** — see `loco-spec.md` §1, §12). Two real colourways
CONFIRMED BY RAND: Brown, Burgundy; neither confirmed metallic. Hex
values: **UNRESOLVED**. Loco's size options are also UNRESOLVED (per
`product-matrix.md`) — only the single default body applies for now.

### 6. Required attach points
`attach_strap`, `attach_chain`. No `attach_handle`.

### 7. Sharing
Same shared list as Nova §7. Loco's `bag_body_primary`/`hardware`/`fringe`
mesh data may never be shared or inferred — **specifically never from
Vault's `vault-body-v1.glb`.**

### 8. Current 3D readiness
**0% — no geometry exists; acceptance gate not clearable.**
`public/models/arcubed/bodies/loco/` is empty; zero `product_models` and
zero real `product_images` rows.

### 9. Resolution routing — where each open row actually gets answered

Every UNRESOLVED row above is routed to exactly one of these. **The route,
not the status, decides whether Rand is asked anything.**

- **ARCHIVE** — answerable from media Rand has *already supplied*. **Never a
  client request.** Our mapping being incomplete is our gap, not hers.
- **CLIENT** — a product or business rule that no photograph or video can
  establish. Legitimate to ask.
- **HIDDEN** — genuinely not visible in any available media. Becomes a
  CLIENT ask *only* once the archive is exhausted and it is still absent.

| Open row | Route | Notes |
|---|---|---|
| 2 Proportions | **ARCHIVE** | The DSC05765 sequence plus video |
| 3 Aperture shape | **ARCHIVE** | |
| **4 Base / body under the fringe** | **ARCHIVE → HIDDEN (conditional CLIENT)** | **Check the phone MOV clips and professional video first.** Fringe moves as a bag is handled, and a clip is far more likely to reveal the body beneath it than any still. Only if no frame in the entire archive shows it does this become a client ask |
| 8 Hardware | **ARCHIVE → HIDDEN** | |
| 9–10 Strap / chain attachment | **ARCHIVE → HIDDEN** | Conditional, same as Nova |
| **11 Fringe attachment, strand length, spacing, coverage** | **ARCHIVE → HIDDEN (conditional CLIENT)** | The existing DSC05765 sequence confirms the fringe *exists* and is identity-critical structural geometry. Whether it also resolves how the strands anchor to the body is an archive question, not yet a client question. **Strand count, length, spacing and anchoring remain prohibited from being invented** regardless of where the answer comes from |
| 12 Unseen / back geometry | **ARCHIVE** | |
| Colour values | **CLIENT (soft)** | Codes only if she has them |

**WITHDRAWN:** the generic Loco front elevation, side elevation, base shot
and back view requests. The professional DSC05765 sequence confirms the
rectangular body, the integrated opening/handle, and the long fringe.

**NOT YET A CLIENT ASK:** the fringe-attachment and under-fringe views.
Both are held as conditional pending review of the existing video. Ask only
if the archive genuinely cannot establish them.


---

## Contradiction Log — every conflict found this round

| ID | Product | Old spec said | Photographic evidence says | Resolution |
|---|---|---|---|---|
| C1 | Nova | "Low, wide clutch; much wider than it is tall; rounded trapezoid" (round 1, asserted as confirmed in `nova-spec.md` + `NOVA-HANDOFF.md`) | "Compact, rounded / oval-ish" (round 2) | Silhouette corrected to compact rounded/oval-ish; **proportions downgraded to UNRESOLVED** |
| C2 | Nova | `nova-spec.md` intro and `NOVA-HANDOFF.md` §1 stated the round-1 proportion as settled fact | — | Both files corrected this round |
| C3 | **Vault** | "**Width greater than height**" (`PRODUCT-GEOMETRY-MAP.md` + `vault-spec.md` intro) | "**Taller than wide**" (round 2) | **Directly reversed.** Corrected in both files |
| C4 | Vault | "Integrated **horizontal** hand opening at the top" | "Large built-in **rectangular or arched** opening" (round 2) | Aperture shape **and** orientation downgraded to UNRESOLVED; existence and integration stay CONFIRMED |
| C5 | Vault | `photo-asset-map.md`: "No handle reference needed (not in Vault's confirmed part list)" | Integrated handle/opening confirmed in both rounds | Stale text corrected; handle photography now explicitly requested |
| C6 | Vault | Original `vault-spec.md`: "no handle" | Confirmed integrated handle | Corrected in a prior round; recorded here so it is not reverted |
| C7 | **Mini Luna** | "**Small rounded basket / mini bucket** style" | "**Compact rounded rectangular** body" (round 2) | **Different shape.** Corrected in `PRODUCT-GEOMETRY-MAP.md` + `mini-luna-spec.md` |
| C8 | Mini Luna | "Rounded / oval base" | Not re-confirmed; followed from the overturned bucket reading | Downgraded to UNRESOLVED |
| C9 | **Mini Luna** | `mini-luna-spec.md` §11: "**regular-yarn** preset for both body zones and the handle by default"; metallic treated as Silver/Gold/two-tone only | **Red** Mini Luna is **shiny metallic yarn** (round 2) | **Red takes the metallic-yarn preset.** Corrected in `mini-luna-spec.md`. Black's status raised as a new open question |
| C10 | Mini Luna / Loco | `photo-asset-map.md`: "No handle reference needed" for both | Mini Luna's handle is the package's only *mandatory* separate handle node; Loco's opening is confirmed | Stale text corrected for both |
| C11 | Loco | Fringe "covers **most of the lower outer body**" | Fringe runs "along the **lower/side** portion" (round 2) | Sides added; "most" not supported — **coverage extent downgraded to UNRESOLVED** |
| C12 | Loco | "**Short**… **wide compact** upper body" | "Rectangular body" (round 2), no proportion given | Proportions downgraded to UNRESOLVED |
| C13 | **Loco** | `loco-spec.md` §12 approach 3: "a **textured shell/skirt** shape with strong normal-map or alpha-cutout detail simulating strand ends" | **Fringe is structural geometry and cannot be represented as a texture** | **Approach 3 removed** and reclassified as a forbidden substitute |
| C14 | Loco | `photo-asset-map.md`: "No handle reference needed" | Integrated opening confirmed | Stale text corrected |

---

## Global rules

**These four products are visually confirmed as four different physical
designs.** Nova ≠ Vault ≠ Mini Luna ≠ Loco. No body mesh may be reused
across products.

**A folder name is not geometric evidence.** "Gold Nova with Handle" does
not establish that Nova has a handle; only a photograph of the bag or a
statement from Rand does. This rule exists because the folder-name
inference was specifically identified as a risk on Nova.

**Where round 1 and round 2 conflict, round 2 wins.** Where round 1 made a
claim about an aspect round 2 corrected elsewhere on the same product,
round 1's claim is downgraded rather than trusted.

### What may be shared across products (the complete list — nothing else)
- **Strap GLBs** (e.g. Crochet Strap) — one shared catalog, attaches to any
  product's `attach_strap`.
- **Chain GLBs** (Silver Tone Chain, Gold Tone Chain) — same.
- **Approved material systems** — the regular-yarn / metallic-yarn / metal
  presets in `material-spec.md`, applied to each product's own textures.
- **Technical node-naming conventions** — the vocabulary in
  `src/lib/three/model-contract.ts`. A naming contract, not geometry.
- **Viewer infrastructure** — `Canvas3D.tsx`/`BagModel.tsx`, the Draco
  decoder, `export-checklist.md`'s pipeline. Process and code, not assets.

There is no shared "handle" component. Each product's handle question is
its own finding above, not a shared catalog item.

### What must never be shared or inferred (no exceptions)
- Any product's body mesh (`bag_body_primary`/`bag_body_secondary`/
  `handle`/`fringe`/`hardware`), reused for, approximated from, or
  *inferred from* another product.
- Unseen back/side/interior/hidden-base geometry for any product — if a
  photo set doesn't show an angle, that angle stays UNRESOLVED.
- A generic "crochet bag" base mesh recoloured and relabeled as multiple
  products. There is no generic Arcubed bag.

## 3D activation rule (per product, independently)

A product shows real 3D only when **its own** `product_models` row exists,
points at **its own** validated `model_assets` row (validated per
`qa-checklist.md` **and** per §2's acceptance gate), and that row is
active. Verified by reading `getDefaultBodyModelsByProductId` in
`src/lib/repository.ts`: it queries `product_models` filtered to each
product's own `product_id`, with no branch that would ever substitute
another product's model. If Nova's model finishes first, Nova shows 3D and
the other three continue showing their fallback — never Nova's geometry.

## Photography and fallback — current state, unchanged this round

Zero real photos have been imported into `product_images` for any of the
four products — **this is now an import gap, not an evidence gap.** Rand's
archive (§0.2) contains dozens of professional stills and substantial
video; none of it has been brought into this project's database or storage
yet. The reviews that produced these findings happened against the archive
directly.

**Real photography remains the intended production fallback until accurate
models exist.** No placeholder or approximate GLB may be placed on the
production storefront and presented as the real product. The only
`model_assets` rows in the database are `is_placeholder = true` dev-test
geometry, structurally excluded from reaching a real product (never linked
via `product_models`, and excluded from public reads by RLS regardless).

## Can we commission modeling yet?

Assessed after the round-3 archive audit. **Blockout** = enough confirmed
form to start massing the body. **Production modeling** = enough to build
the final, shippable asset.

| Product | Blockout | Production model | What's actually left |
|---|---|---|---|
| **Vault** | ✅ **Ready** | ⛔ Not yet | Body form and the integrated opening are confirmed from the DSC04876 sequence. No open client questions. Remaining detail (aperture shape, base, back) is an **archive-mapping** job, not a client one |
| **Mini Luna** | ✅ **Ready** | ⛔ Not yet | Body, arched handle and metallic Red confirmed from the DSC05774 sequence. No open client questions. Remaining detail is **archive mapping** |
| **Nova** | ✅ **Ready — body only** | ⛔ Blocked | Body form, crochet construction and metallic material are confirmed. **Blocked on the handle rule** — a business question only Rand can answer, since it decides whether the standard product has a handle at all. Do not finalise Nova's silhouette until she answers |
| **Loco** | 🟡 **Body yes, fringe no** | ⛔ Blocked | Rectangular body, integrated opening and the existence of structural fringe are confirmed. The body can be blocked out. **The fringe cannot** — anchoring, strand length and spacing are still unestablished, and remain prohibited from being invented. Route: check existing video first |

**No product is ready for a final production model, and no GLB may be
created yet.** Two are ready for blockout outright, one for its body only,
and one for its body but not its defining feature.

**Real photography remains the production fallback** — now on much firmer
ground, since the archive is substantial. No placeholder or approximate GLB
goes on the production storefront presented as the real product.


---

No code was changed and nothing was deployed for this round. No dimensions
were fabricated. No unseen geometry was fabricated. No models were created.
No storefront visuals, catalog data, pricing, or deployment configuration
were touched.


## Frame-level evidence (generated)

<!-- AUTOGEN:FRAME-EVIDENCE START -->

> Regenerated by `scripts/write-frame-evidence.mjs` from
> `.blockouts/measurements.json`. Do not hand-edit between the markers.
> Every measurement was taken **after** EXIF orientation normalization
> (all 45 frames are orientation=8 — see §0.3).

### Vault — 9 frames

**Product attribution:** CONFIRMED BY RAND (DSC04876 named in the archive audit); remaining frames CONFIRMED FROM PHOTOS by identical construction

| Frame | View | Orient. normalized | Total W:H | Body W:H | Through-opening | Proves | Does NOT prove |
|---|---|---|---|---|---|---|---|
| `DSC04876` | three-quarter | yes | 1.72 | 1.72 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |
| `DSC04877` | three-quarter | yes | 1.40 | 1.40 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |
| `DSC04878` | three-quarter | yes | 1.02 | 1.02 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |
| `DSC05788` | near-front | yes | 1.57 | 1.92 | yes — 1.6% of box, bottom at 18% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05789` | near-front | yes | 1.35 | 1.35 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05790` | near-front | yes | 1.41 | 1.77 | yes — 2.3% of box, bottom at 20% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05791` | near-front | yes | 1.37 | 1.37 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05792` | near-front | yes | 1.54 | 1.89 | yes — 1.8% of box, bottom at 19% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05793` | near-front | yes | 1.37 | 1.37 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |

**Near-front body W:H:** min 1.35 · median 1.77 · max 1.92 (6 frames; three-quarter frames excluded from this figure by design)

### Mini Luna — 8 frames

**Product attribution:** CONFIRMED BY RAND (DSC05774 named); DSC04870-04875 CONFIRMED FROM PHOTOS — identical silhouette plus an exact match to Mini Luna's confirmed colour list

| Frame | View | Orient. normalized | Total W:H | Body W:H | Through-opening | Proves | Does NOT prove |
|---|---|---|---|---|---|---|---|
| `DSC04870` | near-front | yes | 1.42 | 2.62 | yes — 7.0% of box, bottom at 46% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04871` | near-front | yes | 1.35 | 2.47 | yes — 7.2% of box, bottom at 46% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04872` | near-front | yes | 1.17 | 2.22 | yes — 4.0% of box, bottom at 47% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04873` | near-front | yes | 1.17 | 1.96 | yes — 5.7% of box, bottom at 40% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04874` | near-front | yes | 1.35 | 2.34 | yes — 9.4% of box, bottom at 43% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04875` | near-front | yes | 1.37 | 2.48 | yes — 11.4% of box, bottom at 45% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05774` | near-front | yes | 1.13 | 1.98 | yes — 11.6% of box, bottom at 43% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05775` | three-quarter | yes | 1.08 | 1.88 | yes — 7.2% of box, bottom at 43% | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |

**Near-front body W:H:** min 1.96 · median 2.34 · max 2.62 (7 frames; three-quarter frames excluded from this figure by design)

### Loco — 6 frames

**Product attribution:** CONFIRMED BY RAND (DSC05765 named); remaining frames CONFIRMED FROM PHOTOS by identical fringe construction

| Frame | View | Orient. normalized | Total W:H | Body W:H | Through-opening | Proves | Does NOT prove |
|---|---|---|---|---|---|---|---|
| `DSC05764` | near-front | yes | 1.63 | 2.06 | yes — 1.6% of box, bottom at 21% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05765` | near-front | yes | 1.61 | 2.04 | yes — 1.6% of box, bottom at 21% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05766` | near-front | yes | 1.60 | 2.03 | yes — 1.6% of box, bottom at 21% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05770` | three-quarter | yes | 1.08 | 1.08 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |
| `DSC05772` | near-front | yes | 1.59 | 2.12 | yes — 2.3% of box, bottom at 25% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05773` | three-quarter | yes | 1.36 | 1.88 | yes — 1.5% of box, bottom at 27% | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |

**Near-front body W:H:** min 2.03 · median 2.06 · max 2.12 (4 frames; three-quarter frames excluded from this figure by design)

### Nova — 22 frames

**Product attribution:** UNRESOLVED — the archive audit named 'Gold Nova photography' with no file numbers. These 22 frames form one distinct shape family that no other product fits, but no frame is client-confirmed

| Frame | View | Orient. normalized | Total W:H | Body W:H | Through-opening | Proves | Does NOT prove |
|---|---|---|---|---|---|---|---|
| `DSC04860` | near-front | yes | 1.49 | 1.49 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04861` | near-front | yes | 1.41 | 1.41 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04862` | near-front | yes | 1.61 | 1.61 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04863` | near-front | yes | 2.05 | 2.05 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04864` | near-front | yes | 1.55 | 1.55 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04865` | three-quarter | yes | 1.31 | 1.31 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |
| `DSC04866` | near-front | yes | 2.43 | 2.43 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04867` | three-quarter | yes | 1.34 | 1.34 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |
| `DSC04868` | near-front | yes | 2.05 | 2.05 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC04869` | near-front | yes | 1.32 | 1.32 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05776` | near-front | yes | 2.04 | 2.72 | yes — 2.3% of box, bottom at 25% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05777` | near-front | yes | 1.63 | 2.15 | yes — 1.2% of box, bottom at 24% | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05778` | near-front | yes | 1.86 | 1.86 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05779` | near-front | yes | 1.66 | 1.66 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05780` | near-front | yes | 2.18 | 2.18 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05781` | three-quarter | yes | 1.40 | 1.40 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |
| `DSC05782` | near-front | yes | 1.19 | 1.19 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05783` | near-front | yes | 1.35 | 1.35 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05784` | near-front | yes | 2.23 | 2.23 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05785` | three-quarter | yes | 1.30 | 1.30 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |
| `DSC05786` | near-front | yes | 1.99 | 1.99 | none detected | front silhouette; body:handle proportion | depth · back · base · hardware · strap/chain anchors |
| `DSC05787` | three-quarter | yes | 1.28 | 1.28 | none detected | that the product has real depth and a rounded back | any ratio (foreshortened — never averaged into a W:H figure) |

**Near-front body W:H:** min 1.19 · median 1.86 · max 2.72 (17 frames; three-quarter frames excluded from this figure by design)


**Media type:** every row above is a still JPEG. **No video exists in this
project.** The archive's 2025 "Arcubed Phone Vids" and 2026 "VIDEOS"
folders were never downloaded, so no motion evidence could be examined —
which is why Loco's fringe attachment remains unresolved.

<!-- AUTOGEN:FRAME-EVIDENCE END -->
