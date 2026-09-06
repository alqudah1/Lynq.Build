import type { Colour } from "@/lib/types";

export default function ColourSelector({
  colours,
  selectedId,
  onSelect,
}: {
  colours: Colour[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="opt-group">
      <p className="opt-label">Colour</p>
      <div className="swatch-row">
        {colours.map((c) =>
          c.hex ? (
            <button
              key={c.id}
              type="button"
              className={`swatch${c.id === selectedId ? " selected" : ""}`}
              style={{ background: c.hex }}
              aria-label={c.name}
              aria-pressed={c.id === selectedId}
              onClick={() => onSelect(c.id)}
            />
          ) : (
            // No confirmed hex yet for this colourway — a named chip rather
            // than a filled swatch, so we never guess at the real colour.
            <button
              key={c.id}
              type="button"
              className={`swatch swatch-named${c.id === selectedId ? " selected" : ""}`}
              aria-pressed={c.id === selectedId}
              onClick={() => onSelect(c.id)}
            >
              {c.name}
            </button>
          )
        )}
      </div>
    </div>
  );
}
