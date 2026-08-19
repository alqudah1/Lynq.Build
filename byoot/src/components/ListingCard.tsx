/**
 * BYOOT_TRANSFORMATION_PLAN.md Section C, "brokerage attribution":
 * `brokerageName` is a REQUIRED prop, not `brokerageName?: string`. Omitting
 * it is a TypeScript compile error, not a runtime maybe-missing risk — that
 * is the actual mechanism, not a comment asking a future author to
 * remember. See ListingCard.test.tsx for the test asserting it renders.
 *
 * No styling framework wired up yet (see byoot/README.md) — this is
 * deliberately unstyled beyond bare layout, not a preview of the eventual
 * brand.
 */
export interface ListingCardProps {
  id: string;
  address: string;
  city: string | null;
  price: number;
  beds: number;
  baths: number;
  /** Required — see the file-level comment above. Never optional, never defaulted to an empty string. */
  brokerageName: string;
  imageUrl?: string | null;
}

const priceFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

export function ListingCard({ address, city, price, beds, baths, brokerageName, imageUrl }: ListingCardProps) {
  return (
    <article data-testid="listing-card">
      <div data-testid="listing-card-media">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- placeholder rendering only; next/image swap belongs to the Phase 2 brand pass, not this scaffold.
          <img src={imageUrl} alt={address} />
        ) : (
          <div data-testid="listing-card-media-placeholder" aria-label="No photo available" />
        )}
      </div>
      <div>
        <p data-testid="listing-card-price">{priceFormatter.format(price)}</p>
        <p data-testid="listing-card-address">
          {address}
          {city ? `, ${city}` : null}
        </p>
        <p data-testid="listing-card-beds-baths">
          {beds} bed &middot; {baths} bath
        </p>
        {/* The element this whole component exists to guarantee. */}
        <p data-testid="listing-card-brokerage">{brokerageName}</p>
      </div>
    </article>
  );
}
