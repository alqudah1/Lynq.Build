// Shop — the colourway wall.
//
// Every verified product/colour pairing, each tile carrying its own colour in
// the link (src/lib/variant.ts) so the product page opens on the colourway the
// customer actually clicked. Frame proportions follow a fixed catalogue
// rhythm (SHOP_RHYTHM), never masonry.

import Link from "next/link";
import Image from "next/image";
import { getActiveBags } from "@/lib/repository";
import { money } from "@/lib/pricing";
import { framesForColour, tileSrc, altFor } from "@/lib/product-media";
import { COLLECTION, SHOP_RHYTHM } from "@/lib/collection";
import { variantHref } from "@/lib/variant";
import type { Bag } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shop",
  description: "Every Arcubed colourway. Four hand-crocheted shapes, made to order in Jordan.",
};

export default async function ShopPage() {
  const bags = await getActiveBags();
  const bySlug = new Map<string, Bag>(bags.map((b) => [b.slug, b]));

  interface Tile {
    key: string; href: string; product: string; colour: string; field: string;
    src: string; asPhoto: boolean; ratio: number; alt: string; price: string;
    rhythm: { span: number; ratio: string; feature?: true };
  }

  const tiles = COLLECTION.map<Tile | null>((entry, i) => {
    const bag = bySlug.get(entry.slug);
    const frame = bag ? framesForColour(bag, entry.colour)[0] : undefined;
    if (!bag || !frame) return null;
    const rhythm = SHOP_RHYTHM[i % SHOP_RHYTHM.length];
    const asPhoto = entry.forcePhoto || !frame.cutOk;
    return {
      key: `${entry.slug}-${entry.colour}`,
      href: variantHref(bag.slug, entry.colour),
      product: entry.product,
      colour: entry.colour,
      field: entry.field,
      src: asPhoto ? frame.photo : tileSrc(frame),
      asPhoto,
      ratio: frame.ratio,
      alt: altFor(bag, entry.colour),
      price: money(bag.basePrice),
      rhythm,
    };
  }).filter((t): t is Tile => t !== null);

  return (
    <>
      <section className="shopx-head">
        <p className="shopx-kicker">Shop</p>
        <h1 className="shopx-title">
          Every colour
          <br />
          we have made.
        </h1>
        <p className="shopx-sub">
          {tiles.length} colourways. Four shapes. Each one crocheted by hand once you choose it.
        </p>
      </section>

      <section className="shopx">
        <ul className="shopx-grid">
          {tiles.map((t) => (
            <li
              key={t.key}
              className={`shopx-cell${t.rhythm.feature ? " is-feature" : ""}`}
              style={{ ["--span" as string]: t.rhythm.span, ["--ar" as string]: t.rhythm.ratio }}
            >
              <Link href={t.href} className="shopx-link">
                <span className="shopx-field" style={{ background: t.asPhoto ? undefined : t.field }}>
                  <Image
                    src={t.src}
                    alt={t.alt}
                    width={1600}
                    height={Math.round(1600 / t.ratio)}
                    // Declared from the tile's actual span. The wide feature
                    // spans BOTH mobile columns, so a flat 50vw made Next
                    // serve a 256px derivative for a 363px slot.
                    sizes={
                      t.rhythm.feature
                        ? "(max-width: 1080px) 100vw, 62vw"
                        : "(max-width: 760px) 58vw, 42vw"
                    }
                    className={t.asPhoto ? "shopx-photo" : "shopx-cut"}
                  />
                  <span className="shopx-view">View</span>
                </span>
                <span className="shopx-meta">
                  <span className="shopx-name">{t.product}</span>
                  <span className="shopx-colour">{t.colour}</span>
                  <span className="shopx-price">{t.price}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
