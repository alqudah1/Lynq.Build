# Vault — 3D Production Spec

Base price 50 JOD. Single-tone (no two-tone support). Confirmed real colour
names: Light Brown, Olive Green, Brown (see
`clients/Arcubed_Label/01_Client_Info/product-matrix.md`) — none metallic,
so the regular-yarn material preset applies to every currently-known Vault
colourway (revisit if a metallic Vault colour is ever confirmed).

**Correction (visual geometry audit) — Vault is NOT handle-free.** An
earlier version of this spec said "no handle." That was wrong. Real
photography confirms Vault has a **built-in horizontal HAND-SLOT cut through
a raised top band — the band either side of the cut is the grip, and nothing
rises clear of the body. This is part of Vault's identity** (see
`docs/3d-production/PRODUCT-GEOMETRY-MAP.md`, Vault §2, for the full
finding). "No handle" in the earlier spec described Vault having no
*customer-selectable/swappable* handle option (still true — see §2 below)
— it did not mean the physical bag has no handle-like feature at all. It
does. **This geometry is required, confirmed, and must be modeled
accurately as part of the Vault body — never as a detachable handle, never
as a shared handle GLB, never as an `attach_handle` accessory.**

**CONFIRMED FROM PHOTOS:** a **rectangular / boxy structured bag that is
TALLER THAN WIDE**; dense, chunky, large-loop crochet in thick yarn, matte
and soft (dark brown on the reviewed reference).

**Correction — proportions were reversed.** An earlier version of this spec
said Vault's "width [is] greater than height." **That is wrong. Vault is
taller than wide** (contradiction C3 in `PRODUCT-GEOMETRY-MAP.md`). Do not
model a broad, wide body. The exact ratio is not established — "taller than
wide" is a direction, not a measurement.

**UNRESOLVED — do not model these from the superseded text.**

- ~~**Opening shape.**~~ **RESOLVED — a horizontal slot through a raised
  band.** Full-resolution inspection of DSC05790 and DSC04876 settles C4.
  Model it as a hole through the top band, not as a separate arch and not as
  a tube. Both frames agree across two colourways. (An earlier pass in the
  same round mistakenly called it an arch, reading the EXIF-rotated frame —
  see `PRODUCT-GEOMETRY-MAP.md` §0.3.)
- ~~**Whether the opening and the handle are one feature or two.**~~
  **RESOLVED — one feature.** The band *is* the handle; the slot *is* the
  opening.
- **Base.** The earlier version said "a broad, relatively flat base with
  rounded lower corners." "Broad" is inconsistent with a taller-than-wide
  body, so this is downgraded. A flat base is plausible for a structured
  bag but is **not confirmed**.
- **Corner softness.** "Softened/rounded sides" is not contradicted but is
  not re-confirmed either — treat corner radius as a modeling judgment
  inside a boxy rectangular envelope, not a confirmed value.

**Do not reuse Nova geometry for any part of Vault** — the two are visually
confirmed as different shapes.

Read `material-spec.md` and `export-checklist.md` first — this spec only
covers what's specific to Vault.

## 1. Required node names

```
bag_body_primary
hardware
```

**No `bag_body_secondary`** — do not include it. An extra
`bag_body_secondary` node on a single-tone product isn't harmful to the
viewer (nothing selects it without a two-tone colour being chosen, since
Vault has no `is_two_tone` colours in its catalog), but it's dead weight in
the file and signals the wrong intent — leave it out.

**The integrated hand-opening/handle geometry is required — but as its own
named `handle` node is OPTIONAL, not mandatory.** You may either:

- sculpt it as part of `bag_body_primary`'s single mesh (simplest, correct
  if it doesn't need an independently-editable material), **or**
