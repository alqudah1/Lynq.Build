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
import { money } from "@/lib/pricing";
import { framesForColour, resolveMedia, cutSrc, tileSrc, altFor } from "@/lib/product-media";
import { variantHref } from "@/lib/variant";
import ScrollStory from "@/components/home/ScrollStory";
import ModelCollection from "@/components/ModelCollection";
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
 * Where each colourway lives inside the customisation band.
 *
 * These were 0.17 + i*0.06 with a 0.06 width, which put all five colours
 * between 0.17 and 0.47 of the band: on a desktop the whole sequence was over
 * before the band was half done, and the remaining 53% was a static bag.
 * Measured at 1440 and 1680, customisation animated for 44% of its band. It
 * also meant a single wheel gesture could cross two colours.
 *
 * Spread across 0.08 to 0.94 instead, so each colourway owns roughly a fifth
 * of the band and every gesture lands on a distinct colour. The phone keeps
 * its own, wider spacing in home.css (a thumb flick covers more of the band
 * than a wheel notch); these are the desktop numbers and the fallback.
 *
 * The last window's end is never read — the final colourway holds to the end
 * of the band rather than fading out — but it is emitted for consistency.
 *
 * Windows OVERLAP by CUST_OVERLAP, and that number is not free: it has to
 * equal 1/--xf, the crossfade length set in home.css. Adjacent windows meant
 * a colourway reached zero opacity on exactly the progress value where its
 * successor started from zero, so the handover contained a frame with no bag
 * in it. Overlapping by the crossfade length makes the two envelopes sum to 1
 * across the whole handover: one colour dissolves into the next.
 */
