import type { Bag, StrapOption, HandleOption, ChainOption } from "@/lib/types";
import { money, isOptIn } from "@/lib/pricing";

type Option = StrapOption | HandleOption | ChainOption;

// TYPOGRAPHIC, NOT ILLUSTRATED — on purpose.
//
// These chips used to render a little BagArt drawing of the component. No
// photography of the Crochet Strap, Silver Tone Chain or Gold Tone Chain
// exists anywhere in the archive (docs/photo-asset-map.md), so those drawings
// were invented shapes standing in for real products — the same placeholder
// problem the storefront was cleared of. Until real component photography
// exists, naming the option honestly beats illustrating a guess.
//
// The chips also carry no image because the gallery cannot yet show a strap
// or chain fitted to a bag: attachment points are unresolved, so compositing
// one over a product photo would be a fabrication.
export default function StrapHandleSelector({
  label,
  options,
  selectedId,
  colourId,
  onSelect,
}: {
  label: string;
  bag: Bag;
  options: Option[];
  selectedId: string | null;
  colourId: string;
  onSelect: (id: string | null) => void;
  kind: "strap" | "handle" | "chain";
}) {
  return (
    <div className="opt-group">
      <p className="opt-label">{label}</p>
      <div className="chip-row">
        {/* "None" belongs to opt-in groups only — without it the only way out
            of a +5 JOD extra was to reload the page. It is wrong for a group
            whose options are all free, such as Nova's With Handle / Without
            Handle: there "None" and "Without Handle" say the same thing, and
            offering both reads as a broken control rather than a choice. */}
        {isOptIn(options) ? (
          <button
            type="button"
            className={`opt-chip${selectedId === null ? " selected" : ""}`}
            aria-pressed={selectedId === null}
            onClick={() => onSelect(null)}
          >
            None
          </button>
        ) : null}
        {options.map((o) => {
          const available = !o.compatibleWith || o.compatibleWith.includes(colourId);
          return (
            <button
              key={o.id}
              type="button"
              className={`opt-chip${o.id === selectedId ? " selected" : ""}`}
              aria-pressed={o.id === selectedId}
              disabled={!available}
              onClick={() => available && onSelect(o.id)}
            >
              {o.label}
              {o.priceDelta ? <span className="opt-chip-delta">+{money(o.priceDelta)}</span> : null}
              {!available ? <span className="opt-chip-delta">Unavailable in this colour</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
