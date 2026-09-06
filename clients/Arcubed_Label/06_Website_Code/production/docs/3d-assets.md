# Arcubed 3D Model Contract

**Status: architecture only. No approved production geometry exists for
Nova, Vault, Mini Luna, or Loco yet.** This document is the spec to hand to
whoever builds/exports the real GLBs — the app already knows how to consume
files that follow it (see `src/lib/three/model-contract.ts`, the single
source of truth these rules are copied from — keep both in sync).

## File format

- `.glb` (binary glTF), Draco-compressed geometry where it meaningfully
  reduces file size. The app self-hosts a Draco decoder at `/draco/` — no
  external CDN dependency.
- Keep texture resolution reasonable for mobile (customers arrive from
  Instagram on phones). Prefer compressed texture formats where your export
  pipeline supports it (e.g. KTX2/Basis) over raw large PNGs.
- Real-world scale: model the bag at approximately its real physical size in
  meters (the viewer's camera/lighting/OrbitControls distances assume this).

## Body model — one GLB per product (or per product+size, see "Sizes" below)

A body GLB is a single scene containing some subset of these **exact**
node names (mesh names in your 3D authoring tool, preserved through
export):

| Node name | Purpose | Required? |
|---|---|---|
| `bag_body_primary` | The bag's primary/base material zone | **Always** |
| `bag_body_secondary` | Second independently-coloured zone | Only on two-tone products (Nova, Mini Luna) |
| `handle` | A handle baked into the body itself — or, for Vault, an alternate home for its confirmed integrated hand-opening/handle if a modeler chooses to split it into its own node (optional there, see `docs/3d-production/vault-spec.md` §1) | Required only for Mini Luna today (confirmed large arched handle). Optional everywhere else — Nova's handle construction is unresolved (do not assume it's required), Vault's may use this node or may not, Loco has none |
| `hardware` | Clasps/buckles/rivets/metal fittings | If present on the bag |
| `fringe` | Loco's confirmed hanging fringe covering the lower body | **Required for Loco only.** Not applicable to any other product |

Plus **empty (no-geometry) transform nodes** marking where a separate
strap/chain/handle GLB should be parented at runtime:

| Node name | Purpose |
|---|---|
| `attach_strap` | Where a selected strap GLB attaches |
| `attach_chain` | Where a selected chain GLB attaches |
| `attach_handle` | Where a selected (swappable) handle GLB attaches |

**Only include the attach point for a part the product actually supports as
swappable.** The app discovers what a body model supports by which nodes are
present — there is no separate database flag saying "this product has a
handle." Getting the node names right *is* the integration.

### Per-product part requirements

Updated per the visual geometry audit in
`docs/3d-production/PRODUCT-GEOMETRY-MAP.md` — real photography confirmed
Nova's handle is not a settled fact, and confirmed integrated handle/fringe
features on Vault, Mini Luna, and Loco that the original architecture-only
version of this table didn't anticipate.

| Product | `bag_body_secondary` | `handle` (as its own node) | `fringe` | `attach_strap` | `attach_chain` | `hardware` |
|---|---|---|---|---|---|---|
| Nova | ✅ (two-tone) | optional — unresolved whether standard Nova has a handle at all; do not assume required | — | ✅ | ✅ | ✅ |
| Vault | — | optional — Vault's confirmed integrated hand-opening/handle is required *geometry*, but may be sculpted into `bag_body_primary` instead of split into its own node | — | ✅ | ✅ | ✅ |
| Mini Luna | ✅ (two-tone) | **required** — confirmed large arched handle | — | ✅ | ✅ | ✅ |
| Loco | — | — | **required** — confirmed hanging fringe, identity-critical | ✅ | ✅ | ✅ |

(Mirrors `PRODUCT_PART_REQUIREMENTS` in `src/lib/three/model-contract.ts`.)

## Strap / chain / handle component GLBs

Each swappable component is its **own** GLB with a single root mesh named
after its kind:

- A strap file's root mesh: `strap`
- A chain file's root mesh: `chain`
- A (swappable) handle file's root mesh: `handle`

