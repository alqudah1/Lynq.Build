# Mini Luna — 3D Production Spec

Base price 50 JOD. Two-tone supported — **CONFIRMED BY RAND**: the real two-tone
colourway is "Silver & Gold," the same real combination shared with Nova
(one shared colour-catalog row, not a separate Mini-Luna-only name — see
`clients/Arcubed_Label/01_Client_Info/product-matrix.md`). Confirmed real
colours: Red, Silver, Gold, Black, and the Silver & Gold two-tone.

**CONFIRMED BY RAND:** every Drive folder containing "Luna" (Silver Luna, Gold Luna,
Black Luna, Luna Gold & Silver) is confirmed by Rand to mean Mini Luna —
see `docs/photo-asset-map.md`. This is no longer an open question; treat
these as real Mini Luna photography.

**Correction (visual geometry audit) — Mini Luna has a required handle.**
An earlier version of this spec said "no handle." That was wrong. Real
photography confirms Mini Luna has a **large integrated arched crochet
handle — thick, rounded, heavily crocheted construction — occupying
significant vertical space above the body** (see
`docs/3d-production/PRODUCT-GEOMETRY-MAP.md`, Mini Luna §2, for the full
finding). "No handle" in the earlier spec described Mini Luna having no
*customer-selectable/swappable* handle option (still true — see §2 below)
— it did not mean the physical bag has no handle at all. It does, and it's
one of Mini Luna's most visually defining features. **This is required as
its own named node — explicitly, not optionally** (unlike Vault's
integrated handle/opening, which may or may not get its own node — Mini
Luna's is large enough, and confirmed with attachment to both sides of the
body, that it must be independently addressable).

**CONFIRMED FROM PHOTOS:** a **compact rounded-RECTANGULAR body**; a large
thick integrated arched crochet handle occupying significant vertical space
above the body; an open top visible beneath that arch; **shiny metallic
crochet yarn on the Red colourway** (see §11 — this changes Red's material
preset); dense horizontal crochet rows with strong ribbon-yarn highlights.

**Correction — the silhouette was wrong.** An earlier version of this spec
described Mini Luna as "a small rounded basket / mini bucket silhouette"
with "a short rounded body with a relatively wide base" and "a rounded/oval
base." **A bucket and a rounded rectangle are not the same shape.** The
later review of the Red Mini Luna reference reads it as a **compact rounded
rectangular body** (contradiction C7 in `PRODUCT-GEOMETRY-MAP.md`).

**UNRESOLVED — do not model these from the superseded text.**

- **Proportions.** "Compact" is confirmed; the width:height ratio is not.
  "Mini" in the product name is still not a confirmed measurement against
  the other three products.
- **Base shape.** The old "rounded/oval base" followed directly from the
  bucket reading that was overturned, so it is downgraded with it
  (contradiction C8). A rounded-rectangular body plausibly implies a
  rounded-rectangular base — but that is inference, not evidence. **Do not
  model an oval base on the old text's authority, and do not model a
  rectangular one on the new inference either.** Wait for the base shot.
- **Top aperture shape** on a rounded-rectangular body (as opposed to the
  bucket the old text assumed).
- **Handle cross-section thickness, and exactly where the arch roots into
  the body on each side.**

**The body and handle must be unique to Mini Luna — do not reuse Nova or
Vault geometry for any part of it**, including for the handle, despite Nova
also having (unresolved) handle photography — Mini Luna's arched handle is
confirmed as its own distinct construction.

Read `material-spec.md` and `export-checklist.md` first — this spec only
covers what's specific to Mini Luna.

## 1. Required node names

```
bag_body_primary
bag_body_secondary
handle
hardware
```

`handle` is **required** here — see the correction above. This is Mini
Luna's large arched crochet handle, not a generic/shared part.

## 2. Required attach points

```
attach_strap
attach_chain
```

