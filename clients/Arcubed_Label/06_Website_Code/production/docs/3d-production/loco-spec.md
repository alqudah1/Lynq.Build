# Loco — 3D Production Spec

Base price 65 JOD (the highest of the four — a pricing fact only, not a
confirmed statement about physical size; do not infer dimensions from it).
Single-tone (no two-tone support). Confirmed real colour names: Brown,
Burgundy — neither metallic.

**Correction (visual geometry audit) — Loco is not structurally identical
to Vault, despite an earlier version of this spec saying so.** That
statement was about the *required node list* coincidentally matching
Vault's shape (both single-tone, no swappable handle) before fringe was
confirmed — it was never a statement about the two products' actual
geometry, but it read that way and has caused exactly the confusion it
shouldn't have. **Real photography confirms Loco is a visually distinct
product from Vault: a short rectangular/fringed handbag with a very
distinctive fringe** — a **rectangular body**, with long hanging fringe
extending the model's overall visual height well beyond the body's own
height; an opening/handle built into the crocheted upper body (not a tall
external arch); thick matte yarn with chunky crochet rows in the upper
section (see
`docs/3d-production/PRODUCT-GEOMETRY-MAP.md`, Loco §2, for the full
finding). **Do not reuse Vault geometry simply because both use horizontal
hand openings — Loco requires its own body and fringe system.**

**Fringe is identity-critical, is a required part of the contract, and is
STRUCTURAL GEOMETRY — it may never be represented as a texture.** Long
individual hanging yarn / tassel strands run along the **lower and side
portions** of the body. This is not a texture effect, not a normal-map
trick, and not an optional flourish: it is the feature that makes Loco
recognisably Loco, and it must exist as real geometry with genuine depth
and separation between strands. See §1, §3, and §12 for the required node
and the permitted (and forbidden) production approaches.

**Correction — fringe extent.** An earlier version of this spec said fringe
"covers most of the lower outer body." The later review reads it as running
along the **lower and side portions** — the sides are added, but "most" is
not supported (contradiction C11 in `PRODUCT-GEOMETRY-MAP.md`). **Exact
coverage, and how far the fringe wraps around the sides, is UNRESOLVED.**

**UNRESOLVED and explicitly prohibited from being invented: strand count,
strand length, strand spacing, and how the strands are anchored to the
body** (a single band? multiple rows? worked into the crochet? individual
strands or grouped tassels?). None of this has been photographed. A modeler
who picks numbers here is fabricating the product's defining feature. The
required close-ups are listed in `PRODUCT-GEOMETRY-MAP.md` Loco §9.

The contract distinguishes three logically separate parts of Loco's body:
the structured upper crochet body (`bag_body_primary`), the integrated hand
opening (part of `bag_body_primary` — see §3, same reasoning as Vault's
non-mandatory-separate-node handle), and the fringe system (`fringe`, its
own required node — see below).

**Also UNRESOLVED, corrected this round:**

- **Body proportions.** The earlier text said "short… wide compact upper
  body." The later review confirms only "rectangular body" and gives no
  proportion (contradiction C12). The width:height ratio is not
  established.
- **Aperture shape.** Integration into the upper body is confirmed; the
  earlier "horizontal rectangular" reading of the aperture itself is not
  re-confirmed, so its precise shape is UNRESOLVED.
- **Hidden base geometry beneath the fringe.** Never seen — the body
  "appears rounded/soft" through the fringe, which is an appearance, not a
  shape. Do not fabricate it and **do not copy Vault's base**; see §8.

Read `material-spec.md` and `export-checklist.md` first.

## 1. Required node names

```
bag_body_primary
hardware
fringe
```

No `bag_body_secondary`, no `handle` node (the confirmed horizontal hand
opening is part of `bag_body_primary` — see §3, not a separate handle
feature the way Vault's or Mini Luna's are). `fringe` is **required** —
see the correction above.

## 2. Required attach points

```
attach_strap
attach_chain
```

No `attach_handle` — the hand opening is built into the body, not
swappable.

