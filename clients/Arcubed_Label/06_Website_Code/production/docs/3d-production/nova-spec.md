# Nova — 3D Production Spec

Base price 55 JOD. Two-tone supported. Currently the only product with a
confirmed real two-tone colourway name ("Silver & Gold" — see
`clients/Arcubed_Label/01_Client_Info/product-matrix.md`).

**Geometry checklist — see `docs/3d-production/PRODUCT-GEOMETRY-MAP.md`,
Nova §2 for the authoritative row-by-row status.** Summary:

**CONFIRMED FROM PHOTOS:** a **compact bag with a rounded / oval-ish
body** — not angular, not boxy; **thick, visibly textured crochet** in a
metallic ribbon-like yarn on the Gold colourway, which must read as
metallic *thread*, never as smooth plastic or chrome.

**UNRESOLVED — corrected this round.** An earlier version of this spec
described Nova as "a low, wide clutch/compact silhouette, wider than tall,
rounded trapezoid/soft oval profile," with "a top edge narrower than the
body's widest point" and "a broad curved/oval base." That came from an
earlier review round. **A later review of the same Gold Nova reference read
it as compact and rounded/oval-ish, which does not establish a
markedly-wider-than-tall clutch proportion** (contradiction C1 in
`PRODUCT-GEOMETRY-MAP.md`). Nova's **width:height ratio, top-opening
shape, and base shape are therefore all UNRESOLVED** — do not model them
from the superseded description above, and do not model a "broad" base or
a trapezoid profile on its authority. Wait for the front elevation, side
elevation, top-down, and base shots listed in `PRODUCT-GEOMETRY-MAP.md`
Nova §9.

**Handle is explicitly unresolved — do not assume every Nova has one.** The standard/reference Gold Nova photo
does not show a tall integrated handle, even though some folders are named
"...with Handle." Build the standard body without a handle; keep the
question open until Rand confirms the real construction. `handle` is
**not** a required node in Nova's part requirements
(`PRODUCT_PART_REQUIREMENTS.nova` in `model-contract.ts`) for exactly this
reason — requiring it would incorrectly reject a standard-construction
submission.

Read `material-spec.md` and `export-checklist.md` first — this spec only
covers what's specific to Nova.

## 1. Required node names

```
bag_body_primary
bag_body_secondary
hardware
```

`handle` is **not required** — see the intro above and §2. Do not add it
speculatively to the standard body; the visually-confirmed reference photo
shows no handle.

## 2. Required attach points

```
attach_strap
attach_chain
```

