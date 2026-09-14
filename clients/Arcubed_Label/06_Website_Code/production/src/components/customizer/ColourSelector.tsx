import Image from "next/image";
import type { Bag, Colour } from "@/lib/types";
import { framesForColour, tileSrc } from "@/lib/product-media";
import { swatchField, isDarkField } from "@/lib/collection";

/**
 * Colourway selector.
 *
 * The swatch is a crop of THAT COLOURWAY'S OWN PHOTOGRAPH, not a colour chip.
 * Most Arcubed colours have no confirmed hex (see Colour.hex), and the ones
 * that could be sampled are metallic yarns whose character is the sheen, not
 * a flat value. A named box told the customer nothing about the colour; a
 * guessed hex would have been worse. The real bag is both honest and more
 * useful, and it costs nothing because the photography already exists.
 *
 * Falls back to the name when a colourway has no photography yet.
 */
export default function ColourSelector({
  showLabel = true,
  bag,
  colours,
  selectedId,
  onSelect,
}: {
  showLabel?: boolean;
  bag: Pick<Bag, "slug" | "name">;
  colours: Colour[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="opt-group">
      {showLabel ? <p className="opt-label">Colour</p> : null}
      {/* The row is sized by its own count so six colourways resolve as one
          line instead of five plus a lone sixth on a second row. On a phone
          it falls to a three-up grid, which splits 6 as 3+3 rather than
          orphaning one. */}
      <div className="swatch-row" style={{ ["--n" as string]: colours.length }}>
        {colours.map((c) => {
          const frame = framesForColour(bag, c.name)[0];
          const on = c.id === selectedId;
          // Its own field, not the one pink every swatch used to share. See
          // swatchField() for why the value comes from the Shop wall rather
          // than from a second palette invented here.
          const field = swatchField(bag.slug, c.name);
          const dark = isDarkField(field);
          return (
            <button
              key={c.id}
              type="button"
              className={`csw${on ? " is-on" : ""}${frame ? "" : " csw-named"}${dark ? " is-deep" : ""}`}
              style={{ ["--csw-field" as string]: field }}
              aria-label={c.name}
              aria-pressed={on}
              onClick={() => onSelect(c.id)}
            >
              {frame ? (
                <span className="csw-img">
                  <Image
                    src={tileSrc(frame, true)}
                    alt=""
                    width={200}
                    height={Math.round(200 / frame.ratio)}
                    sizes="112px"
                  />
                </span>
              ) : null}
              <span className="csw-name">{c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
