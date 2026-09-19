"use client";

// Arcubed Label — cart + UI state. Client-side only, no backend (per project scope:
// no Supabase/Stripe yet). Persists to localStorage so the cart survives normal
// navigation and page refreshes — a real improvement over the prototype's
// in-memory-only cart, without pulling in a database.
//
// Uses useSyncExternalStore rather than "read localStorage in a useEffect and
// setState" — the latter is flagged by React's stricter effect-purity rules and
// causes an extra cascading render; useSyncExternalStore is the API React ships
// specifically for synchronizing with an external store like localStorage,
// with a proper SSR snapshot so there's no hydration mismatch.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { CartLine } from "./types";

const STORAGE_KEY = "arcubed_cart_v1";

function uid(): string {
  return "l" + Math.random().toString(36).slice(2, 9);
}

// ---- module-level external store: a single global cart, shared by every
// subscriber (there is exactly one CartProvider in the app). ----
type Listener = () => void;
let listeners: Listener[] = [];
let cachedRaw = "[]";

function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function getSnapshot(): string {
  return cachedRaw;
}

function getServerSnapshot(): string {
  return "[]";
}

function subscribe(listener: Listener): () => void {
  if (listeners.length === 0) {
    // First subscriber: pick up whatever is already in storage (e.g. from a
    // previous session) before anyone reads the snapshot.
    cachedRaw = readRaw();
  }
  listeners.push(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cachedRaw = readRaw();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writeCart(cart: CartLine[]) {
  const json = JSON.stringify(cart);
  cachedRaw = json;
  try {
    window.localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Storage full/unavailable — cart still works for the session, just won't persist.
  }
  listeners.forEach((l) => l());
}

function parseCart(raw: string): CartLine[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// "Has the client store taken over from the SSR-safe empty snapshot yet" —
// the textbook useSyncExternalStore trick for hydration-safe mount detection,
// no effect required.
function subscribeNoop(): () => void {
  return () => {};
}

interface CartContextValue {
  cart: CartLine[];
  hydrated: boolean;
  cartCount: number;
  cartSubtotal: number;
  cartDrawerOpen: boolean;
  /** The line just added from a product page, while its confirmation shows. */
  justAddedId: string | null;
  openCartDrawer: (justAddedId?: string | null) => void;
  closeCartDrawer: () => void;
  toggleCartDrawer: () => void;
  /** Returns the id of the line that now holds this configuration. */
  addOrUpdateLine: (line: CartLine, editingLineId?: string | null) => string;
  removeLine: (lineId: string) => void;
  setQty: (lineId: string, qty: number) => void;
  /** Empties the cart after an order is successfully placed. */
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const cart = useMemo(() => parseCart(raw), [raw]);

  // Drawer open/close is pure UI state (not persisted) — plain useState is the
  // right tool here, no external store involved.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const addOrUpdateLine = useCallback(
    (line: CartLine, editingLineId?: string | null) => {
      const current = parseCart(getSnapshot());
      if (editingLineId) {
        writeCart(current.map((l) => (l.lineId === editingLineId ? line : l)));
        return editingLineId;
      }
      // THE SAME BAG TWICE IS ONE LINE, NOT TWO. Adding an identical
      // configuration again now raises its quantity instead of stacking a
      // second, indistinguishable row in the cart — the product page no
      // longer navigates away after adding, so pressing Add again is a real
      // thing a customer can do. Ready for Delivery lines are single pieces
      // and are never merged.
      const same = line.kind === "made_to_order" ? current.find((l) => sameConfig(l, line)) : undefined;
      if (same) {
        writeCart(current.map((l) => (l.lineId === same.lineId ? { ...l, qty: l.qty + line.qty } : l)));
        return same.lineId;
      }
      writeCart([...current, line]);
      return line.lineId;
    },
    []
  );

  const clearCart = useCallback(() => {
    writeCart([]);
  }, []);

  const removeLine = useCallback((lineId: string) => {
    const current = parseCart(getSnapshot());
    writeCart(current.filter((l) => l.lineId !== lineId));
  }, []);

  const setQty = useCallback((lineId: string, qty: number) => {
    const current = parseCart(getSnapshot());
    writeCart(current.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, qty) } : l)));
  }, []);

  // Stable, because the drawer's focus effect depends on them: a new function
  // every render would re-run that effect on every cart change and bounce
  // focus out of the panel and back.
  const openCartDrawer = useCallback((id?: string | null) => {
    setJustAddedId(id ?? null);
    setDrawerOpen(true);
  }, []);
  const closeCartDrawer = useCallback(() => {
    setDrawerOpen(false);
    setJustAddedId(null);
  }, []);
  const toggleCartDrawer = useCallback(() => {
    setJustAddedId(null);
    setDrawerOpen((v) => !v);
  }, []);

  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.qty, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((n, l) => n + l.unitPrice * l.qty, 0), [cart]);

  const value: CartContextValue = {
    cart,
    hydrated,
    cartCount,
    cartSubtotal,
    cartDrawerOpen: drawerOpen,
    justAddedId,
    openCartDrawer,
    closeCartDrawer,
    toggleCartDrawer,
    addOrUpdateLine,
    removeLine,
    setQty,
    clearCart,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

/** Two made-to-order lines describe the same physical bag. */
function sameConfig(a: CartLine, b: CartLine): boolean {
  if (a.kind !== "made_to_order" || b.kind !== "made_to_order") return false;
  const ids = (x: string[]) => [...x].sort().join(",");
  return (
    a.bagId === b.bagId &&
    a.colourId === b.colourId &&
    (a.secondaryColourId ?? null) === (b.secondaryColourId ?? null) &&
    (a.sizeId ?? null) === (b.sizeId ?? null) &&
    (a.strapId ?? null) === (b.strapId ?? null) &&
    (a.handleId ?? null) === (b.handleId ?? null) &&
    (a.chainId ?? null) === (b.chainId ?? null) &&
    ids(a.addonIds) === ids(b.addonIds) &&
    a.unitPrice === b.unitPrice
  );
}

export { uid };
