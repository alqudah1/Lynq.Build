"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useCart } from "@/lib/cart-context";
import { snapshotSummary, money } from "@/lib/pricing";
import type { CartLine } from "@/lib/types";
import CartThumb from "./CartThumb";

function DrawerLine({ line, added }: { line: CartLine; added: boolean }) {
  if (line.kind === "ready_for_delivery") {
    const { snapshot } = line;
    return (
      <div className={`drawer-line${added ? " is-added" : ""}`}>
        <div className="drawer-thumb">
          <CartThumb line={line} />
        </div>
        <div className="drawer-line-body">
          <p className="drawer-line-name">{snapshot.itemTitle}</p>
          <p className="drawer-line-opt">Ready for Delivery</p>
          <p className="drawer-line-price">{money(line.unitPrice)}</p>
        </div>
      </div>
    );
  }

  const { snapshot } = line;
  return (
    <div className={`drawer-line${added ? " is-added" : ""}`}>
      <div className="drawer-thumb">
        <CartThumb line={line} />
      </div>
      <div className="drawer-line-body">
        <p className="drawer-line-name">{snapshot.bagName}</p>
        {/* The line just added lists every choice: showing only the first
            two left a strap out of a JOD 60 line that read as a JOD 55 bag. */}
        <p className="drawer-line-opt">{(added ? snapshotSummary(snapshot) : snapshotSummary(snapshot).slice(0, 3)).join(" · ")}</p>
        <p className="drawer-line-price">
          {money(line.unitPrice)}
          {line.qty > 1 ? <span className="drawer-line-qty"> × {line.qty}</span> : null}
        </p>
      </div>
    </div>
  );
}

/**
 * The cart panel, and the post-add decision.
 *
 * Adding a bag used to toast "Added to your bag" and push the customer
 * straight to /cart, so there was no way to keep browsing and nothing on the
 * product page confirmed what had happened (client: "there isn't a 'view bag
 * or keep shopping' option"). Adding now keeps the customer on the product
 * page, with their configuration intact, and opens this panel with the choice
 * stated plainly: View Cart or Keep Shopping. Opened from the header icon it
 * is the same panel without the confirmation line.
 */
export default function CartDrawer() {
  const { cart, cartDrawerOpen, closeCartDrawer, cartSubtotal, justAddedId } = useCart();
  const panelRef = useRef<HTMLElement>(null);
  const firstActionRef = useRef<HTMLAnchorElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const openedAt = useRef(0);

  // Focus goes into the panel when it opens and back where it came from when
  // it closes, and Escape closes it: a keyboard customer who pressed Add to
  // Cart lands on View Cart, and Keep Shopping returns them to the button.
  useEffect(() => {
    if (!cartDrawerOpen) return;
    openedAt.current = performance.now();
    returnTo.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      (firstActionRef.current ?? panelRef.current?.querySelector<HTMLElement>("button"))?.focus();
    }, 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCartDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      returnTo.current?.focus?.({ preventScroll: true });
    };
  }, [cartDrawerOpen, closeCartDrawer]);

  const added = justAddedId ? cart.find((l) => l.lineId === justAddedId) ?? null : null;
  const addedName =
    added?.kind === "made_to_order"
      ? `${added.snapshot.bagName} in ${added.snapshot.colourName}`
      : added?.kind === "ready_for_delivery"
        ? added.snapshot.itemTitle
        : "";

  // A double tap on Add to Cart adds once (the Customizer's lock), but the
  // second tap lands on this overlay the moment it appears and closed the
  // panel the first tap opened. Taps in the first 600ms are the same gesture.
  const onOverlay = () => {
    if (performance.now() - openedAt.current < 600) return;
    closeCartDrawer();
  };

  return (
    <>
      <div
        className={`drawer-overlay${cartDrawerOpen ? " show" : ""}`}
        onClick={onOverlay}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className={`cart-drawer${cartDrawerOpen ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        aria-hidden={!cartDrawerOpen}
        inert={!cartDrawerOpen}
      >
        <div className="drawer-head">
          <span id="cart-drawer-title">{added ? "Added to your cart" : "Your Cart"}</span>
          <button className="icon-btn" aria-label="Close cart" onClick={closeCartDrawer}>
            ×
          </button>
        </div>
        {/* Announced to screen readers the moment a bag is added, without
            moving the whole panel's contents into a live region. */}
        <p className="sr-only" role="status" aria-live="polite">
          {cartDrawerOpen && added ? `${addedName} added to your cart.` : ""}
        </p>
        {cart.length === 0 ? (
          <p className="drawer-empty">Nothing here yet. Go find your bag.</p>
        ) : (
          <>
            <div className="drawer-lines">
              {cart.map((line) => (
                <DrawerLine line={line} key={line.lineId} added={line.lineId === justAddedId} />
              ))}
            </div>
            <div className="drawer-foot">
              <div className="drawer-subtotal">
                <span>Subtotal</span>
                <strong>{money(cartSubtotal)}</strong>
              </div>
              <div className="drawer-actions">
                <Link ref={firstActionRef} className="btn btn-primary btn-block" href="/cart" onClick={closeCartDrawer}>
                  View Cart
                </Link>
                <button type="button" className="drawer-keep" onClick={closeCartDrawer}>
                  Keep Shopping
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
