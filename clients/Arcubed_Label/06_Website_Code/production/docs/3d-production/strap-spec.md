# Strap Component — 3D Production Spec

One strap GLB is one `public.straps_handles` row with `type = 'strap'` and
a `model_asset_id` pointing at it.

**Confirmed real option: "Crochet Strap" (+5 JOD), offered on all four
products** (see `clients/Arcubed_Label/01_Client_Info/product-matrix.md`).
This is currently the only confirmed strap name — the catalog row already
exists (`straps_handles.name = 'Crochet Strap'`), but it has no
`model_asset_id` yet: **no GLB has been produced for it.** This spec is
what that file must follow when it's built. Its name being crochet is a
real material cue for `material-spec.md`'s regular-yarn preset (this strap
is fabric, not metal — unlike the two chain options).

Straps are shared across all four products structurally (every product's
`attach_strap` node expects the same component contract), and Crochet
Strap is in fact linked to all four (`product_straps_handles`) — a single
GLB, once produced, is the strap for Nova, Vault, Mini Luna, and Loco
alike, not four separate files.

Read `material-spec.md` and `export-checklist.md` first.

## 1. Required node names

```
strap
```

One root mesh, named exactly `strap` (`COMPONENT_NODE_NAMES.strap` in
`model-contract.ts`).

## 2. Required attach points

None — a strap file doesn't define its own attach points; it gets
*attached to* a body's `attach_strap` node. See §6 for how the strap's own
origin must relate to that.

## 3. Which parts must be independent meshes

N/A in the usual sense — a strap is typically one continuous mesh. If a
strap design has genuinely distinct sub-parts needing independent materials
(e.g. a fabric strap with a separate metal end-cap), those sub-parts should
be children of the `strap` root node with their own material assignments,
not merged into one mesh with a multi-material split — same reasoning as
the body specs' "why separate meshes" logic, in case any sub-part ever needs
independent identification.

## 4. Which parts must have independent materials

Whatever materials the design actually needs — a plain fabric/yarn strap
needs one (regular-yarn preset, `material-spec.md`); a strap with metal
hardware end-caps needs that as a second material (metal preset). Straps are
**not currently colour-linked to the body's colour selection** — the
customizer doesn't pass a strap colour override, so a strap's material
colour is whatever's authored into the file, not runtime-recoloured. If
straps should eventually match/complement the selected body colour, that's
a future customizer feature, not something to solve in the asset today.

## 5. Which parts can be static

The whole strap is static once attached — no runtime colour or geometry
changes apply to it (see §4).

## 6. Origin/pivot requirements

The strap's root node's local origin is what gets placed exactly at the
body's `attach_strap` empty with an **identity local transform** (no
additional offset/rotation applied at attach time — see `AttachedPart` in
`BagModel.tsx`, which portals the loaded scene directly onto the attach
node). Practically: model the strap so that if you placed its origin at
world origin, oriented per §7, it would sit correctly relative to where
`attach_strap` sits on the body. This requires coordinating with whichever
body spec (`nova-spec.md` etc.) you're targeting — the body author defines
where `attach_strap` is and which way it faces; the strap author must build
to match that, not the other way around. If a strap is meant to work across
multiple products' bodies, its origin convention must be consistent with
all of their `attach_strap` placements — agree this convention before
modeling multiple bodies in parallel with strap work.

## 7. Orientation requirements

Match the body's `attach_strap` node orientation convention (§6) — "up"
along the strap in the strap file's local space should equal "up" in the
attach node's local space once parented, so the strap drapes/sits correctly
without needing a corrective rotation baked into either file.

## 8. Real-world scale/unit requirements

Meters, matching whatever body/bodies this strap is meant to attach to.

## 9. UV requirements

Non-overlapping UVs, standard requirement — same as body specs.

## 10. Texture requirements

Per `material-spec.md`'s regular-yarn (or metal, for hardware end-caps)
channel breakdown.

## 11. Normal/roughness/metalness requirements

Regular-yarn preset for fabric/yarn straps; metal preset for any hardware
sub-parts. Follow `material-spec.md` exactly — do not invent a third preset
for straps.

## 12. Polygon budget target

**1,500–3,000 triangles.** A strap is a small, simple silhouette — it
should not approach body-model polygon counts.

## 13. Texture resolution target

**512×512** per material. A strap rarely fills enough of the frame to
justify more.

## 14. Mobile performance target

**Under 1MB compressed** per strap GLB (geometry + textures, Draco + KTX2
where available).

## 15. GLB export settings

Follow `export-checklist.md` in full.

## 16. Draco/Meshopt recommendation

Draco. Not Meshopt.

## 17. How to test the model in `/dev/3d-inspector`

Load `/dev/3d-inspector`, paste the candidate strap's URL, set **Asset
kind** to `strap`, Load & Validate. The inspector automatically attaches
your candidate strap onto the dev placeholder body's `attach_strap` node so
you can check alignment (position/angle/scale) visually alongside the
validation report — no temporary database rows or code edits needed.

## 18. Common failure cases

- **Strap doesn't appear at all:** root node isn't named exactly `strap`,
  or the body's `attach_strap` node is missing/misnamed — check both files.
- **Strap appears at the wrong position/rotated wrong:** origin/orientation
  mismatch between the strap file and the body's `attach_strap` convention
  — see §6–7. This is the most common real-world failure for a swappable
  component and is almost always a coordination issue, not a viewer bug.
- **Strap looks correct alone but wrong scale relative to the bag:**
  confirm both files are genuinely at the same real-world meter scale (§8)
  — a strap modeled at the wrong scale will still "attach" without error,
  it'll just look proportionally wrong.

## 19. Acceptance criteria before this model can be marked production-ready

All of `qa-checklist.md`'s applicable items, plus:

- [ ] Root node is named exactly `strap`
- [ ] Attaches correctly (position, rotation, scale) on every body it's
      meant to be selectable for
- [ ] Material reads correctly under the viewer's actual lighting (not just
      a DCC tool viewport)
- [ ] Under the polygon/texture/file-size budgets in §12–14