At runtime the app loads the component GLB and parents it onto the body's
matching `attach_*` node — position/orient the component's origin so that
parenting at the identity transform looks correct relative to the attach
point's placement in the body file. Coordinate the attach point's transform
and the component's local origin together when building both.

## Colours

The 3D viewer colours `bag_body_primary`/`bag_body_secondary` from whatever
the customer selects in the existing colour catalog (`public.colours`).
Three ways a colour can arrive at the viewer, in priority order once they
exist:

1. **`material_ref`** (`public.colours.material_ref`) — a real
   material/texture identifier (e.g. an actual yarn/crochet texture set).
   Nothing currently populates this; not consumed by the viewer yet either
   until a real texture pipeline exists to resolve it against.
2. **`hex_value`** — a flat colour tint applied to the material. What every
   real Arcubed colour would use today *if* a hex code existed — none do
   yet (see `clients/Arcubed_Label/01_Client_Info/product-matrix.md`).
3. **Neutral placeholder** (`#D9CFC2`) — used when neither exists, so the
   viewer never guesses at a real colour. This is what every real colour
   renders as right now.

**Do not show a colour as a customer-facing 3D option until it has real
information behind it** (at minimum a confirmed hex; ideally a real
material/texture once that pipeline exists) — showing the neutral
placeholder as if it were a deliberate rendering of "Gold" or "Rose Gold"
would misrepresent the product.

## Two-tone

Nova and Mini Luna: exactly two independently-colourable zones
(`bag_body_primary`, `bag_body_secondary`), each bound to its own colour
selection in the customizer (primary colour selector + a separate "Two-tone"
selector). Both update independently — selecting a secondary colour never
changes the primary zone and vice versa.

## Sizes

**Do not scale the Three.js scene to represent a size upgrade.** A larger
bag is different geometry (different proportions, not a uniform blow-up of
the same shape), so `public.product_models` supports a distinct body GLB per
size via a nullable `size_id` column — `size_id = null` is the default/
standard body; a specific size gets its own row pointing at its own GLB
(e.g. a hypothetical "Nova — Large" body). No real size names have been
confirmed yet (see product-matrix.md), so no size-specific rows exist —
build the standard body first; size variants slot in later without a schema
change.

## Materials — visual quality bar

Arcubed bags are handmade/crocheted. The eventual materials must read as
that, not as glossy plastic:

- Crochet/yarn texture on body materials (normal/bump map from a real
  scanned or procedural yarn texture, not a smooth PBR default)
- Correctly high roughness on yarn surfaces — no mirror-like reflections
- A distinct metallic material for `hardware` (and metallic-yarn colourways
  where applicable) — separate roughness/metalness values from the yarn body
- Chain components should read as an actual metal chain (appropriate
  metalness/roughness, not a flat-shaded grey shape)

None of this exists yet. The current placeholder dev geometry
(`public/models/dev/`) uses flat, obviously-not-final vertex colours
specifically so nobody mistakes it for a material study.

## Versioning

Every `model_assets` row has a `version` integer. Bump it when you replace a
file at the same conceptual asset (don't silently overwrite in place if a
customer may have an order snapshot referencing the old version — see
`CartItem3DConfig` in `src/lib/types.ts`, which preserves the exact asset
version used in a configuration).

## What's needed right now, concretely

For each of Nova, Vault, Mini Luna, Loco:

1. One body GLB following the node-naming table above for that product.
2. Confirmed hex codes (or real material references) for every colour name
   already in the catalog (see product-matrix.md) — needed before the 3D
   colour picker can show anything but the neutral placeholder.
3. Once Rand confirms real strap/chain names: one component GLB per option.
4. Once Rand confirms real size names (if any require different geometry):
   one additional body GLB per size variant.

Everything else — the database relationships, the viewer, the customizer
wiring, the cart snapshot — is already built and will pick up real assets
the moment `product_models`/`straps_handles.model_asset_id` point at them.
No further schema or component changes should be required.
