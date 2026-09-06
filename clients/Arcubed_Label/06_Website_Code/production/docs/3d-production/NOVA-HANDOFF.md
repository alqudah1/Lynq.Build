# Nova — Production 3D Model Handoff

Everything a 3D artist needs to build the first real, shippable Nova body
GLB. Self-contained — you should not need to read the app's source code or
any other doc in this repo to use this brief. Full technical detail (if you
want it) lives in `nova-spec.md`, `material-spec.md`, `export-checklist.md`,
`qa-checklist.md`; this document is the single-page version.

**No Nova geometry exists yet.** Nothing here is a placeholder pretending to
be final — `public/models/arcubed/bodies/nova/` is empty, and the storefront
is currently using real photography (and an illustrative fallback where no
photo is mapped) for Nova, not 3D. That stays true until a model passes
every item in the acceptance checklist below and is formally linked (§9).

## 1. What Nova is

A crocheted handbag, 55 JOD base price. Two-tone (a genuinely different
colour on two separate zones of the bag). **Compact, with a rounded /
oval-ish body** — confirmed from real photography (see §2). Supports a
swappable strap and a swappable chain. **Whether it has a handle is
unresolved — see §7. Do not assume it does.**

**Correction:** an earlier version of this line said "low, wide clutch —
wider than tall, rounded trapezoid/soft oval profile" and presented it as
confirmed. A later review of the same reference photo read it as compact
and rounded/oval-ish instead, which does not establish that proportion
(contradiction C1 in `PRODUCT-GEOMETRY-MAP.md`). **Nova's width:height
ratio, top-opening shape, and base shape are UNRESOLVED** — you do not yet
have enough evidence to model this body, and this handoff is not
commissionable until those photos arrive. See `PRODUCT-GEOMETRY-MAP.md`
Nova §9 for the exact shot list.

## 2. Source photo references

Confirmed real Arcubed photography (from Rand's supplied Drive folders —
not yet browsed/downloaded in this environment; someone with Drive access
needs to pull the actual files). Use these as your geometry silhouette,
material/colour, and handle-construction reference:

| Reference | Use as |
|---|---|
| Gold Nova | Colour reference (Gold — metallic-yarn) |
| Gold Nova with Handle | Colour reference (Gold) + handle construction/attachment reference |
| Nova Silver & Gold | **Two-tone reference** — the primary/secondary zone split |
| Nova Silver & Gold with Handle | Two-tone reference + handle reference |
| Black Nova | **Primary shape/silhouette reference** + colour reference (Black) |
| Champagne Nova | Colour reference (Champagne) |
| Silver Nova | Colour reference (Silver — metallic-yarn) |
| Rose Gold Nova with Handle | Colour reference (Rose Gold — metallic-yarn) + handle reference |
| Nova Hot Pink | Colour/material reference **only** |

**Nova Hot Pink is a reference photo, not a confirmed production colour.**
It is not in Rand's confirmed Nova colour list (§5 below) and must not be
built as a selectable customizer option, added to the colour catalog, or
implied anywhere as available for purchase unless Rand explicitly confirms
it as a real current option. Use it only if you need an extra real-world
reference for how the yarn/colour reads in photography.

**Not available:** hardware close-ups (no confirmed photo of any Arcubed
clasp/buckle/rivet exists), strap/chain reference photography (Crochet
Strap / Silver Tone Chain / Gold Tone Chain names are confirmed, but no
photos of any of the three exist — do not substitute stock imagery),
confirmed hex codes for any colourway (see §5).

## 3. Required geometry — node names

Three separate meshes, each its own named node in the GLB scene graph,
never merged even where they touch or share an edge:

```
bag_body_primary      required
bag_body_secondary    required — Nova is two-tone
hardware              required
```

`handle` is **not required** for this submission — see §7. The standard
reference photo (Gold Nova) shows no tall integrated handle; do not add
one speculatively.

Plus two empty (no-geometry) transform nodes marking where a separately-
loaded strap/chain GLB parents at runtime:

```
attach_strap
attach_chain
```

Names are matched by **exact case-sensitive string equality** at runtime —
a misnamed node doesn't crash anything, it just silently doesn't work (no
colour applied, nothing attached). Double-check spelling before export.

## 4. Independent meshes and materials

