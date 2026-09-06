# Chain Component — 3D Production Spec

One chain GLB is one `public.straps_handles` row with `type = 'chain'` and
a `model_asset_id` pointing at it.

**Two confirmed real options, both offered on all four products** (see
`clients/Arcubed_Label/01_Client_Info/product-matrix.md`):

| Name | Price | Catalog row | GLB |
|---|---|---|---|
| Silver Tone Chain | +5 JOD | exists (`straps_handles.name = 'Silver Tone Chain'`) | not produced yet |
| Gold Tone Chain | +5 JOD | exists (`straps_handles.name = 'Gold Tone Chain'`) | not produced yet |

Two separate GLBs are needed — same geometry contract, different finish
(silver-tone vs. gold-tone metal, per `material-spec.md`'s metal preset —
adjust base colour/albedo per tone, keep roughness/metalness in the same
metal range for both). **Rand does not currently have dedicated product
photography for either chain** — see `docs/photo-asset-map.md`'s
cross-cutting notes. Do not invent or substitute chain reference imagery;
build from real reference once it exists, and flag the gap if asked to
proceed without it.

Chains are structurally the same attachment pattern as straps
(`strap-spec.md`) but are real metal, not fabric/yarn — read
`material-spec.md`'s chain/hardware section, not the yarn section, for
material values.

## 1. Required node names

```
chain
```

One root node, named exactly `chain` (`COMPONENT_NODE_NAMES.chain` in
`model-contract.ts`). This can be (and usually should be) a *group* of
individual link meshes rather than one continuous mesh — see §3 — as long
as the top-level node the group hangs from is named `chain`.

## 2. Required attach points

None of its own — attaches to a body's `attach_chain` node. See §6.

## 3. Which parts must be independent meshes

Unlike a strap, a chain's visual believability depends heavily on real
articulated link geometry (see `material-spec.md`'s note: "chains read as
fake almost immediately when the geometry doesn't actually articulate").
Individual links do **not** need to be separate named/addressable nodes the
way body zones do (nothing in the app selects an individual link by name) —
but they should be genuinely separate link geometry (modeled as a repeating
chain unit, not a single tube faked to look linked via texture), grouped
under the `chain` root node.

## 4. Which parts must have independent materials

Typically one material for the whole chain (the metal preset from
`material-spec.md`). If a chain design mixes materials (e.g. metal links
with a fabric-wrapped section), split those into separate materials the
same way a strap's hardware end-cap would be (see `strap-spec.md` §3–4).

## 5. Which parts can be static

The whole chain is static once attached — same as straps, no runtime colour
override currently applies to it.

## 6. Origin/pivot requirements

Same convention as `strap-spec.md` §6: the `chain` root node's local origin
is placed at the body's `attach_chain` empty with an identity local
transform. Coordinate origin/orientation convention with whichever body
spec(s) this chain is meant to attach to.

## 7. Orientation requirements

Match the body's `attach_chain` node orientation convention — same
reasoning as `strap-spec.md` §7.

## 8. Real-world scale/unit requirements

Meters, matching the target body/bodies. Get individual link scale right
relative to the bag — an oversized or undersized link is one of the fastest
ways a chain reads as fake.

## 9. UV requirements

Non-overlapping UVs. If links repeat identical geometry, a single shared UV
layout reused per link instance (rather than unique UVs per every link) is
both acceptable and the more efficient approach — this is standard practice
for repeating hardware geometry and does not need unique per-link texture
detail to look correct.

## 10. Texture requirements

Per `material-spec.md`'s chain/hardware channel breakdown — albedo,
roughness, optional normal map for wear/machining detail.

## 11. Normal/roughness/metalness requirements

**Use the metal preset from `material-spec.md`, not the yarn preset** —
roughness 0.15–0.35, metalness 0.9–1.0. A chain is not fabric.

## 12. Polygon budget target

**2,000–5,000 triangles** for the full chain (all links combined) — higher
than a strap's budget (§12 in `strap-spec.md`) specifically because real
link geometry costs more than a strap's simpler silhouette; still small
relative to a body model.

## 13. Texture resolution target

**512×512** per material — a chain's individual links are small on screen
even when the overall chain length is significant; resolution needs don't
scale with link count.

## 14. Mobile performance target

**Under 1MB compressed** per chain GLB — same target as a strap, per
`export-checklist.md`'s component-GLB budget.

## 15. GLB export settings

Follow `export-checklist.md` in full.

## 16. Draco/Meshopt recommendation

Draco. Not Meshopt.

## 17. How to test the model in `/dev/3d-inspector`

Same procedure as `strap-spec.md` §17 — load `/dev/3d-inspector`, paste the
candidate URL, set kind=`chain`, Load & Validate. The inspector attaches
your candidate onto the dev placeholder body's `attach_chain` node
automatically.

## 18. Common failure cases

- **Chain doesn't appear:** root node isn't named exactly `chain`, or the
  body's `attach_chain` node is missing/misnamed.
- **Chain attaches at the wrong position/angle:** origin/orientation
  mismatch with the body's `attach_chain` convention — see §6–7, same
  coordination issue as straps.
- **Chain looks like a solid tube, not links:** geometry wasn't actually
  built as articulated links (§3) — no texture trick fixes this; it needs
  real link geometry.
- **Chain looks like grey plastic rope:** yarn material preset was used
  instead of the metal preset — see §11, this is the opposite mistake from
  a body material looking too metallic.

## 19. Acceptance criteria before this model can be marked production-ready

All of `qa-checklist.md`'s applicable items, plus:

- [ ] Root node is named exactly `chain`
- [ ] Individual links are real geometry, not a faked/textured tube
- [ ] Reads as metal (correct roughness/metalness) under the viewer's
      actual lighting
- [ ] Attaches correctly on every body it's meant to be selectable for
- [ ] Under the polygon/texture/file-size budgets in §12–14
