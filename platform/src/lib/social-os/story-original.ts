/**
 * Stories made only for stories (not re-shares of a feed post), rendered
 * from a spec: 1080×1920 JPEG, Instagram's top 250 px and bottom 320 px kept
 * clear. Two kinds:
 *
 * - `sticker` stories leave a clean space for an Instagram poll, quiz or
 *   slider sticker. Instagram only allows those stickers when the story is
 *   posted from the app, so the owner posts these by hand from Telegram
 *   (the message carries the exact sticker text).
 * - `auto` stories carry everything in the image and are published by the
 *   Office like any other post.
 *
 * CodeIt stories use the website's system (cream, brown, orange, Baloo 2,
 * Nunito, JetBrains Mono); LYNQ stories use the grid's (near-black, white,
 * one acid lime, Inter).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareFonts } from "./story-card";

export type StoryBrandKey = "codeit" | "lynq";

/** The sticker the owner adds in the Instagram app, and exactly what to type into it. */
export type StickerSpec =
  | { type: "quiz"; question: string; options: string[]; correct: number }
  | { type: "poll"; question: string; options: [string, string] }
  | { type: "slider"; question: string; emoji: string };

export type StorySpec =
  | { kind: "quiz"; brand: "codeit"; eyebrow: string; headline: string; code: string[]; sticker: Extract<StickerSpec, { type: "quiz" }>; footnote?: string }
  | { kind: "answer"; brand: "codeit"; eyebrow: string; headline: string; answer: string; why: string[]; example: string; tryThis: string }
  | { kind: "thisOrThat"; brand: StoryBrandKey; eyebrow: string; headline: string; a: { label: string; icon: Icon }; b: { label: string; icon: Icon }; sticker: Extract<StickerSpec, { type: "poll" }> }
  | { kind: "slider"; brand: StoryBrandKey; eyebrow: string; headline: string; lines: string[]; sticker: Extract<StickerSpec, { type: "slider" }> }
  | { kind: "tryTonight"; brand: "codeit"; eyebrow: string; headline: string; steps: string[]; code?: string }
  | { kind: "whichSite"; brand: "lynq"; eyebrow: string; headline: string[]; sticker: Extract<StickerSpec, { type: "poll" }> }
  | { kind: "checklist"; brand: "lynq"; eyebrow: string; headline: string[]; intro: string; items: { text: string; ok: boolean }[]; close: [string, string, string] }
  | { kind: "oneFix"; brand: "lynq"; eyebrow: string; headline: string[]; fix: string; detail: string }
  // LYNQ editorial stories: magazine and product-sheet formats, no question asked.
  | { kind: "specSheet"; brand: "lynq"; series: string; model: string; subtitle: string; specs: { label: string; value: string; accent?: boolean }[]; note: string }
  | { kind: "statement"; brand: "lynq"; series: string; folio?: string; /** Small lime label above the lines (default "Studio note"). */ label?: string; lines: string[]; accentWord: string; byline: string }
  | { kind: "object"; brand: "lynq"; series: string; folio?: string; /** Feed image (a product shot) placed as the hero; bytes passed at render time. */ title: string; label: { k: string; v: string }[]; line: string }
  | { kind: "index"; brand: "lynq"; series: string; folio?: string; headline: string; rows: { name: string; what: string; where?: string }[]; note: string }
  | { kind: "process"; brand: "lynq"; series: string; headline: string; steps: { n: string; name: string; detail: string }[]; note: string }
  | { kind: "teardown"; brand: "lynq"; series: string; headline: string; before: string[]; after: string[]; note: string }
  // A real screenshot of a client's site inside a rendered phone (bytes passed at render time; `crop` is the source y offset in px).
  // A finished story image bundled with the app (src/assets/cases), e.g. a case-study highlight frame.
  | { kind: "image"; brand: StoryBrandKey; file: string; alt: string }
  | { kind: "screen"; brand: "lynq"; series: string; folio?: string; step: string; headline: [string, string]; detail: string; crop?: number };

export type Icon = "car" | "paw" | "rocket" | "music" | "phone" | "form" | "star" | "rock";

/** Stable key for a spec: stored on the story so a changed spec re-renders the image. */
export function storyKey(spec: StorySpec): string {
  return `story-spec:${createHash("sha1").update(JSON.stringify(spec)).digest("hex").slice(0, 16)}`;
}

/** Whether the owner posts this story from the app (it needs a sticker). */
export function needsSticker(spec: StorySpec): boolean {
  return "sticker" in spec;
}

/** The Telegram line that tells the owner exactly what to put in the sticker. */
export function stickerInstructions(sticker: StickerSpec): string {
  if (sticker.type === "quiz") return `Quiz sticker: "${sticker.question}"\n${sticker.options.map((o, i) => `${i === sticker.correct ? "✅" : "▫️"} ${o}`).join("\n")}`;
  if (sticker.type === "poll") return `Poll sticker: "${sticker.question}"\n▫️ ${sticker.options[0]}\n▫️ ${sticker.options[1]}`;
  return `Slider sticker: "${sticker.question}" with ${sticker.emoji}`;
}

