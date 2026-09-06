import Link from "next/link";
import type { ReadyForDeliveryItem } from "@/lib/types";
import { money } from "@/lib/pricing";

export default function ReadyForDeliveryCard({
  item,
  fulfillmentLabel,
}: {
  item: ReadyForDeliveryItem;
  fulfillmentLabel: string;
}) {
  const soldOut = item.quantityAvailable <= 0;
  const image = item.images[0];

  return (
    <Link className={`card${soldOut ? " card-sold-out" : ""}`} href={`/ready-for-delivery/${item.id}`}>
      <div className="card-art">
        {image ? (
          // Plain <img>, not next/image — see CartLineItem.tsx's note.
          <img src={image.url} alt={item.title} />
        ) : (
          <div className="card-art-placeholder" aria-hidden="true" />
        )}
        {soldOut ? <span className="card-badge">Sold out</span> : null}
      </div>
      {/* Same visual language as the cart's Ready for Delivery lines
          (.cart-line-sub) — keeps the "this is a fixed, real item" signal
          consistent everywhere it appears, distinct from a made-to-order
          product card, which has no such line. */}
      <p className="cart-line-sub">{soldOut ? "Ready for Delivery" : `Ready for Delivery · ${fulfillmentLabel}`}</p>
      <p className="card-name">{item.title}</p>
      <p className="card-price">{money(item.price)}</p>
    </Link>
  );
}