## 3. Which parts must be independent meshes

`bag_body_primary`, `hardware`, and `fringe` — separate meshes/nodes. The
integrated horizontal hand opening (confirmed built into the crocheted top
section) is part of `bag_body_primary`, not a separate mesh, the same
reasoning as Vault's optional-not-required handle split (`vault-spec.md`
§1) — Loco's opening is confirmed as *built into* the top section, not a
distinct structural addition the way Vault's wrapped-crochet opening or
Mini Luna's arched handle are, so no separate node is required for it here.

## 4. Which parts must have independent materials

`bag_body_primary` (the only colour-driven zone), `hardware` (fixed
metal), and `fringe` each need their own material. Fringe likely reuses
the regular-yarn preset (matte, per the confirmed finding — see §11) but
as its own material instance so its look can be tuned independently of the
structured upper body if needed (e.g. slightly different roughness for
loose hanging strands vs. the tightly-worked upper body).

## 5. Which parts can be static

`hardware`. `fringe` is static in the sense that nothing in the customizer
recolours it independently of `bag_body_primary` today, but see §12 for
why its *geometry* (not colour) still needs care — it must read as loose
hanging strands, not a rigid attached block.

## 6. Origin/pivot requirements

Whole-model origin centered on the ground footprint, Y=0 at the base
resting point. `attach_strap`/`attach_chain` placed/oriented to match
Loco's actual real attachment points — coordinate with
`strap-spec.md`/`chain-spec.md`.

## 7. Orientation requirements

Y-up, front of the bag facing +Z at identity transform.

## 8. Real-world scale/unit requirements

Meters, 1 unit = 1 meter. What is confirmed is a **rectangular body** with
fringe extending the model's overall visual height well beyond the body's
own height — a shape description, not a measurement. **Loco's width:height
ratio is UNRESOLVED** (the earlier "wide compact upper body" reading is
superseded — C12). Model actual measured dimensions once known; don't infer
size from price, from the shape description, or from the fringe's extent.

**The hidden base geometry beneath the fringe is UNRESOLVED, and this is a
hard stop, not a judgment call.** The body "appears rounded/soft" through
the fringe in reference photos — that is an appearance through an occluding
feature, not a shape. An earlier version of this section said to "model a
reasonable rounded/soft base… and flag it as unconfirmed." **That is
fabrication with a disclaimer attached, and it is withdrawn.** Do not model
Loco's base until a photograph with the fringe lifted, or taken from a low
angle, actually shows it (`PRODUCT-GEOMETRY-MAP.md` Loco §9, item 3). And
**do not copy Vault's base** — Vault's own base is UNRESOLVED too, and the
two are different products regardless.

## 9. UV requirements

Non-overlapping UVs for `bag_body_primary` and `fringe`, seams along
natural construction seams where practical for the body. Fringe UVs depend
on which production approach (§12) is used — a shared/tiled UV layout
across repeated strand or card geometry is expected and correct, the same
reasoning `chain-spec.md` §9 gives for repeating hardware geometry.

## 10. Texture requirements

`bag_body_primary`: albedo, normal, roughness per `material-spec.md`.
`hardware`: metal preset. `fringe`: albedo + roughness at minimum (matte,
per the confirmed finding); a normal map is optional — individual strand
geometry (§12, approach 1) usually reads correctly from geometry alone,
while grouped strand-card geometry (§12, approach 2) benefits more from a
normal/alpha map to refine per-strand detail on cards that already exist in
3D. **In neither case does the texture stand in for the strands** — see
§12's forbidden list.

## 11. Normal/roughness/metalness requirements

Regular-yarn preset for `bag_body_primary` (no confirmed Loco colourway is
metallic today) — **confirmed from real photography**: thick matte yarn,
chunky crochet rows in the upper section. `fringe`: same regular-yarn
roughness range (0.6–0.85) as the body, metalness 0.0 — fringe is loose
yarn strands, not a different material category from the body it hangs
from. Metal preset for `hardware`.