const W = 1080;
const H = 1920;
/** Where the sticker goes for each kind: the owner drops it here; nothing is drawn in this box. */
export function stickerZone(spec: StorySpec): { x: number; y: number; w: number; h: number } {
  switch (spec.kind) {
    case "quiz": return { x: 140, y: 1240, w: 800, h: 360 };
    case "thisOrThat": return { x: 140, y: 1300, w: 800, h: 300 };
    case "whichSite": return { x: 140, y: 1310, w: 800, h: 280 };
    case "slider": return spec.brand === "lynq" ? { x: 140, y: 800, w: 800, h: 300 } : { x: 140, y: 960, w: 800, h: 300 };
    default: return { x: 140, y: 1090, w: 800, h: 360 };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
type TextOpts = { f?: string; w?: number; s?: number; c?: string; a?: "start" | "middle" | "end"; ls?: number; op?: number };
const T = (x: number, y: number, t: string, o: TextOpts = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.f ?? "Nunito"}" font-weight="${o.w ?? 700}" font-size="${o.s ?? 40}" fill="${o.c ?? "#35220e"}" text-anchor="${o.a ?? "start"}" letter-spacing="${o.ls ?? 0}" opacity="${o.op ?? 1}" xml:space="preserve">${esc(t)}</text>`;

// ---------- CodeIt ----------
const CR = "#fff4e5", BR = "#35220e", OR = "#ff7a00", ORT = "#d46500", YE = "#f5d04a", MI = "#3ddc97";
const cTitle = (y: number, t: string, s = 80, c = BR) => T(W / 2, y, t, { f: "Baloo 2", s, c, a: "middle" });
function icon(kind: Icon, cx: number, cy: number, color: string, stroke: string): string {
  const s = `stroke="${stroke}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"`;
  switch (kind) {
    case "car": return `<path d="M${cx - 90} ${cy + 20} l20 -50 q8 -18 28 -18 h84 q20 0 28 18 l20 50 v36 h-180 z" fill="${color}" ${s}/><circle cx="${cx - 50}" cy="${cy + 58}" r="22" fill="${stroke}"/><circle cx="${cx + 50}" cy="${cy + 58}" r="22" fill="${stroke}"/><path d="M${cx - 50} ${cy - 30} h100 l14 40 h-128 z" fill="#ffffff" opacity="0.6"/>`;
    case "paw": return `<ellipse cx="${cx}" cy="${cy + 30}" rx="60" ry="48" fill="${color}" ${s}/><circle cx="${cx - 62}" cy="${cy - 30}" r="24" fill="${color}" ${s}/><circle cx="${cx - 22}" cy="${cy - 62}" r="24" fill="${color}" ${s}/><circle cx="${cx + 22}" cy="${cy - 62}" r="24" fill="${color}" ${s}/><circle cx="${cx + 62}" cy="${cy - 30}" r="24" fill="${color}" ${s}/>`;
    case "rocket": return `<path d="M${cx} ${cy - 100} q60 60 40 150 h-80 q-20 -90 40 -150 z" fill="${color}" ${s}/><circle cx="${cx}" cy="${cy - 20}" r="20" fill="#ffffff" ${s}/><path d="M${cx - 40} ${cy + 30} l-36 40 h36 z M${cx + 40} ${cy + 30} l36 40 h-36 z" fill="${color}" ${s}/>`;
    case "music": return `<path d="M${cx - 40} ${cy + 50} v-130 l100 -24 v130" fill="none" ${s}/><ellipse cx="${cx - 62}" cy="${cy + 50}" rx="28" ry="22" fill="${color}" ${s}/><ellipse cx="${cx + 38}" cy="${cy + 26}" rx="28" ry="22" fill="${color}" ${s}/>`;
    case "phone": return `<rect x="${cx - 50}" y="${cy - 90}" width="100" height="180" rx="20" fill="${color}" ${s}/><rect x="${cx - 18}" y="${cy + 60}" width="36" height="8" rx="4" fill="${stroke}"/>`;
    case "star": return `<path d="M${cx} ${cy - 90} l26 56 l62 7 l-46 42 l13 61 l-55 -31 l-55 31 l13 -61 l-46 -42 l62 -7 z" fill="${color}" ${s}/>`;
    case "rock": return `<path d="M${cx - 80} ${cy + 10} q-10 -70 50 -90 q40 -30 80 0 q60 10 50 80 q10 60 -60 80 q-50 20 -90 0 q-40 -20 -30 -70 z" fill="${color}" ${s}/><circle cx="${cx - 20}" cy="${cy - 20}" r="16" fill="none" ${s}/><circle cx="${cx + 34}" cy="${cy + 30}" r="12" fill="none" ${s}/>`;
    case "form": return `<rect x="${cx - 80}" y="${cy - 90}" width="160" height="180" rx="16" fill="${color}" ${s}/><path d="M${cx - 50} ${cy - 40} h100 M${cx - 50} ${cy} h100 M${cx - 50} ${cy + 40} h60" ${s}/>`;
  }
}

// ---------- LYNQ ----------
const BK = "#0b0b0c", WH = "#ffffff", LI = "#c7ff3d", MU = "#8a8a8f", LN = "#2a2a2e";
const bar = (x: number, y: number, w: number, h: number, c = LN, r = 10) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/>`;
function wrapWords(t: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of t.split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

// LYNQ editorial: hairline frame, mono labels, one lime.
const MONO = "JetBrains Mono";
const mLabel = (x: number, y: number, t: string, c = MU, a: "start" | "end" | "middle" = "start") => T(x, y, t.toUpperCase(), { f: MONO, w: 500, s: 24, c, ls: 3, a });


// ---------- CodeIt modern kit: warm gradient, soft light, floating cards, no outlines ----------
const cDefs = `<defs>
<linearGradient id="cbg" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#fff8ee"/><stop offset="1" stop-color="#ffeedd"/></linearGradient>
<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="90"/></filter>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
<linearGradient id="orange" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff6a00"/></linearGradient>
<linearGradient id="code" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#33241a"/><stop offset="1" stop-color="#1f150d"/></linearGradient>
</defs>`;
/** Warm gradient with three soft light blooms: depth without doodles. */
const cBackdrop = () => `${cDefs}<rect width="${W}" height="${H}" fill="url(#cbg)"/>
<circle cx="${W - 60}" cy="260" r="300" fill="${OR}" opacity="0.35" filter="url(#blur)"/>
<circle cx="40" cy="1060" r="280" fill="${YE}" opacity="0.45" filter="url(#blur)"/>
<circle cx="${W - 120}" cy="${H - 160}" r="320" fill="${MI}" opacity="0.28" filter="url(#blur)"/>`;
/** A card that floats: soft blurred shadow below, no outline. */
const softCard = (x: number, y: number, w: number, h: number, fill = "#ffffff", r = 44, shade = 0.18) =>
  `<rect x="${x + 10}" y="${y + 34}" width="${w - 20}" height="${h}" rx="${r}" fill="${BR}" opacity="${shade}" filter="url(#shadow)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const cPill = (cx: number, y: number, t: string) => {
  const tw = t.length * 24.5;
  const w = tw + 130;
  return `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="68" rx="34" fill="${OR}" opacity="0.14"/><circle cx="${cx - w / 2 + 42}" cy="${y + 34}" r="9" fill="${OR}"/>${T(cx + 18, y + 46, t.toUpperCase(), { f: "Nunito", w: 800, s: 30, c: ORT, a: "middle", ls: 5 })}`;
};
/** A code editor window: frosted dark glass, file tab, big code, floating on a soft shadow. */
const cWindow = (x: number, y: number, w: number, lines: string[], file = "quiz.py", maxBottom = 1600) => {
  const size = Math.min(72, Math.floor((w - 140) / (0.6 * Math.max(...lines.map((l) => l.length)))), Math.floor((maxBottom - y - 170) / (1.5 * lines.length)));
  const lh = Math.round(size * 1.5);
  const h = 110 + 60 + lines.length * lh;
  const body = lines.map((l, i) => {
    const y0 = y + 110 + 30 + size + i * lh;
    const num = T(x + 46, y0, String(i + 1), { f: "JetBrains Mono", w: 500, s: size * 0.55, c: "#6f5e4d" });
    return `${num}${T(x + 104, y0, l, { f: "JetBrains Mono", w: 500, s: size, c: l.trim().startsWith("#") ? "#9c8670" : MI })}`;
  }).join("");
  return `${softCard(x, y, w, h, "url(#code)", 40, 0.35)}
<circle cx="${x + 52}" cy="${y + 50}" r="12" fill="#ff5f57"/><circle cx="${x + 90}" cy="${y + 50}" r="12" fill="#febc2e"/><circle cx="${x + 128}" cy="${y + 50}" r="12" fill="#28c840"/>
<rect x="${x + 170}" y="${y + 24}" width="${file.length * 19 + 48}" height="52" rx="14" fill="#ffffff" opacity="0.07"/>${T(x + 194, y + 60, file, { f: "JetBrains Mono", w: 500, s: 28, c: "#d8c4ad" })}
<line x1="${x}" y1="${y + 100}" x2="${x + w}" y2="${y + 100}" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>
${body}`;
};
/** The call to action above the sticker, with a small chevron pointing at it. */
const cTapHint = (y: number, t: string) => `${T(W / 2, y, t, { f: "Nunito", w: 800, s: 40, c: BR, a: "middle", op: 0.75 })}<path d="M${W / 2 - 18} ${y + 24} l18 16 l18 -16" fill="none" stroke="${OR}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
/** Where the Instagram sticker goes: a frosted white panel it sits on. */
const cStickerPad = (z: { x: number; y: number; w: number; h: number }) => `<rect x="${z.x - 30}" y="${z.y - 20}" width="${z.w + 60}" height="${z.h + 40}" rx="48" fill="#ffffff" opacity="0.55" stroke="#ffffff" stroke-width="3"/>`;

// ---------- LYNQ product render kit ----------
/** A Teenage Engineering-style object: the "LYNQ Site" as a piece of hardware, lit from the upper left. */
const lDevice = (x: number, y: number, screen: [string, string], keys: string[], knobs: [string, string]) => {
  const w = 900, h = 500;
  const key = (i: number, label: string) => {
    const kx = x + 70 + i * 120, ky = y + 360, on = i === 0;
    return `<rect x="${kx}" y="${ky + 8}" width="96" height="84" rx="14" fill="#050506"/><rect x="${kx}" y="${ky}" width="96" height="84" rx="14" fill="${on ? LI : "url(#key)"}" stroke="${on ? "#a6d82f" : "#3c3c42"}" stroke-width="2"/>${T(kx + 48, ky + 52, label, { f: MONO, w: 500, s: 22, c: on ? BK : "#9a9aa0", a: "middle", ls: 1 })}`;
  };
  const knob = (cx: number, cy: number, label: string, deg: number) => `<circle cx="${cx + 4}" cy="${cy + 10}" r="66" fill="#050506" opacity="0.8"/><circle cx="${cx}" cy="${cy}" r="66" fill="url(#knob)" stroke="#4a4a50" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="48" fill="url(#knobTop)"/><line x1="${cx}" y1="${cy}" x2="${cx + 40 * Math.sin((deg * Math.PI) / 180)}" y2="${cy - 40 * Math.cos((deg * Math.PI) / 180)}" stroke="${WH}" stroke-width="6" stroke-linecap="round"/>${T(cx, cy + 108, label, { f: MONO, w: 500, s: 22, c: MU, a: "middle", ls: 3 })}`;
  return `<ellipse cx="${x + w / 2 + 60}" cy="${y + h + 20}" rx="${w / 2}" ry="44" fill="#000" opacity="0.85" filter="url(#soft)"/>
<rect x="${x}" y="${y + 16}" width="${w}" height="${h}" rx="40" fill="#08080a"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="40" fill="url(#body)" stroke="#3a3a40" stroke-width="2"/>
<path d="M${x + 40} ${y + 2} H${x + w - 40}" stroke="#5a5a62" stroke-width="2" opacity="0.8"/>
<rect x="${x + 60}" y="${y + 60}" width="420" height="250" rx="18" fill="#060607" stroke="#2a2a30" stroke-width="2"/>
${T(x + 90, y + 112, "● LIVE", { f: MONO, w: 500, s: 22, c: LI, ls: 2 })}${T(x + 450, y + 112, "01", { f: MONO, w: 500, s: 22, c: "#5a5a60", a: "end" })}
${T(x + 90, y + 210, screen[0], { f: MONO, w: 500, s: 54, c: LI, ls: 2 })}${T(x + 90, y + 272, screen[1], { f: MONO, w: 500, s: 26, c: "#7c9a3a", ls: 2 })}
${knob(x + 620, y + 160, knobs[0], -40)}${knob(x + 790, y + 160, knobs[1], 60)}
${keys.map((k, i) => key(i, k)).join("")}
${[...Array(5)].map((_, r) => [...Array(6)].map((__, c) => `<circle cx="${x + 596 + c * 44}" cy="${y + 380 + r * 22}" r="5" fill="#0a0a0c"/>`).join("")).join("")}
${T(x + w - 40, y + h - 26, "LYNQ  SITE  /  01", { f: MONO, w: 500, s: 18, c: "#6a6a72", a: "end", ls: 3 })}`;
};

