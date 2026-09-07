import Link from "next/link";
import Image from "next/image";
import type { Bag } from "@/lib/types";
import { money } from "@/lib/pricing";
import { framesForColour, tileSrc, altFor } from "@/lib/product-media";
import { COLLECTION, SHOP_RHYTHM, type CollectionEntry } from "@/lib/collection";
import { variantHref } from "@/lib/variant";

/**
 * The colourway wall, shared by /shop and the homepage preview.
 *
 * One component so the two surfaces cannot drift into different catalogue
 * languages, which is exactly what had happened: the Shop had a rhythmic
 * 12-column grid while the homepage showed a flat four-up, and the homepage
 * tiles linked to the product WITHOUT their colour, so clicking Silver there
 * opened the default.
 */
export default function CollectionGrid({
  bags,
  limit,
  entries = COLLECTION,
}: {
  bags: Bag[];
  limit?: number;
  entries?: CollectionEntry[];
}) {
  const bySlug = new Map(bags.map((b) => [b.slug, b]));
  const source = limit ? entries.slice(0, limit) : entries;

  const tiles = source
    .map((entry, i) => {
      const bag = bySlug.get(entry.slug);
      const frame = bag ? framesForColour(bag, entry.colour)[0] : undefined;
      if (!bag || !frame) return null;
      const rhythm = SHOP_RHYTHM[i % SHOP_RHYTHM.length];
      const asPhoto = Boolean(entry.forcePhoto) || !frame.cutOk;
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
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return (
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
  );
}
