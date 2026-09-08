import PriceDisplay from "./PriceDisplay";

export function AddToCartInline({
  label,
  price,
  onClick,
}: {
  label: string;
  /** Rendered inside the action, so the commitment and its cost sit together. */
  price?: string;
  onClick: () => void;
}) {
  return (
    <button className="btn btn-primary btn-block add-to-bag" type="button" onClick={onClick}>
      <span className="add-to-bag-label">{label}</span>
      {price ? <span className="add-to-bag-price">{price}</span> : null}
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
