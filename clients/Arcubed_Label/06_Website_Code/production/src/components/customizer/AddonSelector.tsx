import type { AddonOption } from "@/lib/types";
import { money } from "@/lib/pricing";

export default function AddonSelector({
  addons,
  selectedIds,
  colourId,
  onToggle,
}: {
  addons: AddonOption[];
  selectedIds: string[];
  colourId: string;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="opt-group">
      <p className="opt-label">Add-ons</p>
      <div className="chip-row">
        {addons.map((a) => {
          const available = !a.compatibleWith || a.compatibleWith.includes(colourId);
          const active = selectedIds.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              className={`chip${active ? " active" : ""}`}
              aria-pressed={active}
              disabled={!available}
              onClick={() => available && onToggle(a.id)}
              title={!available ? "Unavailable in this colour" : undefined}
            >
              <span>{a.label}</span>
              <span className="chip-price">+{money(a.priceDelta)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
