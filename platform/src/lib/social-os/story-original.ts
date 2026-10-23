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
  | { kind: "statement"; brand: "lynq"; series: string; lines: string[]; accentWord: string; byline: string }
  | { kind: "object"; brand: "lynq"; series: string; /** Feed image (a product shot) placed as the hero; bytes passed at render time. */ title: string; label: { k: string; v: string }[]; line: string }
  | { kind: "index"; brand: "lynq"; series: string; headline: string; rows: { name: string; what: string; where?: string }[]; note: string }
  | { kind: "process"; brand: "lynq"; series: string; headline: string; steps: { n: string; name: string; detail: string }[]; note: string }
  | { kind: "teardown"; brand: "lynq"; series: string; headline: string; before: string[]; after: string[]; note: string };

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
  const y = spec.kind === "whichSite" ? 1290 : spec.kind === "slider" ? 940 : spec.kind === "quiz" ? 1000 : 1090;
  return { x: 140, y, w: 800, h: 360 };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
type TextOpts = { f?: string; w?: number; s?: number; c?: string; a?: "start" | "middle" | "end"; ls?: number; op?: number };
const T = (x: number, y: number, t: string, o: TextOpts = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.f ?? "Nunito"}" font-weight="${o.w ?? 700}" font-size="${o.s ?? 40}" fill="${o.c ?? "#35220e"}" text-anchor="${o.a ?? "start"}" letter-spacing="${o.ls ?? 0}" opacity="${o.op ?? 1}" xml:space="preserve">${esc(t)}</text>`;