// ---------- LYNQ frame: full bleed, studio light, no floating box ----------
const lDefs = `<defs>
<radialGradient id="spot" cx="0.25" cy="0.18" r="0.85"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0.02"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="body" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#2c2c31"/><stop offset="1" stop-color="#16161a"/></linearGradient>
<linearGradient id="key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2a2f"/><stop offset="1" stop-color="#1b1b1f"/></linearGradient>
<radialGradient id="knob" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#4a4a52"/><stop offset="1" stop-color="#1a1a1e"/></radialGradient>
<radialGradient id="knobTop" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#3a3a40"/><stop offset="1" stop-color="#202024"/></radialGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BK}" stop-opacity="0"/><stop offset="1" stop-color="${BK}" stop-opacity="1"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d1d21"/><stop offset="1" stop-color="#0c0c0e"/></linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="28"/></filter>
</defs>`;
const lFrame = (series: string, folio: string) => `<rect width="${W}" height="${H}" fill="${BK}"/>${lDefs}<rect width="${W}" height="${H}" fill="url(#spot)"/>
${T(90, 250, "LYNQ", { f: "Inter SemiBold", w: 600, s: 34, c: WH, ls: 12 })}${T(W - 90, 250, `${series.toUpperCase()}  ·  ${folio}`, { f: MONO, w: 500, s: 22, c: MU, ls: 4, a: "end" })}
${T(90, 1680, "LYNQ.BUILD", { f: MONO, w: 500, s: 22, c: MU, ls: 4 })}${T(W - 90, 1680, "WEBSITES · SYSTEMS · AUTOMATION", { f: MONO, w: 500, s: 18, c: "#55555b", ls: 3, a: "end" })}`;
const lBig = (x: number, y: number, t: string, s = 104, c = WH, f = "Inter Light") => T(x, y, t, { f, w: f === "Inter Light" ? 300 : 600, s, c, ls: -3 });
const rule = (y: number, c = "#222226") => `<line x1="90" y1="${y}" x2="${W - 90}" y2="${y}" stroke="${c}" stroke-width="2"/>`;
/** A phone rendered like hardware: graphite frame, glass, soft floor shadow. */
const lPhone = (x: number, y: number, w: number, h: number, inner: (x: number, y: number, w: number, h: number) => string) =>
  `<ellipse cx="${x + w / 2 + 30}" cy="${y + h + 10}" rx="${w / 2}" ry="30" fill="#000" opacity="0.9" filter="url(#soft)"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="58" fill="url(#body)" stroke="#45454c" stroke-width="3"/>
<rect x="${x + 14}" y="${y + 14}" width="${w - 28}" height="${h - 28}" rx="46" fill="url(#glass)"/>
<rect x="${x + w / 2 - 54}" y="${y + 30}" width="108" height="26" rx="13" fill="#050506"/>
${inner(x + 40, y + 90, w - 80, h - 130)}`;
/** A hardware toggle: lime and right when on. */
const toggle = (x: number, y: number, on: boolean) => `<rect x="${x}" y="${y}" width="120" height="64" rx="32" fill="${on ? LI : "#1c1c20"}" stroke="${on ? "#a6d82f" : "#3a3a40"}" stroke-width="2"/><circle cx="${on ? x + 88 : x + 32}" cy="${y + 32}" r="24" fill="${on ? BK : "url(#knob)"}" stroke="${on ? BK : "#4a4a50"}" stroke-width="2"/>`;
/** Viewfinder corners in lime: where the Instagram sticker goes on LYNQ stories. */
const lZone = (z: { x: number; y: number; w: number; h: number }) => {
  const L = 44, x2 = z.x + z.w, y2 = z.y + z.h;
  const p = `fill="none" stroke="${LI}" stroke-width="4" stroke-linecap="round"`;
  return `<path d="M${z.x} ${z.y + L} V${z.y} H${z.x + L} M${x2 - L} ${z.y} H${x2} V${z.y + L} M${x2} ${y2 - L} V${y2} H${x2 - L} M${z.x + L} ${y2} H${z.x} V${y2 - L}" ${p}/>`;
};
const twoLines = (t: string): [string, string] => {
  const words = t.split(" ");
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
};
/** "Left: next day. Right: under a minute." → the two ends of the slider. */
const sliderEnds = (notes: string[]): { ends: [string, string] | null; rest: string[] } => {
  const i = notes.findIndex((n) => /^Left: .+\. Right: .+\.?$/.test(n));
  if (i < 0) return { ends: null, rest: notes };
  const m = notes[i]!.match(/^Left: (.+?)\. Right: (.+?)\.?$/)!;
  return { ends: [m[1]!, m[2]!], rest: notes.filter((_, j) => j !== i) };
};
/** Where the phone sits on a screen story; the screenshot fills its glass. */
const SCREEN = { x: 290, y: 800, w: 500, h: 810 };
const fit = (t: string, max: number, width = 900, em = 0.52) => Math.min(max, Math.floor(width / (em * Math.max(1, t.length))));

