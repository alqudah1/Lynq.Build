# Arcubed Production 3D Assets

Real, QA-passed production GLBs live here — **nothing in this tree is
production-ready until it has passed every item in
`docs/3d-production/qa-checklist.md`.** See
`docs/3d-production/ingest-workflow.md` for the full incoming → validated →
placed → linked pipeline this folder is the final step of.

## Structure

```
public/models/arcubed/
  bodies/
    nova/        one body GLB per size variant (default = no size suffix)
    vault/
    mini-luna/
    loco/
  straps/        shared catalog — one GLB per real strap option
  chains/        shared catalog — one GLB per real chain option
  handles/       shared catalog — reserved; empty until a swappable handle
                 option is ever confirmed (see docs/3d-production/nova-spec.md §2)
```

Bodies are nested per-product because each product's body geometry is
genuinely distinct. Straps/chains/handles are flat, shared folders because
`public.straps_handles` is one shared catalog table, not a per-product
one — a strap file isn't "Nova's strap," it's a strap that may (via
`product_straps_handles`) be offered on one or several products.

## Filename convention

- Body, default (no confirmed size variant yet): `{product}-body-v{n}.glb`
  — e.g. `nova-body-v1.glb`.
- Body, size-specific (once a real size name exists — see
  `clients/Arcubed_Label/01_Client_Info/product-matrix.md`, currently
  unresolved for all four products): `{product}-{size-slug}-body-v{n}.glb`
  — e.g. `nova-large-body-v1.glb` (illustrative only — "large" is not a
  confirmed real Nova size).
- Strap: `strap-{real-name-slug}-v{n}.glb` — e.g. `strap-braided-tan-v1.glb`
  (illustrative only — no real strap name is confirmed yet).
- Chain: `chain-{real-name-slug}-v{n}.glb` (same caveat).
- Handle (if ever needed): `handle-{real-name-slug}-v{n}.glb`.

`{n}` is the version — increment it (never overwrite a shipped file in
place) when replacing an asset; see `docs/3d-production/ingest-workflow.md`'s
versioning section for why, and how that reaches `model_assets.version`.

**Never invent a real option name for a filename.** Until Rand confirms
one, a strap/chain/size has no file here — see each spec's "unresolved"
notes in `docs/3d-production/`.

## What's here right now

Nothing. Every folder above is empty (holding only its own README/marker) —
no fake or placeholder production files have been added. Development-only
test geometry lives separately at `public/models/dev/`, never in this tree.
