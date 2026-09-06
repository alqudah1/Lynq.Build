// Arcubed homepage — editorial art-direction pass.
//
// MEDIA RULE: every bag on this page is REAL client photography, imported by
// scripts/import-product-media.mjs from clients/Arcubed_Label/03_Images/ and
// resolved through src/lib/product-media.ts. Where a product has no real
// frame, it falls back to BagArt (the honest illustrative placeholder) — it is
// never shown with another product's photo, and no 3D is used anywhere on
// this page. No approved product geometry exists yet; see
// docs/3d-production/PRODUCT-GEOMETRY-MAP.md.
//
// WHERE 3D EVENTUALLY GOES: the hero object and each collection object are
// already isolated as their own layout layer (`.ed-object`), positioned over
// and under type rather than boxed in a viewer. Swapping a photo for a canvas
// is a change of what fills that layer, not a change of layout — which is the
// point of not building around a rectangular <3DViewer>.

import Link from "next/link";
import Image from "next/image";
import { getActiveBags, getActiveColours, getReadyForDeliveryItems, getStoreSettings } from "@/lib/repository";
import { defaultSelectionFor, toRenderInput } from "@/lib/pricing";
import { resolveProductMedia, TEXTURES } from "@/lib/product-media";
import { formatMoney } from "@/lib/site-settings";
import BagArt from "@/components/BagArt";
import Reveal from "@/components/Reveal";
import type { Bag } from "@/lib/types";

export const dynamic = "force-dynamic";

/** One product object — real photo where we have one, honest fallback where we don't. */
function BagObject({ bag, priority = false, sizes }: { bag: Bag; priority?: boolean; sizes: string }) {
  const media = resolveProductMedia(bag);
  if (!media) {
    return <BagArt input={toRenderInput(bag, defaultSelectionFor(bag))} />;
  }
  return (
    <Image
      src={media.src}
      alt={media.alt}
      width={1200}
      height={Math.round(1200 / media.objectRatio)}
      sizes={sizes}
      priority={priority}
      className="ed-object-img"
    />
  );
}

