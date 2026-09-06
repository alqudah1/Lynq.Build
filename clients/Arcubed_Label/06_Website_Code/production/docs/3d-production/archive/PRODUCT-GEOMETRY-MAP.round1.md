# Product Geometry Map — Nova, Vault, Mini Luna, Loco

**Correction on record:** Arcubed does not have one generic bag design.
Nova, Vault, Mini Luna, and Loco are **four distinct physical products**,
each with its own real construction. Nothing about this package — the
shared node-name *vocabulary* (`bag_body_primary`, `attach_strap`, etc.),
the shared material *presets* (regular-yarn, metallic-yarn, metal), or the
shared export pipeline — means the products share actual geometry. A node
being named `bag_body_primary` on both Nova and Vault means both files use
the same **contract** so the same viewer code can load either one; it does
not mean either file's mesh data may ever be copied, reused, or
approximated from the other. Real visual review has now confirmed this
directly: the four bags are visibly different designs (see each product's
audit below) — a low wide clutch, a tall boxy structured bag, a small
arched-handle basket, and a fringed rectangular bag are not variations of
one shape.

**Second correction on record:** the real geometry for each product must
ultimately be established by someone actually looking at that product's
real photography — not inferred from folder names, not inferred from
another product, and not modeled from assumption. **Real visual findings
have now started arriving** (below) and are recorded as CONFIRMED FROM
PHOTOS. What hasn't been reported yet — hardware placement, exact strap/
chain attachment points, and a few product-specific gaps noted inline —
stays UNRESOLVED. **No product's audit is complete yet**, so the
acceptance gate in §2 is still not clearable for any of the four; this
document will keep updating as further findings arrive.

## 0. Status vocabulary used throughout this document

Every factual claim below is tagged with exactly one of:

- **CONFIRMED BY RAND** — a fact the client stated directly (a name, a
  price, which folders belong to which product, whether a feature exists
  as a customer-selectable option). Not a visual observation.
- **CONFIRMED FROM PHOTOS** — a fact established by someone actually
  looking at that exact product's real photography and recording what they
  saw. Now populated below wherever a real finding was supplied.
- **UNRESOLVED** — not yet established by either route. Never filled with
  a guess.

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
Luna, or Loco. Visual review confirms this isn't just a policy — the four
bags are visibly different shapes, not the same shape recoloured.

## 2. Acceptance gate — binding on every product

**No production GLB may be accepted for any product until that exact
product's Visual Geometry Audit (below) has been completed against that
exact product's real photography and marked CONFIRMED FROM PHOTOS.** A
model built before its audit is recorded — no matter how plausible it
looks — is not eligible to pass `qa-checklist.md`, regardless of whether
it otherwise satisfies the node-name/material/export requirements in
`NOVA-HANDOFF.md` or the equivalent spec for another product. Passing the
existing technical QA checklist and having a completed visual audit are
both required; neither substitutes for the other. **As of this update, no
product's audit is fully complete** — every product still has at least one
UNRESOLVED row below.

---

## Nova

### 1. Confirmed photo folders — CONFIRMED BY RAND
Black Nova, Champagne Nova, Gold Nova, Silver Nova, Gold Nova with Handle,
Nova Silver & Gold with Handle, Rose Gold Nova with Handle (per
`docs/photo-asset-map.md`).

### 2. VISUAL GEOMETRY AUDIT — PENDING (partial findings recorded)
Based only on Nova's own photos. Never inferred from Vault, Mini Luna, or
Loco.

