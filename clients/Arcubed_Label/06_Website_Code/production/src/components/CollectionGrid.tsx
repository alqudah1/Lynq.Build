import Link from "next/link";
import Image from "next/image";
import type { Bag } from "@/lib/types";
import { money } from "@/lib/pricing";
import { framesForColour, tileSrc, altFor } from "@/lib/product-media";
import { COLLECTION, SHOP_RHYTHM, colourFit, type CollectionEntry } from "@/lib/collection";
import { variantHref } from "@/lib/variant";

/** A frame's height in grid column-units: span divided by its own aspect. */
function rowUnits(r: { span: number; ratio: string }): number {
  const [w, h] = r.ratio.split("/").map((n) => parseFloat(n));
  return w && h ? r.span / (w / h) : r.span;
}

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
      const rhythm = { ...SHOP_RHYTHM[i % SHOP_RHYTHM.length] };
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
        fit: colourFit(entry.slug, entry.colour),
        rhythm,
        /** Set below: full-bleed in the two-column phone grid. */
        mFull: false,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  // MATCH THE FRAME TO THE SHAPE.
  //
  // SHOP_RHYTHM is a rhythm of tile PROPORTIONS, and it was being handed out
  // by position, so which bag got which frame was an accident of catalogue
  // order. The narrow upright frame at index 6 landed on Nova Champagne — a
  // bag that is twice as wide as it is tall. Contained inside a 3/4 frame it
  // resolved to a quarter of the tile and read as lost, which no amount of
  // scaling fixes: enlarging a wide object inside an upright frame just runs
  // it into the side walls.
  //
  // Each rhythm row already sums to twelve columns AND resolves to one common
  // height, so the {span, ratio} pairs inside a row are interchangeable
  // without disturbing the grid. Widest object to widest frame, so an upright
  // frame always finds an upright bag. Ordering is by aspect only, so the
  // wall re-composes itself if the catalogue changes.
  const rows: (typeof tiles)[] = [];
  for (const t of tiles) {
    const row = rows[rows.length - 1];
    const used = row ? row.reduce((n, x) => n + x.rhythm.span, 0) : 12;
    if (used + t.rhythm.span > 12) rows.push([t]);
    else row.push(t);
  }
  for (const row of rows) {
    const frames = row.map((t) => t.rhythm).sort((a, b) => b.span - a.span);
    row
      .map((t, i) => ({ t, i }))
      // Aspect descending, position as the tie-break so equal shapes keep
      // catalogue order rather than shuffling between renders.
      .sort((a, b) => b.t.ratio - a.t.ratio || a.i - b.i)
      .forEach(({ t }, k) => { t.rhythm = frames[k]; });
  }

  // CLOSE THE LAST ROW.
  //
  // SHOP_RHYTHM is a ten-tile cycle whose rows each sum to the full twelve
  // columns, so it only lands flush when the collection is a multiple of ten.
  // At sixteen the final tile took span 5 and left seven columns of empty
  // white beside it, which reads as a missing product rather than as an
  // ending. The last tile is widened to fill whatever its row has left, so the
  // wall closes on a deliberate frame at any collection size.
  //
  // The ratio has to move with the span or the tile gets taller than the ones
  // beside it and reopens the ragged edge this is here to close. When the
  // closer stands alone it becomes a cinematic band; when it has neighbours,
  // the new ratio is solved from the row's existing height so the row still
  // resolves flat.
  if (rows.length) {
    const lastRow = rows[rows.length - 1];
    const last = lastRow[lastRow.length - 1];
    const remaining = 12 - lastRow.reduce((n, x) => n + x.rhythm.span, 0);
    if (remaining > 0) {
      const span = last.rhythm.span + remaining;
      const alone = lastRow.length === 1;
      const units = rowUnits(lastRow[0].rhythm);
      last.rhythm = {
        ...last.rhythm,
        span,
        ratio: alone
          ? span >= 10 ? "16 / 7" : "16 / 9"
          : `${span} / ${+(span / units).toFixed(4)}`,
        feature: true,
      };
    }
  }

  // THE PHONE IS A DIFFERENT GRID, NOT A NARROWER ONE.
  //
  // Below 760 the wall drops to two columns, but every cell kept the aspect
  // ratio it was given for the twelve-column composition. Squares, 8/5 bands
  // and a 3/4 upright landed side by side, so no two cells in a row were the
  // same height and the desktop feature tiles took the full width from
  // wherever they happened to fall. The result was a staircase with a bag
  // stranded beside an empty half-row four times over.
  //
  // On the phone every tile is the same square and the composition comes from
  // two full-bleed moments instead: the widest bag in the wall, and the
  // closer. A tile is only ever promoted when the current row is EMPTY, so a
  // full-bleed can never leave a hole beside it — whatever the catalogue does.
  let col = 0;
  let promoted = 0;
  tiles.forEach((t, i) => {
    const wide = !t.asPhoto && t.ratio >= 1.7 && i >= 4 && promoted === 0;
    if (col === 0 && (wide || i === tiles.length - 1)) {
      t.mFull = true;
      promoted++;
    } else {
      col = (col + 1) % 2;
    }
  });

  return (
    <ul className="shopx-grid">
      {tiles.map((t) => (
        <li
          key={t.key}
          className={
            `shopx-cell${t.rhythm.feature ? " is-feature" : ""}` +
            (t.mFull ? " is-mfull" : "")
          }
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
                // upscale on Nova Silver & Gold. Below 760 the phone grid has
                // its OWN promotions, which are not the desktop features, so
                // this reads mFull rather than the feature flag.
                sizes={
                  `(max-width: 760px) ${t.mFull ? 100 : 50}vw, ` +
                  `${Math.round((t.rhythm.span / 12) * 96)}vw`
                }
                className={t.asPhoto ? "shopx-photo" : "shopx-cut"}
                style={
                  t.asPhoto || !t.fit
                    ? undefined
                    : {
                        ["--fs" as string]: t.fit.s,
                        ["--fx" as string]: `${t.fit.tx ?? 0}%`,
                        ["--fy" as string]: `${t.fit.ty ?? 0}%`,
                      }
                }
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
