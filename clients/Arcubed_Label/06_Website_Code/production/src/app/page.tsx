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
import { framesForColour, resolveMedia, cutSrc, tileSrc, altFor } from "@/lib/product-media";
import ScrollStory from "@/components/home/ScrollStory";
import CollectionGrid from "@/components/CollectionGrid";
import type { Bag } from "@/lib/types";
import "./home.css";

export const dynamic = "force-dynamic";


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
  // The closing frame deliberately uses a DIFFERENT product. The story
  // previously opened and closed on the same Red Mini Luna, which made the
  // range look like one bag. Vault Olive is the strongest contrast available:
  // another silhouette, another colour family, and its frame covers 83% of
  // the sensor so it holds at size.
  const vault = by("vault");
  const closingBag = frame(vault, "Olive Green");

  // Only colourways that actually resolved to a frame survive — a colour with
  // no photography simply does not appear rather than falling back to another
  // bag's picture.
  const customFrames = CUSTOM_COLOURS.map((colour) => ({ colour, frame: frame(miniLuna, colour) }))
    .filter((c): c is { colour: string; frame: NonNullable<ReturnType<typeof frame>> } => Boolean(c.frame));

  return (
    <div className="home">
      <ScrollStory>
        {/* ---------------- HERO ---------------- */}
        <div className="phase phase-hero">
          {/* White product ground. The hero used to be one pink block from the
              nav to a navy information bar; the bag now stands on light and
              the field change is the composition, not decoration. */}
          <div className="hero-floor" aria-hidden="true" />

          {/* A real h1, art-directed rather than one face at three sizes:
              MADE restrained and letter-spaced, YOUR expressive in italic,
              WAY. the heavy anchor. */}
          <h1 className="hero-type">
            <span className="hero-l1">Made</span>
            <span className="hero-l2">Your</span>
            <span className="hero-l3">Way.</span>
          </h1>

          {heroBag && miniLuna ? (
            <figure className="hero-bag">
              <Image
                // The de-haloed variant. The ordinary cut-out carries the
                // studio contact shadow, which on the white product floor
                // reads as a grey smear beside the bag rather than grounding.
                src={tileSrc(heroBag)}
                alt={altFor(miniLuna, "Red")}
                width={1600}
                height={Math.round(1600 / heroBag.ratio)}
                // Declared above the element's resting width on purpose: the hero bag
                // scales up past 2x during the enter sequence, and `sizes` cannot
                // express a transform, so a resting-width budget left it soft
                // exactly while it is largest on screen.
                sizes="(max-width: 860px) 200vw, 92vw"
                // Next 16 deprecated `priority` and it emitted nothing, so the
                // hero — the LCP element — was being fetched at default
                // priority and the browser warned about it on every load.
                // `preload` is the documented replacement and also puts a
                // <link rel="preload"> in the head, which `loading="eager"`
                // alone does not. The docs say not to combine the two.
                preload
              />
            </figure>
          ) : null}

          {/* Two short lines in one place, not a row of floating labels. */}
          <div className="hero-note">
            <p>Hand crocheted bags</p>
            <p>Made to order in Jordan</p>
          </div>

          <Link className="hero-cta" href="/shop">
            Explore the collection
          </Link>
        </div>

        {/* ---------------- 01 THE MATERIAL ----------------
            An editorial material spread, not a full-screen wallpaper. The
            macro comes from DSC04874, whose object box covers 88% of the
            sensor: the previous crop came from the hero frame, which covers
            only 67% and therefore had the fewest real pixels of any frame in
            the archive. Different product from the hero as well, so the story
            stops repeating one bag. */}
        <div className="phase phase-mat">
          <div className="mat-img">
            <Image
              src="/media/macro-ribbon.webp"
              alt="Metallic ribbon yarn, hand-crocheted"
              width={2312}
              height={1954}
              sizes="(max-width: 860px) 100vw, 75vw"
            />
          </div>
          <div className="mat-side">
            <p className="story-label"><span>01</span> The material</p>
            <p className="mat-note">
              Made one stitch
              <br />
              at a time.
            </p>
            <figure className="mat-detail">
              <Image
                src="/media/macro-twotone.webp"
                alt="Silver and gold two-tone crochet detail"
                width={1680}
                height={811}
                sizes="(max-width: 860px) 44vw, 22vw"
              />
            </figure>
            <p className="mat-fact">Metallic ribbon yarn and cotton, worked by hand in Amman.</p>
          </div>
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
            A configurator, not a slogan. The oversized colour word ran off
            the frame ("SILVER & G...") and fought the object; a rail of
            colour names with the live one marked says the same thing, reads
            as a control, and leaves the bag as the subject. */}
        <div className="phase phase-cust">
          <div className="cust-copy">
            <p className="story-label story-label-navy"><span>03</span> Make it yours</p>
            <p className="cust-head">
              Choose
              <br />
              your colour.
            </p>
            <ul className="cust-rail">
              {customFrames.map((cf, i) => (
                <li
                  key={cf.colour}
                  style={{
                    ["--w0" as string]: (0.17 + i * 0.06).toFixed(3),
                    ["--w1" as string]: (0.17 + i * 0.06 + 0.06).toFixed(3),
                  }}
                >
                  <span>{cf.colour}</span>
                </li>
              ))}
            </ul>
            <p className="cust-foot">Then the size, the strap, the chain. Yours before it is made.</p>
          </div>

          <div className="cust-bag">
            {customFrames.map((cf, i) => (
              <Image
                key={cf.colour}
                src={cutSrc(cf.frame)}
                alt={miniLuna ? altFor(miniLuna, cf.colour) : cf.colour}
                width={1200}
                height={Math.round(1200 / cf.frame.ratio)}
                // Each colourway carries its own `--s` scale so the objects
                // match optically, which pushes the widest of them to 63vw
                // while resting width is 52vw. `sizes` cannot express a
                // transform, so it is declared above the resting width.
                sizes="(max-width: 860px) 96vw, 66vw"
                style={{
                  ["--w0" as string]: (0.17 + i * 0.06).toFixed(3),
                  ["--w1" as string]: (0.17 + i * 0.06 + 0.06).toFixed(3),
                  ["--s" as string]: FRAME_FIT[cf.colour]?.s ?? 1,
                  ["--tx" as string]: `${FRAME_FIT[cf.colour]?.tx ?? 0}%`,
                  ["--ty" as string]: `${FRAME_FIT[cf.colour]?.ty ?? 0}%`,
                }}
              />
            ))}
          </div>
        </div>

        {/* ---------------- 04 THE FINISHED OBJECT ---------------- */}
        <div className="phase phase-final">
          <p className="final-line final-a">Made by hand.</p>
          <p className="final-line final-b">Made yours.</p>
          {closingBag && vault ? (
            <figure className="final-bag">
              <Image
                src={tileSrc(closingBag)}
                alt={altFor(vault, "Olive Green")}
                width={1400}
                height={Math.round(1400 / closingBag.ratio)}
                sizes="(max-width: 860px) 78vw, 42vw"
              />
            </figure>
          ) : null}
        </div>
      </ScrollStory>

      {/* ---------------- COLLECTION ----------------
          The story releases and the product floor arrives: every photographed
          colourway at once, each on its own field. The tile IS the design —
          no card, no border, no shadow, no button over the image. */}
      {/* Collection preview. Same component as /shop, so the catalogue
          language is identical by construction and the tiles carry their
          colourway in the link exactly as the Shop's do. */}
      <section className="shopx" id="collection">
        <div className="shopx-preview-head">
          <h2 className="shopx-kicker">The collection</h2>
          <Link className="shopx-all" href="/shop">
            All sixteen colourways
          </Link>
        </div>
        <CollectionGrid bags={bags} limit={8} />
      </section>
    </div>
  );
}
