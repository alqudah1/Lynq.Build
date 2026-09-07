"use client";

import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";
import MobileMenu from "./MobileMenu";

export default function Header() {
  const { cartCount, toggleCartDrawer } = useCart();

  return (
    <header className="site-header">
      {/* Light background (--bg) → navy wordmark, per the client's official
          logo usage rule (navy bg gets the pale-pink treatment instead). */}
      <Link className="logo" href="/" aria-label="Arcubed Label, home">
        <Image src="/brand/arcubed-wordmark-navy.png" alt="Arcubed Label" width={1116} height={298} priority />
      </Link>
      <nav className="nav">
        <Link href="/shop">Shop</Link>
        <Link href="/ready-for-delivery">Ready for Delivery</Link>
        <Link href="/about">About</Link>
        <Link href="/faq">FAQ</Link>
        <Link href="/contact">Contact</Link>
      </nav>
      <div className="header-actions">
        <button className="icon-btn cart-icon" aria-label="Open cart" onClick={toggleCartDrawer}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 8h12l-1 12.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20.5L6 8Z" />
            <path d="M9 8V6a3 3 0 0 1 6 0v2" />
          </svg>
          <span className="badge" style={{ display: cartCount > 0 ? "flex" : "none" }}>
            {cartCount}
          </span>
        </button>
        <MobileMenu />
      </div>
    </header>
  );
}
