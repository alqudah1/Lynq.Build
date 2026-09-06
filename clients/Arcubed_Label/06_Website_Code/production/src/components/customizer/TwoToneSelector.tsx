import type { Colour } from "@/lib/types";

// Independent second material zone for two-tone products (Nova, Mini Luna).
// Only rendered when the bag actually has at least one colour flagged
// is_two_tone — data-driven, not a per-product hardcoded check. Includes a
// "None" option since a two-tone selection is opt-in, unlike the primary
// colour.
export default function TwoToneSelector({
  colours,
  selectedId,
  onSelect,
}: {
  colours: Colour[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="opt-group">
      <p className="opt-label">Two-tone (optional)</p>
      <div className="swatch-row">
        <button
          type="button"
          className={`swatch swatch-named${selectedId === null ? " selected" : ""}`}
          aria-pressed={selectedId === null}
          onClick={() => onSelect(null)}
        >
          None
        </button>
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
