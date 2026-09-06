# Model Registry / Ingest Workflow

How a candidate GLB becomes a real, customer-facing 3D model — every step,
in order, and why an unvalidated file can never become public by accident.

```
incoming GLB
  → validation (src/lib/three/validate-model.ts, via /dev/3d-inspector)
  → visual QA (qa-checklist.md, against the SAME viewer stack the storefront uses)
  → optimization/compression (export-checklist.md — should already be done before this point, re-check here)
  → final asset placement (public/models/arcubed/... — see that folder's README.md)
  → model_assets row (is_placeholder = false, versioned)
  → product_models / straps_handles.model_asset_id relationship
  → storefront activation (automatic — no extra "publish" step exists or is needed)
```

## Step 1 — Incoming GLB

Arrives however the artist/contractor delivers it (file share, direct
upload to whoever's coordinating). **Do not place it in `public/models/arcubed/`
yet** — that tree is reserved for already-approved assets (see step 4). Keep
candidates in a local scratch location outside the repo (or in a gitignored
staging folder — this project doesn't currently have one; create one
locally, e.g. `_staging-3d-assets/`, and add it to `.gitignore` if you want
it to persist across a working session without ever being committed).

**Why this matters:** a file sitting in `public/models/arcubed/` is a
static asset Next.js will serve to anyone who requests its URL, whether or
not any `model_assets` row references it. Keeping unvalidated candidates
physically outside `public/` is a real technical guarantee that they're not
"public" yet, not just a database-flag promise.

## Step 2 — Validation

Run it through `/dev/3d-inspector` (paste its URL — a local dev server can
serve a file placed anywhere under `public/`, including a temporary
subfolder, or use any HTTPS URL the file is temporarily reachable at) with
the correct product/kind selected. Read every error and warning in the
report — see `qa-checklist.md` items 1–11 for what these map to.

**A model with any validator error is not ready — do not proceed to step 3
regardless of how it looks visually.** Warnings are judgment calls (discuss
with whoever owns 3D production if unsure); errors are not.

## Step 3 — Visual QA

With the same file still loaded in `/dev/3d-inspector` (or `/dev/3d-test`
temporarily reconfigured — see any body spec's §17): work through every
applicable item in `qa-checklist.md` (items 12–16 especially — these are
the ones the validator can't check for you: does rotation feel natural,
does two-tone actually look right, does a real strap/chain attach cleanly).

## Step 4 — Optimization/compression re-check

By this point the file should already be Draco-compressed with reasonable
texture sizes (`export-checklist.md`) — the validator's report from step 2
already flagged any budget overruns. This step is just: don't skip
re-running validation after any change made in response to step 2/3
feedback (a re-export can silently reintroduce a problem the first pass
already caught — re-validate, don't assume a fix worked).

## Step 5 — Final asset placement

Move (don't copy-and-leave-a-duplicate) the approved file into
`public/models/arcubed/` following that folder's README naming convention.
This is the point at which the file becomes technically public (servable by
URL) — which is fine, because everything before this point already
gate-kept on that happening prematurely.

## Step 6 — `model_assets` row

Create the real row:

```sql
insert into public.model_assets (kind, name, glb_url, is_placeholder, version, active)
values ('body', 'Nova body', '/models/arcubed/bodies/nova/nova-body-v1.glb', false, 1, true);
```

- `is_placeholder = false` — this is real production geometry, not dev-test
  geometry. **Never flip an existing placeholder row to `false` instead of
  creating a new one** — placeholders and real assets should never share a
  row's history.
- `version` — `1` for a first submission; increment (new row, not an
  update to the existing row's `glb_url` — see the cart/order audit note
  below for why) when replacing an asset later.
- `active = true` — only once you actually intend this to go live in step 8.
  Setting `active = false` here lets you create the row ahead of time
  without it being selectable yet, if that's useful for staging.

## Step 7 — Relationship

For a body: a `product_models` row —

```sql
insert into public.product_models (product_id, size_id, model_asset_id, active)
values ((select id from products where slug = 'nova'), null, '<model_assets.id from step 6>', true);
```

(`size_id = null` = the default/standard body — see any body spec's
"Sizes" note for the size-variant case.)

For a strap/chain/handle: set `straps_handles.model_asset_id` on the
relevant row (once that row exists — see product-matrix.md, no real
strap/chain names exist yet, so this step is blocked on that regardless of
how ready the 3D asset itself is).

## Step 8 — Storefront activation

**There is no separate "activate" step beyond step 7.** The moment a
`product_models`/`straps_handles.model_asset_id` row exists and is active,
`repository.ts`'s `getActiveBags()`/`getBagBySlug()` picks it up on the next
request and `ProductGallery` automatically renders `BagViewer3D` instead of
the photo/BagArt fallback — see `docs/3d-assets.md`. No code deploy, no
feature flag, no cache to bust beyond normal request-level data fetching.

**This is also why steps 1–3 matter so much**: there is no staging
environment between "row exists" and "live to every customer." Validation
and QA are the only gate.

## Do not make unvalidated models automatically public

Restating the mechanism, since it's the point of this whole document: a
model can't reach a real customer unless (a) the file is physically placed
in `public/models/arcubed/` (step 5) **and** (b) a `model_assets` row with
`is_placeholder = false` and `active = true` exists **and** (c) it's linked
via `product_models`/`straps_handles.model_asset_id`. Skipping any one step
keeps a candidate from ever being customer-facing — there's no path that
bypasses all three.

## Cart/order snapshot behavior across a version replacement

Verified by code walkthrough (`src/lib/pricing.ts`'s `buildCartSnapshot`,
`src/lib/types.ts`'s `CartItem3DConfig`): when a customer adds a
3D-configured item to their cart, the snapshot captures the **specific**
`assetId`/`glbUrl`/`version` that were active on `bag.model3D` (and the
selected strap/chain's `model3D`) *at that moment* — not a live reference to
`product_models`/`model_assets` that would silently change if those rows are
updated later.

Concretely: if Nova's body is replaced with `nova-body-v2.glb` (a new
`model_assets` row, `version = 2`, re-linked via a new `product_models`
row) after a customer has already added a Nova to their cart referencing
`version = 1`, that customer's cart/order snapshot still shows `version: 1`
and its original `glbUrl` — it does not silently start pointing at v2. This
is the same principle the 2D catalog already follows for colours/straps/
addons (`configuration_snapshot` on `order_items`) — this document exists to
confirm the 3D fields follow it too, which they do by construction (the
snapshot is built once, at add-to-cart time, from whatever `bag.model3D`
was at that moment — see `ProductGallery`/`Customizer`'s data flow in
`docs/3d-assets.md`).

**What is NOT stored**: no mesh/geometry/texture data, ever — only the
three small identifiers (`assetId`, `glbUrl`, `version`) per part
(body/strap/chain/handle). An order's `configuration_snapshot` stays a
small JSON document regardless of how large the actual GLB files are.
