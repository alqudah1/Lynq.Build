# Colour previews (prototype)

Show a bag in a colour that has not been photographed, by recolouring the
yarn of an authentic photograph in the browser. Status 2026-10-09: working
prototype for Nova, **admin-only** at `/admin/colour-lab`, not on the
storefront. Nothing is orderable in a preview colour, and no AI service or
network request is involved per colour.

## How it works

1. `node scripts/build-recolour-maps.mjs` (Node 22) prepares, from Rand's
   photographs:
   - `public/media/recolour/<frame>-src-1600.webp` — the source cut-out
   - `public/media/recolour/<frame>-mask-1600.png` — 0..255 per pixel: how
     much of it is yarn. Built from the bag's solid body, kept only where the
     surface has crochet texture (a shadow is smooth), with per-source rules
     (`YARN_RULE`), hand-traced floor lines (`FLOOR`) and hardware search
     areas (`EXCLUDE`) — see the comments in the script.
   - `src/lib/recolour/profiles.generated.json` — for every real photographed
     colourway: its yarn's lightness distribution (33 quantiles), how its
     colour strength varies from shadow to highlight, and its mid-tone.
2. `src/lib/recolour/engine.ts` (browser): each source pixel keeps its
   brightness RANK; the new yarn gets the lightness distribution interpolated
   from the real yarns nearest it in lightness, and colour strength shaped
   like the real chromatic yarns. One 1024-entry lookup table per colour, one
   pass over the pixels.
3. `src/components/customizer/RecolourStage.tsx` draws it on a canvas, keeps
   the real photograph until the first preview exists and the previous
   colour until the next is drawn, and caches the last six colours.
4. `Customizer` takes an optional `preview` prop (only the lab passes it):
   a "Preview colours · not for sale" row, the caption names it a preview and
   the photograph it came from, size/handle/strap/chain are untouched, and
   ordering is refused while a preview is shown.

A colour with real photography is never previewed: the gallery always
prefers the photograph.

## Adding a colour

One entry in `src/lib/recolour/preview-colours.ts` — no rendering code:

```ts
{ key: "navy", name: "Navy", swatch: "#263a63", value: "#263a63", products: ["nova"], approved: false }
```

`value` must be MEASURED: photograph a flat swatch of the actual yarn under
the studio lights and take the colour of the middle band of its brightness
(what `midLab` records for the real yarns). A guessed hex gives a guessed
preview. `render: { chroma, contrast }` can fine-tune (default 1).

## Adding a bag

Add its front frame(s) to `SOURCES` in the build script, check the mask
visually (blue overlay), add floor lines / hardware areas where needed,
rebuild, then add the frame to `PREVIEW_SOURCES`. The bag's own photographed
colourways become its profiles automatically.

| Bag | Fit | Why |
|---|---|---|
| Nova | Working | Metallic raffia; 5 single-yarn references (Black, Rose Gold, Champagne, Gold, Silver) |
| Mini Luna | Good fit, not built | Same metallic raffia; Red, Silver, Gold, Black references; crocheted handle recolours with the body |
| Vault | Partial | Matte cotton cord — gets its own profiles (never Nova's sheen), but all 3 references are dark earth tones: light or bright colours would be extrapolation |
| Loco | Not ready | Fringe strands with backdrop between them; the site already rejected Loco's cut-out for this. Needs a hand-made mask |

## Measured limitations

- **Material, not just colour.** Every Nova yarn photographed is metallic
  raffia, so every preview is metallic raffia. A matte, glitter, bouclé or
  two-tone yarn needs its own photographed reference.
- **Outside the photographed range is extrapolation.** Leave-one-out tests:
  Rose Gold and Champagne predicted from Silver match the real yarns
  (lightness spread and colour strength within ~1–3 units); Gold matches in
  colour but lacks its brightest glints when its own profile is withheld;
  Black cannot be predicted without a dark reference (its bright sheen on a
  near-black body is unlike anything lighter).
- **Source matters.** A mid-tone neutral source (Silver front) is cleanest. A
  dark source stores little shadow detail, so light previews from it are
  grainy. A gold source tints its own floor shadow (neutralised in the build).
- **Hardware** is protected only where a search area is drawn
  (`EXCLUDE`): tested on the open Black Nova's two rim clasps. No Arcubed
  photograph shows a chain or strap, so those are untested.
- **Open, backlit views fail**: light through stitch gaps inside the bag gets
  tinted. Use closed front views as sources.
- **Performance** (Chromium, phone viewport, 1600px source): first preview
  ~0.4s including one-time analysis at 4–6x CPU throttle; each new colour
  24–40ms to render, ~100–150ms tap to screen; a cached colour 1–2ms.
  Download: ~290kB once (Silver source + mask).

## Reviewing locally

```
cd clients/Arcubed_Label/06_Website_Code/production
node scripts/build-recolour-maps.mjs        # only if sources/masks change
npm run build && ARCUBED_ADMIN_PASSPHRASE=<any local value> npx next start -p 4312
# open http://localhost:4312/admin, sign in with that value, then /admin/colour-lab
```
