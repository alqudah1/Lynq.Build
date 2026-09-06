# Model Acceptance Checklist

Run every item below against the model **actually loaded in `/dev/3d-inspector`**
(the real candidate-testing tool — see `ingest-workflow.md`; `/dev/3d-test`
remains the separate pipeline-proof rig using placeholder geometry only) or
a neutral glTF viewer where noted, not just your DCC tool's preview —
several of the most common real-world failures (wrong scale, missing node,
plastic material under different lighting) only show up once the exact file
that will ship goes through the exact loader the customizer uses
(`useGLTF` in `BagModel.tsx`, with the self-hosted Draco decoder).

A model is **production-ready** only when every applicable item below
passes. "Applicable" varies by product — see each product's spec (§19,
"Acceptance criteria") for which items apply and any product-specific
additions (e.g. two-tone only applies to Nova and Mini Luna; Vault and
Mini Luna each have a confirmed handle requirement, Loco has a confirmed
fringe requirement — see the relevant spec).

**This checklist alone is not sufficient.** `PRODUCT-GEOMETRY-MAP.md`'s
acceptance gate additionally requires that product's Visual Geometry Audit
be complete (marked CONFIRMED FROM PHOTOS, not just UNRESOLVED rows left
open) before a model can be accepted — a candidate that passes every item
below but was built before its audit was recorded is still not
production-ready. Check both.

Once a model passes, it gets a real `model_assets` row
(`is_placeholder = false`) and gets linked via `product_models` or
`straps_handles.model_asset_id` — see the package README's workflow
section.

## The checklist

### 1. Loads without errors

Open `/dev/3d-test` (or the product page once linked) with the browser
console open. No errors, no unhandled promise rejections, no React error
boundary triggered (`Bag3DErrorBoundary` catching a failure and rendering
the fallback silently is itself a form of "did not load" — check the
console, don't just check that *something* rendered).

### 2. Node names correct

Every node name matches `src/lib/three/model-contract.ts` exactly
(case-sensitive, exact string). Verify two ways:

- **`/dev/3d-inspector`'s "Node hierarchy" panel** lists every node name
  from the actual loaded scene directly (contract node names highlighted) —
  diff it against the required list in the relevant spec's §1–2. The
  validator's report (same page) also does this diff for you automatically
  and calls out missing/duplicate required nodes as errors.
- **No silent failures accepted:** a missing/misnamed node doesn't throw —
  it just doesn't work (no colour applied, nothing attached, a console
  warning from `AttachedPart` at most). Confirm every required node is
  present by name, don't infer it from "the bag looks roughly right."

### 3. Materials independently editable

For every body zone the product requires (`bag_body_primary`, and
`bag_body_secondary` where applicable): confirm in `/dev/3d-test` that
selecting a different colour changes **only** that zone, with zero visual
change to any other zone, hardware, handle, strap, or chain. If the whole
bag changes colour together, the zones share a material instance — see the
relevant spec's §4 and `material-spec.md`.

### 4. Attach points correct

For every attach point the product requires (`attach_strap`,
`attach_chain`, and `attach_handle` only if that product ever needs a
swappable handle): confirm a component GLB attached there sits at the
correct position, rotation, and scale relative to the body — not just
"present somewhere in the scene." Test with at least one real or
placeholder strap/chain file per `strap-spec.md`/`chain-spec.md` §17.

### 5. No broken normals

Inspect the loaded model from multiple angles (rotate freely in the
viewer). Look for: faces that go dark/inside-out looking as you rotate past
them (inverted normal), visible faceting where a surface should read smooth
(normals not smoothed/averaged where they should be), or lighting that
looks physically wrong on an otherwise-correct silhouette. If found, the
fix is in the source DCC file (recalculate/recompute normals, check for
non-manifold geometry), not something correctable at export time.

### 6. No flipped geometry

Distinct from broken normals: check for entire faces or sub-meshes that are
mirrored/inverted (visible as a mesh being culled or rendering "inside-out"
as a whole, not just individual bad-normal faces). Common cause: a mirrored
duplicate (e.g. mirroring one side of a symmetric bag) with a negative
scale that wasn't corrected/applied before export.

### 7. No excessive draw calls

Each material on each mesh is roughly one draw call. A body model with
`bag_body_primary` + `bag_body_secondary` + `handle` + `hardware`, each
with one material, is ~4 draw calls for the body — plus 1 each for an
attached strap and chain. If a model has noticeably more draw calls than
its part count would suggest, materials probably weren't consolidated
where they could be (e.g. multiple separate materials on what should be one
`hardware` material). Check via your DCC tool's stats overlay or a glTF
inspector before export; there's no in-app draw-call counter today.

### 8. Texture sizes acceptable

