/**
 * CodeIt feed cards, rendered from a spec (no AI), in CodeIt's modern look
 * (codeit-kit.ts: cream gradient with soft light, white cards floating on
 * blurred shadows, dark glass code windows, orange gradient accents, no
 * outlines), the same look as the CodeIt stories, cut into a 1080×1080 square and told as a 1-2-3 story a parent can follow in five
 * seconds without the caption: a real game on a real screen, the real code
 * with the one line that matters, and the payoff.
 *
 * Deterministic, so every post lines up with the last one, and free.
 * Text is rendered through librsvg with the bundled fonts (see story-card.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareFonts } from "./story-card";
import { formatSvg, type CardFormat } from "./codeit-formats";
import { backdrop, header, soft, stepDot } from "./codeit-kit";

export type Hero = "cat" | "ghost" | "rocket" | "bunny";
export type Item = "pizza" | "candy" | "asteroid" | "carrot";

/** One panel of a story card. */
export type CardPanel =
  | { type: "game"; hero?: Hero; item?: Item; score?: string }
  | { type: "code"; lines: string[]; highlight?: number; strike?: number; comment?: string }
  | { type: "input"; text: string }
  | { type: "run"; label?: string }
  | { type: "terminal"; text: string }
  | { type: "question"; prompt: string; options: string[]; correct: number }
  | { type: "text"; lines: string[] };

export interface CardStep {
  label: string;
  panel: CardPanel;
}

export interface CodeItCard {
  /** Small orange caps line above the headline, e.g. "WE PROVE IT". */
  eyebrow: string;
  /** Brown headline, one line. */
  headline: string;
  /** Orange second line. */
  sub: string;
  /**
   * Up to three steps. Two steps in a row are drawn side by side when `rows`
   * groups them: e.g. rows: [[0, 1], [2]] puts steps 0 and 1 on one row.
   * Default: one step per row.
   */
  steps: CardStep[];
  rows?: number[][];
  /** The sentence under the steps: the point of the post, in plain words. */
  takeaway?: string;
  /** Orange "try this" line under the takeaway, e.g. "Try tonight: ask what makes their character move." */
  tryThis?: string;
  /** A creative format (split, bug hunt, comic, cheat sheet, guess, ask) drawn instead of the steps. */
  format?: CardFormat;
}

const W = 1080;
const PAD = 72;
const CREAM = "#fff4e5";
const BROWN = "#35220e";
const ORANGE = "#ff7a00";
const ORANGE_T = "#d46500";
const YELLOW = "#f5d04a";
const DARK = "#2b1d12";
const MINT = "#3ddc97";
const CORAL = "#ff5a5f";
const SKY = "#bfe3ff";
const NIGHT = "#2a2b5a";
const PAPER = "#ffffff";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = (x: number, y: number, t: string, o: { f?: string; w?: number; s?: number; c?: string; a?: "start" | "middle" | "end"; ls?: number; op?: number } = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.f ?? "Nunito"}" font-weight="${o.w ?? 700}" font-size="${o.s ?? 36}" fill="${o.c ?? BROWN}" text-anchor="${o.a ?? "start"}" letter-spacing="${o.ls ?? 0}" opacity="${o.op ?? 1}" xml:space="preserve">${esc(t)}</text>`;
const mono = (x: number, y: number, t: string, s: number, c: string) => text(x, y, t, { f: "JetBrains Mono", w: 500, s, c });
/** A floating card: dark fills become the glass code gradient, light ones white. */
const card = (x: number, y: number, w: number, h: number, fill = PAPER, r = 28) =>
  soft(x, y, w, h, fill === DARK ? "url(#kcode)" : fill === CREAM ? "#fff3e6" : fill, r, fill === DARK ? 0.28 : 0.14);
const pill = (x: number, y: number, w: number, h: number, t: string, fill: string, c: string, s: number) =>
  `${soft(x, y, w, h, fill === ORANGE ? "url(#korange)" : fill === CREAM ? "#fff3e6" : fill, h / 2, 0.1)}${text(x + w / 2, y + h / 2 + s * 0.36, t, { w: 800, s, c, a: "middle" })}`;
