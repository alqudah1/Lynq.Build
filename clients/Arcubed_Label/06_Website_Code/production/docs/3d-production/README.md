# Arcubed 3D Asset Production Package

This folder is the complete brief for producing the four real Arcubed
product models — Nova, Vault, Mini Luna, Loco — so they drop into the
existing, already-built viewer with **zero rework**. If a model follows
every document here, it will load, colour, and swap correctly the moment
its `model_assets`/`product_models` rows are linked. If it doesn't follow
these documents, expect exactly the failure modes listed in each spec's
"Common failure cases" section.

**Nothing in this folder is a substitute for the real bag.** No dimensions,
colours, or material values here are Arcubed's actual confirmed data unless
explicitly marked as such — see `clients/Arcubed_Label/01_Client_Info/product-matrix.md`
for what Rand has and hasn't confirmed, and `PRODUCT-GEOMETRY-MAP.md` for
the per-product geometry status.

**No product is ready for a final production model today.** Every one of
the four still has UNRESOLVED geometry rows, and the acceptance gate in
`PRODUCT-GEOMETRY-MAP.md` §2 is not clearable for any of them. **Real
photography remains the production fallback until accurate models exist —
no placeholder or approximate GLB may be put on the production storefront
and presented as the real product.** Only three status labels are used
anywhere in this package: CONFIRMED BY RAND, CONFIRMED FROM PHOTOS,
UNRESOLVED. Where this package gives a number
(polygon budget, texture resolution, camera framing), it's an engineering
target for the pipeline already built, not a design decision about the
product.

## What already exists (do not redesign this)

- The runtime contract: `src/lib/three/model-contract.ts` — the single
  source of truth for every node name and attach point name used below.
- The narrative version of that contract: `../3d-assets.md` — read that
  first if you haven't. This package is the detailed production companion
  to it, not a replacement.
- The viewer: `src/components/three/` (`BagViewer3D`, `Canvas3D`,
  `BagModel`) — already loads a body GLB, recolours named material zones,
  and portals strap/chain/handle GLBs onto attach points. You should not
  need to touch this code to ship a real model; if a model can't work
  without a viewer code change, something in the model is off-contract —
  check the relevant spec's failure cases first.
- The dev-only proof rig: `/dev/3d-test` (development only, 404s in
  production — see `src/proxy.ts`) — proves the whole pipeline works using
  placeholder geometry.
- The dev-only asset inspector: `/dev/3d-inspector` (same production
  gating) — load ANY candidate GLB by URL, validate it against a chosen
  product's contract, and visually check it (colours, two-tone, dev
  strap/chain alignment) before it's linked to a real product. This is the
  actual QA tool for a real candidate file — see `ingest-workflow.md`.
- The validator: `src/lib/three/validate-model.ts` — checks node names,
  triangle/texture budgets, duplicate/missing required nodes, embedded
  cameras/lights, and more, against the product-specific contract. Powers
  `/dev/3d-inspector`'s validation report.

## Files in this package

| File | Covers |
|---|---|
| `PRODUCT-GEOMETRY-MAP.md` | **Read this first.** The per-product geometry checklist, the CONFIRMED/UNRESOLVED status of every row, the contradiction log, the remaining photography needed, and the acceptance gate |
| `archive/PRODUCT-GEOMETRY-MAP.round1.md` | The superseded round-1 audit, kept verbatim so corrections are auditable. **Not a source of truth** |
| `nova-spec.md` | Nova body model — two-tone, hardware. Compact rounded/oval-ish body confirmed; **proportions, top opening, base and handle all UNRESOLVED** (do not assume) |
| `vault-spec.md` | Vault body model — single-tone, hardware. **Boxy rectangle, taller than wide**; confirmed built-in opening/handle (required geometry, optional separate node) — **aperture shape rectangular-vs-arched UNRESOLVED** |
| `mini-luna-spec.md` | Mini Luna body model — two-tone, hardware. **Compact rounded-rectangular body**, confirmed required arched handle, **Red is metallic yarn**; base UNRESOLVED |
| `loco-spec.md` | Loco body model — single-tone, hardware, integrated opening (no separate handle node). **Fringe is required structural geometry and may never be a texture**; strand layout UNRESOLVED |
| `strap-spec.md` | Swappable strap component GLBs (all four products) |
| `chain-spec.md` | Swappable chain component GLBs (all four products) |
| `material-spec.md` | The yarn/crochet + metallic-yarn + hardware material pipeline, shared by every spec above |
| `export-checklist.md` | GLB export settings, Draco/Meshopt, file size targets |
| `qa-checklist.md` | The full acceptance checklist a model must pass before `is_placeholder` can be `false` and it can be linked to a real product |
| `ingest-workflow.md` | The full incoming-file → validated → placed → linked → live pipeline, and why an unvalidated model can never go public by accident |
| `../photo-asset-map.md` | Maps Rand's confirmed Drive photography references to each bag (shape/colour/hardware/handle reference) — moved one level up since it's used beyond just 3D production; `photo-reference.md` here is a redirect stub |
| `../../public/models/arcubed/README.md` | Where a finished, approved GLB actually goes, and the exact filename convention |

## Production workflow

1. Read `material-spec.md` once — every body/strap/chain spec assumes it.
2. Read the specific product's spec (or `strap-spec.md`/`chain-spec.md`)
   and `../photo-asset-map.md` for what photography to build from.
3. Model, UV, and texture per that spec.
4. Export per `export-checklist.md`.
5. Validate and visually QA the file in `/dev/3d-inspector` (see each
   spec's "How to test" section, and `ingest-workflow.md` for the full
   procedure) — this is the same loader/recolour/attach code the real
   customizer uses, just pointed at your file instead of a linked asset.
6. Run every item in `qa-checklist.md` against the actual loaded result,
   not just the authoring-tool preview.
7. Only once every QA item passes: follow `ingest-workflow.md` to place
   the file and create the real `model_assets`/`product_models` rows.
   Nobody should need to touch application code to ship a model that
   follows this package.

## Real-world scale — read this before modeling anything

Author at true real-world scale in **meters** (1 glTF unit = 1 meter) — this
is the correct, standards-compliant convention and what every major DCC
tool's glTF exporter assumes by default.

**The viewer frames the camera automatically from whatever the loaded
model's actual bounding box measures** (`src/lib/three/framing.ts`,
wired into `BagModel.tsx`) — it is no longer tuned to any one model's
scale. Center, camera distance, zoom limits, and the ground-shadow plane
are all computed from the real geometry every time a body loads, so a
0.2m, 0.4m, or 1m model all frame correctly with zero camera-constant
changes. Model at real scale and it will simply work.