// ---------- Templates ----------
export function storySvg(spec: StorySpec): string {
  switch (spec.kind) {
    case "quiz": {
      const z = stickerZone(spec);
      const [l1, l2] = twoLines(spec.headline);
      return `${cBackdrop()}

${cPill(W / 2, 330, spec.eyebrow)}
${cTitle(540, l1, 112)}${cTitle(660, l2, 112, ORT)}
${cWindow(90, 730, 900, spec.code, "quiz.py", 1110)}
${cStickerPad(z)}
${cTapHint(z.y - 70, "Tap your answer")}
${T(W / 2, z.y + z.h + 120, spec.footnote ?? "Answer in tomorrow's story", { f: "Nunito", w: 800, s: 38, c: ORT, a: "middle" })}`;
    }
    case "answer": {
      const whyH = 130 + spec.why.length * 64;
      const ansSize = fit(spec.answer, 84, 640, 0.6);
      return `${cBackdrop()}

${cPill(W / 2, 330, spec.eyebrow)}
${cTitle(530, spec.headline, 112)}
${softCard(90, 590, 900, 160, "url(#orange)", 44, 0.3)}
<circle cx="180" cy="670" r="46" fill="#ffffff"/><path d="M158 670 l16 18 l30 -36" fill="none" stroke="${OR}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
${T(260, 670 + ansSize * 0.36, spec.answer, { f: "JetBrains Mono", w: 500, s: ansSize, c: "#ffffff" })}
${softCard(90, 820, 900, whyH)}
${T(150, 900, "WHY", { f: "Nunito", w: 800, s: 30, c: ORT, ls: 5 })}
${spec.why.map((l, i) => T(150, 975 + i * 64, l, { s: 48, c: BR })).join("")}
${cWindow(90, 820 + whyH + 70, 900, [spec.example], "try.py")}
${T(W / 2, 1640, spec.tryThis, { f: "Nunito", w: 800, s: 42, c: ORT, a: "middle" })}`;
    }
    case "tryTonight": {
      const [l1, l2] = twoLines(spec.headline);
      const code = spec.code ? spec.code.split("\n") : [];
      return `${cBackdrop()}

${cPill(W / 2, 330, spec.eyebrow)}
${cTitle(540, l1, 108)}${cTitle(655, l2, 108, ORT)}
${spec.steps.map((st, i) => {
        const y = 790 + i * 120;
        return `<circle cx="150" cy="${y}" r="42" fill="${OR}" opacity="0.14"/>${T(150, y + 18, String(i + 1), { f: "Baloo 2", w: 800, s: 50, c: ORT, a: "middle" })}${T(225, y + 17, st, { f: "Nunito", w: 700, s: 48, c: BR })}`;
      }).join("")}
${code.length ? cWindow(90, 790 + spec.steps.length * 120 + 10, 900, code, "tonight.py") : ""}
${softCard(W / 2 - 330, 1530, 660, 100, "url(#orange)", 50, 0.3)}${T(W / 2, 1593, "Free to start: codeitlearn.com", { f: "Nunito", w: 800, s: 38, c: "#ffffff", a: "middle" })}`;
    }
    case "thisOrThat": {
      const z = stickerZone(spec);
      const [l1, l2] = twoLines(spec.headline);
      if (spec.brand === "lynq") {
        const tile = (x: number, label: string, ic: Icon, on: boolean) => `<rect x="${x}" y="600" width="420" height="460" rx="36" fill="url(#body)" stroke="#3a3a40" stroke-width="2"/>${icon(ic, x + 210, 800, on ? LI : WH, BK)}${T(x + 210, 1010, label, { f: "Inter Light", w: 300, s: 42, c: WH, a: "middle" })}`;
        return `${lFrame(spec.eyebrow, "POLL")}${lBig(90, 430, l1, 96)}${lBig(90, 540, l2, 96)}${tile(90, spec.a.label, spec.a.icon, false)}${tile(570, spec.b.label, spec.b.icon, true)}${lZone(z)}`;
      }
      const card = (x: number, _rot: number, label: string, ic: Icon, _fill: string, col: string) => `${softCard(x, 710, 420, 420)}<circle cx="${x + 210}" cy="880" r="120" fill="${col}" opacity="0.14"/>${icon(ic, x + 210, 880, col, BR)}${T(x + 210, 1080, label, { f: "Nunito", w: 800, s: 44, c: BR, a: "middle" })}`;
      return `${cBackdrop()}

${cPill(W / 2, 330, spec.eyebrow)}
${cTitle(540, l1, 104)}${cTitle(650, l2, 104, ORT)}
${card(80, 0, spec.a.label, spec.a.icon, "#ffffff", OR)}${card(580, 0, spec.b.label, spec.b.icon, "#ffffff", "#1fb97a")}
<circle cx="540" cy="920" r="52" fill="${BR}"/>${T(540, 937, "or", { f: "Nunito", w: 800, s: 42, c: CR, a: "middle" })}
${cStickerPad(z)}${cTapHint(z.y - 70, "Vote")}`;
    }
    case "slider": {
      const z = stickerZone(spec);
      const [second, ...allNotes] = spec.lines;
      const { ends, rest: notes } = sliderEnds(allNotes);
      if (spec.brand === "lynq") {
        const size = fit(second ?? spec.headline, 96);
        const fader = (y: number) => `<rect x="140" y="${y}" width="800" height="22" rx="11" fill="#050506" stroke="#2c2c31" stroke-width="2"/>${[...Array(11)].map((_, i) => `<line x1="${140 + i * 80}" y1="${y + 44}" x2="${140 + i * 80}" y2="${y + (i % 5 ? 58 : 70)}" stroke="#3a3a40" stroke-width="2"/>`).join("")}<rect x="${140 + 620}" y="${y - 40}" width="70" height="102" rx="12" fill="url(#body)" stroke="#55555c" stroke-width="2"/><rect x="${140 + 620}" y="${y + 6}" width="70" height="8" fill="${LI}"/>${ends ? `${T(140, y + 120, ends[0].toUpperCase(), { f: MONO, w: 500, s: 22, c: MU, ls: 3 })}${T(940, y + 120, ends[1].toUpperCase(), { f: MONO, w: 500, s: 22, c: LI, ls: 3, a: "end" })}` : ""}`;
        return `${lFrame(spec.eyebrow, "SLIDER")}${lBig(90, 440, spec.headline, size)}${lBig(90, 440 + size + 14, second ?? "", size)}${notes.map((n, i) => T(90, 640 + i * 50, n, { f: "Inter Light", w: 300, s: 36, c: MU })).join("")}${lZone(z)}${fader(1300)}`;
      }
      const size = fit([spec.headline, second ?? ""].sort((x, y) => y.length - x.length)[0]!, 100, 900, 0.56);
      return `${cBackdrop()}

${cPill(W / 2, 330, spec.eyebrow)}
${cTitle(530, spec.headline, size)}${second ? cTitle(530 + size + 10, second, size, ORT) : ""}
${notes.map((l, i) => T(W / 2, 760 + i * 52, l, { f: "Nunito", w: 700, s: 38, c: BR, a: "middle", op: 0.7 })).join("")}
${cStickerPad(z)}${cTapHint(z.y - 70, "Slide it")}
${ends ? `${T(z.x - 10, z.y + z.h + 110, `← ${ends[0]}`, { f: "Nunito", w: 800, s: 38, c: BR, op: 0.7 })}${T(z.x + z.w + 10, z.y + z.h + 110, `${ends[1]} →`, { f: "Nunito", w: 800, s: 38, c: ORT, a: "end" })}` : ""}`;
    }
    case "whichSite": {
      const z = stickerZone(spec);
      const [h1, h2] = spec.headline;
      const messy = (x: number, y: number, w: number) => `${bar(x, y, w, 170, "#26262b")}${T(x + w / 2, y + 96, "◀  SLIDESHOW  ▶", { f: MONO, w: 500, s: 20, c: "#6a6a70", a: "middle", ls: 2 })}${bar(x, y + 200, w * 0.7, 22, "#2a2a2e")}${[0, 1, 2, 3, 4, 5, 6].map((i) => bar(x, y + 244 + i * 34, w - (i % 3) * 40, 14, "#1f1f23")).join("")}${T(x + w / 2, y + 520, "phone in footer", { f: MONO, w: 500, s: 18, c: "#55555b", a: "middle" })}`;
      const clean = (x: number, y: number, w: number) => `${T(x, y + 50, "Plumber", { f: "Inter SemiBold", w: 600, s: 44, c: WH })}${T(x, y + 92, "Open now · 20 min away", { f: "Inter Light", w: 300, s: 24, c: MU })}<rect x="${x}" y="${y + 130}" width="${w}" height="96" rx="48" fill="${LI}"/>${T(x + w / 2, y + 190, "Call now", { f: "Inter SemiBold", w: 600, s: 36, c: BK, a: "middle" })}<rect x="${x}" y="${y + 246}" width="${w}" height="84" rx="42" fill="none" stroke="#4a4a50" stroke-width="3"/>${T(x + w / 2, y + 300, "Book a visit", { f: "Inter Light", w: 300, s: 30, c: WH, a: "middle" })}${T(x, y + 390, "★★★★★  48 reviews", { f: "Inter Light", w: 300, s: 24, c: WH })}`;
      return `${lFrame(spec.eyebrow, "POLL")}${lBig(90, 430, h1 ?? "", 96)}${lBig(90, 540, h2 ?? "", 96, LI)}
${lPhone(110, 610, 400, 600, (x, y, w) => messy(x, y, w))}${lPhone(570, 610, 400, 600, (x, y, w) => clean(x, y, w))}
${T(310, 1266, "A", { f: "Inter SemiBold", w: 600, s: 44, c: WH, a: "middle" })}${T(770, 1266, "B", { f: "Inter SemiBold", w: 600, s: 44, c: LI, a: "middle" })}${lZone(z)}`;
    }
    case "checklist": {
      const [h1, h2] = spec.headline;
      return `${lFrame(spec.eyebrow, "CHECK")}${lBig(90, 440, h1 ?? "", 104)}${lBig(90, 556, h2 ?? "", 104, LI)}${T(90, 650, spec.intro, { f: "Inter Light", w: 300, s: 40, c: MU })}
${spec.items.map((it, i) => { const y = 720 + i * 150; return `${rule(y)}${toggle(90, y + 42, it.ok)}${T(250, y + 90, it.text, { f: "Inter Light", w: 300, s: 46, c: it.ok ? WH : MU })}`; }).join("")}${rule(720 + spec.items.length * 150)}
${T(90, 1420, spec.close[0], { f: "Inter SemiBold", w: 600, s: 64, c: WH })}${T(90, 1500, spec.close[1], { f: "Inter Light", w: 300, s: 52, c: LI })}${T(90, 1566, spec.close[2], { f: "Inter Light", w: 300, s: 52, c: WH })}`;
    }
    case "oneFix": {
      const [h1, h2] = spec.headline;
      const screen = (x: number, y: number, w: number) => `${T(x, y + 70, "Your business", { f: "Inter SemiBold", w: 600, s: 40, c: WH })}${bar(x, y + 100, w - 60, 16, "#26262b")}${bar(x, y + 130, w - 120, 16, "#26262b")}<rect x="${x}" y="${y + 190}" width="${w}" height="100" rx="50" fill="${LI}"/>${T(x + w / 2, y + 252, spec.fix, { f: "Inter SemiBold", w: 600, s: 38, c: BK, a: "middle" })}${[0, 1, 2, 3, 4].map((i) => bar(x, y + 340 + i * 40, w - (i % 2) * 60, 16, "#1f1f23")).join("")}`;
      return `${lFrame(spec.eyebrow, "FIX")}${lBig(90, 440, h1 ?? "", 104)}${lBig(90, 556, h2 ?? "", 104, LI)}
${lPhone(250, 640, 460, 760, screen)}
<path d="M760 960 C 860 960, 880 900, 880 860" fill="none" stroke="${LI}" stroke-width="5"/><path d="M712 960 l30 -18 v36 z" fill="${LI}"/>${T(890, 840, "here", { f: MONO, w: 500, s: 24, c: LI, a: "end", ls: 3 })}
${wrapWords(spec.detail, 38).map((l, i) => T(90, 1490 + i * 54, l, { f: "Inter Light", w: 300, s: 42, c: WH })).join("")}`;
    }
    case "specSheet": {
      // A product launch, not a form: the build drawn as a piece of hardware, then its spec in big type.
      const n = Math.min(5, spec.specs.length);
      const rows = spec.specs.slice(0, n).map((r, i) => {
        const y = 1250 + i * 76;
        return `${rule(y - 50)}${mLabel(90, y, r.label)}${T(W - 90, y + 2, r.value, { f: "Inter Light", w: 300, s: 40, c: r.accent ? LI : WH, a: "end" })}`;
      }).join("");
      return `${lFrame(spec.series, "SPEC")}
${lDevice(90, 360, ["CALL NOW", "BOOK · BUY · ASK"], ["CALL", "BOOK", "BUY", "MSG"], ["FOUND", "KEPT"])}
${T(90, 1030, spec.model, { f: "Inter SemiBold", w: 600, s: 118, c: WH, ls: -3 })}${T(90, 1100, spec.subtitle, { f: "Inter Light", w: 300, s: 42, c: MU })}
${rows}${rule(1250 + n * 76 - 50)}`;
    }
    case "statement": {
      const size = Math.min(124, ...spec.lines.map((l) => fit(l, 124, 900, 0.5)));
      const lh = size + 20;
      const top = Math.max(640, 1080 - (spec.lines.length * lh) / 2);
      const lines = spec.lines.map((l, i) => {
        const y = top + i * lh;
        const at = l.indexOf(spec.accentWord);
        if (at < 0) return T(90, y, l, { f: "Inter Light", w: 300, s: size, c: WH, ls: -3 });
        // the accent word in lime, the rest white: drawn as one text with a tspan
        return `<text x="90" y="${y}" font-family="Inter Light" font-weight="300" font-size="${size}" letter-spacing="-3" fill="${WH}" xml:space="preserve">${esc(l.slice(0, at))}<tspan fill="${LI}">${esc(spec.accentWord)}</tspan>${esc(l.slice(at + spec.accentWord.length))}</text>`;
      }).join("");
      const end = top + (spec.lines.length - 1) * lh;
      return `${lFrame(spec.series, spec.folio ?? "NOTE")}${mLabel(90, top - size - 40, spec.label ?? "Studio note", LI)}${lines}<rect x="90" y="${end + 70}" width="140" height="5" fill="${LI}"/>${mLabel(90, end + 140, spec.byline)}`;
    }
    case "object":
      return `${lFrame(spec.series, spec.folio ?? "OBJ")}
<rect x="0" y="300" width="${W}" height="880" fill="#111113"/>
<!-- the photo is composited into this band at render time; the fade is drawn over it in composeStory -->
${spec.label.map((r, i) => { const y = 1270 + i * 70; return `${rule(y - 50)}${mLabel(90, y, r.k)}${T(W - 90, y + 2, r.v, { f: "Inter Light", w: 300, s: 40, c: WH, a: "end" })}`; }).join("")}${rule(1270 + spec.label.length * 70 - 50)}
${T(90, 1270 + spec.label.length * 70 + 50, spec.line, { f: "Inter Light", w: 300, s: 50, c: LI, ls: -1 })}`;
    case "index": {
      const rows = spec.rows.map((r, i) => {
        const y = 680 + i * 160;
        return `${rule(y - 76)}${mLabel(90, y - 22, String(i + 1).padStart(2, "0"), LI)}${T(170, y, r.name, { f: "Inter Light", w: 300, s: 62, c: WH, ls: -1 })}${T(170, y + 48, r.what, { f: "Inter Light", w: 300, s: 32, c: MU })}${r.where ? mLabel(W - 90, y - 22, r.where, "#5a5a60", "end") : ""}`;
      }).join("");
      const last = 680 + spec.rows.length * 160 - 76;
      return `${lFrame(spec.series, spec.folio ?? "INDEX")}${lBig(90, 470, spec.headline, 112)}${rows}${rule(last)}${T(90, last + 100, spec.note, { f: "Inter Light", w: 300, s: 46, c: LI })}`;
    }
    case "process": {
      const rows = spec.steps.map((st, i) => {
        const y = 680 + i * 170;
        const on = i === spec.steps.length - 1;
        return `<circle cx="112" cy="${y - 18}" r="${on ? 16 : 11}" fill="${on ? LI : BK}" stroke="${on ? LI : "#6a6a70"}" stroke-width="3"/>${i < spec.steps.length - 1 ? `<line x1="112" y1="${y + 4}" x2="112" y2="${y + 140}" stroke="#2e2e33" stroke-width="2"/>` : ""}${mLabel(170, y - 40, st.n, on ? LI : "#6a6a70")}${T(170, y + 16, st.name, { f: "Inter Light", w: 300, s: 64, c: WH, ls: -1 })}${T(170, y + 64, st.detail, { f: "Inter Light", w: 300, s: 32, c: MU })}`;
      }).join("");
      const last = 680 + spec.steps.length * 170;
      return `${lFrame(spec.series, "PROC")}${lBig(90, 470, spec.headline, 104)}${rows}${T(90, last + 10, spec.note, { f: "Inter Light", w: 300, s: 44, c: LI })}`;
    }
    case "image":
      return `<rect width="${W}" height="${H}" fill="${BK}"/>`;
    case "screen":
      return `${lFrame(spec.series, spec.folio ?? "SCREEN")}${mLabel(90, 400, spec.step, LI)}${lBig(90, 500, spec.headline[0], 96)}${lBig(90, 610, spec.headline[1], 96)}
${wrapWords(spec.detail, 44).slice(0, 2).map((l, i) => T(90, 690 + i * 48, l, { f: "Inter Light", w: 300, s: 36, c: MU })).join("")}
${lPhone(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, () => "")}`;
    case "teardown": {
      const before = (x: number, y: number, w: number) => `${bar(x, y, w, 150, "#26262b")}${T(x + w / 2, y + 84, "◀  SLIDESHOW  ▶", { f: MONO, w: 500, s: 18, c: "#6a6a70", a: "middle", ls: 2 })}${[0, 1, 2, 3, 4, 5].map((i) => bar(x, y + 180 + i * 30, w - (i % 3) * 40, 12, "#1f1f23")).join("")}${T(x + w / 2, y + 400, "menu · menu · menu", { f: MONO, w: 500, s: 16, c: "#55555b", a: "middle" })}`;
      const after = (x: number, y: number, w: number) => `${T(x, y + 44, "What you do,", { f: "Inter SemiBold", w: 600, s: 30, c: WH })}${T(x, y + 82, "in one line.", { f: "Inter SemiBold", w: 600, s: 30, c: WH })}<rect x="${x}" y="${y + 120}" width="${w}" height="78" rx="39" fill="${LI}"/>${T(x + w / 2, y + 170, "Call now", { f: "Inter SemiBold", w: 600, s: 28, c: BK, a: "middle" })}<rect x="${x}" y="${y + 214}" width="${w}" height="70" rx="35" fill="none" stroke="#4a4a50" stroke-width="3"/>${T(x + w / 2, y + 258, "Book", { f: "Inter Light", w: 300, s: 26, c: WH, a: "middle" })}`;
      const list = (x: number, items: string[], good: boolean) => items.map((t, i) => `${T(x, 1210 + i * 92, good ? "+" : "×", { f: MONO, w: 500, s: 34, c: good ? LI : "#6a6a70" })}${wrapWords(t, 18).map((l, j) => T(x + 44, 1210 + i * 92 + j * 38, l, { f: "Inter Light", w: 300, s: 34, c: good ? WH : MU })).join("")}`).join("");
      return `${lFrame(spec.series, "TEAR")}${lBig(90, 440, spec.headline, fit(spec.headline, 96))}
${mLabel(110, 540, "Before")}${mLabel(570, 540, "After", LI)}
${lPhone(110, 570, 400, 540, before)}${lPhone(570, 570, 400, 540, after)}
${list(110, spec.before, false)}${list(570, spec.after, true)}`;
    }
  }
}