## 12. Polygon budget target

**Body + hardware (structured upper section, excluding fringe): 8,000–
14,000 triangles** — unchanged from the original estimate, since the
upper crocheted body's own complexity hasn't changed, only the addition of
fringe as a separate, additional requirement.

### The fringe must be real geometry — this is not negotiable

**The fringe is structural. It may not be represented as a texture.** Only
the two approaches below are permitted, and both are *geometry* approaches.

1. **Optimized individual strand geometry** — each hanging strand (or a
   representative subset carrying natural length and angle variation) built
   as real thin geometry. Highest fidelity and most convincing under
   rotation and close zoom, but the most expensive — keep per-strand
   triangle count low (thin ribbons or low-segment cylinders, not fully
   round tubes; a few segments per strand, not many).
2. **Grouped strand-card geometry with real depth and separation** —
   strands grouped onto a smaller number of curved cards arranged at
   varied angles around the body (the foliage-card technique from
   real-time graphics), each card carrying alpha/normal detail that reads
   as multiple strands. Cheaper than approach 1 and an acceptable default
   **only if** the cards genuinely occupy three-dimensional space around
   the body — multiple cards at varied angles and depths, never a single
   surface. The alpha/normal texture here refines geometry that already
   exists; it never substitutes for it.

**Explicitly forbidden — every one of these is "fringe as a texture":**

- A textured shell or skirt shape with normal-map or alpha-cutout detail
  standing in for strands. *(This was listed as an acceptable third
  approach in an earlier version of this spec. It is not — see contradiction
  C13 in `PRODUCT-GEOMETRY-MAP.md`. If you are working from an older copy
  of this document, that guidance is withdrawn.)*
- A normal map, bump map, or displacement on the body surface used to imply
  fringe.
- A single flat alpha plane, or a small number of coplanar planes, carrying
  a fringe image.
- Fringe painted into the body's albedo texture in any form.
- Omitting fringe geometry on the grounds that it is expensive on mobile.
  If the budget and the fringe genuinely conflict, **escalate** — do not
  silently downgrade Loco's defining feature to a texture.

**Whatever approach is used must:** preserve the long loose-strand
appearance (not read as a solid block — see §18), read correctly from every
angle as the model is rotated in `/dev/3d-test` including edge-on (no rigid
single-surface look), and stay within the mobile performance targets in
§13–14.

**Strand count, length, spacing, and anchoring are UNRESOLVED and must not
be invented** (see the intro correction). Both approaches above describe
*how* to build fringe geometry, not *what* the fringe looks like — that
still requires the photography listed in `PRODUCT-GEOMETRY-MAP.md` Loco §9.
Do not begin fringe production before those close-ups exist.

**Combined body + fringe + hardware total: target 16,000–20,000
triangles**, reflecting approach 2 (grouped strand cards) as the expected
default — revisit once a real candidate gives an actual measured number;
this is a planning estimate, not a measured fact. If a real fringe built to
the confirmed reference cannot fit this budget, **raise the budget, do not
substitute a texture.**

## 13. Texture resolution target

`bag_body_primary`: **1024×1024** default, 2048×2048 only if needed.
`hardware`: **512×512**. `fringe`: **512×512–1024×1024** depending on
approach — grouped strand-card geometry (§12, approach 2) typically needs
the higher end of that range; individual strand geometry (approach 1) can
often use less since geometry itself carries most of the detail. Neither
number is licence to raise texture resolution *instead of* building strand
geometry.

## 14. Mobile performance target

Body GLB total (structured body + fringe + hardware, all compressed):
**under 3.5MB** — raised from the original 2.5MB now that fringe is a
confirmed, required, and non-trivial addition; matches the budget already
set in `model-contract.ts`'s `PART_BUDGETS["loco-body"]`. Revisit upward
only if a real candidate genuinely requires it — don't pad preemptively
beyond this.

## 15. GLB export settings

Follow `export-checklist.md` in full.

## 16. Draco/Meshopt recommendation

Draco. Not Meshopt.