- `bag_body_primary`, `bag_body_secondary`, and `hardware` must each be a
  **separate mesh/node** — the app looks each one up by name individually.
- `bag_body_primary` and `bag_body_secondary` **must use two separate
  material slots** — not the same material, not a vertex-colour split on
  one mesh. The runtime recolours each by name independently; if they share
  a material instance, both zones will recolour together, which is wrong.
- `hardware` needs its own material too, per the metal preset in §6 — not
  customer-colour-driven, give it a correct, fixed material rather than
  leaving it defaulted.

## 5. Material zones — the six real Nova colourways

Confirmed by Rand, **hex codes not yet confirmed for any of them** — do not
invent, sample-from-photo, or guess a hex value. Build the material system
to accept a colour value per zone (the app sets it at runtime via
`material.color.set(hex)`); leave the actual hex as a placeholder/TODO
until Rand approves real values.

| Colourway | Zone(s) | Material preset |
|---|---|---|
| Gold | primary (or secondary, when in the two-tone combo) | Metallic yarn |
| Black | primary | Regular yarn |
| Champagne | primary | Regular yarn |
| Silver | primary (or secondary, when in the two-tone combo) | Metallic yarn |
| Rose Gold | primary | Metallic yarn |
| Silver & Gold (two-tone) | **primary = one, secondary = the other** | Metallic yarn, both zones |

**Silver & Gold must map to two independently-coloured zones — primary
zone gets one metal, secondary zone gets the other — never flattened into
a single blended/mixed texture.** This is the entire reason
`bag_body_primary`/`bag_body_secondary` exist as separate meshes/materials
(§4): the split *is* the two-tone effect, produced by the runtime setting
two different colours on two real zones, not by any special two-tone
texture work on your end.

### What the material system must accept, per zone

- An approved base colour (applied as flat, unlit albedo — this is what
  gets swapped at runtime, so the texture itself should carry stitch detail
  without baked-in colour or shading)
- A yarn/crochet normal (bump) map — real stitch-scale detail, not a
  generic fabric weave
- Roughness (value or map)
- AO where useful (optional but recommended — bake into a separate
  channel/alpha, never into the albedo that gets recoloured)
- Metallic-yarn parameters where appropriate (Gold/Silver/Rose Gold/either
  zone of Silver & Gold — see the table below)

### Regular yarn (Black, Champagne)

| Channel | Value |
|---|---|
| Roughness | 0.6–0.85 |
| Metalness | 0.0 |
| Normal map | Required, stitch-scale |

### Metallic yarn (Gold, Silver, Rose Gold, both zones of Silver & Gold)

Still yarn — must not read as smooth chrome.

| Channel | Value |
|---|---|
| Roughness | 0.35–0.55 (noticeably lower than regular yarn, still well above polished-metal roughness) |
| Metalness | 0.4–0.7 (never 1.0 — full metalness reads as a solid metal object, not thread with metallic fiber) |
| Normal map | Required, same stitch-scale detail as regular yarn |

Common failure modes to avoid: roughness below ~0.55 on a *regular* yarn
zone reads as plastic; metalness above ~1.0 or roughness below ~0.35 on a
*metallic* zone reads as chrome, not thread. Test metallic zones under the
viewer's actual lighting (`Environment preset="apartment"`), not just your
DCC tool's viewport — it looks meaningfully different.

## 6. Hardware requirements

`hardware` (clasp/buckle/rivet) is real metal, not yarn — completely
different preset:

| Channel | Value |
|---|---|
| Roughness | 0.15–0.35 |
| Metalness | 0.9–1.0 |
| Normal map | Optional (small on-screen footprint) |

No confirmed hardware reference photo exists yet for any Arcubed product —
build from a reasonable clasp/hardware assumption and flag it clearly as
unconfirmed pending a real reference photo.

## 7. Handle — unresolved, do not build it for this submission

**Build the standard Nova body without any handle geometry.** A visual
audit of the reference photography confirmed the standard/reference Gold
Nova photo shows no tall integrated handle, even though some folders are
named "...with Handle." This is genuinely unresolved — it isn't yet known
whether:

