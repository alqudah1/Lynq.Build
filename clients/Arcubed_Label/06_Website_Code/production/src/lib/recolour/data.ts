// The generated inputs of the colour-preview renderer, typed. Kept apart from
// engine.ts so the engine stays pure (and runnable outside the bundler).
import generated from "./profiles.generated.json";
import type { YarnProfile } from "./engine";

export const PROFILES = generated.profiles as Record<string, YarnProfile[]>;
export const SOURCES = generated.sources as Record<string, { slug: string; width: number; height: number }>;
export const MAP_WIDTH = generated.width as number;

/** Where a source photograph and its yarn mask are served from. */
export const sourceUrl = (frame: string) => `/media/recolour/${frame}-src-${MAP_WIDTH}.webp`;
export const maskUrl = (frame: string) => `/media/recolour/${frame}-mask-${MAP_WIDTH}.png`;
