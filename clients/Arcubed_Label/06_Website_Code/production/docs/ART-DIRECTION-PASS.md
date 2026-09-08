# Art direction correction pass

Reviewed against the rendered browser, not against the previous audit's
grades. Every claim below has a measurement or a screenshot behind it.

## The measurement problem that came first

The earlier audit disagreed with what was on screen because it ran against a
warm browser cache and, for one run, against a stale server on port 4311 that
had nothing to do with the working tree. Both are now closed:

- `scripts/audit-site.mjs` and `scripts/shot-page.mjs` send
  `Network.setCacheDisabled`.
- Every CDP script now resolves its base URL as **argument, then `$BASE`, then
  the default**. `test-variants.mjs` and `test-journey.mjs` read `$BASE` only,
  so passing a URL as an argument was silently discarded and the run tested
  whatever stale server sat on port 4311. That produced one phantom report of
  15 checkout failures and another of 16 variant failures, neither of which
  was real. This is the single most misleading thing in the toolchain and it
  is now impossible to trigger by accident.

With the cache disabled the audit found 36 upscaled images that the warm cache
had been hiding. That is why the previous report and the screen disagreed.

## Scroll story length

Measured with real wheel events (`scripts/measure-scroll-cost.mjs`), not by
setting `scrollTop`:

| | before | after |
|---|---|---|
| story height | 380vh | **240vh** |
| wheel gestures end to end | 27 | **11** |
| gestures per phase | ~4.5 | **1.8** (max 3) |

Native scroll throughout — no wheel handler, no scroll-jacking.

## One product per phase

The story showed the Red Mini Luna in four consecutive frames. It now reveals
the range:

| phase | object |
|---|---|
| hero | Mini Luna, Red |
| 01 the material | macro of gold metallic ribbon yarn (DSC04874) |
| 02 the shape | silhouette set |
| 03 make it yours | Nova, Silver & Gold |
| closing | Vault, Olive Green |

## The material frame

It was soft because of frame choice and crop geometry, not file size.

- The old crop came from DSC05774, which fills only **67%** of the sensor.
  DSC04874 fills **88–95%**, so the same crop carries far more real pixels.
- The old container was 892 wide by 900 tall and the derivative was
  892x373. `object-fit: cover` scaled that **2.4x vertically**. `sizes`
  describes width only and cannot express a height-driven cover upscale, so no
  `sizes` value could have fixed it. The crop aspect now matches the container.

Source crop 1541x1303 -> rendered at 75vw. No upscale at any tested width.

## Customization frame

"SILVER & G..." ran off screen because the rail was one nowrap line at display
size. It is now a colour rail: five rows, rules between, the live name in navy
with the rule drawn across it. Silver and Silver & Gold resolve to different
photographs (DSC04875 and DSC04870) — there is no Silver fallback.

## Product pages

The cream was not a token drift. The tokens were already navy/pink/white;
`.pg-main` and `.pg-thumb` carried a hardcoded `#f4efe8` that bypassed the
token system. A full scan found 60 hardcoded warm values; all are gone.

- Selector language: no pills. Editorial rows separated by rules, with the
  surcharge set right — `CROCHET STRAP        +JOD 5`.
- Add to Bag: square, full width, `ADD TO BAG        JOD 65`, inverts to pink
  on navy on hover.
- Loco is art-directed as the real photograph: full-bleed, square edges, fringe
  as texture. No forced cut-out.
- `--radius` is 0 sitewide, so no rounded cards survive on product, shop, cart
  or checkout.

### Loco image budget, measured

The framed photo was capped at 1600px because the build cropped it out of a
1600px matte proxy, discarding the 6000px original before the crop happened.
Frames whose cut-out was rejected now crop from a 3200px proxy:

| | before | after |
|---|---|---|
| source file | 1600x1092 | **2600x1775** |
| CSS render at 1440 | 1180px | 1440px (full bleed) |
| device need at DPR1 | 1440px | covered 100% |
| device need at DPR2 | 2880px | 2600px available, 90% |

Only the six frames with rejected cut-outs get the 2600px build (632KB total).
Generating it for all 53 frames added 68MB that nothing rendered at that size.

## Type

Measured every element rendering above 150px at 1440. After reducing the
closing frame from 176px to 148px, the only two remaining are the footer
wordmark (187px, a deliberate sign-off) and the product-name watermark
(230px at **13% opacity** — texture behind the object, not a headline).

Three unused webfont families (Instrument Serif, Playfair Display, Archivo)
were loading on every customer route to serve one internal specimen page at
/dev/type. They now load only on that page.

## Fixed along the way

- **Hydration error on every page.** An inline script adds `js` to `<html>`
  before React hydrates, so the className could never match. `<html>` now
  carries `suppressHydrationWarning`.
- **`priority` was a no-op.** Next 16 deprecated it in favour of `preload`, so
  the hero — the LCP element — was being fetched at default priority. Five
  images were affected.
- **Cart thumbnails under-served.** `CartThumb` hardcoded `sizes="88px"` while
  the rebuilt cart page renders it at up to 160px.
- **A sentence with its subject missing** on every product page: "Chosen for
  you and crocheted in. The photograph shows the colour."

## Where it stands

Audit across 20 page/width combinations, cache disabled:
**0 broken images, 0 horizontal overflow, 0 dashes, 0 upscaled images.**

Suites: TypeScript clean, ESLint 0 errors, 16/16 colourway deep links,
23/23 checkout end to end, 6/6 full journeys.

Remaining, and honest about it:

- The Loco photograph carries its studio ground. Full-bleed makes that ground
  the frame rather than a rectangle floating on pink, but it is still a
  different white from the pink field. A clean cut-out would be worse.
- At DPR2 the full-bleed Loco has 90% of the device pixels it asks for. Visibly
  sharp at 1:1; not mathematically complete.
- FAQ is still the thinnest page.
- About and Contact are on-system rather than art-directed.
