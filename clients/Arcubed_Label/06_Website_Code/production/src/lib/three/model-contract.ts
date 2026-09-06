// Arcubed Label — the 3D model contract. This is the ONE place the GLB
// node-naming convention and per-product part requirements are defined.
// Every loader/component in src/components/three/ reads from here rather
// than hardcoding a node name; every real GLB produced for Arcubed must
// follow this exactly. Human-readable version: docs/3d-assets.md — keep
// both in sync if this ever changes.
//
// Design principle: the GLB itself declares which parts a given bag has, by
// which named nodes are present at load time — there is no separate
// "hasHandle" database flag to keep in sync. PRODUCT_PART_REQUIREMENTS below
// is a *specification* for whoever builds the asset (what it must contain),
// not something the app reads at runtime to decide what to render.

/**
 * Mesh/node names for the parts baked directly into a bag BODY GLB.
 * Not every body model needs every node — see PRODUCT_PART_REQUIREMENTS.
 */
export const BODY_NODE_NAMES = {
  /** The bag's primary/base material zone. Every body model needs this. */
  primaryBody: "bag_body_primary",
  /** Second independently-coloured material zone, for two-tone products only. */
  secondaryBody: "bag_body_secondary",
  /** A handle baked into the body model itself — not a shared/swappable
   *  component. Optional per product; see PRODUCT_PART_REQUIREMENTS and
   *  each product's spec in docs/3d-production/ for whether/why. Also used
   *  for Vault's integrated hand-opening/handle structure if a modeler
   *  chooses to split it into its own node (optional there — see
   *  vault-spec.md §1). */
  handle: "handle",
  /** Clasps/buckles/rivets — usually a fixed metal material, not customer-colour-driven. */
  hardware: "hardware",
  /** Loco's hanging fringe covering the lower body — confirmed identity-
   *  critical from real photography (docs/3d-production/PRODUCT-GEOMETRY-MAP.md).
   *  Not used by any other product today. See loco-spec.md for the
   *  strand/card geometry approaches this node's content may take. */
  fringe: "fringe",
} as const;

/**
 * Empty (no-geometry) transform nodes inside a body GLB that mark where a
 * separately-loaded strap/chain/handle GLB should be parented at runtime.
 * A body model only needs the attach point for parts it actually supports
 * as swappable (e.g. Vault has attach_strap + attach_chain, no attach_handle).
 */
export const ATTACH_POINT_NAMES = {
  strap: "attach_strap",
  chain: "attach_chain",
  handle: "attach_handle",
} as const;

export type BodyNodeKey = keyof typeof BODY_NODE_NAMES;
export type AttachPointKey = keyof typeof ATTACH_POINT_NAMES;

/** A single swappable-component GLB (strap/chain/handle) has one root mesh named after its kind. */
export const COMPONENT_NODE_NAMES = {
  strap: "strap",
  chain: "chain",
  handle: "handle",
} as const;

export type ThreeAssetKind = "body" | "strap" | "chain" | "handle" | "hardware";

/**
 * What a real production GLB must contain for each of the four real
 * products — this is the spec to hand to whoever builds/exports the models,
 * and what docs/3d-assets.md describes in prose. It is NOT consulted by the
 * runtime viewer to decide what to render (the loaded GLB's own node
 * presence does that) — it exists so asset production and app behavior stay
 * aligned by design instead of by chance.
 */
export interface ProductPartRequirements {
  secondaryBody: boolean; // two-tone
  // Handle baked into the body (not swappable) as its OWN named node.
  // false does not mean "this product has no handle-like feature" — see
  // each product's spec. It means the *separate node* isn't required:
  // either the product genuinely has no such feature (Vault before this
  // correction — no longer applies; Loco, Nova's unresolved default), or
  // the feature exists but may be sculpted as part of bag_body_primary
  // instead of split into its own node (Vault, per vault-spec.md §1 — a
  // modeler's choice, not a requirement either way).
  handle: boolean;
  strap: boolean; // swappable strap supported
  chain: boolean; // swappable chain supported
  hardware: boolean;
  // Loco's hanging fringe system — see loco-spec.md. Not applicable to any
  // other product today.
  fringe: boolean;
}

