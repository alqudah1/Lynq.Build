import type { SizeOption } from "@/lib/types";

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
          </button>
        ))}
      </div>
      {selected ? <p className="opt-note">{selected.note}</p> : null}
    </div>
  );
}