| Category | Status |
|---|---|
| Exact silhouette | **CONFIRMED FROM PHOTOS** — low, wide clutch / compact handbag silhouette; body much wider than it is tall; rounded trapezoid / soft oval profile |
| Overall proportions | **CONFIRMED FROM PHOTOS** — broad horizontal body with a low vertical profile |
| Top/opening shape | **CONFIRMED FROM PHOTOS** — top edge narrower than the widest part of the body, softly rounded. Closure hardware (if any) is not visible and must not be assumed |
| Base shape | **CONFIRMED FROM PHOTOS** — broad curved/oval base; bottom corners rounded, not box-square |
| Handle shape and construction | **UNRESOLVED** — do not assume every Nova has a fixed handle. Some folders say "with Handle," but the reviewed standard Gold Nova photo does not show a tall integrated handle. Keep handle configuration separate/optional until final product construction is confirmed |
| Crochet/weave pattern | **CONFIRMED FROM PHOTOS** — dense horizontal crochet rows using thick ribbon-like metallic yarn; visible stitch depth and irregular handmade texture must remain visible in the 3D model |
| Hardware placement | UNRESOLVED |
| Strap attachment placement | UNRESOLVED |
| Chain attachment placement | UNRESOLVED |
| Primary material zone | **CONFIRMED FROM PHOTOS** — metallic ribbon-yarn appearance on metallic colourways; must not read as smooth plastic or chrome |
| Secondary/two-tone material zone | UNRESOLVED — two-tone support itself is CONFIRMED BY RAND (Silver & Gold); no zone-boundary finding has been supplied yet |
| Unseen back/side geometry | UNRESOLVED where not visible in source photos — stays unresolved, not fabricated |

### 3. Required unique model file
`public/models/arcubed/bodies/nova/nova-body-v1.glb` — does not exist yet,
and per §2 (acceptance gate) cannot be accepted until the audit above is
complete (handle configuration, hardware placement, strap/chain attachment
placement, and the two-tone zone boundary all still need findings).

