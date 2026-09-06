import type { Bag, StrapOption, HandleOption, ChainOption } from "@/lib/types";
import { money } from "@/lib/pricing";
import BagArt from "../BagArt";

type Option = StrapOption | HandleOption | ChainOption;

export default function StrapHandleSelector({
  label,
  bag,
  options,
  selectedId,
  colourId,
  onSelect,
  kind,
}: {
  label: string;
  bag: Bag;
  options: Option[];
  selectedId: string | null;
  colourId: string;
  onSelect: (id: string | null) => void;
  kind: "strap" | "handle" | "chain";
}) {
  const colourHex = (bag.colours.find((c) => c.id === colourId) ?? bag.colours[0]).hex;

  return (
    <div className="opt-group">
      <p className="opt-label">{label}</p>
      <div className="thumb-row">
        {/* Straps, handles and chains are optional paid upgrades, so "None"
            has to be reachable — without it the only way out of a +5 JOD
            extra was to reload the page. */}
        <button
          type="button"
          className={`thumb-chip${selectedId === null ? " selected" : ""}`}
          aria-pressed={selectedId === null}
          onClick={() => onSelect(null)}
        >
          <span className="thumb-art">
            <BagArt input={{ name: bag.name, colourHex }} />
          </span>
          <span className="thumb-label">None</span>
        </button>
        {options.map((o) => {
          const available = !o.compatibleWith || o.compatibleWith.includes(colourId);
          return (
            <button
              key={o.id}
              type="button"
              className={`thumb-chip${o.id === selectedId ? " selected" : ""}`}
              aria-pressed={o.id === selectedId}
              disabled={!available}
              onClick={() => available && onSelect(o.id)}
            >
              <span className="thumb-art">
                <BagArt
                  input={{
                    name: bag.name,
                    colourHex,
                    strapArt: kind === "strap" ? o.art : undefined,
                    handleArt: kind === "handle" ? o.art : undefined,
                    chainArt: kind === "chain" ? o.art : undefined,
                  }}
                />
              </span>
              <span className="thumb-label">
                {o.label}
                {o.priceDelta ? ` · +${money(o.priceDelta)}` : ""}
                {!available ? " · Unavailable in this colour" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
