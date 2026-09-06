// Ready for Delivery: Rand's in-stock, already-made bags — a separate
// storefront experience from the made-to-order customizer (see
// docs/ready-for-delivery.md). No customizer, no live configuration — each
// card is one fixed physical item.

import Link from "next/link";
import { getReadyForDeliveryItems, getStoreSettings } from "@/lib/repository";
import ReadyForDeliveryCard from "@/components/ReadyForDeliveryCard";

// Live catalog data should never be prerendered — see app/page.tsx for why
// this must be explicit rather than inferred.
export const dynamic = "force-dynamic";

export default async function ReadyForDeliveryPage() {
  const [items, settings] = await Promise.all([getReadyForDeliveryItems(), getStoreSettings()]);
  const fulfillmentLabel = settings?.readyForDeliveryFulfillmentLabel ?? "Next day";
  // The confirmed promise is "NEXT-DAY DELIVERY IN JORDAN". store_settings
  // holds "Next day"; hyphenate it into its adjectival form and append the
  // country, which the label alone does not carry — and the promise is only
  // true inside Jordan, so it must never be shown without it.
  const deliveryPromise = `${fulfillmentLabel.replace(/\s+day$/i, "-day")} delivery in Jordan`;

  return (
    <>
      <section className="ed-rfd-head">
        <p className="ed-kicker">Ready for delivery</p>
        <h1 className="ed-rfd-title">
          READY
          <br />
          NOW
        </h1>
        {/* The confirmed customer promise is NEXT-DAY DELIVERY IN JORDAN.
            fulfillmentLabel is the store-settings value ("Next day"); the
            country is appended here because the label alone doesn't carry it
            and the promise is only true inside Jordan. */}
        <p className="ed-rfd-promise">{deliveryPromise}.</p>
        <p className="ed-rfd-sub">
          Already made, photographed exactly as it ships. Choose it as it is — these pieces don&rsquo;t
          go through the customizer.
        </p>
      </section>
      <section className="ed-rfd-body">
        {items.length === 0 ? (
          <div className="rfd-empty">
            <p className="rfd-empty-statement">The next edit is being prepared.</p>
            <p className="page-copy center rfd-empty-copy">
              Nothing is finished and waiting right now. Every piece is being made to order — which
              is the other half of how Arcubed works.
            </p>
            <p className="rfd-empty-meta">
              <span>{deliveryPromise}</span>
              <span aria-hidden="true">·</span>
              <span>Real photography</span>
              <span aria-hidden="true">·</span>
              <span>Exact configuration</span>
              <span aria-hidden="true">·</span>
              <span>Fixed price &amp; quantity</span>
            </p>
            <Link className="rfd-empty-link" href="/shop">
              Explore Made to Order
            </Link>
          </div>
        ) : (
          <div className="rfd-grid">
            {items.map((item, i) => (
              <div
                className={`rfd-grid-item${i === 0 ? " rfd-grid-item-feature" : ""}`}
                key={item.id}
                style={{ animationDelay: `${Math.min(i, 6) * 0.04}s` }}
              >
                <ReadyForDeliveryCard item={item} fulfillmentLabel={fulfillmentLabel} />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