- handle is a real customer-selectable option (a future revision would
  then need `attach_handle` and a separate swappable handle component GLB,
  mirroring `strap-spec.md`'s pattern), or
- a fixed baked `handle` node belongs on the standard body after all
  (mirroring Mini Luna's now-confirmed required arched handle, see
  `mini-luna-spec.md`), or
- specific photographed pieces were simply built differently from the
  standard product, and the standard body never has one.

**Do not build `handle` or `attach_handle` speculatively — ship the
handle-less standard body first.** This is a deliberate change from an
earlier version of this document, which incorrectly said to build a baked
handle; that was written before the visual audit and contradicted what the
reference photo actually shows. Revisit once Rand confirms the real
construction.

## 8. Scale, orientation, pivot

- **Real-world scale: meters, 1 glTF unit = 1 meter.** Model Nova at its
  actual real dimensions once measured — do not scale to fit any
  placeholder's framing; the viewer auto-frames its camera from the loaded
  model's actual bounding box, so correct real-world scale is what makes
  framing work automatically.
- **Y-up** (glTF standard), bag facing **+Z** at identity transform (front
  of the bag — where a customer-facing logo/clasp would be — points down
  +Z with no per-model rotation correction applied in code).
- **Whole-model origin:** centered on the ground footprint (X=0, Z=0 at the
  bag's base center), Y=0 at the bag's lowest point resting flat.
- **`attach_strap` / `attach_chain` origin:** each empty's local origin and
  rotation is exactly where a strap/chain GLB's own root node gets parented
  with an **identity local transform** (no corrective offset applied at
  runtime) — place these empties at where a strap/chain should visually
  begin (typically the top side seams), oriented so "up" in the empty's
  local space matches "up" along the strap's natural drape.
- Apply all transforms before export — no un-applied rotation/scale on any
  mesh.

## 9. GLB export settings

- **`.glb`** (binary glTF 2.0), one file, no external texture/bin
  references, textures embedded.
- **Draco geometry compression: required.** Position 14 bits, Normal 10
  bits, UV 12 bits, Generic (vertex colour, if used) 8 bits. **Do not use
  Meshopt** — the viewer's decoder is Draco-only; a Meshopt-only file will
  fail to load.
- Texture compression: prefer KTX2/Basis Universal if your pipeline
  supports it; otherwise embedded PNG (alpha) or JPEG (opaque) is an
  acceptable first pass — note KTX2 as a follow-up, don't block on it.
- **No embedded cameras or lights** — the viewer supplies its own. Confirm
  your exporter's camera/light inclusion is switched off.
- One material per zone, none shared, no unused/orphaned materials in the
  file.

## 10. Triangle and texture targets

| Part | Triangle budget | Texture resolution | File size |
|---|---|---|---|
| Body (`bag_body_primary` + `bag_body_secondary` combined, no handle in this submission) | 12,000–18,000 | 1024×1024 per body-zone material (2048×2048 only if genuinely needed) | — |
| `hardware` | under 800 | 512×512 | — |
| Whole body GLB (geometry + all embedded textures, compressed) | — | — | **under 3MB** |

These are load-time/mobile-performance targets (customers arrive from
Instagram, mostly on phones), not hard technical ceilings the app enforces
— exceeding by a small margin for real necessary detail is a judgment
call; exceeding by multiples is not.

## 11. Exact delivery filename and path

```
public/models/arcubed/bodies/nova/nova-body-v1.glb
```

This is the **minimum viable delivery** — it alone is enough to link Nova's
default (Regular) size to the real 3D customizer. Do not deliver into
`public/models/arcubed/` directly — that folder is for already-approved,
already-linked assets only (see §12). Deliver the candidate file to
whoever is coordinating (e.g. a scratch/staging location outside the
public folder), not committed straight into the tree.

### Size variants (later, not required for the first submission)

Nova has three confirmed sizes: Regular (default), Medium (+5 JOD), Large
(+5 JOD) — no real dimensions supplied for Medium/Large yet, so don't
model those until real measurements exist. When they do, each size is its
own body GLB, same node contract as above:

```
public/models/arcubed/bodies/nova/nova-medium-body-v1.glb
public/models/arcubed/bodies/nova/nova-large-body-v1.glb
```

### Strap and chain (shared catalog, not Nova-specific — needed once, used by all four products)

```
public/models/arcubed/straps/strap-crochet-strap-v1.glb
public/models/arcubed/chains/chain-silver-tone-chain-v1.glb
public/models/arcubed/chains/chain-gold-tone-chain-v1.glb
```

These attach to any product's `attach_strap`/`attach_chain` points, Nova's
included — they are not separate per-product files. No reference
photography exists for any of the three yet (§2); do not invent it.

## 12. Ingest workflow — what happens after you deliver a candidate

This is the exact, already-built pipeline your file goes through. **No
step can be skipped, and no unvalidated file can become customer-facing —
there is no path that bypasses this.**

```
incoming Nova GLB (kept outside public/, not committed)
  → validator (src/lib/three/validate-model.ts, run via /dev/3d-inspector)
  → inspector (visual check — rotate/zoom/colour/two-tone, dev strap/chain attach)
  → node / material / scale QA (qa-checklist.md items 1–14)
  → mobile performance QA (file size, texture size, throttled-network load check)
  → final optimized GLB (re-validated after any fix — a re-export can silently
    reintroduce a problem the first pass caught)
  → moved into public/models/arcubed/bodies/nova/nova-body-v1.glb
  → model_assets row created (is_placeholder = false, version = 1, active)
  → product_models row created (links the product_id + this model_assets row)
  → Nova activates for 3D automatically — no separate "publish" step, no
    code deploy, no feature flag
  → storefront serves the real 3D customizer for Nova
  → photography/illustrative fallback remains exactly what's used for
    every OTHER product (and for Nova itself if the model ever fails to
    load) — untouched by this
```

A model with **any validator error** does not proceed past that step,
regardless of how it looks visually. Warnings are judgment calls; errors
are not.

## 13. Store behavior until this ships

Confirmed against the live system, not assumed: zero `product_models` rows
exist today, and the only `model_assets` rows in the database are
`is_placeholder = true` dev-test geometry that is structurally excluded
from ever reaching a real product (never linked via `product_models`, and
excluded from public reads by RLS regardless). **Nova is using real
photography (and the illustrative fallback where no photo is mapped yet)
right now, and will continue to until a real model passes every item below
and is linked** — this is the existing, already-correct behavior, not
something that needs to change.

## 14. Acceptance checklist

All must pass, checked against the file **actually loaded in
`/dev/3d-inspector`** (or a neutral glTF viewer where noted) — not just
your DCC tool's preview:

- [ ] Loads with no console errors, no unhandled rejections
- [ ] All three required nodes present, exact names: `bag_body_primary`,
      `bag_body_secondary`, `hardware`
- [ ] No handle geometry present unless Rand has confirmed the real
      construction requires one (see §7) — a standard submission passes
      without it
- [ ] `attach_strap` and `attach_chain` present, correctly placed/oriented
- [ ] `bag_body_primary` and `bag_body_secondary` recolour **completely
      independently** — changing one never visibly affects the other
- [ ] At least one metallic-yarn colourway tested (a stand-in Gold/Silver
      hex is fine) and does not look chrome or plastic
- [ ] A real or placeholder strap/chain file attaches correctly at both
      points, correct position/angle/scale
- [ ] Hardware reads as metal under the viewer's actual lighting
- [ ] No broken/inverted normals, no flipped geometry
- [ ] No excessive draw calls (materials consolidated where possible)
- [ ] No embedded cameras or lights
- [ ] Real-world meter scale confirmed; Y-up; front faces +Z at identity
- [ ] Rotation feels natural — no clipping through the ground plane, pivot
      reads as the bag's own visual center
- [ ] Two-tone selector: selecting a two-tone colour updates
      `bag_body_secondary` only; "None" leaves it at its authored default,
      not broken/uncoloured
- [ ] Triangle count 12,000–18,000 (body, no handle), hardware under 800;
      textures at or under 1024×1024 (2048×2048 only if truly needed) for
      body zones, 512×512 for hardware
- [ ] Whole GLB under 3MB compressed; real load-time check on a throttled
      "Fast 3G" connection, not just the file-size number
- [ ] Deliberately-broken-load test: point a test row at a 404/malformed
      file and confirm the product page falls back cleanly to
      photography/illustrative fallback — no blank canvas, no stuck
      spinner, no uncaught error

Only once every box is checked does this stop being a candidate and become
`nova-body-v1.glb`.
