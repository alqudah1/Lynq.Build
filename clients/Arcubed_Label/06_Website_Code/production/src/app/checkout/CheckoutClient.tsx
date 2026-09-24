"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";
import { formatMoney } from "@/lib/site-settings";
import { mediaForSnapshot } from "@/lib/product-media";
import { submitOrder, type CheckoutResult } from "./actions";
import type { CartLine, ShippingRule } from "@/lib/types";

// Every amount rendered here is a PREVIEW. The server recomputes all of it at
// submit from the database, so a tampered localStorage cart changes what the
// customer sees and nothing about what they are charged.

function lineConfigParts(line: CartLine): string[] {
  if (line.kind === "ready_for_delivery") {
    const s = line.snapshot;
    return [s.colourName, s.secondaryColourName, s.sizeLabel, s.strapLabel, s.chainLabel]
      .filter((v): v is string => Boolean(v));
  }
  const s = line.snapshot;
  // Only selected options appear. "Strap: None" is noise, not information.
  return [
    s.colourName,
    s.secondaryColourName ? `${s.secondaryColourName} two-tone` : null,
    s.sizeLabel && s.sizeLabel !== "Regular" ? s.sizeLabel : null,
    s.strapLabel,
    // Nova is sold with or without its handle. The choice changes what gets
    // crocheted, so it belongs beside the colour and the strap.
    s.handleLabel,
    s.chainLabel,
    ...(s.addons ?? []).map((a) => a.label),
  ].filter((v): v is string => Boolean(v));
}

