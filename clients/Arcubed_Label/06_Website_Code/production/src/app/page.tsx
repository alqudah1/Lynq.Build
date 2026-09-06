// Arcubed homepage — hero, scroll story, collection reveal.
//
// MEDIA RULE, unchanged from the rest of the site: every bag here is real
// client photography resolved through src/lib/product-media.ts. No 3D (no
// approved production geometry exists — see docs/3d-production/), and the
// illustrated BagArt placeholder appears nowhere on this page.
//
// The whole page is one scroll timeline. See src/components/home/ScrollStory
// for how progress is produced and src/app/home.css for what reads it.

import Link from "next/link";
import Image from "next/image";
import { getActiveBags } from "@/lib/repository";
import { formatMoney } from "@/lib/site-settings";
import { framesForColour, resolveMedia, cutSrc, tileSrc, TEXTURES, altFor } from "@/lib/product-media";
import ScrollStory from "@/components/home/ScrollStory";
import type { Bag } from "@/lib/types";
import "./home.css";

export const dynamic = "force-dynamic";

/**
 * COLLECTION — every purchasable colourway that has its own photography, from
 * src/lib/media-manifest.ts. Nothing here is a guess: a pairing appears only
 * if that product/colour has real frames in the manifest.
 *
 * The field colours are NOT the brand palette, on purpose — the brand is the
 * navy and pink furniture around the grid, and each bag gets a field chosen
 * to set its own colour off. They are all light-to-mid: the cut-outs carry a
 * soft studio matte that reads as a white glow on a dark ground, verified by
 * compositing them before this list was written, which is also why nothing
 * here sits on navy.
 */