- give it its own `handle` node (same name/vocabulary as Nova's baked
  handle and Mini Luna's arched handle — see `model-contract.ts`), if you
  want to treat its material/wrap independently for QA or a different
  roughness value than the surrounding body.

Either approach is acceptable; the validator does not require the separate
node (`PRODUCT_PART_REQUIREMENTS.vault.handle` is `false` for exactly this
reason — see `model-contract.ts`'s comment on that value). What is *not*
acceptable is omitting the feature entirely, or building it as a swappable
component (see §2).

## 2. Required attach points

```
attach_strap
attach_chain
```

**Still no `attach_handle`.** Vault's confirmed handle/opening is a fixed,
built-in part of the body construction — not a customer-selectable or
swappable option (matching the confirmed customization list: straps and
chains are swappable, handle is not, for any of the four products today).
Do not build it as a separate component GLB or attach point.

## 3. Which parts must be independent meshes

`bag_body_primary` and `hardware` must be separate meshes/nodes. The
integrated handle/opening (§1) is not required to be a separate mesh — it
may be sculpted as geometry within `bag_body_primary` — but if you do give
it its own `handle` node, treat it with the same rigor as any other named
part: its own node, not merged back into `bag_body_primary` inconsistently
across the file.

## 4. Which parts must have independent materials

`bag_body_primary` needs its own material (the primary colour-driven zone
on Vault, which is also where the integrated handle/opening lives unless
split out). `hardware` needs its own fixed metal material per
`material-spec.md`. If the handle/opening is split into its own `handle`
node, it needs its own material too — likely the same regular-yarn preset
as the body, since it's a wrapped-crochet feature per the confirmed visual
finding, not a different material category.

## 5. Which parts can be static

`hardware` — fully static, no runtime logic touches it. The handle/opening
(whether part of `bag_body_primary` or its own `handle` node) is also
static — nothing in the current customizer swaps or recolours it
independently.

## 6. Origin/pivot requirements

Same convention as Nova §6: whole-model origin centered on the ground
footprint, Y=0 at the base resting point. `attach_strap`/`attach_chain`
placed and oriented to match wherever the real strap/chain attachment
points are on Vault's actual construction — coordinate with
`strap-spec.md`/`chain-spec.md`.

## 7. Orientation requirements

Y-up, front of the bag facing +Z at identity transform — same convention as
every other product (see `nova-spec.md` §7 for why this matters to the
viewer's default camera angle).

## 8. Real-world scale/unit requirements

Meters, 1 unit = 1 meter. See the README's scale/camera-retuning note.

## 9. UV requirements

Non-overlapping UVs for `bag_body_primary`, seams along natural construction
seams where practical. Simpler than Nova's requirement here — only one
body-colour zone to worry about.

## 10. Texture requirements

`bag_body_primary`: albedo, normal, roughness per `material-spec.md`.
`hardware`: per the metal preset. Resolution targets per §13 below.

## 11. Normal/roughness/metalness requirements

Regular-yarn preset for `bag_body_primary` (no confirmed Vault colourway is
metallic today). Metal preset for `hardware`.

## 12. Polygon budget target

Body (primary + hardware combined, including the integrated handle/opening
geometry whether or not it's split into its own node): **8,000–14,000
triangles** — this range already assumed a moderate level of body detail
and doesn't need raising just because the handle/opening is now explicitly
confirmed as required geometry (it was always going to be part of the
body's triangle count either way; this correction changes what the geometry
must depict, not how many polygons it's allowed).

## 13. Texture resolution target

`bag_body_primary`: **1024×1024** default, 2048×2048 only if crochet detail
doesn't read at 1024. `hardware`: **512×512**.

## 14. Mobile performance target

Body GLB total: **under 2.5MB compressed** (Draco + KTX2 where available) —
slightly under Nova's budget given the simpler part set.

## 15. GLB export settings

Follow `export-checklist.md` in full.

## 16. Draco/Meshopt recommendation

Draco. Not Meshopt (viewer doesn't decode it).

## 17. How to test the model in `/dev/3d-inspector`

Same procedure as `nova-spec.md` §17 — load `/dev/3d-inspector`, paste the
candidate URL, set kind=`body` and product=`vault`, Load & Validate. No
temporary rows/edits needed. Vault has no two-tone selector to exercise —
skip that part of `qa-checklist.md`'s two-tone item, note it N/A for Vault.

## 18. Common failure cases

- **Bag doesn't recolour at all:** `bag_body_primary` node name misspelled
  or the mesh's material wasn't actually assigned that node name — recheck
  against `model-contract.ts`.
- **Looks plastic:** roughness too low / missing normal map — see
  `material-spec.md`.
- **Strap/chain attaches misaligned:** `attach_strap`/`attach_chain`
  transform doesn't match the component file's origin assumption — a
  cross-file coordination issue, see §6.
- **A stray `bag_body_secondary` node causes confusion during QA:** remove
  it — Vault shouldn't have one (see §1). (A `handle` node, by contrast, is
  now expected/acceptable if you chose to split the integrated handle/
  opening out — see §1's correction. Don't remove a legitimate `handle`
  node by following old guidance; this file previously said to.)
- **Missing or unconvincing integrated handle/opening:** the visually
  confirmed feature (thick wrapped crochet around a large built-in
  opening) isn't present, or reads as a plain hole/gap with no crochet
  wrap — re-check against `PRODUCT-GEOMETRY-MAP.md`'s Vault finding; this
  is identity-defining for Vault, not an optional detail.
- **Guessing the proportion:** Vault's width:height is **UNRESOLVED**. The
  round-3 summary says taller than wide; direct tracing of DSC04876 and
  DSC05790 (with the archive's 90° frame rotation corrected) says markedly
  wider than tall. Resolve this from the archive before modelling — do not
  pick a side. See `PRODUCT-GEOMETRY-MAP.md` §0.3.
- **Building an arch instead of a slot:** nothing on Vault rises clear of
  the body. A free-standing loop is the wrong feature — that is Mini Luna.

## 19. Acceptance criteria before this model can be marked production-ready

All of `qa-checklist.md` (two-tone item marked N/A), plus:

- [ ] `bag_body_primary` recolours correctly across at least 3 test hex
      values in `/dev/3d-test`
- [ ] The body's width:height was resolved from the archive before
      modelling — **not** chosen by the modeler (see §18 / C3)
- [ ] The grip is a **horizontal slot cut through a raised top band**, not
      an arch rising clear of the body
- [ ] The integrated arch handle with wrapped crochet is
      present and visually matches the confirmed photo reference — whether
      built into `bag_body_primary` or split into its own `handle` node
- [ ] Strap and chain both attach correctly at `attach_strap`/`attach_chain`
- [ ] Hardware reads as metal under the viewer's actual lighting
- [ ] No `bag_body_secondary` node present in the file