### 4. Required material zones
`bag_body_primary`, `bag_body_secondary` (two-tone — CONFIRMED BY RAND),
`handle` (node reserved — whether Nova's production geometry actually needs
a baked `handle` mesh is UNRESOLVED per §2's audit, see above), `hardware`
(fixed metal). Six real colourways CONFIRMED BY RAND: Gold, Black,
Champagne, Silver, Rose Gold, Silver & Gold (two-tone: primary = one metal,
secondary = the other — never one flattened texture). Hex values for all
six: UNRESOLVED. Full detail: `NOVA-HANDOFF.md`, `material-spec.md`.

### 5. Required attach points
`attach_strap`, `attach_chain`. `attach_handle` **not** built — handle is
currently baked/fixed pending resolution of whether it should ever be
swappable (`nova-spec.md` §2, UNRESOLVED) — now reinforced by the audit
finding that not every Nova photo shows a tall integrated handle at all.

### 6. What can be shared across products
Only: strap GLBs, chain GLBs, the approved material systems (regular-yarn/
metallic-yarn/metal presets in `material-spec.md`), the technical node-
naming conventions in `src/lib/three/model-contract.ts`, and the viewer
infrastructure (`export-checklist.md`'s pipeline, `Canvas3D.tsx`/
`BagModel.tsx`). Nothing about Nova's actual mesh geometry.

### 7. What must never be shared
Nova's `bag_body_primary`/`bag_body_secondary`/`handle`/`hardware` mesh
data — and Nova's geometry may never be *inferred* from Vault/Mini
Luna/Loco's photos either, even partially (e.g. "assume the base is like
Vault's"). Visual review confirms this is not hypothetical: Nova's low,
wide, rounded-trapezoid profile is visibly nothing like Vault's tall boxy
shape, Mini Luna's small rounded basket, or Loco's fringed rectangle.

### 8. Current 3D readiness status
**0% — no geometry exists, and the acceptance gate isn't clearable yet**
(audit partially complete — handle configuration, hardware placement,
strap/chain attachment points, and the two-tone zone boundary remain
UNRESOLVED). `public/models/arcubed/bodies/nova/` is empty. Verified live:
zero `product_models` rows for Nova, zero real `product_images` rows for
Nova. Storefront shows the honest illustrative fallback (`BagArt.tsx`).

---

## Vault

### 1. Confirmed photo folders — CONFIRMED BY RAND
Light Brown Vault, Olive Green Vault, Brown Vault (per
`docs/photo-asset-map.md`).

### 2. VISUAL GEOMETRY AUDIT — PENDING (partial findings recorded)
Based only on Vault's own photos. Never inferred from Nova, Mini Luna, or
Loco.

| Category | Status |
|---|---|
| Exact silhouette | **CONFIRMED FROM PHOTOS** — structured handbag shape, substantially taller and boxier than Nova; broad rectangular body with softened/rounded sides |
| Overall proportions | **CONFIRMED FROM PHOTOS** — width greater than height, but much taller relative to width than Nova |
| Top/opening shape | **CONFIRMED FROM PHOTOS** — integrated horizontal hand opening at the top of the body |
| Base shape | **CONFIRMED FROM PHOTOS** — broad, relatively flat base with rounded lower corners |
| Handle shape and construction | **CONFIRMED FROM PHOTOS** — built-in horizontal handle/opening with thick wrapped crochet around it; this is part of Vault's identity and must be modeled accurately. **Reconciled** — `vault-spec.md` §1 now documents this as required geometry (never a detachable handle, shared GLB, or `attach_handle` accessory), with a separate `handle` node left optional (artist's choice, per `PRODUCT_PART_REQUIREMENTS.vault.handle = false` in `model-contract.ts` — the *feature* is mandatory, the *separate node* isn't) |
| Crochet/weave pattern | **CONFIRMED FROM PHOTOS** — dense repeating large-loop crochet texture across the body; thick yarn, matte/soft appearance in the reviewed Brown Vault photo |
| Hardware placement | UNRESOLVED |
| Strap attachment placement | UNRESOLVED |
| Chain attachment placement | UNRESOLVED |
| Primary material zone | **CONFIRMED FROM PHOTOS** — thick yarn, matte/soft appearance (Brown Vault reference) |
| Secondary/two-tone material zone | N/A — Vault is confirmed single-tone, CONFIRMED BY RAND |

### 3. Required unique model file
`public/models/arcubed/bodies/vault/vault-body-v1.glb` — does not exist
yet, and cannot be accepted until the audit above is complete (hardware
placement and strap/chain attachment placement remain UNRESOLVED — the
handle/opening contract question itself is now reconciled, see §2/§4).
**Do not reuse Nova geometry** — restated per this round's explicit
instruction, on top of the general rule in §1/§7.

### 4. Required material zones
`bag_body_primary` (single-tone, CONFIRMED BY RAND), `hardware` (fixed
metal), plus the confirmed integrated handle/opening — required geometry,
optionally its own `handle` node (see `vault-spec.md` §1 and
`model-contract.ts`'s `PRODUCT_PART_REQUIREMENTS.vault`). Three real
colourways CONFIRMED BY RAND: Light Brown, Olive Green, Brown — none
confirmed metallic, so the regular-yarn preset applies to all three today.
Hex values: UNRESOLVED.

### 5. Required attach points
`attach_strap`, `attach_chain`. No `attach_handle` — Vault's confirmed
handle/opening is fixed, built-in body construction, not a swappable
option (`vault-spec.md` §2).

### 6. What can be shared across products
Only: strap GLBs, chain GLBs, the approved material systems, the technical
node-naming conventions, and the viewer infrastructure. Nothing about
Vault's actual mesh geometry.

### 7. What must never be shared
Vault's `bag_body_primary`/`hardware`/integrated-handle mesh data — never
substituted for, built from, or *inferred from* Nova/Mini Luna/Loco's real
construction. Visual review confirms Vault is visibly taller and boxier
than Nova, with a structural integrated hand-opening Nova's photos do not
show at all.

### 8. Current 3D readiness status
**0% — no geometry exists, acceptance gate not clearable** (audit
partially complete — hardware placement and strap/chain attachment points
remain UNRESOLVED; the handle/opening node-contract question is reconciled,
see §2/§4). `public/models/arcubed/bodies/vault/` is empty. Verified live:
zero `product_models` rows, zero real `product_images` rows for Vault.
Same fallback behavior as Nova above.

---

## Mini Luna

### 1. Confirmed photo folders — CONFIRMED BY RAND
Red Mini Luna, **plus** every Drive folder containing "Luna" — Silver Luna,
Gold Luna, Black Luna, Luna Gold & Silver — per Rand's explicit
confirmation recorded in `product-matrix.md` ("all 'Luna' Drive folders are
now confirmed to mean Mini Luna") and `docs/photo-asset-map.md`'s
"RESOLVED" section.

### 2. VISUAL GEOMETRY AUDIT — PENDING (partial findings recorded)
Based only on confirmed Mini Luna / Luna photos. Never inferred from Nova,
Vault, or Loco — even though Mini Luna shares its two-tone colour name with
Nova, that is a colour-catalog fact, not a geometry fact (see §6).

| Category | Status |
|---|---|
| Exact silhouette | **CONFIRMED FROM PHOTOS** — small rounded basket / mini bucket style |
| Overall proportions | **CONFIRMED FROM PHOTOS** — short rounded body with a relatively wide base; the large handle occupies significant vertical space above the body. ("Mini" in the name is still not a confirmed measurement against the other three products — no cross-product size comparison is established, only Mini Luna's own proportions relative to itself) |
| Top/opening shape | **CONFIRMED FROM PHOTOS** — open top visible beneath the arch handle |
| Base shape | **CONFIRMED FROM PHOTOS** — rounded/oval base |
| Handle shape and construction | **CONFIRMED FROM PHOTOS** — large integrated arched crochet handle; thick, rounded, heavily crocheted construction. **Reconciled** — `mini-luna-spec.md` §1 now requires `handle` as its own named node (explicitly, unlike Vault's optional split — the handle is large enough and confirmed attached at both sides that it must be independently addressable). `PRODUCT_PART_REQUIREMENTS["mini-luna"].handle = true` in `model-contract.ts` |
| Crochet/weave pattern | **CONFIRMED FROM PHOTOS** — dense horizontal crochet rows with strong ribbon-yarn highlights in metallic versions |
| Hardware placement | UNRESOLVED |
| Strap attachment placement | UNRESOLVED |
| Chain attachment placement | UNRESOLVED |
| Primary material zone | **CONFIRMED FROM PHOTOS** — ribbon-yarn highlights confirmed on metallic colourways |
| Secondary/two-tone material zone | UNRESOLVED — the requirement for two independent zones stays CONFIRMED BY RAND, but the exact zone boundary should only be finalized from confirmed two-tone Luna photography specifically, which has not been reviewed yet as distinct from the general Mini Luna/Luna photo set |

### 3. Required unique model file
`public/models/arcubed/bodies/mini-luna/mini-luna-body-v1.glb` — does not
exist yet, and cannot be accepted until the audit above is complete
(hardware placement, strap/chain attachment placement, and the two-tone
zone boundary all still need resolving — the handle node contract itself
is now reconciled, see §2/§4). **Do not reuse Nova or Vault geometry** —
restated per this round's explicit instruction.

### 4. Required material zones
`bag_body_primary`, `bag_body_secondary` (two-tone, CONFIRMED BY RAND —
zone boundary itself still UNRESOLVED per §2), `handle` (required node,
reconciled — see `mini-luna-spec.md` §1), `hardware`. Confirmed real
colourways (CONFIRMED BY RAND): Red, Silver, Gold, Black, and the two-tone
Silver & Gold. Hex values: UNRESOLVED.

### 5. Required attach points
`attach_strap`, `attach_chain`. No `attach_handle` — the arched handle is
baked into the body (`mini-luna-spec.md` §2), not a swappable component.

### 6. What can be shared across products
Only: strap GLBs, chain GLBs, the approved material systems, the technical
node-naming conventions, and the viewer infrastructure. Mini Luna's Silver
& Gold two-tone colourway is the **same catalog colour row** Nova uses
(shared name/hex-once-confirmed at the *colour* level) — that is a shared
*colour catalog entry*, not shared geometry. Mini Luna's body mesh (and its
handle) is still 100% its own file.

### 7. What must never be shared
Mini Luna's `bag_body_primary`/`bag_body_secondary`/`hardware`/handle mesh
data — never substituted for, built from, or *inferred from* Nova's or
Vault's geometry. Visual review confirms this concretely: Mini Luna's small
rounded basket with a large arched handle looks nothing like Nova's low
wide clutch or Vault's tall boxy structured bag, despite Mini Luna and Nova
sharing a colour name.

### 8. Current 3D readiness status
**0% — no geometry exists, acceptance gate not clearable** (audit
partially complete — hardware placement, strap/chain attachment points,
and the two-tone zone boundary remain UNRESOLVED; the handle node contract
is reconciled, see §2/§4). `public/models/arcubed/bodies/mini-luna/` is
empty. Verified live: zero `product_models` rows, zero real
`product_images` rows for Mini Luna. Same fallback behavior as Nova above.

---

## Loco

### 1. Confirmed photo folders — CONFIRMED BY RAND
Brown Loco, Burgundy Loco (per `docs/photo-asset-map.md`).

### 2. VISUAL GEOMETRY AUDIT — PENDING (partial findings recorded)
Based only on Loco's own photos. Never inferred from Nova, Vault, or Mini
Luna — including Vault, despite Loco's required node/attach-point *list*
happening to match Vault's shape (see §6–7).

| Category | Status |
|---|---|
| Exact silhouette | **CONFIRMED FROM PHOTOS** — short rectangular/fringed handbag with a very distinctive lower fringe section |
| Overall proportions | **CONFIRMED FROM PHOTOS** — wide compact upper body, with long hanging fringe extending the visual height considerably. (Loco's higher base price, 65 JOD, CONFIRMED BY RAND, is a pricing fact only and was not used to infer this) |
| Top/opening shape | **CONFIRMED FROM PHOTOS** — horizontal rectangular hand opening integrated into the upper body |
| Base shape | UNRESOLVED — the underlying bag body appears rounded/soft beneath the fringe, but the exact hidden base geometry has not been confirmed and is not modeled from this appearance alone |
| Handle shape and construction | **CONFIRMED FROM PHOTOS** — the hand opening is built into the crocheted top section, rather than a tall external arch. **Do not reuse Vault geometry simply because both use horizontal hand openings — Loco requires its own body and fringe system**; this is an explicit instruction, not just the general rule |
| Crochet/weave pattern | **CONFIRMED FROM PHOTOS** — thick matte yarn with chunky crochet rows in the upper section. **Plus a major structural finding:** long individual hanging yarn strands (fringe) cover most of the lower outer body — fringe is essential to Loco's identity and must be represented in the production model. **Reconciled** — `loco-spec.md` §1/§12 now defines `fringe` as its own required node, with three ordered production approaches (optimized strand geometry → grouped fringe-card geometry → another mobile-safe technique if visually equivalent), and `model-contract.ts` requires it (`PRODUCT_PART_REQUIREMENTS.loco.fringe = true`) |
| Hardware placement | UNRESOLVED |
| Strap attachment placement | UNRESOLVED |
| Chain attachment placement | UNRESOLVED |
| Primary material zone | **CONFIRMED FROM PHOTOS** — thick matte yarn, chunky crochet rows, upper section |
| Secondary/two-tone material zone | N/A — Loco is confirmed single-tone, CONFIRMED BY RAND |

### 3. Required unique model file
`public/models/arcubed/bodies/loco/loco-body-v1.glb` — does not exist yet,
and cannot be accepted until the audit above is complete (hidden base
geometry, hardware placement, and strap/chain attachment placement remain
UNRESOLVED — the fringe-system node contract itself is now reconciled, see
§2/§4). **Do not reuse Vault geometry** — restated per this round's
explicit instruction; the shared horizontal-opening trait is not
permission to share a file.

### 4. Required material zones
`bag_body_primary` (single-tone, CONFIRMED BY RAND — no two-tone support),
`hardware`, `fringe` (required node, reconciled — see `loco-spec.md` §1,
§12 for the three ordered production approaches). Two real colourways
CONFIRMED BY RAND: Brown, Burgundy — neither confirmed metallic. Hex
values: UNRESOLVED. Loco's size options are also UNRESOLVED (per
`product-matrix.md`) — only the single default body applies for now.

### 5. Required attach points
`attach_strap`, `attach_chain`. No separate handle attach point — the hand
opening is built into the body per §2, not a swappable component.

### 6. What can be shared across products
Only: strap GLBs, chain GLBs, the approved material systems, the technical
node-naming conventions, and the viewer infrastructure. Loco's required
node/attach-point *list* happens to be identical in shape to Vault's (both
single-tone, no separate handle component) — that is a contract-shape
coincidence, not permission to reuse or infer from Vault's file. See §7.

### 7. What must never be shared
Loco's `bag_body_primary`/`hardware`/fringe mesh data. **Specifically:
Loco must never reuse or approximate from Vault's `vault-body-v1.glb`,
even though their required node lists are identical and both have an
integrated horizontal hand opening.** Visual review confirms they are not
the same shape: Vault is a tall boxy structured bag with no fringe; Loco is
a shorter, wider bag whose defining feature — a substantial hanging fringe
covering most of the lower body — Vault's photos show nothing like. The
actual mesh geometry must be modeled from Loco's own confirmed, visually-
audited photography, never approximated from Vault's.

### 8. Current 3D readiness status
**0% — no geometry exists, acceptance gate not clearable** (audit
partially complete — hidden base geometry, hardware placement, and
strap/chain attachment points remain UNRESOLVED; the fringe-system node
contract is reconciled, see §2/§4). `public/models/arcubed/bodies/loco/`
is empty. Verified live: zero `product_models` rows, zero real
`product_images` rows for Loco. Same fallback behavior as Nova above.

---

## Global rule (this round)

**These four products are now visually confirmed as different physical
designs.** Nova ≠ Vault ≠ Mini Luna ≠ Loco. No body mesh may be reused
across products.

## Cross-product summary

### What may be shared across products (the complete list — nothing else)
- **Strap GLBs** (e.g. Crochet Strap) — one shared catalog, attaches to any
  product's `attach_strap`.
- **Chain GLBs** (Silver Tone Chain, Gold Tone Chain) — same, shared
  catalog, attaches to any product's `attach_chain`.
- **Approved material systems** — the regular-yarn / metallic-yarn / metal
  roughness-metalness presets in `material-spec.md`, applied to each
  product's own textures.
- **Technical node-naming conventions** — the vocabulary in
  `src/lib/three/model-contract.ts` (`bag_body_primary`, `attach_strap`,
  etc.), so the same viewer code can load any product's file. A naming
  contract, not geometry.
- **Viewer infrastructure** — `Canvas3D.tsx`/`BagModel.tsx`, the Draco
  decoder, `export-checklist.md`'s pipeline. Process and code, not assets.

Nothing else. In particular, there is no shared "handle" component today —
each product's handle-or-not-and-what-kind is its own unresolved or
newly-confirmed finding above, not a shared catalog item.

### What must never be shared or inferred (no exceptions)
- Any product's body mesh (`bag_body_primary`/`bag_body_secondary`/handle/
  fringe/`hardware`), reused for, approximated from, or *inferred from*
  another product — now visually confirmed as four different shapes, not a
  policy applied to a hypothetically-similar generic bag.
- Unseen back/side/interior/hidden-base geometry for any product — if a
  photo set doesn't show an angle (Nova's back/sides, Loco's base beneath
  the fringe), that angle stays UNRESOLVED, never fabricated.
- A generic "crochet bag" base mesh recoloured and relabeled as multiple
  products. There is no generic Arcubed bag.

## 3D activation rule (per product, independently)

A product shows real 3D only when **its own** `product_models` row exists,
points at **its own** validated `model_assets` row (validated per
`qa-checklist.md` **and** per §2's visual-audit acceptance gate above), and
that row is active — verified this exact mechanism has no cross-product
fallback by reading `getDefaultBodyModelsByProductId` in
`src/lib/repository.ts`: it queries `product_models` filtered to each
product's own `product_id`, with no branch that would ever substitute
another product's model. If, for example, Nova's audit and model are
finished while Vault/Mini Luna/Loco's aren't, Nova shows 3D and the other
three continue showing their photography/illustrative fallback — never
Nova's geometry.

## Photo display rule — current state

Per `product-matrix.md`'s Photography section: **zero real photos have
been imported into `product_images` for any of the four products** (live-
verified, all four empty). The external visual review that produced this
update's findings has not yet resulted in actual image files being
imported into this project's database/storage. Real photography — once
imported — is intended to take priority over the illustrative `BagArt`
fallback; that priority logic does not exist in the app yet and was not
built this turn, since this task was scoped to the geometry map only.
Until either real photos are imported and that display path is built, or a
real 3D model ships per product (which additionally requires that
product's audit to be fully complete, not just partially, per §2), every
product correctly continues showing the honest illustrative fallback —
this is accurate current behavior, not a bug.

No code was changed and nothing was deployed for this task. No dimensions
were fabricated. No unseen geometry was fabricated. No models were
created.
