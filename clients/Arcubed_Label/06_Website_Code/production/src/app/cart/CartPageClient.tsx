"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart-context";
import { money } from "@/lib/pricing";
import { formatMoney } from "@/lib/site-settings";
import type { ShippingRule } from "@/lib/types";
import CartLineItem from "@/components/CartLineItem";
import { showToast } from "@/lib/toast";

export default function CartPageClient({
  shippingRules,
  productionTimeLabel,
  readyForDeliveryFulfillmentLabel,
}: {
  shippingRules: ShippingRule[];
  productionTimeLabel: string | null;
  readyForDeliveryFulfillmentLabel: string | null;
}) {
  const { cart, hydrated, cartSubtotal } = useCart();
  const hasMadeToOrder = cart.some((l) => l.kind === "made_to_order");
  const hasReadyForDelivery = cart.some((l) => l.kind === "ready_for_delivery");

  if (!hydrated) return null;

  if (cart.length === 0) {
    return (
      <section className="section empty-state">
        <p className="eyebrow center">Your Bag</p>
        <h2 className="center">Nothing here yet.</h2>
        <div className="center">
          <Link className="btn btn-primary" href="/shop">
            Shop the Collection
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="section cart-page">
      <p className="eyebrow">Your Bag</p>
      <p className="cart-lede">Made exactly the way you designed it.</p>
      <div className="cart-lines">
        {cart.map((line) => (
          <CartLineItem line={line} key={line.lineId} />
        ))}
      </div>
      <div className="cart-summary">
        <div className="row">
          <span>Subtotal</span>
          <strong>{money(cartSubtotal)}</strong>
        </div>
        <div className="shipping-rates">
          <p className="opt-label">Shipping</p>
          {shippingRules.length ? (
            shippingRules.map((r) => (
              <div className="row muted" key={r.zoneKey}>
                <span>{r.label}</span>
                <span>
                  {r.isQuoteRequired || r.amount === null
                    ? "Calculated based on destination — contact us for a quote"
                    : formatMoney(r.amount, r.currencyCode)}
                </span>
              </div>
            ))
          ) : (
            <div className="row muted">
              <span>Shipping</span>
              <span>Calculated at checkout</span>
            </div>
          )}
        </div>
        {hasMadeToOrder ? (
          <p className="reassure">
            {productionTimeLabel
              ? `Handmade to order. Production takes ${productionTimeLabel}.`
              : "Handmade to order."}
          </p>
        ) : null}
        {hasReadyForDelivery ? (
          <p className="reassure">
            Ready for Delivery items ship {(readyForDeliveryFulfillmentLabel ?? "next day").toLowerCase()}.
          </p>
        ) : null}
        <button
          className="btn btn-primary btn-block"
          type="button"
          onClick={() => showToast("Checkout is on its way — thank you for your patience.")}
        >
          Checkout
        </button>
      </div>
    </section>
  );
}