const LOGO = path.join(process.cwd(), "src", "assets", "brand", "codeit-logo.png");
/** Finished case-study frames, rendered by case-render from the client's own photos and screenshots. */
const CASES = path.join(process.cwd(), "src", "assets", "cases");

/** Renders a story to a 1080×1920 JPEG. */
export async function composeStory(spec: StorySpec, photo?: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number; contentType: "image/jpeg" }> {
  prepareFonts();
  const sharp = (await import("sharp")).default;
  if (spec.kind === "image") {
    const out = await sharp(readFileSync(path.join(CASES, path.basename(spec.file)))).resize(W, H, { fit: "cover" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: W, height: H, contentType: "image/jpeg" };
  }
  const layers = [] as { input: Buffer; left: number; top: number }[];
  if (spec.kind === "object" && photo) {
    layers.push({ input: await sharp(Buffer.from(photo)).resize(W, 880, { fit: "cover" }).toBuffer(), left: 0, top: 300 });
    // fade the photo into the page, and keep the title legible over it
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="880"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="#0b0b0c" stop-opacity="0"/><stop offset="1" stop-color="#0b0b0c" stop-opacity="1"/></linearGradient></defs><rect width="${W}" height="880" fill="url(#f)"/><text x="90" y="840" font-family="JetBrains Mono" font-weight="500" font-size="24" letter-spacing="3" fill="#c7ff3d">${esc(spec.title.toUpperCase())}</text></svg>`), left: 0, top: 300 });
  }
  if (spec.kind === "screen" && photo) {
    const gx = SCREEN.x + 14, gy = SCREEN.y + 14, gw = SCREEN.w - 28, gh = SCREEN.h - 28;
    const src = sharp(Buffer.from(photo));
    const meta = await src.metadata();
    const scale = gw / (meta.width ?? gw);
    const top = Math.max(0, Math.round((spec.crop ?? 0) * scale));
    const resized = await sharp(Buffer.from(photo)).resize({ width: gw }).toBuffer();
    const rh = Math.round((meta.height ?? gh) * scale);
    const shot = await sharp(resized).extract({ left: 0, top: Math.min(top, Math.max(0, rh - gh)), width: gw, height: Math.min(gh, rh) }).toBuffer();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${gw}" height="${Math.min(gh, rh)}"><rect width="${gw}" height="${Math.min(gh, rh)}" rx="46" fill="#fff"/></svg>`);
    layers.push({ input: await sharp(shot).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(), left: gx, top: gy });
    // the notch sits over the screen
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="40"><rect x="16" y="2" width="108" height="30" rx="15" fill="#050506"/></svg>`), left: SCREEN.x + SCREEN.w / 2 - 70, top: SCREEN.y + 24 });
  }
  if (spec.brand === "codeit") layers.push({ input: await sharp(readFileSync(LOGO)).resize({ width: 220 }).png().toBuffer(), left: (W - 220) / 2, top: 140 });
  const out = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${storySvg(spec)}</svg>`))
    .composite(layers)
    .flatten({ background: spec.brand === "codeit" ? CR : BK })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: W, height: H, contentType: "image/jpeg" };
}

