import type { SizeOption } from "@/lib/types";
import { money } from "@/lib/pricing";

export default function SizeSelector({
  sizes,
  selectedId,
  onSelect,
}: {
  sizes: SizeOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = sizes.find((s) => s.id === selectedId);
  return (
    <div className="opt-group">
      <p className="opt-label">Size</p>
      <div className="pill-row">
        {sizes.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`pill${s.id === selectedId ? " selected" : ""}`}
            aria-pressed={s.id === selectedId}
            onClick={() => onSelect(s.id)}
          >
            {s.label}
            {/* Every size says what it costs. Medium and Large used to be a
                bare word on an empty row, the only options in the buy band
                with nothing beside them, and read as blank placeholders
                (client: "the medium and large options are little boxes"). */}
            <span className="opt-chip-delta">{s.priceDelta ? `+${money(s.priceDelta)}` : "Included"}</span>
          </button>
        ))}
      </div>
      {selected ? <p className="opt-note">{selected.note}</p> : null}
    </div>
  );
}