Every texture is at or under the resolution target in the relevant
spec/`material-spec.md` (1024×1024 default for body zones, 2048×2048 only
if genuinely needed, 512×512 for handle/hardware/strap/chain). Check actual
embedded texture dimensions in the exported GLB (a glTF inspector will show
this), not just what you intended to export at.

### 9. Mobile performance acceptable

File size (geometry + all embedded textures, as actually exported/
compressed) is under the relevant spec's target (3MB for Nova's body, 2.5MB
for Vault/Mini Luna/Loco's bodies, 1MB for any strap/chain component — see
`export-checklist.md`'s budget methodology). Also do a real load-time gut
check on a throttled connection (browser devtools network throttling to
"Fast 3G" or similar) — the file-size target is a proxy for load time, not
the actual requirement; if it loads slowly despite being under budget,
investigate before shipping.

### 10. No embedded unnecessary cameras/lights

Inspect the GLB's contents (glTF inspector, or check your DCC exporter's
scene-content summary before export) and confirm zero camera or light
objects are embedded — the viewer supplies its own (`Canvas3D.tsx`). An
embedded camera/light doesn't necessarily break rendering, but it's dead
weight and a sign the export wasn't scoped correctly — treat its presence
as a fail and re-export with the exporter's camera/light inclusion turned
off.

### 11. Correct real-world scale

Model is authored at true meters (1 unit = 1 meter) — see the package
README's scale section, including the note that the *viewer's camera* is
currently tuned for the placeholder's non-real scale and will need a
one-line adjustment once the first real body ships. That adjustment is not
this model's problem to solve — this checklist item is about the *model*
being at correct real-world scale, independent of how the camera happens to
be framed today.

### 12. Correct orientation

Y-up, front of the bag facing +Z at identity transform (see any body
spec's §7). Confirm in a neutral glTF viewer if in doubt — some DCC tools'
own preview can mask an orientation issue that becomes obvious once loaded
through a standards-compliant glTF loader.

### 13. Rotation feels natural in the viewer

Subjective but real: drag-rotate the model through a full turn in
`/dev/3d-test`. It should read as "looking at a bag from different angles,"
not swing unnaturally, clip through the ground plane
(`ContactShadows` at y=-0.62), or have its pivot feel off-center (rotating
around a point that isn't roughly the bag's own visual center). If the
pivot feels wrong, revisit the relevant spec's §6 (origin/pivot).

### 14. Two-tone works where required (Nova, Mini Luna only — N/A for
### Vault, Loco)

Select a two-tone colour in the customizer's "Two-tone (optional)" selector
and confirm `bag_body_secondary` updates to that colour while
`bag_body_primary` stays unchanged, and vice versa when changing the
primary colour with a secondary already selected. Also confirm selecting
"None" in the two-tone selector correctly leaves `bag_body_secondary` at
whatever its authored/default material colour is (no runtime override
applied) rather than looking broken/uncoloured.

### 15. Strap/chain swaps align correctly

Covered in depth in `strap-spec.md`/`chain-spec.md` §4/§6 and §18 — restate
here as the acceptance gate: select at least two different strap options
(or a strap and no-strap state) and confirm each attaches at the identical
correct position/angle (i.e. the *body's* `attach_strap` placement is
correct and consistent, independent of which strap is selected) — a
strap-specific misalignment is that strap file's problem (see
`strap-spec.md`); if *every* strap misaligns identically, the body's attach
point itself is likely wrong.

### 16. Fallback still works if model fails

Deliberately break the load (e.g. temporarily point the test
`model_assets` row's `glb_url` at a 404 or malformed file) and confirm the
product page falls back cleanly to the existing photo/BagArt crossfade —
not a blank canvas, not a stuck loading spinner, no uncaught console error
that would indicate `Bag3DErrorBoundary` didn't actually catch it. This is
testing the *system's* resilience, not the model itself, but it's the last
gate before a model is trusted in production — a model that only works
when everything goes right isn't production-ready by this project's
standard (see `src/lib/repository.ts`'s equivalent production-fallback
discipline for the 2D catalog, which this mirrors).

## After all items pass

1. Upload the final GLB (Supabase Storage or wherever the project's asset
   host ends up being — not decided yet, coordinate before the first real
   upload).
2. Create a real `model_assets` row: `is_placeholder = false`, `kind`
   matching the part, `glb_url` pointing at the uploaded file, `version = 1`
   (or incremented, if replacing an existing asset — see
   `export-checklist.md`'s versioning note and `docs/3d-assets.md`'s
   "Versioning" section).
3. Link it: a `product_models` row (product + `size_id = null` for the
   default body) for a body model, or set
   `straps_handles.model_asset_id` for a strap/chain/handle option.
4. This is a database change — no application code should need to change
   for a model that follows this package's specs to start working on the
   real product page.