// ---------- Highlight covers ----------
/**
 * Instagram crops a highlight cover to a circle from the middle of a story
 * image, so the cover is a full 1080×1920 frame with the mark centred.
 * CodeIt: cream, an orange disc with the site's dark outline and offset
 * shadow. LYNQ: near-black, one hairline lime ring, a thin white mark.
 */
export type CoverMark = "play" | "rocket" | "code" | "ask" | "gift" | "heart" | "quiz" | "pip" | "wrench" | "box" | "eye" | "grid" | "letters";

export function coverSvg(brand: StoryBrandKey, mark: CoverMark, letters = ""): string {
  const cx = W / 2, cy = H / 2;
  const dark = brand === "lynq";
  const ink = dark ? WH : "#ffffff";
  const st = (fill = "none") => `fill="${fill}" stroke="${ink}" stroke-width="${dark ? 10 : 18}" stroke-linecap="round" stroke-linejoin="round"`;
  const s = st();
  const glyph = (() => {
    switch (mark) {
      case "play": return `<path d="M${cx - 50} ${cy - 80} L${cx + 80} ${cy} L${cx - 50} ${cy + 80} Z" ${st(dark ? "none" : ink)}/>`;
      case "rocket": return `<path d="M${cx} ${cy - 130} q80 80 52 200 h-104 q-28 -120 52 -200 z" ${s}/><circle cx="${cx}" cy="${cy - 20}" r="26" ${s}/><path d="M${cx - 52} ${cy + 40} l-46 56 h46 M${cx + 52} ${cy + 40} l46 56 h-46" ${s}/>`;
      case "code": return `<path d="M${cx - 60} ${cy - 90} L${cx - 150} ${cy} L${cx - 60} ${cy + 90} M${cx + 60} ${cy - 90} L${cx + 150} ${cy} L${cx + 60} ${cy + 90} M${cx + 30} ${cy - 120} L${cx - 30} ${cy + 120}" ${s}/>`;
      case "ask": return `<path d="M${cx - 140} ${cy - 110} h280 q30 0 30 30 v150 q0 30 -30 30 h-150 l-70 60 v-60 h-60 q-30 0 -30 -30 v-150 q0 -30 30 -30 z" ${s}/><path d="M${cx - 34} ${cy - 40} q0 -40 34 -40 q36 0 36 34 q0 26 -36 40 v20" ${s}/><circle cx="${cx}" cy="${cy + 72}" r="${dark ? 7 : 11}" fill="${ink}"/>`;
      case "gift": return `<rect x="${cx - 130}" y="${cy - 40}" width="260" height="160" rx="16" ${s}/><rect x="${cx - 150}" y="${cy - 100}" width="300" height="60" rx="14" ${s}/><path d="M${cx} ${cy - 100} v220 M${cx} ${cy - 100} q-80 -70 -100 -10 q-6 20 100 10 q80 -70 100 -10 q6 20 -100 10" ${s}/>`;
      case "heart": return `<path d="M${cx} ${cy + 120} C ${cx - 220} ${cy - 10}, ${cx - 120} ${cy - 170}, ${cx} ${cy - 70} C ${cx + 120} ${cy - 170}, ${cx + 220} ${cy - 10}, ${cx} ${cy + 120} Z" ${s}/>`;
      case "quiz": return `<rect x="${cx - 130}" y="${cy - 130}" width="260" height="260" rx="40" ${s}/><path d="M${cx - 60} ${cy} l45 45 l80 -95" ${s}/>`;
      case "pip": return `<circle cx="${cx}" cy="${cy}" r="140" ${s}/><circle cx="${cx - 48}" cy="${cy - 20}" r="${dark ? 12 : 20}" fill="${ink}"/><circle cx="${cx + 48}" cy="${cy - 20}" r="${dark ? 12 : 20}" fill="${ink}"/><path d="M${cx - 50} ${cy + 50} q50 40 100 0" ${s}/>`;
      case "wrench": return `<path d="M${cx + 70} ${cy - 130} a80 80 0 0 0 -90 110 l-120 120 a34 34 0 0 0 48 48 l120 -120 a80 80 0 0 0 110 -90 l-50 50 l-50 -10 l-10 -50 z" ${s}/>`;
      case "box": return `<path d="M${cx} ${cy - 140} l130 70 v150 l-130 70 l-130 -70 v-150 z M${cx - 130} ${cy - 70} l130 70 l130 -70 M${cx} ${cy} v150" ${s}/>`;
      case "eye": return `<path d="M${cx - 170} ${cy} q170 -170 340 0 q-170 170 -340 0 z" ${s}/><circle cx="${cx}" cy="${cy}" r="50" ${s}/>`;
      case "grid": return [0, 1].flatMap((i) => [0, 1].map((j) => `<rect x="${cx - 120 + i * 130}" y="${cy - 120 + j * 130}" width="110" height="110" rx="${dark ? 6 : 22}" ${s}/>`)).join("");
      case "letters": return T(cx, cy + (dark ? 44 : 56), letters, { f: dark ? "Inter Light" : "Baloo 2", w: dark ? 300 : 800, s: dark ? 150 : 180, c: ink, a: "middle", ls: dark ? 6 : 0 });
    }
  })();
  return dark
    ? `<rect width="${W}" height="${H}" fill="${BK}"/><circle cx="${cx}" cy="${cy}" r="330" fill="#121214"/><circle cx="${cx}" cy="${cy}" r="330" fill="none" stroke="${LI}" stroke-width="4"/>${glyph}`
    : `${cDefs}<rect width="${W}" height="${H}" fill="url(#cbg)"/><circle cx="${cx}" cy="${cy}" r="330" fill="url(#orange)"/>${glyph}`;
}

