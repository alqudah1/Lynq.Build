// Arcubed homepage — fashion-editorial composition.
//
// MEDIA RULE: every bag on this page is REAL client photography resolved
// through src/lib/product-media.ts. The illustrated BagArt placeholder does
// not appear on this page at all — it is not the Arcubed identity. No 3D is
// used anywhere: no approved production geometry exists (see
// docs/3d-production/PRODUCT-GEOMETRY-MAP.md).
//
// Objects are positioned as their own layer so a photo can later be swapped
// for a canvas without touching the layout.

import Link from "next/link";
import Image from "next/image";
import { getActiveBags, getActiveColours, getReadyForDeliveryItems, getStoreSettings } from "@/lib/repository";
import { formatMoney } from "@/lib/site-settings";
import { framesForColour, resolveMedia, cutSrc, TEXTURES, altFor } from "@/lib/product-media";
import Reveal from "@/components/Reveal";
import HeroCollage from "@/components/HeroCollage";
import MaskReveal from "@/components/editorial/MaskReveal";
import type { Bag } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Picks a specific colourway's frame, falling back to the product's first. */
function frame(bag: Bag | undefined, colour: string) {
  if (!bag) return null;
  const exact = framesForColour(bag, colour);
  if (exact.length) return exact[0];
  return resolveMedia(bag)?.frame ?? null;
}