Still no `attach_handle` — Mini Luna's arched handle is a fixed, baked
part of the body construction (like Nova's would be, if confirmed), not a
customer-selectable/swappable option. Do not build it as a separate
component GLB.

## 3. Which parts must be independent meshes

`bag_body_primary`, `bag_body_secondary`, `handle`, and `hardware` must
each be a separate mesh/node — same reasoning as `nova-spec.md` §3
(independent lookup and recolour by name). The handle is large and
structurally distinct (confirmed attachment to both sides of the body) —
do not attempt to merge it into `bag_body_primary`.

## 4. Which parts must have independent materials

`bag_body_primary` and `bag_body_secondary` **must** be separate material
slots — this is the two-tone mechanism, identical requirement to Nova (see
`nova-spec.md` §4). `handle` and `hardware` need their own materials too —
the handle is confirmed as thick heavily-crocheted construction, so give it
the regular-yarn (or metallic-yarn, if the colourway calls for it — see
§11) preset rather than leaving it defaulted or silently sharing
`bag_body_primary`'s material instance.

## 5. Which parts can be static

`hardware` only. `handle` is static in the sense that nothing in the
current customizer swaps or recolours it independently, but it must still
exist as its own named node (see §3).

## 6. Origin/pivot requirements

Same convention as `nova-spec.md` §6 / `vault-spec.md` §6: whole-model
origin centered on the ground footprint, attach points placed/oriented to
match wherever Mini Luna's real strap/chain attachment points are —
coordinate with `strap-spec.md`/`chain-spec.md`.

## 7. Orientation requirements

Y-up, front of the bag facing +Z at identity transform — same convention as
every other product.

## 8. Real-world scale/unit requirements

Meters, 1 unit = 1 meter. Mini Luna's own proportions are now confirmed
(§0/intro: short rounded body, relatively wide base, large handle occupying
significant vertical space) — but that is a shape description, not a
measurement. Still do not assume a size relationship to the other three
products without a real measurement; model actual real dimensions once
measured. See the README's scale/camera-retuning note.

## 9. UV requirements

Non-overlapping UVs per zone, `bag_body_primary`, `bag_body_secondary`, and
`handle` each with their own UV space (same requirement as Nova's two body
zones — see `nova-spec.md` §9 — extended here to the handle since it's now
a required node).

## 10. Texture requirements

`bag_body_primary`/`bag_body_secondary`/`handle`: albedo, normal,
roughness per `material-spec.md`. `hardware`: metal preset. Resolution
targets per §13.

## 11. Normal/roughness/metalness requirements

**Correction — Red is metallic, not regular yarn.** An earlier version of
this section said "regular-yarn preset for both body zones and the handle
by default," treating metallic as applying only to Silver, Gold, and the
Silver & Gold two-tone. **Real photography of the Red Mini Luna shows shiny
metallic crochet yarn** (contradiction C9 in `PRODUCT-GEOMETRY-MAP.md`).

**Confirmed from real photography:** metallic ribbon-yarn character appears
on **Red**, and strong ribbon-yarn highlights appear on the metallic
colourways (Silver, Gold, and the Silver & Gold two-tone) — apply the
metallic-yarn preset (`material-spec.md`) to whichever zone(s) carry a
metallic colour, matching Nova's equivalent requirement. As with Nova, a
metallic zone must still read as metallic *thread*, never as chrome.

**UNRESOLVED: whether Black is also metallic.** Nothing establishes this
either way — do not default it to regular yarn without asking Rand, and do
not default it to metallic either. It is on the open-questions list in
`PRODUCT-GEOMETRY-MAP.md` Mini Luna §9. **Still unresolved:** exactly which zone (primary or
secondary) carries which half of the Silver & Gold two-tone split — that
needs confirmed two-tone Luna photography specifically (see
`PRODUCT-GEOMETRY-MAP.md`, Mini Luna §2), not inferred from the general
Mini Luna/Luna photo set reviewed so far.

## 12. Polygon budget target

Body (primary + secondary + handle + hardware combined): **10,000–16,000
triangles** — raised from the original 8,000–14,000 (which assumed no
handle) now that the confirmed large arched handle is required geometry;
still below Nova's 12,000–18,000 since Mini Luna is presumably physically
smaller, even with its own handle.

## 13. Texture resolution target

`bag_body_primary`/`bag_body_secondary`: **1024×1024** default each,
2048×2048 only if needed. `handle`/`hardware`: **512×512**.

## 14. Mobile performance target

Body GLB total: **under 2.75MB compressed** — a small increase over the
original 2.5MB to account for the now-required handle's own geometry and
texture; still well under Nova's 3MB.

## 15. GLB export settings

Follow `export-checklist.md` in full.

## 16. Draco/Meshopt recommendation

Draco. Not Meshopt.

## 17. How to test the model in `/dev/3d-inspector`

Same procedure as `nova-spec.md` §17 — load `/dev/3d-inspector`, paste the
candidate URL, set kind=`body` and product=`mini-luna`, Load & Validate.
Mini Luna's two-tone selector (the inspector's "Secondary (two-tone)" test
colour) should be exercised in QA the same as Nova's, using the confirmed
Silver & Gold real colourway (or a stand-in hex if final hex values aren't
approved yet — see §11).

## 18. Common failure cases

Same set as `nova-spec.md` §18's colour/material/attach-point failure modes
(this product shares the same two-body-zone + hardware + strap/chain
structure, plus its own required handle) — refer there for the full list.
Mini-Luna-specific additions:

- **`handle` node missing:** this is now a required node (§1) — a body
  without it fails validation and doesn't match Mini Luna's confirmed
  construction. Do not follow old guidance that said to remove it; an
  earlier version of this spec incorrectly said Mini Luna has no handle.
- **Handle present but reads as thin/small:** the confirmed reference shows
  a large arched handle occupying significant vertical space above the
  body, not a modest loop — re-check proportions against
  `PRODUCT-GEOMETRY-MAP.md`'s finding.
- **Body modeled as a bucket/basket:** that came from a superseded review
  round (C7). The confirmed silhouette is a **compact rounded rectangle**.
- **Base modeled as an oval:** downgraded with the bucket reading (C8) and
  currently UNRESOLVED — a base shape chosen by the modeler is a
  fabrication, not a judgment call.
- **Red rendered with the regular-yarn preset:** Red is confirmed metallic
  (§11, C9).
- **Handle only attached at one point:** the confirmed construction
  attaches to both sides of the body — a handle that reads as attached at
  only one side, or floating, doesn't match the real reference.

## 19. Acceptance criteria before this model can be marked production-ready

All of `qa-checklist.md`, plus:

- [ ] `bag_body_primary` and `bag_body_secondary` recolour completely
      independently in `/dev/3d-test`'s colour and two-tone selectors
- [ ] `handle` node present: large, arched, thick crochet construction,
      correctly attached to both sides of the body, matching the confirmed
      photo reference
- [ ] Strap and chain both attach correctly at `attach_strap`/`attach_chain`
- [ ] Hardware reads as metal under the viewer's actual lighting
