# Size evidence map

**Verdict: UNRESOLVED for every product. No size preview may be generated.**

Method: every one of the 45 originals in `03_Images/` was inspected as a
contact sheet, then individually where ambiguous.

## What the archive contains

| Requirement for a size visual | Present? | Detail |
|---|---|---|
| Same product photographed in two sizes | **No** | No frame pair is labelled or demonstrably two sizes |
| Two sizes in one frame (direct comparison) | **No** | Every frame contains exactly one bag |
| A scale reference (hand, coin, ruler, model) | **No** | All 45 frames are isolated studio shots, product only |
| Known camera distance or focal length | **No** | EXIF carries no subject distance |
| Stated dimensions from Rand | **No** | Nothing in `01_Client_Info/` |

## Why apparent size in the frames proves nothing

Object size in an isolated studio frame is a product of subject distance and
focal length, neither of which is recorded. Two frames of the *same* bag at
different distances differ in apparent size far more than Regular differs from
Small. Measured object-box widths across the Mini Luna frames vary by 17%
(`scripts/measure-products.mjs`) purely from camera position.

## Per product

| Product | Sizes sold | Status | Note |
|---|---|---|---|
| Nova | Regular, Small | **UNRESOLVED** | No dimension, no comparison frame |
| Vault | Regular, Small | **UNRESOLVED** | Same |
| Mini Luna | Regular, Small | **UNRESOLVED** | See the open question below |
| Loco | Regular, Small | **UNRESOLVED** | Same |

## The Mini Luna question this raises

`DSC04872/04873` (Black) show a **narrower, boxier** body; `DSC05774/05775`
(Red) show a **wider, rounder** one. That is either camera rotation, two
sizes, or two versions. It cannot be settled from the archive. It is on the
Rand question list and must not be resolved by assumption.

## Consequence for the storefront

Size remains a real purchasable option with a real price effect (+5 JOD for the
upgrade) and is carried through cart, checkout and order. It produces **no
visual change**, because there is nothing truthful to show. `transform: scale()`
was explicitly rejected: size is geometry, and scaling a photograph of a
Regular bag is a fabrication, not a preview.

**To resolve:** one photograph of Regular and Small together, or stated
dimensions in cm for each product and size.
