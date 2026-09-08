"use client";

import Link from "next/link";
import type { CartLine, ReadyForDeliverySnapshot } from "@/lib/types";
import { snapshotSummary, money } from "@/lib/pricing";
import { useCart } from "@/lib/cart-context";
import { showToast } from "@/lib/toast";
import CartThumb from "./CartThumb";

function readyForDeliverySummary(snapshot: ReadyForDeliverySnapshot): string[] {
  if (snapshot.configurationDescription) return [snapshot.configurationDescription];
  const parts: string[] = [];
  if (snapshot.colourName) parts.push(`Colour: ${snapshot.colourName}`);
  if (snapshot.secondaryColourName) parts.push(`Secondary: ${snapshot.secondaryColourName}`);
  if (snapshot.sizeLabel) parts.push(`Size: ${snapshot.sizeLabel}`);
  if (snapshot.strapLabel) parts.push(`Strap: ${snapshot.strapLabel}`);
  if (snapshot.chainLabel) parts.push(`Chain: ${snapshot.chainLabel}`);
  return parts;
}

export default function CartLineItem({ line }: { line: CartLine }) {
  const { removeLine, setQty } = useCart();

  const qtyStepper = (
    <div className="qty-stepper">
      <button type="button" aria-label="Decrease quantity" onClick={() => setQty(line.lineId, line.qty - 1)}>
        −
      </button>
      <span>{line.qty}</span>
      <button type="button" aria-label="Increase quantity" onClick={() => setQty(line.lineId, line.qty + 1)}>
        +
      </button>
    </div>
  );
  const removeButton = (
    <button
      className="link-btn"
      type="button"
      onClick={() => {
        removeLine(line.lineId);
        showToast("Removed from bag.");
      }}
    >
      Remove
    </button>
  );

  if (line.kind === "ready_for_delivery") {
    const { snapshot } = line;
    return (
      <div className="cart-line">
        <div className="cart-thumb">
          <CartThumb line={line} sizes="160px" />
        </div>
        <div className="cart-line-body">
          <p className="cart-line-name">{snapshot.itemTitle}</p>
          <p className="cart-line-sub">Ready for Delivery · {snapshot.fulfillmentLabel}</p>
          <div className="cart-line-opt">
            {readyForDeliverySummary(snapshot).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <p className="cart-line-price">{money(line.unitPrice)}</p>
          <div className="cart-line-actions">
            {qtyStepper}
            {removeButton}
          </div>
        </div>
      </div>
    );
  }

  const { snapshot } = line;
  return (
    <div className="cart-line">
      <div className="cart-thumb">
        <CartThumb line={line} sizes="160px" />
      </div>
      <div className="cart-line-body">
        <p className="cart-line-name">{snapshot.bagName}</p>
        <div className="cart-line-opt">
          {snapshotSummary(snapshot).map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <p className="cart-line-price">{money(line.unitPrice)}</p>
        <div className="cart-line-actions">
          {qtyStepper}
          <Link className="link-btn" href={`/product/${snapshot.bagSlug}?edit=${line.lineId}`}>
            Edit
          </Link>
          {removeButton}
        </div>
      </div>
    </div>
  );
}
