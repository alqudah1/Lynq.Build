import { z } from "zod";

/**
 * A generated prospect website has to look like it was designed for one
 * specific business, not stamped out of a template. Two things make that
 * true and checkable:
 *
 *  1. The design direction is drawn from a bounded vocabulary of genuinely
 *     different layouts, type systems and motifs, so "distinctive" means a
 *     different *structure*, not a different accent colour.
 *  2. Every palette is repaired into WCAG-legible territory before it can
 *     reach a page. Contrast is arithmetic, so this is a proof rather than
 *     an intention — see `ensureReadable` and `contrastRatio` below.
 *
 * The model proposes a direction; this module is what makes the proposal
 * safe. When the model is unavailable or proposes something unusable, the
 * deterministic derivation from the business identity still produces a
 * direction that differs business to business.
 */

export const LAYOUT_ARCHETYPES = [
  "editorial-split",
  "gallery-immersive",
  "warm-minimal",
  "market-grid",
  "counter-forward",
] as const;
export type LayoutArchetype = (typeof LAYOUT_ARCHETYPES)[number];

export const TYPE_SYSTEMS = ["grotesk", "humanist", "transitional", "slab", "geometric"] as const;
export type TypeSystem = (typeof TYPE_SYSTEMS)[number];

export const MOTIFS = ["hairline", "arc", "stack", "caps-rule", "ticket"] as const;
export type Motif = (typeof MOTIFS)[number];

export const DENSITIES = ["airy", "balanced", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

const HEX = /^#[0-9a-f]{6}$/;

export const palettarySchema = z.object({
  scheme: z.enum(["light", "dark"]),
  background: z.string().regex(HEX),
  surface: z.string().regex(HEX),
  ink: z.string().regex(HEX),
  muted: z.string().regex(HEX),
  accent: z.string().regex(HEX),
  accentInk: z.string().regex(HEX),
});
export type Palette = z.infer<typeof palettarySchema>;

export const designDirectionSchema = z.object({
  /** A short internal name for the direction, e.g. "Charcoal counter". */
  name: z.string().trim().min(1).max(80),
  /** Why this direction suits this specific business. Shown to the founder. */
  rationale: z.string().trim().min(40).max(1200),
  layout: z.enum(LAYOUT_ARCHETYPES),
  typeSystem: z.enum(TYPE_SYSTEMS),
  motif: z.enum(MOTIFS),
  density: z.enum(DENSITIES),
  radius: z.number().int().min(0).max(28),
  palette: palettarySchema,
});
export type DesignDirection = z.infer<typeof designDirectionSchema>;

/** The proposal shape the model is asked for: colours are a hue intent, not raw hex. */
export const designProposalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rationale: z.string().trim().min(40).max(1200),
  layout: z.enum(LAYOUT_ARCHETYPES),
  typeSystem: z.enum(TYPE_SYSTEMS),
  motif: z.enum(MOTIFS),
  density: z.enum(DENSITIES),
  scheme: z.enum(["light", "dark"]),
  /** Degrees on the colour wheel for the brand accent. */
  accentHue: z.number().int().min(0).max(359),
  /** Degrees for the page ground; usually a neutral relative of the accent. */
  neutralHue: z.number().int().min(0).max(359),
  /** 0 = fully neutral ground, 100 = strongly tinted ground. */
  neutralTint: z.number().int().min(0).max(100),
  radius: z.number().int().min(0).max(28),
});
export type DesignProposal = z.infer<typeof designProposalSchema>;

/**
 * Real typefaces, one pairing per type system.
 *
 * A generated site used to fall back to whatever a device happened to
 * have, which is the single loudest tell that something was produced by a
 * machine rather than designed. Each pairing is a display face with real
 * character and a body face that stays readable at length; the stacks
 * still end in a system fallback so a blocked stylesheet degrades rather
 * than breaks.
 */
