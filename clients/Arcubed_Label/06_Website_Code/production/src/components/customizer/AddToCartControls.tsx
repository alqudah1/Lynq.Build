import PriceDisplay from "./PriceDisplay";

export function AddToCartInline({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn btn-primary btn-block add-to-bag" type="button" onClick={onClick}>
      {label}
    </button>
  );
}

export function AddToCartStickyBar({
  price,
  label,
  onClick,
}: {
  price: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="sticky-bar">
      <PriceDisplay price={price} className="sticky-price" />
      <button className="btn btn-primary" type="button" onClick={onClick}>
        {label}
      </button>
    </div>
  );
}
