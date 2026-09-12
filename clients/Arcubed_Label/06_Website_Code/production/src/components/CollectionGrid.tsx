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

  // CLOSE THE LAST ROW.
  //
  // SHOP_RHYTHM is a ten-tile cycle whose rows each sum to the full twelve
  // columns, so it only lands flush when the collection is a multiple of ten.
  // At sixteen the final tile took span 5 and left seven columns of empty
  // white beside it, which reads as a missing product rather than as an
  // ending. The last tile is widened to fill whatever its row has left, so the
  // wall closes on a deliberate full-width frame at any collection size — and
  // the ratio widens with it so the image is cropped cinematically rather than
  // stretched. Only ever the last tile, and only when the row is short.
  if (tiles.length) {
    let used = 0;
    for (const t of tiles) {
      used = used + t.rhythm.span > 12 ? t.rhythm.span : used + t.rhythm.span;
    }
    const last = tiles[tiles.length - 1];
    const remaining = 12 - (used - last.rhythm.span) - last.rhythm.span;
    if (remaining > 0) {
      const span = last.rhythm.span + remaining;
      last.rhythm = {
        ...last.rhythm,
        span,
        // A full-width closer gets a band; a partial one keeps a calmer crop.
        ratio: span >= 10 ? "16 / 6" : span >= 8 ? "16 / 8" : last.rhythm.ratio,
        feature: true,
      };
    }
  }

  return (
    <ul className="shopx-grid">
      {tiles.map((t) => (
        <li
          key={t.key}
          className={`shopx-cell${t.rhythm.feature ? " is-feature" : ""}`}
          data-product={t.product}
          data-colour={t.colour}
          style={{ ["--span" as string]: t.rhythm.span, ["--ar" as string]: t.rhythm.ratio }}
        >
          <Link href={t.href} className="shopx-link">
            <span className="shopx-field" style={{ background: t.asPhoto ? undefined : t.field }}>
              <Image
                src={t.src}
                alt={t.alt}
                width={1600}
                height={Math.round(1600 / t.ratio)}
                // Derived from the tile's own span rather than from the
                // feature flag. The closing tile is widened at runtime to fill
                // whatever its row has left, so a fixed 62vw under-declared it
                // the moment it became a full-width band: measured a 1.17
                // upscale on Nova Silver & Gold. Below 760 the grid is two
                // columns, so a feature spans the viewport and everything else
                // is half of it.
                sizes={
                  `(max-width: 760px) ${t.rhythm.feature ? 100 : 50}vw, ` +
                  `${Math.round((t.rhythm.span / 12) * 96)}vw`
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