const CUST_SPAN = [0.08, 0.94] as const;
/** Must stay equal to 1 / --xf in home.css (--xf: 28). */
const CUST_OVERLAP = 0.036;
function CUST_WINDOW(i: number): [string, string] {
  const w = (CUST_SPAN[1] - CUST_SPAN[0]) / CUSTOM_COLOURS.length;
  const a = CUST_SPAN[0] + i * w;
  return [a.toFixed(3), (a + w + CUST_OVERLAP).toFixed(3)];
}

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
  // Gold, not red. The material moment immediately above IS this bag's gold
  // ribbon (DSC04874 is the Gold Mini Luna), so the form arrives in the
  // colour the customer has just been looking at. The red fill also made a
  // fourth red object on a homepage that already opens with a red bag.
  { slug: "mini-luna", name: "Mini Luna", ratio: 1.0755, width: 0.76, note: "Arch handle", fill: "#c9a24e" },
  // Burgundy at a value that actually separates from navy; the old dusty rose
  // read as a muddy blob rather than as the fringed form.
  { slug: "loco", name: "Loco", ratio: 1.5453, width: 0.94, note: "Fringed", fill: "#b06a72" },
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
  // NOVA IS THE FACE OF THE BRAND (client, 2026-09: "the best selling bag by
  // a high margin and the most visually appealing to most people").
  //
  // DSC05786 by name: Gold Nova, the frame that already leads Nova on the
  // Shop wall, so the hero and the Shop introduce the same bag. The versions
  // WITH a handle (DSC05776, DSC05778) were tried first for the through-
  // opening the Mini Luna hero relied on, and rejected at hero scale: their
  // mattes leave a pale rim along the handle and specks of studio ground in
  // the opening, which a 200vw phone crop makes plain. This one's edge is the
  // cleanest in the Nova archive. Rebuilt from the 6000px original
  // (HIRES_CUTS). The Red Mini Luna is not retired: it keeps the material
  // close-up and the colour sequence, and the Black Mini Luna stays as the
  // hero's secondary object.
  const nova = by("nova");
  const novaGold = nova ? framesForColour(nova, "Gold") : [];
  const heroBag = novaGold.find((f) => f.frameId === "DSC05786") ?? novaGold[0] ?? frame(miniLuna, "Red");
  const heroProduct = heroBag && novaGold.includes(heroBag) ? nova : miniLuna;
  const heroColour = heroProduct === nova ? "Gold" : "Red";
  // The closing frame deliberately uses a DIFFERENT product. The story
  // previously opened and closed on the same Red Mini Luna, which made the
  // range look like one bag. Vault Olive is the strongest contrast available:
  // another silhouette, another colour family, and its frame covers 83% of
  // the sensor so it holds at size.
  // CLOSING CAST — the range, not one bag on a pink field.
  //
  // Every candidate cut-out was composited on the actual #FFE0FD field before
  // any of this was written. Loco is excluded on evidence, not taste: all six
  // of its frames are cutOk:false because the fringe will not matte cleanly,
  // and a forced extraction would read as a torn edge at this size.
  //
  // Four objects, three products, four colour families, and no red — the Red
  // Mini Luna already owns the hero, and repeating it here is what made the
  // range look like one bag in the first place.
  const vault = by("vault");
  // THE CLOSING FRAME IS ONE CLEAN OBJECT.
  //
  // Two rebuilds now. First it was two cut-outs on a drawn floor, which was a
  // collage. Then it was a 50/50 split with a close crop of Burgundy Loco,
  // and the crop was the problem: at that size the fringe filled the panel
  // and the bag stopped being legible as a bag.
  //
  // Measured every photograph in the archive by studio-ground luminance and
  // by whether the object reads whole. Vault Olive is the strongest thing
  // Arcubed has for this job: ground 0.92, a structured silhouette that
  // survives at poster scale, and a clean cut-out, so it can sit on the brand
  // field with no second background competing. It is also the one shape the
  // homepage has not already used as a hero.
  const finalShot = frame(vault, "Olive Green");

  /**
   * HERO SECONDARY — one layer, not three.
   *
   * The SAME silhouette as the hero in the opposite colourway, which is the
   * headline stated as a picture: one shape, made your way. Black Nova was
   * tried first and rejected on sight — a closed, low, wide form at a third
   * of the hero's width has no handle, no opening and no edge to read, so it
   * rendered as a dark mass rather than as a bag.
   *
   * Mini Luna's arch survives the scale: the through-opening reads at 20vw,
   * so the object is still unmistakably a bag at a third the size, and black
   * against red gives the value separation Nova was picked for in the first
   * place.
   *
   * Falls back to the other dark colourways, and if none resolve the hero
   * renders without a secondary rather than substituting another product.
   */
  /*
   * DSC04873 BY NAME, not framesForColour(...)[0].
   *
   * Black has two frames and the first one, DSC04872, does not matte cleanly
   * inside the arch: a patch of the studio background survives in the handle's
   * through-opening. At the hero's scale, on white, that is a visible grey
   * smear in the one part of the object that makes it read as a bag. Both
   * frames are flagged cutOk, so nothing in the manifest predicts it — it was
   * found by rendering the composition at 2x and looking at the handle.
   *
   * Falls back to whatever Black has, then to another dark object, then to
   * nothing at all. The hero renders without a secondary rather than
   * substituting a photograph of a product it does not name.
   */
  const heroBlackFrames = miniLuna ? framesForColour(miniLuna, "Black") : [];
  const heroSecond =
    heroBlackFrames.find((f) => f.frameId === "DSC04873") ??
    heroBlackFrames[0] ??
    frame(vault, "Brown");

  /**
   * CLOSING CAST — two objects, not a scatter.
   *
   * The previous frame put three bags of similar size on an unbroken pink
   * field with no ground under any of them, and it read as three cut-outs
   * placed on a canvas rather than as a photograph. Rebuilt around one
   * dominant object and one supporting object:
   *
   *   FOCAL      Vault Olive — the widest, heaviest silhouette in the
   *              archive, and the only one whose own studio shadow survives
   *              the matte, so it can actually sit on a floor.
   *   SECONDARY  Nova Silver & Gold — a different shape family (low, closed,
   *              wide against Vault's structured body), a different colour
   *              family, and a metallic against a matte cotton. Contrast on
   *              silhouette, scale, colour AND texture.
   *
   * Mini Luna Silver and Nova Black are both gone: at the size this
   * composition wants them they were accessories to nothing.
   */
  // The closing cast is gone with the collage it arranged; see finalShot.

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

          {heroBag && heroProduct ? (
            <figure className={`hero-bag${heroProduct === nova ? " is-nova" : ""}`}>
              <Image
                // The de-haloed variant. The ordinary cut-out carries the
                // studio contact shadow, which on the white product floor
                // reads as a grey smear beside the bag rather than grounding.
                src={tileSrc(heroBag)}
                alt={altFor(heroProduct, heroColour)}
                width={1600}
                height={Math.round(1600 / heroBag.ratio)}
                // Declared above the element's resting width on purpose: the hero bag
                // scales up past 2x during the enter sequence, and `sizes` cannot
                // express a transform, so a resting-width budget left it soft
                // exactly while it is largest on screen.
                // Nova rests at 56vw on a desktop (home.css) but the enter sequence
                // scales it to ~1.5x, so the desktop budget stays at 92vw. Tablet rests
                // at 80vw; the phone keeps 200vw for the push-in on exit.
                sizes={heroProduct === nova
                  ? "(max-width: 699px) 200vw, (max-width: 860px) 84vw, 92vw"
                  : "(max-width: 860px) 200vw, 92vw"}
                quality={90}
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

          {/* The secondary layer. Cropped by the bottom edge, on the same
              white floor as the hero object so the two share a ground plane
              and the size difference reads as distance. */}
          {heroSecond && miniLuna ? (
            <figure className="hero-second" aria-hidden="true">
              <Image
                src={tileSrc(heroSecond)}
                alt=""
                width={900}
                height={Math.round(900 / heroSecond.ratio)}
                // Desktop-only by design (hidden at 860 and below), but a
                // display:none image is still fetched, so a phone was paying
                // for a picture it never shows. The small branch pins it to
                // the narrowest derivative instead of a 44vw one; the desktop
                // branch is declared just above the 20vw it actually renders
                // at, so it never resolves to a candidate it has to upscale.
                // 36vw was the width before the phone composition grew the
                // secondary to 40vw; it left a 1.11 upscale at 375.
                sizes="(max-width: 699px) 62vw, (max-width: 860px) 64px, 21vw"
                quality={90}
              />
            </figure>
          ) : null}

          {/* A magazine product credit, not a card: the object in the frame,
              named, in the colourway shown, at its real price. The price is
              read from the product rather than typed, so it cannot drift from
              the database the rest of the store prices from. */}
          {heroProduct ? (
            <div className="hero-credit">
              <span className="hero-credit-rule" aria-hidden="true" />
              <p>{heroProduct.name.trim()}</p>
              <p>{heroColour}</p>
              <p>{money(heroProduct.basePrice)}</p>
            </div>
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
          {/* A placed photograph, not a background. The page padding leaves
              white on every side of it, which is the difference between an
              editorial spread and wallpaper. Its aspect matches the crop so
              object-fit has nothing to scale. */}
          <figure className="mat-img">
            <Image
              src="/media/macro-material.webp"
              alt="Gold metallic ribbon yarn crocheted by hand, showing the handle join and stitch rows"
              width={2522}
              height={1928}
              sizes="(max-width: 860px) 92vw, 56vw"
                quality={90}
            />
          </figure>
          <div className="mat-side">
            <p className="story-label"><span>01</span> The material</p>
            <p className="mat-note">
              Made one stitch
              <br />
              at a time.
            </p>
            <span className="mat-rule" aria-hidden="true" />
            <figure className="mat-detail">
              <Image
                src="/media/macro-twotone.webp"
                alt="Silver and gold two-tone crochet detail"
                width={1465}
                height={932}
                sizes="(max-width: 860px) 42vw, 17vw"
              />
            </figure>
            <p className="mat-fact">Metallic ribbon yarn, crocheted by hand.</p>
          </div>
        </div>

        {/* ---------------- 02 THE SHAPE ----------------
            Four products, four forms — as pure silhouettes rather than four
            cards. They are hard-thresholded alpha masks filled with the brand
            pink (scripts/build-silhouettes.mjs), which is also the only way
            to put these bags on navy at all: the photographic cut-outs carry
            a soft studio matte that glows against a dark field. */}
        <div className="phase phase-shape">
          {/* The handoff from MATERIAL to FORM. A strip of the same ribbon
              carries the texture across, so the two moments read as one
              transition rather than "texture, then a poster". The forms rise
              from below while this copy is still on screen. */}
          <div className="shape-lead">
            <p className="story-label story-label-pink"><span>02</span> The shape</p>
            <p className="shape-head">
              One material.
              <br />
              Four forms.
            </p>
          </div>

          {/* One composition, no divider: label, headline, copy, forms. The
              ribbon strip that used to sit here read as decoration cutting the
              section in half, so the whole block is now a single flow and the
              forms sit directly under the copy they belong to. */}
          <div className="shape-close">
            <p className="shape-note">Each one its own form. None of them a version of another.</p>
          <ul className="shape-row">
            {SHAPES.map((sh) => (
              <li key={sh.slug} className={`shape-item shape-${sh.slug}`}>
                {/* The whole shape is the link, not just the name under it
                    (client: "tap the shape of any bag and it redirects you
                    directly to its page"). One anchor per item, nothing
                    interactive nested inside it. */}
                <Link className="shape-link" href={`/product/${sh.slug}`} aria-label={`View the ${sh.name}`}>
                  <span
                    className="sil"
                    aria-hidden="true"
                    style={{
                      ["--sil" as string]: `url(/media/silhouette-${sh.slug}.webp)`,
                      ["--ratio" as string]: sh.ratio,
                      ["--w" as string]: sh.width,
                      ["--fill" as string]: sh.fill,
                    }}
                  />
                  <em>{sh.name}</em>
                  <i>{sh.note}</i>
                </Link>
              </li>
            ))}
          </ul>
          </div>
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
            {/* WHICH BAG THESE COLOURS BELONG TO. The rail listed five
                colours under "Choose your colour." and nothing said they are
                Mini Luna's five: read as a configurator, it looked as though
                the brand only comes in five (client: "not all colors are
                available for customization"). Colour is per shape, so the
                model is named and the other eleven are one tap away. */}
            <p className="cust-model">Shown on Mini Luna</p>
            <ul className="cust-rail">
              {customFrames.map((cf, i) => (
                <li
                  key={cf.colour}
                  style={{
                    ["--w0" as string]: CUST_WINDOW(i)[0],
                    ["--w1" as string]: CUST_WINDOW(i)[1],
                  }}
                >
                  {/* Tapping a colour opens that exact colourway in the
                      customizer. Scrolling still walks through them; a finger
                      no longer has to scroll to choose one. */}
                  <Link className="cust-pick" href={miniLuna ? variantHref(miniLuna.slug, cf.colour) : "/shop"}
                        aria-label={`Customize the Mini Luna in ${cf.colour}`}>
                  {/* The same photographic swatch the shop and the product
                      pages use. A colour name on its own is not a colour, and
                      this is the one beat on the homepage whose whole subject
                      is choosing one — it was the only place in the system
                      showing colour as a word and nothing else. Decorative
                      here: the name beside it already carries the meaning. */}
                  <span className="cust-sw" aria-hidden="true">
                    <Image
                      src={tileSrc(cf.frame, true)}
                      alt=""
                      width={140}
                      height={Math.round(140 / cf.frame.ratio)}
                      sizes="46px"
                    />
                  </span>
                  <span>{cf.colour}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="cust-foot">Then the size, the strap, the chain. Yours before it is made.</p>
            <Link className="cust-all" href="/shop">All 16 colourways</Link>
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
                sizes="(max-width: 860px) 100vw, 66vw"
                quality={90}
                style={{
                  ["--w0" as string]: CUST_WINDOW(i)[0],
                  ["--w1" as string]: CUST_WINDOW(i)[1],
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
          {/* One object, the claim behind it. No split screen, no second
              background: the bag is a cut-out so the brand field IS the
              ground, which is the same language the hero opens with. */}
          <p className="fin-kicker">Made by hand</p>
          <p className="fin-head">Made yours.</p>
          {finalShot && vault ? (
            <figure className="fin-obj">
              <Image
                src={cutSrc(finalShot)}
                alt={altFor(vault, "Olive Green")}
                width={1700}
                height={Math.round(1700 / finalShot.ratio)}
                // 130vw, not 92: on a phone the object is deliberately
                // scaled past the viewport edge to meet the stacked
                // headline, and it measures 128vw at 375.
                sizes="(max-width: 759px) 130vw, 56vw"
              quality={90}
              />
            </figure>
          ) : null}
          <p className="fin-sub">Four shapes. Sixteen colourways.</p>
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
        {/* Model first. The eight tile wall here read as eight products, so
            "Nova / Gold" looked like Nova only exists in gold. It also ended
            ragged by over a thousand pixels at 1440, which is what made the
            footer appear to intrude on the collection. */}
        <ModelCollection bags={bags} />
      </section>
    </div>
  );
}
