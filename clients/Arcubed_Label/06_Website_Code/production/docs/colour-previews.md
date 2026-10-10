# Colour previews

Show a bag in a confirmed colour that has not been photographed yet, by
recolouring the yarn of an authentic photograph in the browser. Status
2026-10-09: working for all four bags in the admin colour lab
(`/admin/colour-lab`); **nothing is approved, so the storefront shows
photography only**. No AI service or network request is involved per colour.

## What a customer sees (once a preview is approved)

The product page always prefers, in order:

1. a real photograph of the selected colourway
2. an approved digital colour preview (`src/lib/colour-previews.ts`), drawn
   by `RecolourStage`, captioned "Digital colour preview in …, not a
   photograph" with a note naming the photograph it was made from and that
   the finished bag may differ slightly
3. another colourway's photograph, labelled as such

A preview is only ever attached to a colour that is already confirmed and
purchasable in the catalogue (Supabase `product_colours`). Nothing in this
system creates a colour or makes one orderable. The lab's "Storefront
simulation" mode shows exactly this experience without saving anything.

## How it works

1. `node scripts/build-recolour-maps.mjs` (Node 22) prepares, from Rand's
   photographs:
   - `public/media/recolour/<frame>-src-1600.webp` — the source cut-out (q97)
   - `public/media/recolour/<frame>-mask-1600.png` — how much of each pixel
     is yarn. Solid body; crochet texture separates yarn from smooth shadow;
     only small holes are filled (a handle's arch stays backdrop); per-source
     rules (`YARN_RULE`: texture threshold, colour rescue, darkness for
     Loco's fringe, keep-bright for backlit gaps, automatic floor trim for
     Vault); hand-traced floor lines (`FLOOR`); hardware search areas
     (`EXCLUDE`); edge clean-up so silhouettes take the new colour instead of
     a pale rim.
   - `src/lib/recolour/profiles.generated.json` — every real photographed
     colourway, grouped by MATERIAL family: lightness distribution (33
     quantiles), colour strength and hue drift from shadow to highlight, and
     its mid-tone.
2. `src/lib/recolour/engine.ts`: each pixel keeps its brightness RANK in the
   source; the new yarn gets the lightness distribution interpolated from
   the real yarns of the same material nearest it in lightness, and colour
   strength + hue drift from the real yarns nearest it in hue. The lightness
   stretch is capped (4x) so compression blocks are not magnified.
3. `RecolourStage` draws it on a canvas, keeps the photograph until the
   first preview exists and the previous colour until the next is drawn, and
   caches the last six colours.

## Material families

| Family | Bags | Real references | Status |
|---|---|---|---|
| Metallic raffia | Nova, Mini Luna | Nova Gold, Black, Champagne, Silver, Rose Gold; Mini Luna Red, Silver, Gold, Black | Convincing for all test colours. Red checked against Rand's real red yarn: matches pixel values at every brightness rank |
| Matte cord | Vault | Brown, Light Brown, Olive Green | Convincing including light colours at 1:1, but every reference is a dark earth tone: light colours are extrapolated |
| Fringe cord | Loco | Brown, Burgundy | Dark and mid colours only. Above L* 45 the dark source turns speckled and washed out, so lighter swatches are refused (`maxLightness`) |

## Adding an approved preview

1. Rand confirms the colour and it is added to the catalogue (purchasable).
2. Photograph a flat swatch of the actual yarn under the studio lights; its
   mid-tone (40th–60th percentile of brightness) is the `value`.
3. Review it in the lab (Preview colours mode with that value, then
   Storefront simulation). Rand or Mustafa approves the exact image.
4. Add one entry to `APPROVED_PREVIEWS` in `src/lib/colour-previews.ts`:
   ```ts
   nova: { Navy: { value: "#263a63", frame: "DSC04868", sourceColour: "Silver", approvedBy: "Rand", approvedOn: "2026-11-02" } }
   ```
5. Release normally (see docs/deployment.md). When the colour is later
   photographed, the photograph replaces the preview automatically.

## Measured limitations

- **Colour, not material.** Previews inherit the source yarn's material:
  metallic raffia, matte cord or fringe cord. A different yarn type needs
  its own photographed references.
- **The source sets the glints.** Recolouring cannot add highlights the
  source photograph does not have: the Silver Nova's soft sheen gives a
  softer red than the hard-lit Red Mini Luna photograph, though the colour
  values match.
- **Light previews from dark sources** degrade (Loco: refused above L* 45).
- **Hardware** is protected only where a search area is drawn (tested on the
  open Black Nova's clasps). No Arcubed photograph shows a chain or strap.
- **Open, backlit views fail** (light through stitch gaps gets tinted); only
  closed front views are offered as sources for approval.
- **Authentic glints**: the Silver sources carry tiny bright foil facets
  that read as pale flecks on dark previews at 2x zoom. They are in Rand's
  photographs, not added.
- **Performance** (Chrome, Android viewport, 6x CPU throttle): first preview
  0.23–0.28s including one-time analysis; each new colour 141–186ms tap to
  screen (48–78ms rendering); cached colour 77–225ms. WebKit/iPhone and
  desktop pass all interaction checks. Download once per bag: 0.3–0.6MB.

## Reviewing

Review builds live at https://arcubed-review.vercel.app (admin sign-in, then
`/admin/colour-lab`). Locally:

```
cd clients/Arcubed_Label/06_Website_Code/production
node scripts/build-recolour-maps.mjs        # only if sources/masks change
npm run build && ARCUBED_ADMIN_PASSPHRASE=<any local value> npx next start -p 4312
# http://localhost:4312/admin, sign in with that value, then /admin/colour-lab
```