export default function CheckoutClient({
  rules,
  productionTimeLabel,
  deliveryPromise,
  currency,
}: {
  rules: ShippingRule[];
  productionTimeLabel: string;
  deliveryPromise: string;
  currency: string;
}) {
  const { cart, cartCount, cartSubtotal, clearCart } = useCart();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [zoneKey, setZoneKey] = useState<string>(rules[0]?.zoneKey ?? "");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [building, setBuilding] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Collapsed on a phone, where the summary sits ABOVE the form and otherwise
  // pushes the first field off the screen. The CSS only honours this below the
  // two-column breakpoint; on a desktop the summary is always open.
  const [summaryOpen, setSummaryOpen] = useState(false);

  // One token per checkout attempt. Created on FIRST submit (an event
  // handler, where impure calls belong — generating it during render is both
  // impure and premature) and reused for every retry of that same attempt, so
  // a double-click or browser retry resolves to the SAME order rather than a
  // second one. A disabled button is UX; this is the transactional guarantee.
  const idemRef = useRef<string | null>(null);
  function attemptKey(): string {
    if (idemRef.current === null) {
      idemRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `k${Date.now()}${Math.random().toString(36).slice(2)}`;
    }
    return idemRef.current;
  }

  const rule = rules.find((r) => r.zoneKey === zoneKey);
  const quoteRequired = Boolean(rule?.isQuoteRequired || rule?.amount === null);

  const subtotal = cartSubtotal;
  const shipping = quoteRequired ? 0 : rule?.amount ?? 0;
  const hasMade = cart.some((l) => l.kind === "made_to_order");
  const hasReady = cart.some((l) => l.kind === "ready_for_delivery");

  /** The same checks the Server Action applies, run early so a customer is
   *  told which field is wrong instead of reading a list at the top. The
   *  server still re-validates everything: this is courtesy, not security. */
  function validate(): Record<string, string> {
    const f: Record<string, string> = {};
    if (!fullName.trim()) f.name = "Please enter your full name.";
    if (!phone.trim()) f.phone = "Please enter a phone number so we can reach you about delivery.";
    else if (phone.replace(/\D/g, "").length < 7) f.phone = "That phone number doesn't look complete.";
    if (!email.trim()) f.email = "Please enter an email address for your confirmation.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) f.email = "That email address doesn't look right.";
    if (quoteRequired) { if (!country.trim()) f.country = "Please tell us which country we're shipping to."; }
    else if (!city.trim()) f.city = "Please enter your city or delivery area.";
    if (!address.trim()) f.address = "Please enter a delivery address.";
    return f;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const f = validate();
    setFieldErrors(f);
    if (Object.keys(f).length) {
      setErrors([]);
      // Focus the first field that failed, BY ID. Querying for
      // [aria-invalid="true"] ran before React had re-rendered the attribute,
      // so it matched nothing and focus never moved.
      const order = ["name", "phone", "email", quoteRequired ? "country" : "city", "address"];
      const firstKey = order.find((k) => f[k]);
      const el = firstKey ? document.getElementById(`f-${firstKey}`) : null;
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const res: CheckoutResult = await submitOrder({
        fullName, phone, email, zoneKey, country, city, address, building, notes,
        idempotencyKey: attemptKey(),
        // IDs and quantities only — no prices.
        items: cart.map((l) =>
          l.kind === "ready_for_delivery"
            ? { kind: "ready_for_delivery" as const, itemId: l.itemId, qty: l.qty }
            : {
                kind: "made_to_order" as const, qty: l.qty, bagId: l.bagId, colourId: l.colourId,
                secondaryColourId: l.secondaryColourId, sizeId: l.sizeId, strapId: l.strapId,
                handleId: l.handleId, chainId: l.chainId, addonIds: l.addonIds,
              }
        ),
      });
      if (!res.ok) {
        setErrors(res.errors);
        setBusy(false);
        // Form values are intentionally NOT cleared on error.
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      clearCart();
      router.push(`/order/${res.confirmationToken}`);
    } catch {
      setErrors(["We couldn't reach the server. Please check your connection and try again."]);
      setBusy(false);
    }
  }

  if (cartCount === 0) {
    return (
      <section className="es">
        <div className="es-copy">
          <p className="eyebrow">Checkout</p>
          <p className="es-line">Nothing to check out yet.</p>
          <p className="es-note">Pick a shape, choose a colour, and it is made for you.</p>
          <Link className="es-link" href="/shop">Shop the collection</Link>
        </div>
        <figure className="es-art" aria-hidden="true">
          {/* LCP on an empty /checkout — same fix as the cart. */}
          <Image src="/media/DSC04874-tile-2600.webp" alt="" width={1400} height={1125} sizes="(max-width: 760px) 88vw, (max-width: 1200px) 44vw, 40vw" preload />
        </figure>
      </section>
    );
  }

  return (
    <section className="co">
      <div className="co-form-col">
        <p className="ed-kicker">Checkout</p>
        <h1 className="co-title">ALMOST<br />YOURS.</h1>

        {errors.length > 0 ? (
          <div className="co-errors" role="alert" aria-live="assertive">
            {errors.map((msg) => <p key={msg}>{msg}</p>)}
          </div>
        ) : null}

        <form className="co-form" onSubmit={onSubmit} noValidate>
          <p className="co-legend">Contact</p>
          <div className="co-row">
            <label htmlFor="f-name">Full name</label>
            <input id="f-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)}
                   aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "e-name" : undefined} />
            {fieldErrors.name ? <span className="co-err" id="e-name">{fieldErrors.name}</span> : null}
          </div>
          <div className="co-row">
            <label htmlFor="f-phone">Phone</label>
            <input id="f-phone" inputMode="tel" autoComplete="tel" placeholder="07 XXXX XXXX"
                   value={phone} onChange={(e) => setPhone(e.target.value)}
                   aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? "e-phone" : "h-phone"} />
            {fieldErrors.phone
              ? <span className="co-err" id="e-phone">{fieldErrors.phone}</span>
              : <span className="co-hint" id="h-phone">We use this to arrange delivery.</span>}
          </div>
          <div className="co-row">
            <label htmlFor="f-email">Email</label>
            <input id="f-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "e-email" : "h-email"} />
            {fieldErrors.email
              ? <span className="co-err" id="e-email">{fieldErrors.email}</span>
              : <span className="co-hint" id="h-email">Your order confirmation goes here.</span>}
          </div>

          <p className="co-legend">Delivery</p>
          <div className="co-row">
            <label htmlFor="f-zone">Delivering to</label>
            <select id="f-zone" value={zoneKey} onChange={(e) => setZoneKey(e.target.value)}>
              {rules.map((r) => <option key={r.zoneKey} value={r.zoneKey}>{r.label}</option>)}
            </select>
          </div>
          {quoteRequired ? (
            <div className="co-row">
              <label htmlFor="f-country">Country</label>
              <input id="f-country" autoComplete="country-name" value={country} onChange={(e) => setCountry(e.target.value)}
                     aria-invalid={Boolean(fieldErrors.country)} aria-describedby={fieldErrors.country ? "e-country" : undefined} />
              {fieldErrors.country ? <span className="co-err" id="e-country">{fieldErrors.country}</span> : null}
            </div>
          ) : (
            <div className="co-row">
              {/* Jordan is the default destination and the zone above already
                  says which part of it, so the country field only appears when
                  the order is leaving the country. */}
              <label htmlFor="f-city">City / area</label>
              <input id="f-city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)}
                     aria-invalid={Boolean(fieldErrors.city)} aria-describedby={fieldErrors.city ? "e-city" : undefined} />
              {fieldErrors.city ? <span className="co-err" id="e-city">{fieldErrors.city}</span> : null}
            </div>
          )}
          <div className="co-row">
            <label htmlFor="f-address">Address</label>
            <input id="f-address" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)}
                   aria-invalid={Boolean(fieldErrors.address)} aria-describedby={fieldErrors.address ? "e-address" : undefined} />
            {fieldErrors.address ? <span className="co-err" id="e-address">{fieldErrors.address}</span> : null}
          </div>
          <div className="co-row">
            <label htmlFor="f-building">Building / apartment <span className="co-opt">optional</span></label>
            <input id="f-building" value={building} onChange={(e) => setBuilding(e.target.value)} />
          </div>
          <div className="co-row">
            <label htmlFor="f-notes">Delivery notes <span className="co-opt">optional</span></label>
            <textarea id="f-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {/* PAYMENT. No provider is integrated and no card details are
              collected anywhere (docs/payment-integration.md). Naming a method
              the store has not confirmed — Cash on Delivery, CliQ, a card —
              would be inventing a business rule.
              The wording describes the process the customer is actually in:
              every piece is crocheted to order, so the order is confirmed with
              them before anything is paid. "No payment is taken on this site"
              was equally true and read like a half-built shop. */}
          <p className="co-legend">Payment</p>
          <div className="co-pay">
            <p className="co-pay-head">Arcubed confirms your order with you.</p>
            <p className="co-pay-body">
              Every piece is crocheted to order, so Arcubed gets in touch on the details above to
              confirm your order and arrange payment and delivery. You are not charged when you
              place it.
            </p>
          </div>

          <button className="co-submit" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? "Sending…" : quoteRequired ? "Request your order" : "Place your order"}
          </button>
          <p className="co-payment-note">
            {quoteRequired
              ? "We reply with a shipping quote before anything is finalised."
              : "You will get a confirmation with your order number straight away."}
          </p>
        </form>
      </div>

      <aside className="co-summary" data-open={summaryOpen ? "true" : "false"}>
        {/* On a phone the summary sits above the form, so left open it pushed
            the first field off the screen. It collapses to one tappable row
            carrying the count and the total — the same disclosure the approved
            design direction asked for. The CSS only applies the collapse below
            the two-column breakpoint; on a desktop the panel is always open
            and this control is not rendered to the user at all. */}
        <button type="button" className="co-summary-toggle" aria-expanded={summaryOpen}
                aria-controls="co-summary-body" onClick={() => setSummaryOpen((o) => !o)}>
          <span className="co-summary-toggle-label">
            {summaryOpen ? "Hide order summary" : "Show order summary"}
            <span className="co-caret" aria-hidden="true" />
          </span>
          <span className="co-summary-toggle-total">
            {cartCount} {cartCount === 1 ? "item" : "items"} · {formatMoney(subtotal + shipping, currency)}
          </span>
        </button>
        <div className="co-summary-inner" id="co-summary-body">
          <p className="co-legend">Your cart</p>
          <ul className="co-lines">
            {cart.map((line) => {
              const parts = lineConfigParts(line);
              const frame =
                line.kind === "made_to_order"
                  ? mediaForSnapshot(line.snapshot.bagSlug, line.snapshot.bagName, line.snapshot.colourName)
                  : mediaForSnapshot(null, line.snapshot.productName, line.snapshot.colourName);
              const name = line.kind === "made_to_order" ? line.snapshot.bagName : line.snapshot.itemTitle;
              return (
                <li key={line.lineId} className="co-line">
                  <span className="co-thumb">
                    {frame ? (
                      <Image src={frame.photoSmall} alt="" width={160}
                             height={Math.round(160 / frame.ratio)} sizes="72px" />
                    ) : null}
                  </span>
                  <span className="co-line-body">
                    <span className="co-line-name">{name}</span>
                    {parts.length ? <span className="co-line-config">{parts.join(" · ")}</span> : null}
                    <span className="co-line-kind">
                      {line.kind === "ready_for_delivery" ? "Ready now" : "Made to order"}
                    </span>
                  </span>
                  <span className="co-line-price">
                    {line.qty > 1 ? <span className="co-line-qty">×{line.qty}</span> : null}
                    {formatMoney(line.unitPrice * line.qty, currency)}
                  </span>
                </li>
              );
            })}
          </ul>

          <dl className="co-totals">
            <div><dt>Subtotal</dt><dd>{formatMoney(subtotal, currency)}</dd></div>
            <div>
              <dt>Shipping</dt>
              <dd>{quoteRequired ? "Quoted by destination" : formatMoney(shipping, currency)}</dd>
            </div>
            <div className="co-total-row">
              <dt>{quoteRequired ? "Goods total" : "Total"}</dt>
              <dd>{formatMoney(subtotal + shipping, currency)}</dd>
            </div>
          </dl>

          {quoteRequired ? (
            <p className="co-quote">
              We ship worldwide. Shipping is quoted by destination, so the amount above covers the
              bags only. Arcubed confirms the shipping cost with you before anything is finalised.
            </p>
          ) : null}

          <div className="co-timing">
            {hasMade ? <p><strong>Made to order</strong> · {productionTimeLabel}</p> : null}
            {hasReady ? <p><strong>Ready now</strong> · {deliveryPromise}</p> : null}
            {hasMade && hasReady ? (
              <p className="co-timing-split">
                These arrive separately. Your ready piece ships first, the made-to-order pieces
                follow once they&rsquo;re finished.
              </p>
            ) : null}
          </div>
        </div>
      </aside>
    </section>
  );
}
