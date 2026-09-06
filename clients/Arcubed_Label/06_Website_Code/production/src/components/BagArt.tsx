// Arcubed Label — PLACEHOLDER bag illustration, ported from prototype/js/art.js.
// Stands in for real layered product photography until the client's shoot happens
// (see development-plan.md §4-5). This is deliberately swappable: everything that
// renders a bag preview goes through this one component, so replacing it with the
// real photo-compositing approach later touches this file only, not the callers.
//
// Takes a plain BagRenderInput rather than a live Bag — pure rendering, no data
// dependency, works identically whether the caller has a live product (via
// toRenderInput) or just a cart line's stored snapshot (via snapshotToRenderInput).

import { useId } from "react";
import type { BagRenderInput } from "@/lib/types";

// Honest "no colour data yet" placeholder — used whenever a colour has no
// confirmed hex (every real Arcubed colourway right now: names come from
// client-supplied photography, but no hex code has been confirmed). This is
// NOT a guess at the real colour; it's a neutral stone tone that reads as
// "art unavailable", matching the site's own --line/--surface neutrals
// rather than any specific brand or product colour.
const PLACEHOLDER_HEX = "#D9CFC2";

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function StrapArt({ kind, dark }: { kind: string; dark: string }) {
  if (kind === "braided") {
    return (
      <>
        <path d="M96,96 C96,40 140,18 160,18 C180,18 224,40 224,96" fill="none" stroke={dark} strokeWidth={7} strokeLinecap="round" strokeDasharray="2 10" />
        <path d="M96,96 C96,40 140,18 160,18 C180,18 224,40 224,96" fill="none" stroke={dark} strokeWidth={3} strokeLinecap="round" />
      </>
    );
  }
  if (kind === "chain") {
    return <path d="M96,96 C96,40 140,14 160,14 C180,14 224,40 224,96" fill="none" stroke={dark} strokeWidth={3} strokeLinecap="round" strokeDasharray="1 9" />;
  }
  return <path d="M96,96 C96,44 138,22 160,22 C182,22 224,44 224,96" fill="none" stroke={dark} strokeWidth={6} strokeLinecap="round" />;
}

function HandleArt({ kind, dark }: { kind: string; dark: string }) {
  const lift = kind === "handleLong" ? 34 : 14;
  const top = 96 - lift - 40;
  const mid = 96 - lift - 26;
  return (
    <>
      <path d={`M120,96 C120,${mid} 128,${top} 140,${top}`} fill="none" stroke={dark} strokeWidth={7} strokeLinecap="round" />
      <path d={`M200,96 C200,${mid} 192,${top} 180,${top}`} fill="none" stroke={dark} strokeWidth={7} strokeLinecap="round" />
    </>
  );
}

function AddonArt({ art, dark, gold }: { art: string; dark: string; gold: string }) {
  if (art === "charm") {
    return (
      <>
        <circle cx={222} cy={230} r={7} fill="none" stroke={gold} strokeWidth={3} />
        <line x1={222} y1={222} x2={222} y2={212} stroke={gold} strokeWidth={3} />
      </>
    );
  }
  if (art === "tassel") {
    return (
      <>
        {["150", "160", "170", "180"].map((x) => (
          <line key={x} x1={x} y1={300} x2={x} y2={322} stroke={dark} strokeWidth={3} strokeLinecap="round" />
        ))}
      </>
    );
  }
  if (art === "pouch") {
    return <rect x={230} y={180} width={30} height={24} rx={5} fill="none" stroke={dark} strokeWidth={3} />;
  }
  if (art === "monogram") {
    return (
      <text x={160} y={205} fontFamily="var(--font-head)" fontSize={26} fill={dark} textAnchor="middle" opacity={0.65}>
        A
      </text>
    );
  }
  return null;
}

const BODY_PATH =
  "M64,150 C64,116 82,92 116,92 L204,92 C238,92 256,116 256,150 L266,304 C266,326 244,340 218,340 L102,340 C76,340 54,326 54,304 Z";

export default function BagArt({ input, className }: { input: BagRenderInput; className?: string }) {
  const hex = input.colourHex ?? PLACEHOLDER_HEX;
  const secondaryHex = input.secondaryColourHex ?? undefined;
  const dark = shade(hex, -55);
  const gold = "#B8860B";
  const addonArts = input.addonArts ?? [];
  const reactId = useId();
  const clipId = `bagClip-${reactId}`;
  const stitchId = `stitch-${reactId}`;

  return (
    <svg viewBox="0 0 320 360" role="img" aria-label={`${input.name} preview`} className={className}>
      <defs>
        <pattern id={stitchId} width={14} height={14} patternUnits="userSpaceOnUse">
          <circle cx={3} cy={3} r={1.4} fill={dark} opacity={0.16} />
        </pattern>
        <clipPath id={clipId}>
          <path d={BODY_PATH} />
        </clipPath>
      </defs>
      {input.strapArt ? <StrapArt kind={input.strapArt} dark={dark} /> : null}
      {input.chainArt ? <StrapArt kind={input.chainArt} dark={dark} /> : null}
      {input.handleArt ? <HandleArt kind={input.handleArt} dark={dark} /> : null}
      <path d={BODY_PATH} fill={hex} />
      {/* Two-tone: a lower band in the secondary colour. Approximate — the
          real per-product split is a 3D/photography decision, not this
          placeholder's job. */}
      {secondaryHex ? (
        <rect x={54} y={260} width={212} height={80} fill={secondaryHex} clipPath={`url(#${clipId})`} />
      ) : null}
      <rect x={40} y={80} width={240} height={270} fill={`url(#${stitchId})`} clipPath={`url(#${clipId})`} />
      <path d={BODY_PATH} fill="none" stroke={dark} strokeWidth={2} opacity={0.5} />
      {addonArts.map((art, i) => (
        <AddonArt key={`${art}-${i}`} art={art} dark={dark} gold={gold} />
      ))}
    </svg>
  );
}
