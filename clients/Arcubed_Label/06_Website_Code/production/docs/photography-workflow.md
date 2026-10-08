# Replacing product photography

How to bring new photographs (for example from a professional shoot) onto the
site without broken images, wrong colours or lost SEO. Written 2026-10-08.

**Rule:** real photographs only, and only ones Rand has approved. Nothing is
replaced until the new files exist. The site always prefers a real photograph
of the selected colourway; an approved colour preview
(`src/lib/colour-previews.ts`) is used only for a confirmed colour that has no
photograph yet, and is labelled as a preview.

## How images reach the site

```
03_Images/<FRAME>.JPG          originals (6000x4000 DSLR, on the Desktop, not in git)
  -> scripts/media-manifest.mjs   hand-maintained map: product -> colour -> [frames]
  -> node scripts/build-media.mjs     framed photos + cut-outs + src/lib/media-manifest.ts
  -> node scripts/build-hires.mjs     high-resolution cut-outs (hero, product stage)
  -> node scripts/build-tile-cutouts.mjs   field-safe cut-outs for collection tiles
public/media/<FRAME>-{800,1600,2600}.webp, -cut-*.webp, -tile-*.webp
```

`src/lib/media-manifest.ts` is generated: never edit it by hand. Everything
customer-facing — product gallery, colour swatches, Shop tiles, collection,
cart and order thumbnails, the colour preloader — reads it through
`src/lib/product-media.ts`.

A second route exists (`product_images` table in Supabase, read by
`resolveProductImages`). It wins outright when rows exist, but it skips the
cut-outs and sizes above, so photos shown that way sit in a grey rectangle.
Use the manifest route unless that trade-off is chosen deliberately.

## Steps

1. **Name and store.** Copy the approved originals into
   `clients/Arcubed_Label/03_Images/` as `<FRAME>.JPG` (keep the camera's
   `DSC0xxxx` names; any unique name works). Never overwrite an existing
   frame's file — add new names, so old references keep working until moved.
2. **Map them.** In `scripts/media-manifest.mjs`, set each colour's `frames`
   list. The FIRST frame is that colourway's face everywhere (Shop tile,
   swatch, collection, cart thumbnail, first gallery shot, preload); the rest
   are further gallery angles, in order. Colour names must match the catalogue
   exactly ("Silver & Gold", not "Silver and gold"). A colour photographed but
   not sold goes under `editorialOnly`, never under `colours`.
3. **Build.** From `06_Website_Code/production` with Node 22:
   `node scripts/build-media.mjs && node scripts/build-hires.mjs && node scripts/build-tile-cutouts.mjs`.
   Each frame is cropped to the bag plus margin, so aspect ratios stay
   consistent and are recorded per frame (`ratio`) — the layout reserves that
   space, so nothing jumps.
4. **Check the cut-outs by eye.** If a cut-out leaves backdrop between straps
   or fringe, add the frame to `REJECTED_CUTOUTS`; the site then shows the
   framed photograph instead. A bad matte is worse than a visible backdrop.
5. **Update the pinned frames** — the few places that pick a frame by name:

   | Where | Pinned frame | Notes |
   |---|---|---|
   | `src/app/page.tsx` homepage hero | `DSC05786` (Gold Nova) | falls back to Nova Gold's first frame |
   | `src/app/page.tsx` Black Mini Luna | `DSC04873` | falls back to first Black frame |
   | `src/app/page.tsx` Mini Luna macro | `DSC04874` | detail crop |
   | `src/app/about/page.tsx` | `DSC04873` | falls back to first Black frame |
   | `src/app/cart/CartPageClient.tsx` empty cart | `/media/DSC05792-tile-2600.webp` | **direct path, no fallback** |
   | `src/app/checkout/CheckoutClient.tsx` empty checkout | `/media/DSC04874-tile-2600.webp` | **direct path, no fallback** |
   | `public/media/og-nova.jpg` | social share image | replace with a 1200x630 crop |
   | `src/lib/collection.ts` | per-frame fit values | re-measure if a lead frame changes |

6. **Alt text and SEO** need no work: alt text is generated from product and
   colour (`altFor`), and detail crops carry their own `alt` in
   `DETAIL_CROPS`. Page URLs, canonicals and the sitemap do not depend on
   file names.
7. **Verify** against a local build, one suite at a time (each script states
   at its top whether it takes the base URL as an argument or from `$BASE`):
   `test-configurator` (every colour has a photo), `test-gallery`
   (swatches distinct), `audit-image-detail` (no under-resolved images),
   `audit-site` (no broken images), `wk-touch`, `wk-checkout` with
   `SKIP_ORDER=1`. Then deploy and alias both domains.
8. **Remove old files last**, only after nothing references them:
   `grep -rn <FRAME> src scripts` must return nothing.

## Photoshoot checklist (for Rand)

Same studio setup for every bag: plain light background, the same lights, the
same camera height and lens, the bag centred with space around it. Shoot each
colourway Rand sells:

| Bag | Colourways |
|---|---|
| Nova | Gold, Black, Champagne, Silver, Rose Gold, Silver & Gold — with handle and without |
| Mini Luna | Red, Silver, Gold, Black, Silver & Gold |
| Vault | Light Brown, Olive Green, Brown |
| Loco | Brown, Burgundy |

For every bag in every colour:

1. **Front**, straight on, whole bag in frame — this becomes the main photo.
2. **Three-quarter view** from the front left.
3. **Side view**.
4. **Back**.
5. **Top / open**, showing the opening and inside.
6. **Close-up of the stitches**, filling the frame.
7. **With each fitting it is sold with**: Crochet Strap, Silver Tone Chain,
   Gold Tone Chain (and Nova with and without handle).

Once per bag (any one colour): **worn on the shoulder or in hand**, for scale.

Also: a **flat swatch of every yarn colour** under the same lights — this is
what any future colour preview would be checked against. Keep the bag the
same distance from the camera in every front shot so all bags appear at a
consistent size on the site. Send the original full-size files, not phone
exports or edited JPEGs.
