"use client";

// Mobile-only navigation menu. Most traffic is expected from Instagram/mobile
// (per Rand), and the approved prototype's header nav is desktop-only with no
// mobile fallback — this fills that gap without touching the desktop header.
//
// Full-screen overlay rather than a side drawer, deliberately: it sits BELOW
// the sticky header in z-index (not on top of it), so the header — including
// the cart icon — stays visible and tappable the entire time the menu is open,
// satisfying "cart access must remain visible" without duplicating the cart
// control inside the menu itself.
//
// The toggle button lives inline in the header, but the overlay/panel are
// portaled to document.body: the header itself is position:sticky with its
// own z-index, which creates a stacking context, so a fixed-position overlay
// nested inside it would paint over the header's own content regardless of
// z-index value. Portaling makes it a true sibling of the header in the real
// stacking order, matching how CartDrawer is already a root-level sibling.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Mount-detection without an effect (and without a hydration mismatch): the
// same textbook useSyncExternalStore trick used in cart-context.tsx. The
// client's first hydration render must match SSR (mounted=false); the portal
// only appears in a subsequent client-only update, once mounted=true.
function subscribeNoop(): () => void {
  return () => {};
}
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

const LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/ready-for-delivery", label: "Ready for Delivery" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export default function MobileMenu() {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const pathname = usePathname();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  // Close on route change — adjusted during render (React's documented pattern
  // for "reset state when a prop changes") rather than in an effect, so it
  // doesn't cost an extra cascading render.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  // Escape closes; body scroll lock while open; focus the first link on open,
  // return focus to the toggle button on close.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstLinkRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    const toggleButton = toggleRef.current;
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      toggleButton?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        className="menu-toggle icon-btn"
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-menu-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {mounted
        ? createPortal(
            <>
              <div
                className={`mobile-menu-overlay${open ? " show" : ""}`}
                onClick={() => setOpen(false)}
                aria-hidden={!open}
              />
              <div
                id="mobile-menu-panel"
                ref={panelRef}
                className={`mobile-menu${open ? " open" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label="Site menu"
                aria-hidden={!open}
              >
                <nav className="mobile-menu-links">
                  {LINKS.map((link, i) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      ref={i === 0 ? firstLinkRef : undefined}
                      tabIndex={open ? 0 : -1}
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  );
}