const step = stepDot;
const check = (x: number, y: number) => `<path d="M${x} ${y} l10 10 l22 -24" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Greedy wrap by estimated glyph width. */
export function wrap(t: string, size: number, maxWidth: number, perChar = 0.5): string[] {
  const maxChars = Math.max(10, Math.floor(maxWidth / (size * perChar)));
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

// ---------------------------------------------------------------------------
// Game scene: a flat hero mid-jump, an item, stars, ground, a score badge.
// ---------------------------------------------------------------------------

function hero(kind: Hero, x: number, y: number): string {
  const g = (inner: string) => `<g transform="translate(${x},${y}) rotate(-16)">${inner}</g>`;
  if (kind === "ghost") {
    return g(`<path d="M0 60 L0 20 Q0 -20 50 -20 Q100 -20 100 20 L100 60 L84 48 L68 60 L50 48 L34 60 L16 48 Z" fill="#fff8f0" stroke="#4a2f17" stroke-width="2.5"/><circle cx="36" cy="18" r="6" fill="${DARK}"/><circle cx="64" cy="18" r="6" fill="${DARK}"/><path d="M42 36 q8 8 16 0" fill="none" stroke="#4a2f17" stroke-width="2.5" stroke-linecap="round"/>`);
  }
  if (kind === "rocket") {
    return g(`<path d="M50 -30 Q90 20 70 80 L30 80 Q10 20 50 -30 Z" fill="#fff8f0" stroke="#4a2f17" stroke-width="2.5"/><circle cx="50" cy="20" r="12" fill="${SKY}" stroke="#4a2f17" stroke-width="2.5"/><path d="M30 60 L8 84 L34 80 Z M70 60 L92 84 L66 80 Z" fill="${CORAL}" stroke="#4a2f17" stroke-width="2.5"/><path d="M40 82 L50 110 L60 82 Z" fill="${YELLOW}" stroke="#4a2f17" stroke-width="2.5"/>`);
  }
  if (kind === "bunny") {
    return g(`<ellipse cx="56" cy="46" rx="54" ry="34" fill="#fff8f0" stroke="#4a2f17" stroke-width="2.5"/><circle cx="108" cy="24" r="30" fill="#fff8f0" stroke="#4a2f17" stroke-width="2.5"/><path d="M96 -2 L92 -52 L114 -8 Z M124 -2 L136 -52 L142 -6 Z" fill="#fff8f0" stroke="#4a2f17" stroke-width="2.5"/><path d="M98 -8 L96 -40 L108 -12 Z M126 -8 L134 -40 L136 -12 Z" fill="${CORAL}" opacity="0.6"/><circle cx="100" cy="20" r="4" fill="${DARK}"/><circle cx="118" cy="20" r="4" fill="${DARK}"/><circle cx="110" cy="32" r="4" fill="${CORAL}"/><circle cx="4" cy="46" r="12" fill="#fff8f0" stroke="#4a2f17" stroke-width="2.5"/><path d="M34 76 l-8 20 M78 78 l-2 20" stroke="${DARK}" stroke-width="8" stroke-linecap="round"/><path d="M34 76 l-8 20 M78 78 l-2 20" stroke="#fff8f0" stroke-width="4" stroke-linecap="round"/>`);
  }
  return g(`<ellipse cx="60" cy="40" rx="64" ry="36" fill="${ORANGE}" stroke="#4a2f17" stroke-width="2.5"/><ellipse cx="60" cy="52" rx="34" ry="16" fill="#ffc98a" opacity="0.9"/><circle cx="118" cy="22" r="30" fill="${ORANGE}" stroke="#4a2f17" stroke-width="2.5"/><path d="M98 0 L104 -22 L120 -2 Z M138 0 L146 -22 L128 -2 Z" fill="${ORANGE}" stroke="#4a2f17" stroke-width="2.5"/><circle cx="110" cy="20" r="4" fill="${DARK}"/><circle cx="128" cy="20" r="4" fill="${DARK}"/><path d="M-2 40 C -30 20, -30 0, -6 4" fill="none" stroke="${DARK}" stroke-width="8" stroke-linecap="round"/><path d="M-2 40 C -30 20, -30 0, -6 4" fill="none" stroke="${ORANGE}" stroke-width="4" stroke-linecap="round"/><path d="M20 70 l-8 22 M70 72 l-4 22 M104 60 l10 20" stroke="${DARK}" stroke-width="8" stroke-linecap="round"/><path d="M20 70 l-8 22 M70 72 l-4 22 M104 60 l10 20" stroke="${ORANGE}" stroke-width="4" stroke-linecap="round"/>`);
}

function item(kind: Item, x: number, y: number): string {
  if (kind === "candy") {
    return `<g transform="translate(${x},${y}) rotate(-20)"><rect x="0" y="0" width="90" height="44" rx="22" fill="${CORAL}" stroke="#4a2f17" stroke-width="2.5"/><path d="M0 10 L-22 -4 L-22 48 L0 34 Z M90 10 L112 -4 L112 48 L90 34 Z" fill="${CORAL}" stroke="#4a2f17" stroke-width="2.5"/><path d="M22 4 l10 36 M46 4 l10 36 M70 4 l10 36" stroke="#fff" stroke-width="5" opacity="0.8"/></g>`;
  }
  if (kind === "asteroid") {
    return `<path d="M${x} ${y} l40 -30 l50 10 l20 40 l-30 40 l-50 5 l-35 -30 Z" fill="#9a8d82" stroke="#4a2f17" stroke-width="2.5"/><circle cx="${x + 40}" cy="${y + 10}" r="8" fill="#7a6d62"/><circle cx="${x + 70}" cy="${y + 40}" r="11" fill="#7a6d62"/>`;
  }
  if (kind === "carrot") {
    return `<g transform="translate(${x},${y}) rotate(30)"><path d="M0 0 L40 0 L20 110 Z" fill="${ORANGE}" stroke="#4a2f17" stroke-width="2.5"/><path d="M8 -4 L0 -36 L20 -10 L30 -40 L34 -4 Z" fill="${MINT}" stroke="#4a2f17" stroke-width="2.5"/></g>`;
  }
  return `<path d="M${x} ${y} L${x + 120} ${y} L${x + 60} ${y - 94} Z" fill="#ffc96b" stroke="#4a2f17" stroke-width="2.5"/><path d="M${x} ${y} L${x + 120} ${y} L${x + 110} ${y - 16} L${x + 10} ${y - 16} Z" fill="#e0902e" stroke="#4a2f17" stroke-width="2.5"/><circle cx="${x + 45}" cy="${y - 39}" r="9" fill="${CORAL}" stroke="#4a2f17" stroke-width="2"/><circle cx="${x + 78}" cy="${y - 54}" r="9" fill="${CORAL}" stroke="#4a2f17" stroke-width="2"/><circle cx="${x + 62}" cy="${y - 24}" r="8" fill="${CORAL}" stroke="#4a2f17" stroke-width="2"/>`;
}

function scene(x: number, y: number, w: number, h: number, p: Extract<CardPanel, { type: "game" }>): string {
  const kind = p.hero ?? "cat";
  const sky = kind === "ghost" || kind === "rocket" ? NIGHT : SKY;
  const star = (sx: number, sy: number) => `<path d="M${sx} ${sy} l6 14 15 1 -12 9 5 15 -14 -9 -14 9 5 -15 -12 -9 15 -1z" fill="${YELLOW}" stroke="#4a2f17" stroke-width="2"/>`;
  const ground = kind === "rocket" ? "" : `<ellipse cx="${x + w * 0.3}" cy="${y + h - 34}" rx="${w * 0.6}" ry="60" fill="url(#kgrass)"/><ellipse cx="${x + w * 0.85}" cy="${y + h - 24}" rx="${w * 0.45}" ry="50" fill="#25b877" opacity="0.55"/><rect x="${x}" y="${y + h - 30}" width="${w}" height="30" fill="url(#kgrass)"/>`;
  const scale = Math.min(1, w / 440);
  return `