/** A highlight cover as a 1080×1920 JPEG (upload it as the cover in the Instagram app). */
export async function composeCover(brand: StoryBrandKey, mark: CoverMark, letters = ""): Promise<Uint8Array> {
  prepareFonts();
  const sharp = (await import("sharp")).default;
  const out = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${coverSvg(brand, mark, letters)}</svg>`))
    .flatten({ background: brand === "codeit" ? CR : BK })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/** The cover for each highlight name, per brand. */
export const HIGHLIGHT_COVERS: Record<StoryBrandKey, Record<string, { mark: CoverMark; letters?: string }>> = {
  codeit: {
    "START HERE": { mark: "play" },
    BUILDS: { mark: "rocket" },
    LESSONS: { mark: "code" },
    "ASK THE TEACHER": { mark: "ask" },
    FREE: { mark: "gift" },
    ABOUT: { mark: "heart" },
    QUIZ: { mark: "quiz" },
    PIP: { mark: "pip" },
  },
  lynq: {
    "START HERE": { mark: "play" },
    KINGSBRIDGE: { mark: "letters", letters: "K" },
    NASMA: { mark: "letters", letters: "N" },
    AMY: { mark: "letters", letters: "A" },
    ARCUBED: { mark: "letters", letters: "AR" },
    "HOUSE DEALS": { mark: "letters", letters: "HD" },
    "FIX THIS": { mark: "wrench" },
    "WHAT YOU GET": { mark: "box" },
    OFFICE: { mark: "grid" },
    BEHIND: { mark: "eye" },
  },
};
