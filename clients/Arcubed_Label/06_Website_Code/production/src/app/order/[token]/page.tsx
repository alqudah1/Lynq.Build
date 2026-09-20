// Order confirmation. Addressed by an unguessable confirmation token; the
// order number is shown but is never the lookup key.
//
// HONESTY: no payment provider is configured, so nothing here says "paid",
// "purchase complete" or "payment successful". The order is a REQUEST that
// Arcubed confirms — which is exactly what the database records
// (status 'pending', payment_status 'unpaid').

import { notFound } from "next/navigation";
import { plainText } from "@/lib/site-settings";
import Link from "next/link";
import Image from "next/image";
import { getOrderByConfirmationToken } from "@/lib/orders";
import { getStoreSettings } from "@/lib/repository";
import { formatMoney } from "@/lib/site-settings";
import { mediaForSnapshot } from "@/lib/product-media";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

export default async function OrderConfirmationPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const [order, settings] = await Promise.all([
    getOrderByConfirmationToken(token),
    getStoreSettings(),
  ]);
  if (!order) notFound();

  const fulfillmentLabel = settings?.readyForDeliveryFulfillmentLabel ?? "Next day";
  const deliveryPromise = `${fulfillmentLabel.replace(/\s+day$/i, "-day")} delivery in Jordan`;
  const productionTimeLabel = plainText(settings?.productionTimeLabel ?? "5 to 7 days");
  const hasMade = order.lines.some((l) => l.kind === "made_to_order");
  const hasReady = order.lines.some((l) => l.kind === "ready_for_delivery");
  const addr = order.shippingAddress ?? {};
  const addrLine = [addr.address, addr.building, addr.city, addr.country]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(", ");

  return (
    <section className="oc">
      <p className="ed-kicker">Order received</p>
      <h1 className="oc-title">THANK<br />YOU.</h1>
      <p className="oc-ref">
        Your reference is <strong>{order.orderNumber}</strong>
      </p>
      <p className="oc-lede">
        We&rsquo;ve got your order. Arcubed will contact you on the details below to confirm it and
        arrange payment and delivery.
      </p>

      <div className="oc-grid">
        <div className="oc-items">
          <p className="co-legend">Your pieces</p>
          <ul className="oc-lines">
            {order.lines.map((l, i) => {
              const frame = mediaForSnapshot(l.bagSlug, l.name, l.colourName);
              return (
                <li key={i} className="oc-line">
                  <span className="co-thumb">
                    {frame ? (
                      <Image src={frame.photoSmall} alt="" width={160}
                             height={Math.round(160 / frame.ratio)} sizes="72px" />
                    ) : null}
                  </span>
                  <span className="co-line-body">
                    <span className="co-line-name">{l.name}</span>
                    {l.configuration.length ? (
                      <span className="co-line-config">{l.configuration.join(" · ")}</span>
                    ) : null}
                    <span className="co-line-kind">
                      {l.kind === "ready_for_delivery" ? `Ready now · ${deliveryPromise}` : `Made to order · ${productionTimeLabel}`}
                    </span>
                  </span>
                  <span className="co-line-price">
                    {l.quantity > 1 ? <span className="co-line-qty">×{l.quantity}</span> : null}
                    {formatMoney(l.unitPrice * l.quantity, order.currency)}
                  </span>
                </li>
              );
            })}
          </ul>

          <dl className="co-totals">
            <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotal, order.currency)}</dd></div>
            <div>
              <dt>Shipping</dt>
              <dd>{order.shippingQuoteRequired ? "To be quoted" : formatMoney(order.shippingAmount, order.currency)}</dd>
            </div>
            <div className="co-total-row">
              <dt>{order.shippingQuoteRequired ? "Goods total" : "Total"}</dt>
              <dd>{formatMoney(order.total, order.currency)}</dd>
            </div>
          </dl>
          {order.shippingQuoteRequired ? (
            <p className="co-quote">
              Shipping outside Jordan is quoted by destination. The amount above covers the bags
              only. We&rsquo;ll confirm shipping before anything is finalised.
            </p>
          ) : null}
        </div>

        <aside className="oc-side">
          <p className="co-legend">Delivering to</p>
          <p className="oc-block">
            {order.customerName}<br />
            {addrLine || "Address on file"}<br />
            {order.customerPhone ? <>{order.customerPhone}<br /></> : null}
            {order.customerEmail}
          </p>

          <p className="co-legend">Status</p>
          <p className="oc-block">
            Order received. Awaiting confirmation from Arcubed.<br />
            <span className="oc-muted">No payment has been taken.</span>
          </p>

          {hasMade || hasReady ? (
            <>
              <p className="co-legend">Timing</p>
              <p className="oc-block">
                {hasMade ? <>Made to order · {productionTimeLabel}<br /></> : null}
                {hasReady ? <>Ready now · {deliveryPromise}</> : null}
              </p>
            </>
          ) : null}

          <Link className="ed-link" href="/shop">Continue shopping</Link>
        </aside>
      </div>
    </section>
  );
}
