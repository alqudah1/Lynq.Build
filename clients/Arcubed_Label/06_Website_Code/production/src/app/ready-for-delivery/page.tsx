// Ready for Delivery: Rand's in-stock, already-made bags — a separate
// storefront experience from the made-to-order customizer (see
// docs/ready-for-delivery.md). No customizer, no live configuration — each
// card is one fixed physical item.

import Link from "next/link";
import Image from "next/image";
import { getReadyForDeliveryItems, getStoreSettings, getActiveBags } from "@/lib/repository";
import { framesForColour, tileSrc, altFor } from "@/lib/product-media";
import ReadyForDeliveryCard from "@/components/ReadyForDeliveryCard";

// Live catalog data should never be prerendered — see app/page.tsx for why
// this must be explicit rather than inferred.
export const dynamic = "force-dynamic";

export default async function ReadyForDeliveryPage() {
  const [items, settings, bags] = await Promise.all([
    getReadyForDeliveryItems(),
    getStoreSettings(),
    getActiveBags(),
  ]);
  // Real product media for the empty state — an empty page should still show
  // what Arcubed makes.
  const emptyBag = bags.find((b) => b.name.trim().toLowerCase() === "mini luna");
  const emptyFrame = emptyBag ? framesForColour(emptyBag, "Red")[0] : undefined;
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
          Already made, photographed exactly as it ships. Choose it as it is. These pieces don&rsquo;t
          go through the customizer.
        </p>
      </section>
      <section className="ed-rfd-body">
        {items.length === 0 ? (
          /* An intentional frame, not a blank page. Inventory really is zero
             here — the data reads fine, there is simply nothing finished and
             waiting — so this states that plainly, on the brand pink, with a
             real bag and one way forward. */
          <div className="rfd-empty">
            <div className="rfd-empty-copy-col">
              <p className="rfd-empty-kicker">Nothing ready today</p>
              <p className="rfd-empty-statement">
                Every piece<br />is being made<br />to order.
              </p>
              <p className="rfd-empty-note">
                Ready for Delivery is finished stock, photographed exactly as it ships. There is
                none right now. The next edit is being made.
              </p>
              <Link className="rfd-empty-link" href="/shop">
                See the collection <span aria-hidden="true">&rarr;</span>
              </Link>
              <p className="rfd-empty-meta">
                <span>{deliveryPromise}</span>
                <span aria-hidden="true">·</span>
                <span>Made to order in 3 to 5 business days</span>
              </p>
            </div>
            {emptyFrame && emptyBag ? (
              <figure className="rfd-empty-art">
                <Image
                  src={tileSrc(emptyFrame)}
                  alt={altFor(emptyBag, "Red")}
                  width={1100}
                  height={Math.round(1100 / emptyFrame.ratio)}
                  sizes="(max-width: 860px) 78vw, 40vw"
                  priority
                />
              </figure>
            ) : null}
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