export default async function HomePage() {
  const [bags, colours, rfd, settings] = await Promise.all([
    getActiveBags(),
    getActiveColours(),
    getReadyForDeliveryItems(),
    getStoreSettings(),
  ]);
  // Confirmed promise: NEXT-DAY DELIVERY IN JORDAN. store_settings holds
  // "Next day"; the country is appended because the label does not carry it
  // and the promise is only true inside Jordan.
  const fulfillmentLabel = settings?.readyForDeliveryFulfillmentLabel ?? "Next day";
  const deliveryPromise = `${fulfillmentLabel.replace(/\s+day$/i, "-day")} delivery in Jordan`;

  const byName = (n: string) => bags.find((b) => b.name.trim().toLowerCase() === n);
  const nova = byName("nova") ?? bags[0];
  const vault = byName("vault");
  const miniLuna = byName("mini luna");
  const loco = byName("loco");
  const rest = [vault, miniLuna, loco].filter(Boolean) as Bag[];
  const inStock = rfd.filter((i) => i.quantityAvailable > 0).slice(0, 6);

  return (
    <>
      {/* ---------------- 1. HERO ---------------- */}
      <section className="ed-hero">
        <div className="ed-hero-type" aria-hidden="true">
          <span className="ed-hero-line ed-hero-line-a">ARCU</span>
          <span className="ed-hero-line ed-hero-line-b">BED</span>
        </div>
        <h1 className="visually-hidden">Arcubed — hand-crocheted bags, made to order</h1>
        {nova ? (
          <div className="ed-hero-object ed-object">
            <BagObject bag={nova} priority sizes="(max-width: 780px) 86vw, 46vw" />
          </div>
        ) : null}
        <div className="ed-hero-meta">
          <p className="ed-kicker">Handmade in small batches</p>
          <Link className="ed-link" href="/shop">
            Shop the collection
          </Link>
        </div>
      </section>

      {/* ---------------- 2. BRAND STATEMENT ---------------- */}
      <Reveal as="section" className="ed-statement">
        <p className="ed-statement-line">MADE BY HAND.</p>
        <p className="ed-statement-line ed-statement-line-2">MADE YOURS.</p>
        <p className="ed-statement-note">
          Every bag is crocheted one stitch at a time, to your colour and your fittings. Nothing is
          made before you choose it.
        </p>
      </Reveal>

      {/* ---------------- 3. COLLECTION ---------------- */}
      <section className="ed-collection">
        <Reveal className="ed-section-head">
          <p className="ed-kicker">The collection</p>
        </Reveal>

        {nova ? (
          <Reveal as="article" className="ed-piece ed-piece-lead">
            <Link href={`/product/${nova.slug}`} className="ed-piece-link">
              <span className="ed-piece-name">{nova.name}</span>
              <span className="ed-object ed-piece-object">
                <BagObject bag={nova} sizes="(max-width: 780px) 78vw, 40vw" />
              </span>
              <span className="ed-piece-meta">
                <span>{nova.tagline}</span>
                <span className="ed-price">{formatMoney(nova.basePrice, "JOD")}</span>
              </span>
            </Link>
          </Reveal>
        ) : null}

        <div className="ed-piece-row">
          {rest.map((bag, i) => (
            <Reveal as="article" key={bag.id} className={`ed-piece ed-piece-${i + 1}`} delay={i * 90}>
              <Link href={`/product/${bag.slug}`} className="ed-piece-link">
                <span className="ed-piece-name">{bag.name}</span>
                <span className="ed-object ed-piece-object">
                  <BagObject bag={bag} sizes="(max-width: 780px) 62vw, 26vw" />
                </span>
                <span className="ed-piece-meta">
                  <span>{bag.tagline}</span>
                  <span className="ed-price">{formatMoney(bag.basePrice, "JOD")}</span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------- 4. CUSTOMIZE ---------------- */}
      <Reveal as="section" className="ed-customize">
        <div className="ed-customize-copy">
          <p className="ed-kicker ed-kicker-pink">Customize yours</p>
          <h2 className="ed-h2">
            Choose the colour.
            <br />
            Choose the fittings.
            <br />
            We make it after.
          </h2>
          <Link className="ed-link ed-link-pink" href="/shop">
            Start customizing
          </Link>
        </div>
        {colours.length ? (
          <ul className="ed-swatches" aria-label="Available colours">
            {colours.map((c) => (
              <li key={c.id} className="ed-swatch">
                {/* No hex is confirmed for any real colourway yet, so a swatch
                    shows the NAME rather than an invented colour chip. */}
                <span
                  className={c.hex ? "ed-swatch-dot" : "ed-swatch-dot ed-swatch-dot-named"}
                  style={c.hex ? { background: c.hex } : undefined}
                  aria-hidden="true"
                />
                {c.name}
              </li>
            ))}
          </ul>
        ) : null}
      </Reveal>

      {/* ---------------- 5. READY FOR DELIVERY ---------------- */}
      <section className="ed-ready">
        <Reveal className="ed-ready-head">
          <h2 className="ed-ready-title">
            READY FOR
            <br />
            DELIVERY
          </h2>
          <p className="ed-ready-sub">Already made. {deliveryPromise}.</p>
        </Reveal>

        {inStock.length ? (
          <Reveal as="ul" className="ed-ready-list">
            {inStock.map((item, i) => (
              <li key={item.id} className="ed-ready-item" style={{ "--i": i } as React.CSSProperties}>
                <Link href={`/ready-for-delivery/${item.id}`}>
                  <span className="ed-ready-product">{item.productName}</span>
                  <span className="ed-ready-config">
                    {item.colourName ?? item.configurationDescription ?? item.title}
                  </span>
                  <span className="ed-ready-qty">{item.quantityAvailable}</span>
                </Link>
              </li>
            ))}
          </Reveal>
        ) : (
          <Reveal className="ed-ready-empty">
            <p>Nothing finished and waiting right now — every piece is being made to order.</p>
            <Link className="ed-link ed-link-pink" href="/shop">
              Make one yours
            </Link>
          </Reveal>
        )}
      </section>

      {/* ---------------- 6. CRAFT ---------------- */}
      <section className="ed-craft">
        <Reveal className="ed-craft-big">
          <Image src={TEXTURES.fringe.src} alt={TEXTURES.fringe.alt} width={1100} height={880} sizes="(max-width: 780px) 100vw, 54vw" className="ed-craft-img" />
        </Reveal>
        <Reveal className="ed-craft-words" delay={80}>
          <p className="ed-craft-line">
            One stitch<br />at a time.
          </p>
          <p className="ed-craft-note">
            No two Arcubed bags are identical. The yarn, the tension, the hand — all of it shows,
            and that is the point.
          </p>
        </Reveal>
        <Reveal className="ed-craft-small ed-craft-small-1" delay={140}>
          <Image src={TEXTURES.metallic.src} alt={TEXTURES.metallic.alt} width={900} height={700} sizes="(max-width: 780px) 46vw, 22vw" className="ed-craft-img" />
        </Reveal>
        <Reveal className="ed-craft-small ed-craft-small-2" delay={200}>
          <Image src={TEXTURES.chunky.src} alt={TEXTURES.chunky.alt} width={900} height={600} sizes="(max-width: 780px) 46vw, 22vw" className="ed-craft-img" />
        </Reveal>
      </section>
    </>
  );
}