**Neither `handle` nor `attach_handle` should be built into the standard
Nova submission.** Nova's handle status is explicitly unresolved: the
visual audit confirmed the standard/reference Gold Nova photo shows no
tall integrated handle, while some client-supplied photography shows Nova
variants "with Handle." This could mean handle is a real customer-
selectable option (a future revision would then need `attach_handle` and a
separate swappable handle component GLB per `strap-spec.md`'s pattern), or
that a fixed baked `handle` node belongs on the standard body after all
(matching `mini-luna-spec.md`'s now-confirmed arched handle pattern), or
that specific photographed pieces were simply built differently from the
standard product. **Do not resolve this by guessing — build the standard
body without any handle geometry, and revisit once Rand confirms the real
construction.** In particular, **a folder name is not geometric evidence**:
"Gold Nova with Handle" tells you what someone typed into Drive, not what
the bag is made of. Only a photograph of the bag or a direct statement from
Rand can settle this.

## 3. Which parts must be independent meshes

`bag_body_primary`, `bag_body_secondary`, and `hardware` must each be a
**separate mesh** (separate node in the scene graph), even where they
share an edge or sit flush against each other. The viewer looks each one up
by name individually — merging any of them into a single mesh makes that
merged part impossible to address (no independent recolour, no independent
identification for QA). **If a future revision does add handle geometry**
(only once Rand confirms the real construction — see intro/§2), it must
follow the same rule: its own separate mesh, not merged into
`bag_body_primary`.

## 4. Which parts must have independent materials

`bag_body_primary` and `bag_body_secondary` **must** use two separate
material slots (not the same material with a vertex-colour split, not a
shared material) — the viewer clones and recolours each by name
independently at runtime (`recolorNamedMesh` in `BagModel.tsx`). `hardware`
needs its own material too, per the metal preset in `material-spec.md` —
not customer-colour-driven, give it a correct, sensible fixed material
rather than leaving it defaulted.

## 5. Which parts can be static

`hardware` is the only part expected to be fully static (no runtime colour
or swap logic touches it at all) for the current standard submission (no
handle geometry).

## 6. Origin/pivot requirements

- Whole-model origin: centered on the ground footprint (X=0, Z=0 at the
  bag's base center), Y=0 at the bag's lowest point resting on a flat
  surface (matches `ContactShadows`' ground plane at y=-0.62 in
  `Canvas3D.tsx` once the model is scaled/placed to actually sit on it —
  see the README's real-world-scale note about camera retuning).
- `attach_strap`/`attach_chain`: each empty node's own local origin/rotation
  is what a strap/chain component's mesh is parented at with an identity
  local transform — place these empties exactly where a strap/chain should
  visually begin (typically the top side seams), oriented so "up" in the
  empty's local space matches "up" along the strap's natural drape
  direction. Coordinate this with whoever builds the strap/chain files
  (`strap-spec.md`/`chain-spec.md`) — the two must agree on origin
  convention or the swap will look attached at a wrong angle even though it
  technically loads.

## 7. Orientation requirements

Y-up, bag facing +Z (front of the bag, where a customer-facing logo/clasp
would be, points down the positive Z axis) when the model's own root
transform is identity. This matters because the viewer's camera starts at
`position: [0, 0.3, 2.6]` — a front-on start view assumes the front of the
bag faces the camera at that position without any per-model rotation
correction in code.

## 8. Real-world scale/unit requirements

Meters, 1 unit = 1 meter — see the README's scale section, including the
camera-retuning caveat. Model Nova at its actual real dimensions once
measured; do not scale to fit the placeholder's ~1-unit framing.

## 9. UV requirements

- Non-overlapping UVs per material zone (standard requirement for baking
  AO/normal maps without artifacts).
- `bag_body_primary` and `bag_body_secondary` each need their own UV space
  (expected, since they're separate materials/meshes per §3–4) — no shared
  atlas between the two zones is required, but is fine if your pipeline
  naturally produces one, as long as each zone's texture region doesn't
  bleed into the other's.
- Seams placed along natural construction seams (stitch lines, side panels)
  where possible — both for texture-stretch reasons and because visible UV
  seams read less obviously wrong when they coincide with a seam a real
  crocheted bag would actually have.

## 10. Texture requirements

Per `material-spec.md`'s channel breakdown, per zone (`bag_body_primary`,
`bag_body_secondary`, `hardware`):

- Albedo/base colour, normal, roughness (map or value) at minimum for the
  two body zones; hardware per the metal preset in `material-spec.md`.
- Resolution target: **1024×1024** per body-zone material as the default
  target, up to **2048×2048** only if the crochet detail genuinely doesn't
  read at 1024 — don't default to 2048 "to be safe." `hardware`:
  **512×512** is normally sufficient given its smaller screen footprint.

## 11. Normal/roughness/metalness requirements

Follow `material-spec.md` exactly: regular-yarn preset for
`bag_body_primary`/`bag_body_secondary` unless that specific colourway is
metallic yarn (Gold, Silver, Rose Gold, or the two-tone "Silver & Gold"
combination — use the metallic-yarn preset for whichever zone(s) carry a
metallic colour; visually confirmed — see intro), hardware per the metal
preset.

## 12. Polygon budget target

Body (primary + secondary combined, no handle in the standard submission):
**12,000–18,000 triangles**. Hardware: **under 800 triangles** (small
pieces, geometry doesn't need to carry fine detail — let the normal map do
that work). If a future revision adds confirmed handle geometry, budget it
similarly to Mini Luna's handle allowance in `mini-luna-spec.md` §12 —
revisit this number then, don't pad it preemptively now.

## 13. Texture resolution target

Per §10 above: 1024×1024 default per body zone (2048×2048 only if needed),
512×512 for hardware.

## 14. Mobile performance target

Body GLB total (geometry + all embedded textures, Draco + KTX2 where
available): **under 3MB compressed**. See `export-checklist.md`'s budget
methodology for the reasoning.

## 15. GLB export settings

Follow `export-checklist.md` in full — nothing Nova-specific beyond what's
already covered above.

## 16. Draco/Meshopt recommendation

Draco, per `export-checklist.md`. Do not use Meshopt — the viewer doesn't
decode it yet.

## 17. How to test the model in `/dev/3d-inspector`

Load `/dev/3d-inspector` locally (`npm run dev`), paste the candidate
file's URL (host it anywhere reachable over HTTP during testing — a local
static path under `public/` works fine), set **Asset kind** to `body` and
**Validate against product** to `nova`, then Load & Validate. No temporary
database rows or code edits needed — this route is built exactly for
testing an unlinked candidate. It shows the validation report (errors/
warnings against Nova's contract) side-by-side with the live 3D view
(rotate/zoom/colour/two-tone, with the dev strap/chain attached for an
attach-point sanity check) through the same loader the real customizer
uses. See `ingest-workflow.md` for the full validate → QA → ship procedure.

## 18. Common failure cases

- **Whole bag recolours as one block, secondary zone never changes:**
  `bag_body_primary` and `bag_body_secondary` share a material instance in
  the source file (§4) — split them.
- **Bag looks correctly coloured but plastic/shiny:** roughness too low or
  missing normal map on the body materials — see `material-spec.md`.
- **Metallic colourway looks like a chrome ball, not thread:** metalness
  too close to 1.0 and/or roughness too low — use the metallic-yarn preset
  values, not a generic "metal" preset.
- **Strap/chain attaches at a visibly wrong angle or position:** the
  `attach_strap`/`attach_chain` empty's transform doesn't match the
  assumption the strap/chain file's own origin was built against — this is
  a coordination problem between files, not a viewer bug; re-check §6.
- **Uncertain whether to include a handle at all:** don't guess — build the
  standard body without one (see intro/§2) until Rand confirms Nova's real
  handle construction.
- **Console warning about a missing node name on load:** exact string
  mismatch against `model-contract.ts` — recheck spelling/casing.

## 19. Acceptance criteria before this model can be marked production-ready

All of `qa-checklist.md`, plus, specific to Nova:

- [ ] `bag_body_primary` and `bag_body_secondary` recolour completely
      independently in `/dev/3d-test`'s colour and two-tone selectors
- [ ] At least one metallic-yarn colourway (e.g. a stand-in Gold/Silver hex
      during testing) has been checked against the metallic-yarn preset and
      does not look chrome/plastic
- [ ] No handle geometry present unless Rand has confirmed the real
      construction requires one (see intro/§2) — a standard submission
      passes without it
- [ ] Strap and chain both attach correctly at `attach_strap`/`attach_chain`
      using at least one real or placeholder component file
- [ ] Hardware reads as metal, not painted plastic, under the viewer's
      actual lighting (not just your DCC tool's viewport)
