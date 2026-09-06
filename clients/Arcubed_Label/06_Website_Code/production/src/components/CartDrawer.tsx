"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart-context";
import { snapshotSummary, money } from "@/lib/pricing";
import type { CartLine } from "@/lib/types";
import CartThumb from "./CartThumb";

function DrawerLine({ line }: { line: CartLine }) {
  if (line.kind === "ready_for_delivery") {
    const { snapshot } = line;
    return (
      <div className="drawer-line">
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
    <div className="drawer-line">
      <div className="drawer-thumb">
        <CartThumb line={line} />
      </div>
      <div className="drawer-line-body">
        <p className="drawer-line-name">{snapshot.bagName}</p>
        <p className="drawer-line-opt">{snapshotSummary(snapshot).slice(0, 2).join(" · ")}</p>
        <p className="drawer-line-price">{money(line.unitPrice)}</p>
      </div>
    </div>
  );
}

export default function CartDrawer() {
  const { cart, cartDrawerOpen, closeCartDrawer, cartSubtotal } = useCart();

  return (
    <>
      <div
        className={`drawer-overlay${cartDrawerOpen ? " show" : ""}`}
        onClick={closeCartDrawer}
        aria-hidden={!cartDrawerOpen}
      />
      <aside className={`cart-drawer${cartDrawerOpen ? " open" : ""}`} aria-hidden={!cartDrawerOpen}>
        <div className="drawer-head">
          <span>Your Bag</span>
          <button className="icon-btn" aria-label="Close" onClick={closeCartDrawer}>
            ×
          </button>
        </div>
        {cart.length === 0 ? (
          <p className="drawer-empty">Nothing here yet — go find your bag.</p>
        ) : (
          <>
            <div className="drawer-lines">
              {cart.map((line) => (
                <DrawerLine line={line} key={line.lineId} />
              ))}
            </div>
            <div className="drawer-foot">
              <div className="drawer-subtotal">
                <span>Subtotal</span>
                <strong>{money(cartSubtotal)}</strong>
              </div>
              <Link className="btn btn-primary btn-block" href="/cart" onClick={closeCartDrawer}>
                View Bag
              </Link>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