export default async function HomePage() {
  const [bags, colours, rfd, settings] = await Promise.all([
    getActiveBags(),
    getActiveColours(),
    getReadyForDeliveryItems(),
    getStoreSettings(),
  ]);

  const by = (n: string) => bags.find((b) => b.name.trim().toLowerCase() === n);
  const nova = by("nova");
  const vault = by("vault");
  const miniLuna = by("mini luna");
  const loco = by("loco");

  // Hero cast — one dominant object plus three supporting, chosen for colour
  // contrast across the archive: gold, red, silver, olive.
  const heroLead = frame(nova, "Black");
  const heroLeft = frame(miniLuna, "Red");
  const heroRight = frame(nova, "Silver");

  const fulfillmentLabel = settings?.readyForDeliveryFulfillmentLabel ?? "Next day";
  const deliveryPromise = `${fulfillmentLabel.replace(/\s+day$/i, "-day")} delivery in Jordan`;
  const inStock = rfd.filter((i) => i.quantityAvailable > 0).slice(0, 5);

  const collection = [
    { bag: nova, colour: "Gold", cls: "cx-nova" },
    { bag: vault, colour: "Brown", cls: "cx-vault" },
    { bag: miniLuna, colour: "Red", cls: "cx-luna" },
    { bag: loco, colour: "Brown", cls: "cx-loco" },
  ].filter((c) => c.bag) as { bag: Bag; colour: string; cls: string }[];

  return (
    <>
      {/* ---------------- HERO ----------------
          Statement-led, not product-promo-led: the headline occupies most of
          the viewport and the products cross THROUGH it (line 1 behind the
          dominant object, line 2 in front). Cream field, not pink — the
          products carry the colour. */}
      <section className="hx">
        <HeroCollage>
          <div className="hx-stage">
            <h1 className="hx-h">
              <MaskReveal as="span" className="hx-line hx-l1">MORE THAN</MaskReveal>
              <MaskReveal as="span" className="hx-line hx-l2" delay={140}>A BAG.</MaskReveal>
            </h1>

            {heroLead ? (
              <figure className="hx-obj hx-lead">
                <Image src={cutSrc(heroLead)} alt={altFor(nova!, "Black")} width={1200}
                       height={Math.round(1200 / heroLead.ratio)} priority
                       sizes="(max-width:780px) 74vw, 42vw" />
              </figure>
            ) : null}
            {heroLeft ? (
              <figure className="hx-obj hx-left">
                <Image src={cutSrc(heroLeft, true)} alt={altFor(miniLuna!, "Red")} width={600}
                       height={Math.round(600 / heroLeft.ratio)} sizes="(max-width:780px) 40vw, 19vw" />
              </figure>
            ) : null}
            {heroRight ? (
              <figure className="hx-obj hx-right">
                <Image src={cutSrc(heroRight, true)} alt={altFor(nova!, "Silver")} width={600}
                       height={Math.round(600 / heroRight.ratio)} sizes="(max-width:780px) 34vw, 16vw" />
              </figure>
            ) : null}
            {/* Texture layer, not a fourth bag — depth without a fourth PNG. */}
            <figure className="hx-obj hx-tex" aria-hidden="true">
              <Image src={TEXTURES.metallic.src} alt="" width={600}
                     height={Math.round(600 / TEXTURES.metallic.ratio)} sizes="20vw" />
            </figure>
          </div>
        </HeroCollage>

        <div className="hx-meta">
          <p className="hx-eyebrow">Handmade in small batches</p>
          <p className="hx-sub">Objects shaped by colour, texture and individuality.</p>
          <Link className="hx-cta" href="/shop">
            Explore the collection <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      {/* ---------------- STATEMENT ---------------- */}
      <section className="st">
        <Reveal className="st-a">
          <p className="st-line">MADE</p>
          <p className="st-line">BY HAND.</p>
        </Reveal>
        <Reveal className="st-img" delay={90}>
          <Image src={TEXTURES.metallic.src} alt="Close detail of metallic ribbon yarn, hand-crocheted"
                 width={1100} height={Math.round(1100 / TEXTURES.metallic.ratio)} sizes="(max-width:860px) 90vw, 46vw" />
        </Reveal>
        <Reveal className="st-b" delay={140}>
          <p className="st-line st-line-out">MADE YOURS.</p>
          <p className="st-note">
            Every piece is crocheted one stitch at a time, in your colour and your fittings.
            Nothing is made before you choose it.
          </p>
        </Reveal>
      </section>

      {/* ---------------- COLLECTION ---------------- */}
      <section className="cx">
        <Reveal className="cx-head">
          <p className="ed-kicker">The collection</p>
          <h2 className="cx-title">Four shapes.<br />Yours in any colour.</h2>
        </Reveal>

        <div className="cx-grid">
          {collection.map(({ bag, colour, cls }, i) => {
            const f = frame(bag, colour);
            return (
              <Reveal as="article" key={bag.id} className={`cx-item ${cls}`} delay={i * 70}>
                <Link href={`/product/${bag.slug}`} className="cx-link">
                  <span className={`cx-media${f?.cutOk ? " cx-media-cut" : ""}`}>
                    {f ? (
                      <Image src={f.cutOk ? cutSrc(f) : f.photo} alt={altFor(bag, colour)} width={1600}
                             height={Math.round(1600 / f.ratio)} sizes="(max-width:860px) 92vw, 46vw" />
                    ) : null}
                  </span>
                  <span className="cx-name">{bag.name}</span>
                  <span className="cx-meta">
                    <span>{bag.tagline}</span>
                    <span className="cx-price">{formatMoney(bag.basePrice, "JOD")}</span>
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ---------------- CUSTOMIZE ---------------- */}
      <section className="cz">
        <Reveal className="cz-media">
          {heroLeft ? (
            <Image src={cutSrc(heroLeft)} alt={altFor(miniLuna!, "Red")} width={1200}
                   height={Math.round(1200 / heroLeft.ratio)} sizes="(max-width:860px) 80vw, 42vw" />
          ) : null}
        </Reveal>
        <Reveal className="cz-copy" delay={80}>
          <p className="ed-kicker ed-kicker-pink">Customize yours</p>
          <h2 className="cz-title">MAKE IT<br />YOURS.</h2>
          <p className="cz-note">Choose the colour, the strap, the chain. Then we make it.</p>
          <ul className="cz-swatches" aria-label="Available colours">
            {colours.map((c) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
          <Link className="ed-link ed-link-pink" href="/shop">Customize your bag</Link>
        </Reveal>
      </section>

      {/* ---------------- READY FOR DELIVERY ---------------- */}
      <section className="rd">
        <Reveal className="rd-head">
          <p className="ed-kicker">Ready for delivery</p>
          <h2 className="rd-title">READY<br />NOW</h2>
          <p className="rd-promise">{deliveryPromise}.</p>
        </Reveal>
        {inStock.length ? (
          <Reveal as="ul" className="rd-list" delay={80}>
            {inStock.map((item, i) => (
              <li key={item.id} style={{ "--i": i } as React.CSSProperties}>
                <Link href={`/ready-for-delivery/${item.id}`}>
                  <span className="rd-product">{item.productName}</span>
                  <span className="rd-config">{item.colourName ?? item.configurationDescription ?? item.title}</span>
                  <span className="rd-qty">{item.quantityAvailable}</span>
                </Link>
              </li>
            ))}
          </Reveal>
        ) : (
          <Reveal className="rd-empty" delay={80}>
            <p>Nothing finished and waiting right now — every piece is being made to order.</p>
            <Link className="ed-link" href="/ready-for-delivery">See how it works</Link>
          </Reveal>
        )}
      </section>

      {/* ---------------- CRAFT ---------------- */}
      <section className="cf">
        <Reveal className="cf-big">
          <Image src={TEXTURES.fringe.src} alt="Close detail of hand-knotted fringe" width={1100}
                 height={Math.round(1100 / TEXTURES.fringe.ratio)} sizes="(max-width:860px) 100vw, 56vw" />
        </Reveal>
        <Reveal className="cf-words" delay={70}>
          <p className="cf-line">One stitch<br />at a time.</p>
          <p className="cf-note">
            No two Arcubed bags are identical. The yarn, the tension, the hand — all of it shows,
            and that is the point.
          </p>
        </Reveal>
        <Reveal className="cf-s1" delay={120}>
          <Image src={TEXTURES.gold.src} alt="Close detail of metallic gold crochet" width={900}
                 height={Math.round(900 / TEXTURES.gold.ratio)} sizes="(max-width:860px) 48vw, 26vw" />
        </Reveal>
        <Reveal className="cf-s2" delay={170}>
          <Image src={TEXTURES.twotone.src} alt="Close detail of two-tone silver and gold crochet" width={900}
                 height={Math.round(900 / TEXTURES.twotone.ratio)} sizes="(max-width:860px) 48vw, 26vw" />
        </Reveal>
      </section>
    </>
  );
}
