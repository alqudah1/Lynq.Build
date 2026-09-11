"use client";

import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";
import { money } from "@/lib/pricing";
import { formatMoney } from "@/lib/site-settings";
import type { ShippingRule } from "@/lib/types";
import CartLineItem from "@/components/CartLineItem";

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
      /* An Arcubed moment rather than a dead end: a statement, a real bag on
         the brand field, and a typographic way back. It used to be one
         centred sentence on white with the footer filling the rest. */
      <section className="es">
        <div className="es-copy">
          <p className="eyebrow">Your bag</p>
          <p className="es-line">Nothing here yet.</p>
          <p className="es-note">Every piece is crocheted after you choose it.</p>
          <Link className="es-link" href="/shop">Shop the collection</Link>
        </div>
        <figure className="es-art" aria-hidden="true">
          <Image src="/media/DSC05792-tile-2600.webp" alt="" width={1400} height={916} sizes="(max-width: 760px) 88vw, (max-width: 1200px) 44vw, 40vw" />
        </figure>
      </section>
    );
  }

  return (
    <section className="section cart-page">
      <p className="eyebrow">Your Bag</p>
      <p className="cart-lede">Made exactly the way you designed it.</p>
      {/* Two zones on desktop: the bag on the left, the summary beside it,
          rather than a narrow column with the page's right half empty. */}
      <div className="cart-grid">
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
                    ? "Calculated by destination. Contact us for a quote"
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
        <Link className="btn btn-primary btn-block" href="/checkout">
          Checkout
        </Link>
      </div>
      </div>
    </section>
  );
}
