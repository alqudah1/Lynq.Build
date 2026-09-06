// Verification-only script — not part of the app. Exercises computeUnitPrice
// (pricing.ts's pure pricing rule: basePrice + sum(selected priceDeltas))
// against synthetic Bag objects built from Rand's CONFIRMED real values
// (already applied to Supabase via 20260903090000_update_confirmed_size_
// strap_chain_and_luna_colours.sql — verified against the live DB separately,
// this script only checks the pure arithmetic is correct). Run with:
// node scripts/test-pricing.ts

import { computeUnitPrice } from "../src/lib/pricing.ts";
import type { Bag } from "../src/lib/types.ts";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

function baseBag(overrides: Partial<Bag>): Bag {
  return {
    id: "p1",
    slug: "p1",
    name: "Test Bag",
    basePrice: 50,
    description: "",
    colours: [
      { id: "c1", name: "Black", hex: "#000000", isTwoTone: false },
      { id: "c2", name: "Silver & Gold", hex: "#cccccc", isTwoTone: true },
    ],
    images: [],
    model3D: undefined,
    ...overrides,
  } as Bag;
}

// --- Nova: Regular (default, +0), Medium (+5), Large (+5) ---
const nova = baseBag({
  basePrice: 55,
  sizes: [
    { id: "reg", label: "Regular", priceDelta: 0 },
    { id: "med", label: "Medium", priceDelta: 5 },
    { id: "lg", label: "Large", priceDelta: 5 },
  ],
});
assert(
  computeUnitPrice(nova, { colourId: "c1", secondaryColourId: null, sizeId: "reg", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 55,
  "Nova Regular = base price (55), +0"
);
assert(
  computeUnitPrice(nova, { colourId: "c1", secondaryColourId: null, sizeId: "med", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 60,
  "Nova Medium = base + 5 (60)"
);
assert(
  computeUnitPrice(nova, { colourId: "c1", secondaryColourId: null, sizeId: "lg", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 60,
  "Nova Large = base + 5 (60)"
);

// --- Vault: Regular (default, +0), Large (+5) ---
const vault = baseBag({
  basePrice: 50,
  sizes: [
    { id: "reg", label: "Regular", priceDelta: 0 },
    { id: "lg", label: "Large", priceDelta: 5 },
  ],
});
assert(
  computeUnitPrice(vault, { colourId: "c1", secondaryColourId: null, sizeId: "reg", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 50,
  "Vault Regular = base price (50), +0"
);
assert(
  computeUnitPrice(vault, { colourId: "c1", secondaryColourId: null, sizeId: "lg", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 55,
  "Vault Large = base + 5 (55)"
);

// --- Mini Luna: Regular (default, +0), Small (FREE size-up, +0 — must NOT be +5) ---
const miniLuna = baseBag({
  basePrice: 50,
  sizes: [
    { id: "reg", label: "Regular", priceDelta: 0 },
    { id: "sm", label: "Small", priceDelta: 0 },
  ],
});
assert(
  computeUnitPrice(miniLuna, { colourId: "c1", secondaryColourId: null, sizeId: "reg", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 50,
  "Mini Luna Regular = base price (50), +0"
);
assert(
  computeUnitPrice(miniLuna, { colourId: "c1", secondaryColourId: null, sizeId: "sm", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 50,
  "Mini Luna Small = base price (50), +0 (free size-up, NOT +5)"
);

// --- Straps/chains: Crochet Strap, Silver Tone Chain, Gold Tone Chain, all +5 ---
const strapChainBag = baseBag({
  basePrice: 55,
  straps: [{ id: "crochet", label: "Crochet Strap", priceDelta: 5 }],
  chains: [
    { id: "silver", label: "Silver Tone Chain", priceDelta: 5 },
    { id: "gold", label: "Gold Tone Chain", priceDelta: 5 },
  ],
});
assert(
  computeUnitPrice(strapChainBag, { colourId: "c1", secondaryColourId: null, sizeId: null, strapId: "crochet", handleId: null, chainId: null, addonIds: [] }) === 60,
  "Crochet Strap = base + 5 (60)"
);
assert(
  computeUnitPrice(strapChainBag, { colourId: "c1", secondaryColourId: null, sizeId: null, strapId: null, handleId: null, chainId: "silver", addonIds: [] }) === 60,
  "Silver Tone Chain = base + 5 (60)"
);
assert(
  computeUnitPrice(strapChainBag, { colourId: "c1", secondaryColourId: null, sizeId: null, strapId: null, handleId: null, chainId: "gold", addonIds: [] }) === 60,
  "Gold Tone Chain = base + 5 (60)"
);
assert(
  computeUnitPrice(strapChainBag, { colourId: "c1", secondaryColourId: null, sizeId: null, strapId: "crochet", handleId: null, chainId: "gold", addonIds: [] }) === 65,
  "Crochet Strap + Gold Tone Chain = base + 5 + 5 (65), both selectable together"
);

// --- Two-tone: Nova + Mini Luna, selecting the two-tone secondary colour
// must add +0 — computeUnitPrice never reads secondaryColourId, by
// construction there is no price path for it, which is the correct
// behavior (two-tone is confirmed free on both products).
assert(
  computeUnitPrice(nova, { colourId: "c1", secondaryColourId: "c2", sizeId: "reg", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 55,
  "Nova + two-tone secondary colour = base price (55), +0"
);
assert(
  computeUnitPrice(miniLuna, { colourId: "c1", secondaryColourId: "c2", sizeId: "reg", strapId: null, handleId: null, chainId: null, addonIds: [] }) === 50,
  "Mini Luna + two-tone secondary colour = base price (50), +0"
);

console.log(failures === 0 ? "\nAll pricing checks passed." : `\n${failures} pricing check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