export const PRODUCT_PART_REQUIREMENTS: Record<"nova" | "vault" | "mini-luna" | "loco", ProductPartRequirements> = {
  // handle: false — real Nova photography shows a "with Handle" folder
  // AND a standard reference photo (Gold Nova) with no tall integrated
  // handle visible. Requiring the node would incorrectly reject a
  // standard-construction Nova body. Keep unresolved (optional) until
  // Rand confirms whether handle is a real, permanent part of Nova's
  // construction — see PRODUCT-GEOMETRY-MAP.md, Nova §2.
  nova: { secondaryBody: true, handle: false, strap: true, chain: true, hardware: true, fringe: false },
  // handle: false — Vault's confirmed integrated hand-opening/handle is
  // real and required geometry (see vault-spec.md §1), but a SEPARATE
  // named node for it is explicitly optional ("may have its own named
  // mesh if useful for materials/QA" — not "must"). The validator can't
  // meaningfully gate a visual feature that may or may not get its own
  // node; the requirement lives in vault-spec.md's prose and the
  // PRODUCT-GEOMETRY-MAP.md acceptance gate instead.
  vault: { secondaryBody: false, handle: false, strap: true, chain: true, hardware: true, fringe: false },
  // handle: true — Mini Luna's confirmed large arched handle is required
  // as its own node (see mini-luna-spec.md §1) — explicitly instructed,
  // distinct from Vault's "optional node" case above.
  "mini-luna": { secondaryBody: true, handle: true, strap: true, chain: true, hardware: true, fringe: false },
  // fringe: true — Loco's confirmed hanging fringe is identity-critical
  // and required as its own node (see loco-spec.md §1).
  loco: { secondaryBody: false, handle: false, strap: true, chain: true, hardware: true, fringe: true },
};

/** Public path to the self-hosted Draco decoder — see public/draco/. */
export const DRACO_DECODER_PATH = "/draco/";

/**
 * Production budgets, sourced from docs/3d-production/*.md (the numbers
 * there are authored FROM these constants — keep both in sync if either
 * changes). Consumed by the dev-only validator (src/lib/three/validate-model.ts)
 * so "excessive triangle count"/"excessive texture size" warnings use the
 * exact same numbers the human-readable specs quote, not a second guess.
 */
export const PART_BUDGETS: Record<
  "nova-body" | "vault-body" | "mini-luna-body" | "loco-body" | "strap" | "chain" | "handle" | "hardware",
  { maxTriangles: number; maxTextureSize: number; defaultTextureSize: number; maxFileSizeBytes: number }
> = {
  "nova-body": { maxTriangles: 18000, maxTextureSize: 2048, defaultTextureSize: 1024, maxFileSizeBytes: 3 * 1024 * 1024 },
  "vault-body": { maxTriangles: 14000, maxTextureSize: 2048, defaultTextureSize: 1024, maxFileSizeBytes: 2.5 * 1024 * 1024 },
  // Raised from 14,000/2.5MB once the confirmed required arched handle
  // (mini-luna-spec.md §1) was added to the contract — the handle is real
  // geometry the original budget didn't account for.
  "mini-luna-body": { maxTriangles: 16000, maxTextureSize: 2048, defaultTextureSize: 1024, maxFileSizeBytes: 2.75 * 1024 * 1024 },
  // Raised from the original 14,000/2.5MB (shared with Vault/Mini Luna)
  // once the fringe requirement was confirmed — a fringe system built as
  // optimized strand/card geometry (loco-spec.md's ordered approaches)
  // adds real triangle and file-size cost beyond a plain single-zone body.
  // This is a planning adjustment, not a measured real value — revisit
  // once an actual candidate fringe asset gives a real number.
  "loco-body": { maxTriangles: 20000, maxTextureSize: 2048, defaultTextureSize: 1024, maxFileSizeBytes: 3.5 * 1024 * 1024 },
  strap: { maxTriangles: 3000, maxTextureSize: 512, defaultTextureSize: 512, maxFileSizeBytes: 1024 * 1024 },
  chain: { maxTriangles: 5000, maxTextureSize: 512, defaultTextureSize: 512, maxFileSizeBytes: 1024 * 1024 },
  handle: { maxTriangles: 3000, maxTextureSize: 512, defaultTextureSize: 512, maxFileSizeBytes: 1024 * 1024 },
  hardware: { maxTriangles: 800, maxTextureSize: 512, defaultTextureSize: 512, maxFileSizeBytes: 1024 * 1024 },
};

export type ProductKey = "nova" | "vault" | "mini-luna" | "loco";

/** Reasonable real-world bag envelope, meters — used only for the validator's soft "does this look like a bag" scale warning, never as an authoritative dimension (no real measurements exist yet — see product-matrix.md). */
export const EXPECTED_BAG_SCALE_METERS = { min: 0.08, max: 0.6 };