export const TYPE_STACKS: Record<TypeSystem, { display: string; body: string; webFonts: string[] }> = {
  grotesk: {
    display: '"Space Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif',
    body: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
    webFonts: ["Space+Grotesk:wght@400;500;700", "Inter:wght@400;500;600"],
  },
  humanist: {
    display: '"Work Sans", "Optima", "Gill Sans", "Segoe UI", sans-serif',
    body: '"Inter", "Segoe UI", Candara, sans-serif',
    webFonts: ["Work+Sans:wght@400;500;600", "Inter:wght@400;500"],
  },
  transitional: {
    display: '"Playfair Display", Georgia, "Times New Roman", serif',
    body: '"Lora", Georgia, "Times New Roman", serif',
    webFonts: ["Playfair+Display:ital,wght@0,500;0,700;1,500", "Lora:wght@400;500"],
  },
  slab: {
    display: '"Zilla Slab", Rockwell, Georgia, serif',
    body: '"Source Serif 4", Georgia, "Times New Roman", serif',
    webFonts: ["Zilla+Slab:wght@500;700", "Source+Serif+4:opsz,wght@8..60,400;8..60,600"],
  },
  geometric: {
    display: '"Poppins", "Futura", "Century Gothic", sans-serif',
    body: '"Inter", "Avenir Next", "Segoe UI", sans-serif',
    webFonts: ["Poppins:wght@400;500;600", "Inter:wght@400;500"],
  },
};

