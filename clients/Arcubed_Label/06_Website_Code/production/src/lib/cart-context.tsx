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
  openCartDrawer: () => void;
  closeCartDrawer: () => void;
  toggleCartDrawer: () => void;
  addOrUpdateLine: (line: CartLine, editingLineId?: string | null) => void;
  removeLine: (lineId: string) => void;
  setQty: (lineId: string, qty: number) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const cart = useMemo(() => parseCart(raw), [raw]);

  // Drawer open/close is pure UI state (not persisted) — plain useState is the
  // right tool here, no external store involved.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const addOrUpdateLine = useCallback(
    (line: CartLine, editingLineId?: string | null) => {
      const current = parseCart(getSnapshot());
      const next = editingLineId
        ? current.map((l) => (l.lineId === editingLineId ? line : l))
        : [...current, line];
      writeCart(next);
    },
    []
  );

  const removeLine = useCallback((lineId: string) => {
    const current = parseCart(getSnapshot());
    writeCart(current.filter((l) => l.lineId !== lineId));
  }, []);

  const setQty = useCallback((lineId: string, qty: number) => {
    const current = parseCart(getSnapshot());
    writeCart(current.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, qty) } : l)));
  }, []);

  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.qty, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((n, l) => n + l.unitPrice * l.qty, 0), [cart]);

  const value: CartContextValue = {
    cart,
    hydrated,
    cartCount,
    cartSubtotal,
    cartDrawerOpen: drawerOpen,
    openCartDrawer: () => setDrawerOpen(true),
    closeCartDrawer: () => setDrawerOpen(false),
    toggleCartDrawer: () => setDrawerOpen((v) => !v),
    addOrUpdateLine,
    removeLine,
    setQty,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

export { uid };
