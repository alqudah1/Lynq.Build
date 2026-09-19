"use client";

// A fixed physical item, not a live configuration — no customizer, no
// colour/strap/chain selectors. Real photos are the product representation
// (see docs/ready-for-delivery.md); a 3D viewer is explicitly optional here
// and not built for this route.

import type { ReadyForDeliveryCartItem, ReadyForDeliveryItem } from "@/lib/types";
import { money, buildReadyForDeliverySnapshot } from "@/lib/pricing";
import { useCart, uid } from "@/lib/cart-context";
import { AddToCartInline, AddToCartStickyBar } from "@/components/customizer/AddToCartControls";

function description(item: ReadyForDeliveryItem): string {
  if (item.configurationDescription) return item.configurationDescription;
  const parts = [item.colourName, item.secondaryColourName ? `+ ${item.secondaryColourName}` : null, item.sizeLabel, item.strapLabel, item.chainLabel].filter(
    Boolean
  );
  return parts.join(" · ");
}

export default function ReadyForDeliveryDetail({
  item,
  fulfillmentLabel,
}: {
  item: ReadyForDeliveryItem;
  fulfillmentLabel: string;
}) {
  const { addOrUpdateLine, openCartDrawer } = useCart();
  const soldOut = item.quantityAvailable <= 0;

  function handleAdd() {
    if (soldOut) return;
    const line: ReadyForDeliveryCartItem = {
      kind: "ready_for_delivery",
      lineId: uid(),
      itemId: item.id,
      qty: 1,
      unitPrice: item.price,
      snapshot: buildReadyForDeliverySnapshot(item, fulfillmentLabel),
    };
    // Same post-add decision as a made-to-order bag: stay here, and the cart
    // panel offers View Cart or Keep Shopping.
    openCartDrawer(addOrUpdateLine(line));
  }

  return (
    <section className="product">
      <div className="product-media">
        <div className="media-frame">
          {item.images[0] ? (
            // Plain <img>, not next/image — see CartLineItem.tsx's note.
            <img src={item.images[0].url} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div className="card-art-placeholder" aria-hidden="true" style={{ width: "100%", height: "100%" }} />
          )}
        </div>
        {item.images.length > 1 ? (
          <div className="rfd-thumb-row">
            {item.images.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.url} alt="" key={img.id} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="product-panel">
        <p className="eyebrow">{item.productName} · Ready for Delivery</p>
        <h1>{item.title}</h1>
        <p className="price-inline">{money(item.price)}</p>

        <div className="opt-group">
          <p className="opt-label">Configuration</p>
          <p className="page-copy">{description(item) || "See photos for exact configuration."}</p>
        </div>

        <div className="opt-group">
          <p className="opt-label">Availability</p>
          <p className="page-copy">
            {soldOut ? "Sold out" : `${item.quantityAvailable} in stock`} · {fulfillmentLabel} delivery
          </p>
        </div>

        <AddToCartInline label={soldOut ? "Sold Out" : "Add to Cart"} onClick={handleAdd} />

        <div className="accordion-group">
          <details>
            <summary>What is Ready for Delivery?</summary>
            <p>
              This is one exact bag Rand already has in stock. The photos above are the real item, not a
              representation. Because it&rsquo;s already made, it skips the made-to-order production time.
            </p>
          </details>
        </div>
      </div>

      {!soldOut ? <AddToCartStickyBar price={item.price} label="Add to Cart" onClick={handleAdd} /> : null}
    </section>
  );
}