// ---------- CodeIt ----------
const CR = "#fff4e5", BR = "#35220e", OR = "#ff7a00", ORT = "#d46500", YE = "#f5d04a", DK = "#2b1d12", MI = "#3ddc97";
const cCard = (x: number, y: number, w: number, h: number, f = CR, r = 36) => `<rect x="${x + 10}" y="${y + 10}" width="${w}" height="${h}" rx="${r}" fill="${DK}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}" stroke="${DK}" stroke-width="5"/>`;
const cHead = (eyebrow: string) => `<rect width="${W}" height="${H}" fill="${CR}"/>${T(W / 2, 400, eyebrow.toUpperCase(), { w: 800, s: 34, c: ORT, ls: 8, a: "middle" })}`;
const cTitle = (y: number, t: string, s = 80, c = BR) => T(W / 2, y, t, { f: "Baloo 2", s, c, a: "middle" });
const cCode = (x: number, y: number, w: number, lines: string[]) => {
  // JetBrains Mono is 0.6 em wide: shrink long lines so they stay inside the card.
  const size = Math.min(50, Math.floor((w - 100) / (0.6 * Math.max(...lines.map((l) => l.length)))));
  const lh = Math.round(size * 1.56);
  const h = 70 + lines.length * lh;
  return cCard(x, y, w, h, DK) + lines.map((l, i) => T(x + 50, y + 42 + size + i * lh, l, { f: "JetBrains Mono", w: 500, s: size, c: l.trim().startsWith("#") || /print|\(/.test(l) ? MI : CR })).join("");
};
const cOpt = (x: number, y: number, w: number, h: number, letter: string, label: string, on = false) =>
  `${cCard(x, y, w, h, on ? OR : CR, h / 2)}<circle cx="${x + h / 2 + 6}" cy="${y + h / 2}" r="${h / 2 - 18}" fill="${on ? DK : OR}" stroke="${DK}" stroke-width="4"/>${T(x + h / 2 + 6, y + h / 2 + 17, letter, { f: "Baloo 2", s: 50, c: "#fff", a: "middle" })}${T(x + h + 26, y + h / 2 + 16, label, { f: "JetBrains Mono", w: 500, s: 46, c: on ? "#fff" : BR })}`;
const cRun = (y: number, label: string) => `<rect x="90" y="${y}" width="900" height="130" rx="30" fill="${YE}" stroke="${DK}" stroke-width="5"/><circle cx="170" cy="${y + 65}" r="26" fill="none" stroke="${BR}" stroke-width="6"/><path d="M162 ${y + 51} L188 ${y + 65} L162 ${y + 79} Z" fill="${BR}"/>${T(230, y + 84, label, { w: 800, s: 46 })}`;

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
const lHead = (eyebrow: string) => `<rect width="${W}" height="${H}" fill="${BK}"/>${T(90, 330, "LYNQ", { f: "Inter SemiBold", w: 600, s: 38, c: WH, ls: 10 })}${T(W - 90, 330, eyebrow.toUpperCase(), { f: "Inter SemiBold", w: 600, s: 30, c: LI, ls: 6, a: "end" })}<rect x="90" y="356" width="${W - 180}" height="2" fill="${LI}" opacity="0.6"/>`;
const lLines = (y: number, lines: string[], s = 76, c = WH) => lines.map((l, i) => T(90, y + i * (s + 18), l, { f: "Inter Light", w: 300, s, c })).join("");
const bar = (x: number, y: number, w: number, h: number, c = LN, r = 10) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/>`;
const phone = (x: number, y: number, w: number, h: number, inner: (x: number, y: number, w: number, h: number) => string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="48" fill="#141416" stroke="#3a3a40" stroke-width="4"/><rect x="${x + w / 2 - 50}" y="${y + 18}" width="100" height="12" rx="6" fill="#3a3a40"/>${inner(x + 24, y + 50, w - 48, h - 80)}`;

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
const eFrame = (series: string, folio: string) =>
  `<rect width="${W}" height="${H}" fill="${BK}"/>
<rect x="60" y="250" width="${W - 120}" height="${H - 250 - 300}" fill="none" stroke="#1f1f23" stroke-width="2"/>
${T(90, 300, "LYNQ", { f: "Inter SemiBold", w: 600, s: 30, c: WH, ls: 10 })}
${T(W / 2, 300, series.toUpperCase(), { f: MONO, w: 500, s: 22, c: MU, ls: 4, a: "middle" })}
${T(W - 90, 300, folio, { f: MONO, w: 500, s: 22, c: MU, ls: 2, a: "end" })}
<line x1="60" y1="328" x2="${W - 60}" y2="328" stroke="#1f1f23" stroke-width="2"/>
<line x1="60" y1="${H - 360}" x2="${W - 60}" y2="${H - 360}" stroke="#1f1f23" stroke-width="2"/>
${T(90, H - 318, "LYNQ.BUILD", { f: MONO, w: 500, s: 22, c: MU, ls: 4 })}
${T(W - 90, H - 318, "WEBSITES · SYSTEMS · AUTOMATION", { f: MONO, w: 500, s: 20, c: "#5a5a60", ls: 3, a: "end" })}`;
const mLabel = (x: number, y: number, t: string, c = MU, a: "start" | "end" | "middle" = "start") => T(x, y, t.toUpperCase(), { f: MONO, w: 500, s: 24, c, ls: 3, a });

// ---------- Templates ----------
export function storySvg(spec: StorySpec): string {
  switch (spec.kind) {
    case "quiz":
      return `${cHead(spec.eyebrow)}${cTitle(500, spec.headline)}${cCode(90, 570, 900, spec.code)}${T(W / 2, 1600, spec.footnote ?? "Answer in tomorrow's story.", { w: 800, s: 42, c: ORT, a: "middle" })}`;
    case "answer":
      return `${cHead(spec.eyebrow)}${cTitle(500, spec.headline)}${cOpt(90, 570, 900, 140, "✓", spec.answer, true)}
${cCard(90, 770, 900, 140 + spec.why.length * 60 + 220)}${T(140, 860, "Why:", { f: "Baloo 2", s: 56, c: ORT })}
${spec.why.map((l, i) => T(140, 940 + i * 60, l, { s: 46 })).join("")}
${cCard(140, 960 + spec.why.length * 60, 800, 120, DK, 24)}${T(180, 1036 + spec.why.length * 60, spec.example, { f: "JetBrains Mono", w: 500, s: 44, c: MI })}
${T(W / 2, 1290 + spec.why.length * 60 - 60, spec.tryThis, { w: 800, s: 44, c: ORT, a: "middle" })}
${cRun(1450, "Run it free at codeitlearn.com")}`;
    case "tryTonight":
      return `${cHead(spec.eyebrow)}${cTitle(500, spec.headline, 76)}
${spec.steps.map((st, i) => `<circle cx="150" cy="${640 + i * 190}" r="40" fill="${OR}" stroke="${DK}" stroke-width="5"/>${T(150, 657 + i * 190, String(i + 1), { f: "Baloo 2", s: 50, c: "#fff", a: "middle" })}${T(220, 656 + i * 190, st, { w: 700, s: 46 })}`).join("")}
${spec.code ? cCode(90, 640 + spec.steps.length * 190 - 40, 900, spec.code.split("\n")) : ""}
${cRun(1450, "Free to start: codeitlearn.com")}`;
    case "thisOrThat": {
      const dark = spec.brand === "lynq";
      const bg = dark ? lHead(spec.eyebrow) : cHead(spec.eyebrow);
      const title = dark ? lLines(480, [spec.headline], 72) : cTitle(500, spec.headline, 76);
      const tile = (x: number, letter: string, label: string, ic: Icon) => dark
        ? `<rect x="${x}" y="580" width="420" height="420" rx="36" fill="#141416" stroke="${LN}" stroke-width="3"/>${icon(ic, x + 210, 760, letter === "A" ? WH : LI, BK)}${T(x + 210, 950, label, { f: "Inter Light", w: 300, s: 40, c: WH, a: "middle" })}`
        : `${cCard(x, 580, 420, 420, letter === "A" ? "#ffffff" : "#fff0e0")}${icon(ic, x + 210, 760, letter === "A" ? OR : MI, DK)}${T(x + 210, 950, label, { f: "Baloo 2", s: 48, a: "middle" })}`;
      return `${bg}${title}${tile(90, "A", spec.a.label, spec.a.icon)}${tile(570, "B", spec.b.label, spec.b.icon)}`;
    }
    case "slider": {
      // The headline and the first line are the question (both big); any further line is a small note.
      const dark = spec.brand === "lynq";
      const [second, ...notes] = spec.lines;
      return dark
        ? `${lHead(spec.eyebrow)}${lLines(500, [spec.headline, ...(second ? [second] : [])], 72)}${lLines(720, notes, 40, MU)}`
        : `${cHead(spec.eyebrow)}${cTitle(520, spec.headline, 76)}${second ? cTitle(610, second, 76) : ""}${notes.map((l, i) => T(W / 2, 700 + i * 56, l, { s: 42, c: ORT, a: "middle" })).join("")}`;
    }
    case "whichSite":
      return `${lHead(spec.eyebrow)}${lLines(480, spec.headline, 72)}
${phone(90, 630, 420, 580, (x, y, w) => `${bar(x, y, w, 150, "#222226")}${bar(x + 20, y + 30, 200, 26)}${bar(x + 20, y + 76, 300, 18, "#1c1c20")}${bar(x + 20, y + 106, 260, 18, "#1c1c20")}${[0, 1, 2, 3, 4, 5].map((i) => bar(x, y + 200 + i * 46, w - (i % 3) * 40, 22, "#1c1c20")).join("")}${bar(x, y + 430, w, 70, "#222226")}${T(x + w / 2, y + 500, "phone: see footer", { f: "Inter Light", w: 300, s: 24, c: MU, a: "middle" })}`)}
${phone(570, 630, 420, 580, (x, y, w) => `${bar(x, y, w, 50, "#1c1c20")}${T(x, y + 120, "Plumber", { f: "Inter SemiBold", w: 600, s: 44, c: WH })}${T(x, y + 166, "Open now · 20 min away", { f: "Inter Light", w: 300, s: 26, c: MU })}<rect x="${x}" y="${y + 200}" width="${w}" height="100" rx="50" fill="${LI}"/>${T(x + w / 2, y + 264, "Call now", { f: "Inter SemiBold", w: 600, s: 38, c: BK, a: "middle" })}<rect x="${x}" y="${y + 320}" width="${w}" height="86" rx="43" fill="none" stroke="#3a3a40" stroke-width="3"/>${T(x + w / 2, y + 375, "Book a visit", { f: "Inter Light", w: 300, s: 32, c: WH, a: "middle" })}${T(x, y + 470, "★★★★★  48 reviews", { f: "Inter Light", w: 300, s: 26, c: WH })}`)}
${T(300, 1262, "A", { f: "Inter SemiBold", w: 600, s: 64, c: WH, a: "middle" })}${T(780, 1262, "B", { f: "Inter SemiBold", w: 600, s: 64, c: LI, a: "middle" })}`;
    case "checklist": {
      const row = (y: number, txt: string, ok: boolean) => `<rect x="90" y="${y}" width="${W - 180}" height="120" rx="20" fill="#131315" stroke="${LN}" stroke-width="2"/><rect x="120" y="${y + 30}" width="60" height="60" rx="14" fill="none" stroke="${ok ? LI : "#5a5a60"}" stroke-width="4"/>${ok ? `<path d="M134 ${y + 60} l14 14 l26 -30" fill="none" stroke="${LI}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` : ""}${T(220, y + 76, txt, { f: "Inter Light", w: 300, s: 40, c: WH })}`;
      return `${lHead(spec.eyebrow)}${lLines(490, spec.headline, 80)}${T(90, 680, spec.intro, { f: "Inter Light", w: 300, s: 40, c: MU })}${spec.items.map((it, i) => row(740 + i * 150, it.text, it.ok)).join("")}
${T(90, 1440, spec.close[0], { f: "Inter SemiBold", w: 600, s: 60, c: WH })}${T(90, 1520, spec.close[1], { f: "Inter Light", w: 300, s: 48, c: LI })}${T(90, 1586, spec.close[2], { f: "Inter Light", w: 300, s: 48, c: WH })}`;
    }
    case "oneFix":
      return `${lHead(spec.eyebrow)}${lLines(490, spec.headline, 80)}
${phone(290, 700, 500, 700, (x, y, w) => `${bar(x, y, w, 60, "#1c1c20")}${T(x, y + 140, "Your business", { f: "Inter SemiBold", w: 600, s: 40, c: WH })}${bar(x, y + 170, w - 60, 18, "#1c1c20")}<rect x="${x}" y="${y + 230}" width="${w}" height="104" rx="52" fill="none" stroke="${LI}" stroke-width="4" stroke-dasharray="14 12"/>${T(x + w / 2, y + 296, spec.fix, { f: "Inter SemiBold", w: 600, s: 36, c: LI, a: "middle" })}${[0, 1, 2, 3].map((i) => bar(x, y + 380 + i * 44, w - (i % 2) * 60, 20, "#1c1c20")).join("")}`)}
<path d="M840 1000 C 900 1000, 900 960, 800 960" fill="none" stroke="${LI}" stroke-width="5"/><path d="M816 946 L796 960 L816 974" fill="none" stroke="${LI}" stroke-width="5" stroke-linecap="round"/>
${lLines(1500, wrapWords(spec.detail, 34), 44, WH)}`;
    case "specSheet": {
      const rows = spec.specs.map((r, i) => {
        const y = 760 + i * 118;
        return `<line x1="90" y1="${y - 70}" x2="${W - 90}" y2="${y - 70}" stroke="#1f1f23" stroke-width="2"/>${mLabel(90, y, r.label)}${T(W - 90, y + 2, r.value, { f: "Inter Light", w: 300, s: 48, c: r.accent ? LI : WH, a: "end" })}`;
      }).join("");
      const last = 760 + spec.specs.length * 118 - 70;
      return `${eFrame(spec.series, "SPEC")}
${mLabel(90, 440, "Model")}${T(90, 540, spec.model, { f: "Inter SemiBold", w: 600, s: 96, c: WH, ls: -2 })}${T(90, 606, spec.subtitle, { f: "Inter Light", w: 300, s: 40, c: MU })}
${rows}<line x1="90" y1="${last}" x2="${W - 90}" y2="${last}" stroke="#1f1f23" stroke-width="2"/>
${lLines(last + 90, wrapWords(spec.note, 40), 36, MU)}`;
    }
    case "statement": {
      const size = 92;
      const top = 620;
      const lines = spec.lines.map((l, i) => {
        const y = top + i * (size + 22);
        const at = l.indexOf(spec.accentWord);
        if (at < 0) return T(90, y, l, { f: "Inter Light", w: 300, s: size, c: WH, ls: -2 });
        // the accent word in lime, the rest white: drawn as one text with a tspan
        return `<text x="90" y="${y}" font-family="Inter Light" font-weight="300" font-size="${size}" letter-spacing="-2" fill="${WH}" xml:space="preserve">${esc(l.slice(0, at))}<tspan fill="${LI}">${esc(spec.accentWord)}</tspan>${esc(l.slice(at + spec.accentWord.length))}</text>`;
      }).join("");
      const end = top + spec.lines.length * (size + 22);
      return `${eFrame(spec.series, "NOTE")}${mLabel(90, 470, "Studio note")}${lines}<rect x="90" y="${end + 30}" width="120" height="4" fill="${LI}"/>${mLabel(90, end + 110, spec.byline)}`;
    }
    case "object":
      return `${eFrame(spec.series, "OBJ")}
${mLabel(90, 410, spec.title)}
<rect x="90" y="440" width="${W - 180}" height="760" fill="#111113"/>
<!-- the photo is composited into this square at render time -->
${spec.label.map((r, i) => `<line x1="90" y1="${1250 + i * 64 - 42}" x2="${W - 90}" y2="${1250 + i * 64 - 42}" stroke="#1f1f23" stroke-width="2"/>${mLabel(90, 1250 + i * 64, r.k)}${T(W - 90, 1252 + i * 64, r.v, { f: "Inter Light", w: 300, s: 32, c: WH, a: "end" })}`).join("")}
${T(90, 1250 + spec.label.length * 64 + 40, spec.line, { f: "Inter Light", w: 300, s: 44, c: LI })}`;
    case "index": {
      const rows = spec.rows.map((r, i) => {
        const y = 680 + i * 150;
        return `<line x1="90" y1="${y - 70}" x2="${W - 90}" y2="${y - 70}" stroke="#1f1f23" stroke-width="2"/>${mLabel(90, y - 20, String(i + 1).padStart(2, "0"), "#5a5a60")}${T(170, y, r.name, { f: "Inter Light", w: 300, s: 50, c: WH })}${T(170, y + 46, r.what, { f: "Inter Light", w: 300, s: 30, c: MU })}${r.where ? mLabel(W - 90, y - 20, r.where, "#5a5a60", "end") : ""}`;
      }).join("");
      const last = 680 + spec.rows.length * 150 - 70;
      return `${eFrame(spec.series, "INDEX")}${mLabel(90, 440, "Index")}${T(90, 530, spec.headline, { f: "Inter Light", w: 300, s: 76, c: WH, ls: -1 })}${rows}<line x1="90" y1="${last}" x2="${W - 90}" y2="${last}" stroke="#1f1f23" stroke-width="2"/>${T(90, last + 80, spec.note, { f: "Inter Light", w: 300, s: 34, c: LI })}`;
    }
    case "process": {
      const rows = spec.steps.map((st, i) => {
        const y = 700 + i * 160;
        const on = i === spec.steps.length - 1;
        return `<circle cx="118" cy="${y - 14}" r="${on ? 14 : 10}" fill="${on ? LI : "none"}" stroke="${on ? LI : "#5a5a60"}" stroke-width="3"/>${i < spec.steps.length - 1 ? `<line x1="118" y1="${y + 6}" x2="118" y2="${y + 136}" stroke="#2a2a2e" stroke-width="2"/>` : ""}${mLabel(170, y - 34, st.n, "#5a5a60")}${T(170, y + 14, st.name, { f: "Inter Light", w: 300, s: 50, c: WH })}${T(170, y + 60, st.detail, { f: "Inter Light", w: 300, s: 30, c: MU })}`;
      }).join("");
      const last = 700 + spec.steps.length * 160;
      return `${eFrame(spec.series, "PROC")}${mLabel(90, 440, "Process")}${T(90, 530, spec.headline, { f: "Inter Light", w: 300, s: 76, c: WH, ls: -1 })}${rows}${T(90, last + 10, spec.note, { f: "Inter Light", w: 300, s: 34, c: LI })}`;
    }
    case "teardown": {
      const col = (x: number, title: string, items: string[], good: boolean) => `${mLabel(x, 700, title, good ? LI : MU)}<line x1="${x}" y1="724" x2="${x + 420}" y2="724" stroke="${good ? LI : "#2a2a2e"}" stroke-width="2"/>${items.map((t, i) => `${T(x, 800 + i * 96, good ? "+" : "−", { f: MONO, w: 500, s: 36, c: good ? LI : "#5a5a60" })}${wrapWords(t, 20).map((l, j) => T(x + 46, 800 + i * 96 + j * 40, l, { f: "Inter Light", w: 300, s: 34, c: good ? WH : MU })).join("")}`).join("")}`;
      return `${eFrame(spec.series, "TEAR")}${mLabel(90, 440, "Teardown")}${T(90, 530, spec.headline, { f: "Inter Light", w: 300, s: 72, c: WH, ls: -1 })}${col(90, "Before", spec.before, false)}${col(570, "After", spec.after, true)}${lLines(1420, wrapWords(spec.note, 40), 34, MU)}`;
    }
  }
}

const LOGO = path.join(process.cwd(), "src", "assets", "brand", "codeit-logo.png");

/** Renders a story to a 1080×1920 JPEG. */
export async function composeStory(spec: StorySpec, photo?: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number; contentType: "image/jpeg" }> {
  prepareFonts();
  const sharp = (await import("sharp")).default;
  const layers = [] as { input: Buffer; left: number; top: number }[];
  if (spec.kind === "object" && photo) layers.push({ input: await sharp(Buffer.from(photo)).resize(W - 180, 760, { fit: "cover" }).toBuffer(), left: 90, top: 440 });
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
    : `<rect width="${W}" height="${H}" fill="${CR}"/><circle cx="${cx + 16}" cy="${cy + 16}" r="330" fill="${DK}"/><circle cx="${cx}" cy="${cy}" r="330" fill="${OR}" stroke="${DK}" stroke-width="10"/>${glyph}`;
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
    "FIX THIS": { mark: "wrench" },
    "WHAT YOU GET": { mark: "box" },
    OFFICE: { mark: "grid" },
    BEHIND: { mark: "eye" },
  },
};