## 17. How to test the model in `/dev/3d-inspector`

Same procedure as `vault-spec.md` §17 / `nova-spec.md` §17 — load
`/dev/3d-inspector`, paste the candidate URL, set kind=`body` and
product=`loco`, Load & Validate. No two-tone selector to exercise — mark
that QA item N/A for Loco. The validator checks for the required `fringe`
node automatically (same mechanism as Nova/Mini Luna's two-tone check) —
no manual step needed beyond loading the file, but do visually confirm
fringe reads correctly under rotation (§12's "moves/reads naturally"
requirement) since that's a human judgment call the automated validator
can't make.

## 18. Common failure cases

General body failure modes (missing/misnamed `bag_body_primary`,
plastic-looking material, misaligned strap/chain attach, stray unwanted
`bag_body_secondary`/`handle` nodes) are the same category as
`vault-spec.md` §18 — but **Loco and Vault are not the same shape**; don't
assume a Vault-shaped candidate is "close enough" for Loco. Fringe-specific
additions:

- **`fringe` node missing:** required (§1) — a body without it fails
  validation and doesn't match Loco's confirmed construction.
- **Fringe built as a texture rather than geometry:** the single most
  serious failure. A textured shell/skirt, a normal-mapped body surface, a
  flat alpha plane, or fringe painted into the albedo are all rejections,
  not judgment calls — see §12's forbidden list. An earlier version of this
  spec permitted the textured-shell approach; that guidance is withdrawn
  (C13).
- **Fringe reads as a solid textured block, not loose strands:** the chosen
  production approach (§12) isn't giving real depth/separation. This is the
  most important *visual* failure to check for — fringe is Loco's defining
  feature, and a block reads as obviously wrong even to a non-expert.
- **Fringe doesn't read naturally when rotated:** geometry is too
  rigid/planar from certain angles — usually too few cards, all near-
  coplanar. Approach 2 requires multiple cards at varied angles and depths
  for exactly this reason; test rotation in `/dev/3d-test`, including
  edge-on, before considering the approach final.
- **Strand count/length/spacing chosen by the modeler:** these are
  UNRESOLVED and prohibited from being invented (see the intro correction).
- **Fringe over budget:** see §12 — don't default to full individual-strand
  geometry (approach 1) without checking it against the combined triangle/
  file-size target first.
- **Assuming Loco's base matches Vault's:** Loco's own base is UNRESOLVED
  (§8) — and so is Vault's, which was downgraded this round (C3/C4). There
  is no confirmed base on either product to copy from.
- **Modeling Loco's base at all before it has been photographed:** see §8.
  A "reasonable rounded/soft shape, flagged as unconfirmed" is still
  invented geometry — earlier guidance permitting it is withdrawn.

## 19. Acceptance criteria before this model can be marked production-ready

All of `qa-checklist.md` (two-tone item marked N/A), plus:

- [ ] `bag_body_primary` recolours correctly across at least 3 test hex
      values in `/dev/3d-test`
- [ ] `fringe` node present and built as **real geometry** — not a
      textured shell, not a normal map, not a flat alpha plane, not painted
      into the albedo (§12's forbidden list)
- [ ] `fringe` reads as genuine loose hanging strands — not a solid block
- [ ] Fringe reads naturally when the model is rotated in `/dev/3d-test` —
      no rigid single-surface look from any angle, including edge-on
- [ ] Fringe strand length, spacing, and anchoring match a real confirmed
      photo reference — **not** values chosen by the modeler
- [ ] Fringe coverage (lower and side portions) matches the confirmed
      reference rather than the superseded "most of the lower body" text
- [ ] Fringe stays within the triangle/file-size budget in §12–14
- [ ] The horizontal hand opening reads as built into the crocheted top
      section (not a tall external arch), matching the confirmed reference
- [ ] Strap and chain both attach correctly at `attach_strap`/`attach_chain`
- [ ] Hardware reads as metal under the viewer's actual lighting
- [ ] No `bag_body_secondary` or `handle` node present in the file