<clipPath id="clip${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30"/></clipPath>
<g clip-path="url(#clip${x}${y})">
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${sky === NIGHT ? "url(#knight)" : "url(#ksky)"}"/>
${ground}
${star(x + 50, y + 40)}${star(x + w - 70, y + 60)}
<g transform="translate(${x + w * 0.62},${y + h - 56}) scale(${scale})">${item(p.item ?? "pizza", 0, 0)}</g>
<g transform="translate(${x + w * 0.2},${y + h * 0.36}) scale(${scale})">${hero(kind, 0, 0)}</g>
<rect x="${x + w - 154}" y="${y + 18}" width="134" height="42" rx="21" fill="${DARK}"/>${text(x + w - 85, y + 44, `SCORE ${p.score ?? "12"}`, { f: "JetBrains Mono", w: 700, s: 22, c: "#fff", a: "middle" })}
</g>`;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/** Draws a panel into a box; returns the SVG. Heights are fixed per panel type so layout is predictable. */
export function panelHeight(p: CardPanel): number {
  switch (p.type) {
    case "game": return 250;
    case "code": return Math.max(150, 70 + p.lines.length * 50 + (p.comment ? 38 : 0));
    case "input": return 100;
    case "run": return 72;
    case "terminal": return 104;
    case "question": return 176;
    case "text": return 52 + p.lines.length * 44;
  }
}

function panel(x: number, y: number, w: number, p: CardPanel): string {
  const h = panelHeight(p);
  switch (p.type) {
    case "game":
      return `${soft(x, y, w, h, PAPER, 30, 0.18)}${scene(x, y, w, h, p)}`;
    case "code": {
      let out = card(x, y, w, h, DARK);
      let ly = y + 56;
      if (p.comment) {
        out += mono(x + 36, ly, p.comment, 28, "#c9b8a6");
        ly += 38;
      }
      p.lines.forEach((line, i) => {
        if (i === p.highlight) {
          out += `<rect x="${x + 24}" y="${ly - 36}" width="${Math.min(w - 48, line.length * 19 + 36)}" height="50" rx="12" fill="${ORANGE}"/>${mono(x + 36, ly, line, 32, "#fff")}`;
        } else if (i === p.strike) {
          out += mono(x + 36, ly, line, 30, "#8e7b69") + `<line x1="${x + 34}" y1="${ly - 10}" x2="${x + 36 + line.length * 18.2}" y2="${ly - 10}" stroke="${CORAL}" stroke-width="6" stroke-linecap="round"/>`;
        } else {
          const c = line.trim().startsWith("#") ? MINT : "#fff4e5";
          out += mono(x + 36, ly, line, 30, c);
        }
        ly += 50;
      });
      return out;
    }
    case "input": {
      // Shrinks to fit a half-width panel, cursor right after the text.
      const fs = Math.min(38, Math.floor((w - 90) / (0.5 * p.text.length)));
      return `${card(x, y, w, h, PAPER)}${text(x + 36, y + 50 + fs * 0.32, p.text, { w: 700, s: fs })}<rect x="${x + 44 + Math.min(w - 90, p.text.length * fs * 0.49)}" y="${y + 30}" width="4" height="44" rx="2" fill="${ORANGE}"/>`;
    }
    case "run":
      return `${soft(x, y, w, h, YELLOW, h / 2, 0.16)}<circle cx="${x + 58}" cy="${y + 36}" r="16" fill="none" stroke="${BROWN}" stroke-width="4"/><path d="M${x + 53} ${y + 27} L${x + 69} ${y + 36} L${x + 53} ${y + 45} Z" fill="${BROWN}"/>${text(x + 92, y + 48, p.label ?? "Run this", { w: 800, s: 32 })}`;
    case "terminal":
      return `${card(x, y, w, h, DARK)}${mono(x + 36, y + 66, `> ${p.text}`, 38, MINT)}<rect x="${x + 48 + (p.text.length + 2) * 23}" y="${y + 36}" width="18" height="40" fill="${MINT}" opacity="0.8"/>`;
    case "question": {
      const n = p.options.length;
      const gap = 24;
      const pw = Math.floor((w - 72 - gap * (n - 1)) / n);
      let out = card(x, y, w, h) + text(x + 36, y + 58, p.prompt, { f: "Baloo 2", w: 700, s: 38 });
      p.options.forEach((o, i) => {
        const px = x + 36 + i * (pw + gap);
        const right = i === p.correct;
        out += pill(px, y + 92, pw, 62, o, right ? ORANGE : CREAM, right ? "#fff" : BROWN, 27);
        if (right) out += check(px + pw - 54, y + 120);
      });
      return out;
    }
    case "text": {
      let out = card(x, y, w, h, PAPER);
      p.lines.forEach((l, i) => (out += text(x + 36, y + 50 + i * 44, l, { w: 700, s: 30 })));
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/** The whole SVG (without the logo bitmap, composited after). */
export function codeItCardSvg(spec: CodeItCard): string {
  if (spec.format) return formatSvg(spec.eyebrow, spec.headline, spec.sub, spec.format);
  const rows = spec.rows ?? spec.steps.map((_, i) => [i]);
  const parts: string[] = [backdrop(), header(spec.eyebrow, spec.headline, spec.sub)];

  // Bottom block first (the value for the reader), so the steps get whatever height is left.
  const bottomParts: string[] = [];
  let top = W - 64; // the footer line sits below this
  if (spec.tryThis) {
    const lines = wrap(spec.tryThis, 30, W - PAD * 2 - 48, 0.52);
    const boxH = 40 + lines.length * 40;
    const by = top - boxH;
    bottomParts.push(`<rect x="${PAD}" y="${by}" width="${W - PAD * 2}" height="${boxH}" rx="${Math.min(30, boxH / 2)}" fill="${ORANGE}" opacity="0.12"/>`);
    lines.forEach((l, i) => bottomParts.push(text(PAD + 24, by + 42 + i * 40, l, { w: 800, s: 30, c: ORANGE_T })));
    top = by - 22;
  }
  if (spec.takeaway) {
    const tl = wrap(spec.takeaway, 34, W - PAD * 2, 0.5);
    tl.forEach((l, i) => bottomParts.push(text(PAD, top - 10 - (tl.length - 1 - i) * 42, l, { f: "Baloo 2", w: 700, s: 34 })));
    top -= 10 + tl.length * 42;
  }
  const stepsTop = 246;
  const avail = top - 16 - stepsTop;

  // Steps, measured, then scaled to fit when they run long.
  const stepParts: string[] = [];
  let y = stepsTop;
  let n = 1;
  const rowGap = 44;
  for (const row of rows) {
    const gap = 40;
    const cw = Math.floor((W - PAD * 2 - gap * (row.length - 1)) / row.length);
    let rowH = 0;
    row.forEach((si, col) => {
      const s = spec.steps[si]!;
      const x = PAD + col * (cw + gap);
      stepParts.push(step(x, y, n++, s.label));
      stepParts.push(panel(x, y + 38, cw, s.panel));
      rowH = Math.max(rowH, panelHeight(s.panel));
    });
    if (row.length === 2) {
      const mid = y + 38 + rowH / 2;
      stepParts.push(`<path d="M${PAD + cw + gap - 26} ${mid - 14} L${PAD + cw + gap - 8} ${mid} L${PAD + cw + gap - 26} ${mid + 14}" fill="none" stroke="${ORANGE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    y += 38 + rowH + rowGap;
  }
  const stepsH = y - rowGap - stepsTop + 10;
  const k = Math.min(1, avail / stepsH);
  parts.push(`<g transform="translate(${W / 2} ${stepsTop}) scale(${k.toFixed(4)}) translate(${-W / 2} ${-stepsTop})">${stepParts.join("\n")}</g>`);
  parts.push(...bottomParts);
  parts.push(text(W - PAD, W - 28, "codeitlearn.com", { w: 800, s: 24, c: ORANGE_T, a: "end" }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${parts.join("\n")}</svg>`;
}

const LOGO = path.join(process.cwd(), "src", "assets", "brand", "codeit-logo.png");

/** Renders the card to a 1080×1080 JPEG (Instagram only accepts JPEG feed images) with the CodeIt logo in the corner. */
export async function composeCodeItCard(spec: CodeItCard): Promise<{ bytes: Uint8Array; width: number; height: number; contentType: "image/jpeg" }> {
  prepareFonts();
  const sharp = (await import("sharp")).default;
  const logo = await sharp(readFileSync(LOGO)).resize({ width: 176 }).png().toBuffer();
  const out = await sharp(Buffer.from(codeItCardSvg(spec))).composite([{ input: logo, left: 72, top: 56 }]).flatten({ background: CREAM }).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer();
  return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: W, height: W, contentType: "image/jpeg" };
}

/** The look's version: bump it when the design changes. */
const STYLE = "modern-2";

/** A stable fingerprint of a card spec, stored on the post so a changed spec remakes the image. */
export function cardKey(spec: CodeItCard): string {
  // STYLE is part of the key, so a redesign remakes the images of posts nobody has touched yet.
  return `codeit-card:${createHash("sha1").update(STYLE + JSON.stringify(spec)).digest("hex").slice(0, 16)}`;
}
