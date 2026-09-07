import Image from "next/image";
import type { Bag, Colour } from "@/lib/types";
import { framesForColour, tileSrc } from "@/lib/product-media";

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
      <div className="swatch-row">
        {colours.map((c) => {
          const frame = framesForColour(bag, c.name)[0];
          const on = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              className={`csw${on ? " is-on" : ""}${frame ? "" : " csw-named"}`}
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
                    sizes="72px"
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