/** The one stylesheet a generated demo loads, built from its own type system. */
export function webFontHref(typeSystem: TypeSystem): string {
  const families = TYPE_STACKS[typeSystem].webFonts.map((family) => `family=${family}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

export const DENSITY_SCALE: Record<Density, { section: string; gap: string; measure: string; display: string; lead: string }> = {
  airy: { section: "clamp(5.5rem, 12vw, 11rem)", gap: "2.75rem", measure: "38rem", display: "clamp(3.2rem, 8vw, 7.5rem)", lead: "clamp(1.15rem, 1.6vw, 1.5rem)" },
  balanced: { section: "clamp(4.5rem, 9vw, 8.5rem)", gap: "2rem", measure: "34rem", display: "clamp(2.9rem, 7vw, 6.2rem)", lead: "clamp(1.1rem, 1.4vw, 1.35rem)" },
  compact: { section: "clamp(3.5rem, 7vw, 6rem)", gap: "1.5rem", measure: "31rem", display: "clamp(2.5rem, 6vw, 5rem)", lead: "1.05rem" },
};

/* ------------------------------------------------------------------ */
/* Colour arithmetic                                                   */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const channel = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function channelLuminance(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const value = hex.trim().toLowerCase();
  if (!HEX.test(value)) throw new Error(`Not a six-digit hex colour: ${hex}`);
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Walk a colour's lightness away from the ground until it reads. Hue and
 * saturation are preserved, so the brand intent survives the repair; only
 * legibility is non-negotiable. Returns the first lightness that clears the
 * target, or the extreme (near-black / near-white) if nothing else does.
 */
export function ensureReadable(input: {
  hue: number;
  saturation: number;
  lightness: number;
  against: string;
  target: number;
  direction: "darker" | "lighter";
}): string {
  const step = input.direction === "darker" ? -0.02 : 0.02;
  let lightness = clamp(input.lightness, 0.02, 0.98);
  for (let attempt = 0; attempt <= 50; attempt += 1) {
    const candidate = hslToHex(input.hue, input.saturation, lightness);
    if (contrastRatio(candidate, input.against) >= input.target) return candidate;
    const next = lightness + step;
    if (next < 0.02 || next > 0.98) break;
    lightness = next;
  }
  return input.direction === "darker" ? "#050505" : "#fdfdfd";
}

/* ------------------------------------------------------------------ */
/* Deterministic identity seed                                         */
/* ------------------------------------------------------------------ */

/** FNV-1a. Small, stable across runs and platforms — a design must not drift between a preview and a rebuild. */
export function identitySeed(value: string): number {
  let hash = 0x811c9dc5;
  const normalized = value.trim().toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pick<T>(options: readonly T[], seed: number, offset: number): T {
  return options[(Math.floor(seed / 7 ** offset) + offset) % options.length]!;
}

/**
 * A usable direction derived from nothing but the business identity. Used
 * as the floor when the model is unavailable or returns something invalid,
 * and as the source of any field a proposal leaves unusable.
 */
export function deriveDesignProposal(identity: string): DesignProposal {
  const seed = identitySeed(identity);
  const accentHue = seed % 360;
  return {
    name: `${pick(["Ground", "Counter", "Table", "Room", "Corner"], seed, 1)} ${pick(["study", "edition", "series", "profile"], seed, 2)}`,
    rationale:
      "Derived from the business identity so the direction is stable across rebuilds and distinct from other prospects. Layout, type system and palette hue are all seeded from the name and location rather than a shared template.",
    layout: pick(LAYOUT_ARCHETYPES, seed, 1),
    typeSystem: pick(TYPE_SYSTEMS, seed, 2),
    motif: pick(MOTIFS, seed, 3),
    density: pick(DENSITIES, seed, 4),
    scheme: seed % 2 === 0 ? "light" : "dark",
    accentHue,
    neutralHue: (accentHue + 18) % 360,
    neutralTint: seed % 26,
    radius: [0, 2, 4, 8, 14, 20][seed % 6]!,
  };
}

/**
 * Turn a proposal into a palette that is guaranteed legible: body text,
 * secondary text and accent-on-ground all clear WCAG AA (4.5:1), and text
 * on the accent clears it too. `resolveDesignDirection` is therefore total
 * — there is no palette it can return that the validator would reject.
 */
export function resolveDesignDirection(proposal: DesignProposal): DesignDirection {
  const dark = proposal.scheme === "dark";
  const tint = proposal.neutralTint / 100;
  const groundSaturation = 0.02 + tint * 0.10;
  const background = hslToHex(proposal.neutralHue, groundSaturation, dark ? 0.07 : 0.975);
  const surface = hslToHex(proposal.neutralHue, groundSaturation, dark ? 0.12 : 0.935);
  const ink = ensureReadable({
    hue: proposal.neutralHue,
    saturation: groundSaturation * 0.6,
    lightness: dark ? 0.95 : 0.13,
    against: background,
    target: 12,
    direction: dark ? "lighter" : "darker",
  });
  const muted = ensureReadable({
    hue: proposal.neutralHue,
    saturation: groundSaturation * 0.8,
    lightness: dark ? 0.7 : 0.42,
    against: background,
    target: 4.5,
    direction: dark ? "lighter" : "darker",
  });
  // The accent moves away from the ground until it clears AA against the
  // ground; because it moves away, near-white (dark accent) or near-black
  // (light accent) text on it improves in the same step.
  const accent = ensureReadable({
    hue: proposal.accentHue,
    saturation: 0.58,
    lightness: dark ? 0.66 : 0.36,
    against: background,
    target: 4.5,
    direction: dark ? "lighter" : "darker",
  });
  const accentInk = contrastRatio("#0a0a0a", accent) >= contrastRatio("#fdfdfd", accent) ? "#0a0a0a" : "#fdfdfd";
  return {
    name: proposal.name,
    rationale: proposal.rationale,
    layout: proposal.layout,
    typeSystem: proposal.typeSystem,
    motif: proposal.motif,
    density: proposal.density,
    radius: proposal.radius,
    palette: { scheme: proposal.scheme, background, surface, ink, muted, accent, accentInk },
  };
}

/** CSS custom properties for the emitted route, so a demo carries its own theme without touching shared styles. */
export function designTokens(direction: DesignDirection): Record<string, string> {
  const stacks = TYPE_STACKS[direction.typeSystem];
  const scale = DENSITY_SCALE[direction.density];
  return {
    "--demo-bg": direction.palette.background,
    "--demo-surface": direction.palette.surface,
    "--demo-ink": direction.palette.ink,
    "--demo-muted": direction.palette.muted,
    "--demo-accent": direction.palette.accent,
    "--demo-accent-ink": direction.palette.accentInk,
    "--demo-radius": `${direction.radius}px`,
    "--demo-display": stacks.display,
    "--demo-body": stacks.body,
    "--demo-section": scale.section,
    "--demo-gap": scale.gap,
    "--demo-measure": scale.measure,
    "--demo-display-size": scale.display,
    "--demo-lead-size": scale.lead,
    // A hairline that reads as drawn rather than as a border artefact.
    "--demo-rule": `color-mix(in srgb, ${direction.palette.ink} 16%, transparent)`,
    "--demo-rule-strong": `color-mix(in srgb, ${direction.palette.ink} 32%, transparent)`,
    "--demo-veil": `color-mix(in srgb, ${direction.palette.background} 72%, transparent)`,
  };
}