const COLLECTION: { slug: string; product: string; colour: string; field: string; forcePhoto?: true }[] = [
  // Sequenced as a 4-column grid, not listed. Each row alternates warm and
  // cool, no two neighbours share a hue family in either direction, no
  // product clumps, and each field is picked against its own bag's colour —
  // cool grounds under the golds, warm grounds under the silvers and blacks.
  // The two Loco tiles are photographic (their fringe defeats a matte) so
  // they carry the studio grey; they are placed diagonally rather than in the
  // same column, which was reading as a grey block.
  { slug: "nova", product: "Nova", colour: "Gold", field: "#8fa5b8" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Red", field: "#8d9b7a" },
  { slug: "vault", product: "Vault", colour: "Olive Green", field: "#d9d3cc" },
  { slug: "nova", product: "Nova", colour: "Black", field: "#d6b06a" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Silver", field: "#c07f5f" },
  // Full photograph, not a cut-out. Its matte traps a patch of seamless
  // inside the hand slot that is connected to the region running round the
  // bag, so it cannot be lifted as an enclosed patch — and the threshold
  // that would catch it also starts erasing the silver bags, whose bodies
  // sit within about 29 RGB of the cream backdrop. An honest photographic
  // tile beats a cut-out with a white hole in its handle.
  { slug: "vault", product: "Vault", colour: "Brown", field: "#7e93a8", forcePhoto: true },
  { slug: "nova", product: "Nova", colour: "Champagne", field: "#b8a0c0" },
  { slug: "loco", product: "Loco", colour: "Brown", field: "#c9b8a4" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Gold", field: "#6f8496" },
  // Deeper rose: Nova Silver is the palest object in the grid and washed out
  // against the lighter dusty pink the rhythm originally gave it.
  { slug: "nova", product: "Nova", colour: "Silver", field: "#a8747c" },
  { slug: "loco", product: "Loco", colour: "Burgundy", field: "#bfae9a" },
  { slug: "vault", product: "Vault", colour: "Light Brown", field: "#a9b89a" },

  { slug: "mini-luna", product: "Mini Luna", colour: "Black", field: "#e3c98a" },
  { slug: "nova", product: "Nova", colour: "Rose Gold", field: "#7e8f6f" },
  { slug: "mini-luna", product: "Mini Luna", colour: "Silver & Gold", field: "#d89a7a" },
  { slug: "nova", product: "Nova", colour: "Silver & Gold", field: "#96a8bd" },
];

/**
 * CUSTOMISATION BEAT — the one control with a truthful visual answer today.
 * Five real photographs of the same product, so the bag genuinely changes
 * colour under the viewer. Straps, chains and sizes are named but NOT
 * pictured: no photography of a fitted strap or chain exists, and there is no
 * separate photography of the small size, so showing anything would be an
 * invention. When an approved 3D model exists these same windows drive it.
 */
const CUSTOM_COLOURS = ["Red", "Gold", "Silver", "Black", "Silver & Gold"];

/**
 * Per-frame alignment for the customisation sequence.
 *
 * These five are five separate photographs and they do NOT agree: Black's
 * frame is portrait (1200x1347) where the others are landscape, and its bag
 * fills 61% of the image height against 88-89% for the rest — which is why it
 * sat visibly lower and smaller than every other colourway.
 *
 * Each object's box was measured inside its own cut-out, then these were
 * solved so all five render at the same object height, on the same baseline,
 * horizontally centred on the object rather than on the image. Scale is
 * about the bottom centre; the translations are percentages of the image's
 * own untransformed box. Nothing is cropped — handles and rims are untouched.
 */
const FRAME_FIT: Record<string, { s: number; tx: number; ty: number }> = {
  "Red": { s: 0.892, tx: -3.03, ty: 1.46 },
  "Gold": { s: 0.968, tx: 5.13, ty: 1.44 },
  "Silver": { s: 0.986, tx: 6.61, ty: 2.07 },
  "Black": { s: 1.005, tx: 2.11, ty: 3.08 },
  "Silver & Gold": { s: 1.021, tx: 8.99, ty: 2.27 },
};

/** The four forms, with the measured aspect ratio of each silhouette asset
 *  so the row can size them by their real proportions rather than by a box. */
/**
 * The four forms. `ratio` is each silhouette asset's measured aspect; `width`
 * is its share of the row.
 *
 * Sizing by WIDTH and letting height fall out of the real ratio is the whole
 * point of this section: matching them all to one height (the first version)
 * flattened exactly the differences the section exists to show, and made
 * Nova — the widest, lowest form — the biggest object on screen. Now Mini
 * Luna stands tallest, Nova sits lowest and widest, and they share a
 * baseline, so they read as four objects on a shelf rather than four icons.
 */
const SHAPES = [
  { slug: "nova", name: "Nova", ratio: 2.0783, width: 1.0, note: "Soft, closed, low", fill: "#9a9aa0" },
  { slug: "vault", name: "Vault", ratio: 1.3877, width: 0.9, note: "Wide, structured", fill: "#a99a63" },
  { slug: "mini-luna", name: "Mini Luna", ratio: 1.0755, width: 0.76, note: "Arch handle", fill: "#c9564a" },
  { slug: "loco", name: "Loco", ratio: 1.5453, width: 0.94, note: "Fringed", fill: "#a2646c" },
];

/** A specific colourway's first frame, falling back to the product's best. */
function frame(bag: Bag | undefined, colour: string) {
  if (!bag) return null;
  const exact = framesForColour(bag, colour);
  if (exact.length) return exact[0];
  return resolveMedia(bag)?.frame ?? null;
}

export default async function HomePage() {
  const bags = await getActiveBags();
  const by = (n: string) => bags.find((b) => b.name.trim().toLowerCase() === n);
  const nova = by("nova");
  const miniLuna = by("mini luna");

  // HERO CAST — chosen by compositing every candidate against the actual pink
  // field before writing any layout, not by preference:
  //   · Red Mini Luna leads because its arch is the only silhouette in the
  //     archive with a through-opening, so the pink field reads THROUGH the
  //     bag and the headline can pass behind it and reappear.
  //   · Black Nova is the strongest secondary: opposite value, closed form.
  //   · The macro is Red Mini Luna's OWN yarn (texture-metallic), which is
  //     what lets the material moment later be the same physical object
  //     rather than a cut to an unrelated picture.
  const heroBag = frame(miniLuna, "Red");
  const heroSecond = frame(nova, "Black");

  // Only colourways that actually resolved to a frame survive — a colour with
  // no photography simply does not appear rather than falling back to another
  // bag's picture.
  const customFrames = CUSTOM_COLOURS.map((colour) => ({ colour, frame: frame(miniLuna, colour) }))
    .filter((c): c is { colour: string; frame: NonNullable<ReturnType<typeof frame>> } => Boolean(c.frame));

  const collection = COLLECTION.map((item) => {
    const bag = bags.find((b) => b.slug === item.slug);
    const f = bag ? frame(bag, item.colour) : null;
    if (!bag || !f) return null;
    return {
      ...item,
      // The tile variant, not the storefront cut-out: on a coloured field the
      // ordinary matte shows as a pale halo. Loco has no tile asset (its
      // fringe defeats a clean matte) and falls back to the full photograph,
      // which is the honest option for it anyway.
      cut: item.forcePhoto ? f.photo : tileSrc(f),
      isCut: f.cutOk && !item.forcePhoto,
      ratio: f.ratio,
      alt: altFor(bag, item.colour),
      price: formatMoney(bag.basePrice, "JOD"),
    };
  }).filter(Boolean) as {
    slug: string; product: string; colour: string; field: string;
    cut: string; isCut: boolean; ratio: number; alt: string; price: string;
  }[];

  return (
    <div className="home">
      <ScrollStory>
        {/* ---------------- HERO ---------------- */}
        <div className="phase phase-hero">
          <div className="hero-type">
            <p className="hero-l1">Made</p>
            <p className="hero-l2">Your</p>
            <p className="hero-l3">Way.</p>
          </div>

          {heroBag && miniLuna ? (
            <figure className="hero-bag">
              <Image
                src={cutSrc(heroBag)}
                alt={altFor(miniLuna, "Red")}
                width={1200}
                height={Math.round(1200 / heroBag.ratio)}
                sizes="(max-width: 860px) 104vw, 56vw"
                priority
              />
            </figure>
          ) : null}

          {heroSecond && nova ? (
            <figure className="hero-second">
              <Image
                src={cutSrc(heroSecond)}
                alt={altFor(nova, "Black")}
                width={700}
                height={Math.round(700 / heroSecond.ratio)}
                sizes="17vw"
              />
            </figure>
          ) : null}

          {/* Factual labels only. Each one is already established elsewhere on
              the site: hand-crocheted and made-to-order are the product
              model; Amman is in the footer. Nothing invented. */}
          <div className="hero-band">
            <span>Hand-crocheted</span>
            <span>Made to order</span>
            <span>Amman, Jordan</span>
            <figure>
              <Image
                src={TEXTURES.metallic.src}
                alt=""
                width={600}
                height={Math.round(600 / TEXTURES.metallic.ratio)}
                sizes="24vw"
              />
            </figure>
          </div>
        </div>

        {/* ---------------- 01 THE MATERIAL ----------------
            Not a cut to a new section: a circle mask opens from the point the
            hero bag is scaling through, so the viewer goes INTO the surface
            of the object they were just looking at. The macro is that exact
            bag's own yarn, which is what makes the move honest rather than a
            stock texture standing in for one. */}
        <div className="phase phase-mat">
          <div className="mat-img">
            <Image
              // A dedicated wide close crop taken from the full-resolution
              // original (scripts/build-textures.mjs). The shared macro was a
              // ~430px crop out of a 1600px proxy, upscaled — which is what
              // was visibly pixelated when drawn full-bleed.
              src="/media/macro-metallic.webp"
              alt="Metallic ribbon yarn, hand-crocheted — detail of the Red Mini Luna"
              width={1937}
              height={1005}
              sizes="100vw"
            />
          </div>
          <p className="story-label"><span>01</span> The material</p>
          <p className="mat-note">Metallic ribbon yarn, worked one stitch at a time.</p>
        </div>

        {/* ---------------- 02 THE SHAPE ----------------
            Four products, four forms — as pure silhouettes rather than four
            cards. They are hard-thresholded alpha masks filled with the brand
            pink (scripts/build-silhouettes.mjs), which is also the only way
            to put these bags on navy at all: the photographic cut-outs carry
            a soft studio matte that glows against a dark field. */}
        <div className="phase phase-shape">
          <p className="story-label story-label-pink"><span>02</span> The shape</p>
          <ul className="shape-row">
            {SHAPES.map((sh) => (
              <li key={sh.slug} className={`shape-item shape-${sh.slug}`}>
                <span
                  className="sil"
                  role="img"
                  aria-label={`Silhouette of the ${sh.name} bag`}
                  style={{
                    ["--sil" as string]: `url(/media/silhouette-${sh.slug}.webp)`,
                    ["--ratio" as string]: sh.ratio,
                    ["--w" as string]: sh.width,
                    ["--fill" as string]: sh.fill,
                  }}
                />
                <em>{sh.name}</em>
                <i>{sh.note}</i>
              </li>
            ))}
          </ul>
          <p className="shape-note">Each one its own form. None of them a version of another.</p>
        </div>

        {/* ---------------- 03 MAKE IT YOURS ----------------
            The bag holds its position and its colour changes underneath the
            viewer. Only colour moves, because only colour has real
            photography behind it. */}
        <div className="phase phase-cust">
          <p className="story-label story-label-navy"><span>03</span> Make it yours</p>

          {/* The colour name set oversized and running BEHIND the object — the
              same device as the hero. It is what gives this phase something
              to look at besides a bag on an empty field, and it makes the
              colour change a compositional event rather than a swap. */}
          <ul className="cust-word">
            {customFrames.map((cf, i) => (
              <li
                key={cf.colour}
                style={{
                  // Starts after the field has finished wiping in, and ends
                  // before the "details" line takes over.
                  ["--w0" as string]: (0.17 + i * 0.06).toFixed(3),
                  ["--w1" as string]: (0.17 + i * 0.06 + 0.06).toFixed(3),
                }}
              >
                {cf.colour}
              </li>
            ))}
          </ul>

          <div className="cust-bag">
            {customFrames.map((cf, i) => (
              <Image
                key={cf.colour}
                // The ORDINARY cut-out here, not the tile variant. The tile
                // assets exist to stop a pale halo on mid-tone fields; on
                // this pale pink field there is no halo to stop, and their
                // harder shadow cut shows as a ragged grey edge at this
                // scale. Right asset, right field.
                src={cutSrc(cf.frame)}
                alt={miniLuna ? altFor(miniLuna, cf.colour) : cf.colour}
                width={1200}
                height={Math.round(1200 / cf.frame.ratio)}
                sizes="(max-width: 860px) 88vw, 50vw"
                style={{
                  // Starts after the field has finished wiping in, and ends
                  // before the "details" line takes over.
                  ["--w0" as string]: (0.17 + i * 0.06).toFixed(3),
                  ["--w1" as string]: (0.17 + i * 0.06 + 0.06).toFixed(3),
                  ["--s" as string]: FRAME_FIT[cf.colour]?.s ?? 1,
                  ["--tx" as string]: `${FRAME_FIT[cf.colour]?.tx ?? 0}%`,
                  ["--ty" as string]: `${FRAME_FIT[cf.colour]?.ty ?? 0}%`,
                }}
              />
            ))}
          </div>

          <div className="cust-steps">
            <p className="cust-step cust-step-1">Choose<br />a colour.</p>
            <p className="cust-step cust-step-2">Choose<br />the details.</p>
            <p className="cust-step cust-step-3">Make it<br />yours.</p>
          </div>

        </div>

        {/* ---------------- 04 THE FINISHED OBJECT ---------------- */}
        <div className="phase phase-final">
          <p className="final-line final-a">Made by hand.</p>
          <p className="final-line final-b">Made yours.</p>
          {heroBag && miniLuna ? (
            <figure className="final-bag">
              <Image
                src={cutSrc(heroBag)}
                alt={altFor(miniLuna, "Red")}
                width={1100}
                height={Math.round(1100 / heroBag.ratio)}
                sizes="(max-width: 860px) 88vw, 46vw"
              />
            </figure>
          ) : null}
        </div>
      </ScrollStory>

      {/* ---------------- COLLECTION ----------------
          The story releases and the product floor arrives: every photographed
          colourway at once, each on its own field. The tile IS the design —
          no card, no border, no shadow, no button over the image. */}
      <section className="grid-wrap" id="collection">
        {/* One line, not an introduction. The jump from the quiet pink frame
            to a wall of colour is the transition; a big heading in between
            only delays it. */}
        <div className="grid-head">
          <h2 className="grid-kicker">The collection</h2>
          <p className="grid-title">Every colour we have made.</p>
        </div>
        <ul className="col-grid">
          {collection.map((item) => (
            <li key={`${item.slug}-${item.colour}`} className="col-tile">
              <Link href={`/product/${item.slug}`}>
                <span className="ct-field" style={{ background: item.field }}>
                  <Image
                    src={item.cut}
                    alt={item.alt}
                    width={900}
                    height={Math.round(900 / item.ratio)}
                    sizes="(max-width: 700px) 46vw, 23vw"
                    loading="lazy"
                    className={item.isCut ? "ct-cut" : "ct-photo"}
                  />
                  <span className="ct-view">View</span>
                </span>
                <span className="ct-meta">
                  <span className="ct-name">{item.product}</span>
                  <span className="ct-colour">{item.colour}</span>
                  <span className="ct-price">{item.price}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
