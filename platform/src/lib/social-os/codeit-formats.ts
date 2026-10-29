/**
 * Creative CodeIt feed formats, drawn in CodeIt's modern look (codeit-kit.ts:
 * gradient, soft floating cards, no outlines), the same look as the stories. Each is a 1080×1080
 * card under the same header as the step cards, so the grid stays one
 * family while the formats vary:
 *
 * - split:  one line of code, two games (the same game with one value changed)
 * - bug:    bug hunt: a broken game, its code, "which line is the bug?"
 * - comic:  a four-panel Pip strip that teaches one idea
 * - cheat:  a parent cheat sheet: one coding word explained with a kitchen object
 * - guess:  guess the game from four lines of code
 * - ask:    "you send it, we build it", a call for game ideas
 */
export type FormatHero = "cat" | "ghost" | "rocket" | "bunny";
export type FormatItem = "pizza" | "candy" | "asteroid" | "carrot";

/** One half of a split: the line of code, a label, and optionally a badge (e.g. "LIVES 99") or explicit speed lines. */
export interface SplitSide { code: string; caption: string; badge?: string; fast?: boolean }

export type CardFormat =
  | { kind: "split"; top: SplitSide; bottom: SplitSide; hero?: FormatHero; item?: FormatItem; /** Line under the two games (default "Same game. One number changed."). */ note?: string }
  | { kind: "bug"; hero?: FormatHero; item?: FormatItem; symptom: string; code: string[]; question: string }
  | { kind: "comic"; panels: { caption: string; pose: "think" | "type" | "jump" | "cheer"; bubble?: string; code?: string; jumps?: number }[] }
  | { kind: "cheat"; word: string; like: string; object: "jar" | "loop" | "fork"; lines: string[]; code: string }
  | { kind: "guess"; code: string[]; options: string[]; hint: string }
  | { kind: "ask"; prompt: string; example: string; promise: string };

import { BROWN, CORAL, INK, MINT, ORANGE, ORANGE_T, PAD, PAPER, W, YELLOW, backdrop, bubble, chip, chipWidth, footer, head, header, mono, pill, pillWidth, soft, text } from "./codeit-kit";

const ln = `stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"`;

export function hero(kind: FormatHero, x: number, y: number, tilt = 0): string {
  const g = (inner: string) => `<g transform="translate(${x},${y}) rotate(${tilt})">${inner}</g>`;
  if (kind === "ghost") return g(`<path d="M0 60 L0 20 Q0 -20 50 -20 Q100 -20 100 20 L100 60 L84 48 L68 60 L50 48 L34 60 L16 48 Z" fill="#fffaf4" ${ln}/><circle cx="36" cy="18" r="6" fill="${INK}"/><circle cx="64" cy="18" r="6" fill="${INK}"/><circle cx="28" cy="32" r="6" fill="${CORAL}" opacity="0.35"/><circle cx="72" cy="32" r="6" fill="${CORAL}" opacity="0.35"/>`);
  if (kind === "rocket") return g(`<path d="M50 -30 Q90 20 70 80 L30 80 Q10 20 50 -30 Z" fill="#fffaf4" ${ln}/><circle cx="50" cy="20" r="12" fill="#bfe3ff" ${ln}/><path d="M30 60 L8 84 L34 80 Z M70 60 L92 84 L66 80 Z" fill="${CORAL}" ${ln}/><path d="M40 82 L50 108 L60 82 Z" fill="${YELLOW}"/>`);
  if (kind === "bunny") return g(`<ellipse cx="56" cy="46" rx="54" ry="34" fill="#fffaf4" ${ln}/><circle cx="108" cy="24" r="30" fill="#fffaf4" ${ln}/><path d="M96 -2 Q88 -40 100 -50 Q110 -30 112 -6 Z M124 -2 Q130 -44 142 -48 Q146 -24 138 -4 Z" fill="#fffaf4" ${ln}/><path d="M99 -10 Q96 -34 101 -40 Q106 -26 107 -10 Z M127 -8 Q131 -34 137 -38 Q139 -22 134 -8 Z" fill="${CORAL}" opacity="0.45"/><circle cx="100" cy="20" r="4" fill="${INK}"/><circle cx="118" cy="20" r="4" fill="${INK}"/><circle cx="109" cy="31" r="4" fill="${CORAL}"/><circle cx="4" cy="44" r="12" fill="#fffaf4" ${ln}/>`);
  return g(`<ellipse cx="60" cy="40" rx="64" ry="36" fill="${ORANGE}" ${ln}/><ellipse cx="60" cy="52" rx="34" ry="16" fill="#ffc98a"/><circle cx="118" cy="22" r="30" fill="${ORANGE}" ${ln}/><path d="M98 0 L104 -22 L120 -2 Z M138 0 L146 -22 L128 -2 Z" fill="${ORANGE}" ${ln}/><circle cx="110" cy="20" r="4" fill="${INK}"/><circle cx="128" cy="20" r="4" fill="${INK}"/><path d="M20 70 l-8 22 M70 72 l-4 22 M104 60 l10 20" stroke="${ORANGE}" stroke-width="8" stroke-linecap="round"/>`);
}

export function item(kind: FormatItem, x: number, y: number): string {
  if (kind === "candy") return `<g transform="translate(${x},${y - 40}) rotate(-20)"><rect x="0" y="0" width="90" height="44" rx="22" fill="${CORAL}" ${ln}/><path d="M0 10 L-22 -4 L-22 48 L0 34 Z M90 10 L112 -4 L112 48 L90 34 Z" fill="${CORAL}" ${ln}/><path d="M24 6 l8 32 M48 6 l8 32" stroke="#fff" stroke-width="5" opacity="0.7"/></g>`;
  if (kind === "asteroid") return `<path d="M${x} ${y - 40} l40 -30 l50 10 l20 40 l-30 40 l-50 5 l-35 -30 Z" fill="#a89a8e" ${ln}/>`;
  if (kind === "carrot") return `<g transform="translate(${x},${y - 90}) rotate(30)"><path d="M0 0 Q20 -6 40 0 L20 110 Z" fill="${ORANGE}" ${ln}/><path d="M8 -4 Q0 -30 4 -36 Q14 -20 20 -8 Q26 -34 32 -40 Q36 -18 34 -4 Z" fill="${MINT}" ${ln}/></g>`;
  return `<path d="M${x} ${y} L${x + 120} ${y} L${x + 60} ${y - 94} Z" fill="#ffc96b" ${ln}/><path d="M${x + 4} ${y} L${x + 116} ${y} L${x + 108} ${y - 14} L${x + 12} ${y - 14} Z" fill="#e0902e"/><circle cx="${x + 45}" cy="${y - 39}" r="9" fill="${CORAL}"/><circle cx="${x + 76}" cy="${y - 52}" r="9" fill="${CORAL}"/>`;
}

const sparkle = (sx: number, sy: number, r = 12, c = YELLOW) => `<path d="M${sx} ${sy - r} Q${sx + r * 0.18} ${sy - r * 0.18} ${sx + r} ${sy} Q${sx + r * 0.18} ${sy + r * 0.18} ${sx} ${sy + r} Q${sx - r * 0.18} ${sy + r * 0.18} ${sx - r} ${sy} Q${sx - r * 0.18} ${sy - r * 0.18} ${sx} ${sy - r} Z" fill="${c}"/>`;

/** A game window: a rounded screen floating on a soft shadow. */
function scene(x: number, y: number, w: number, h: number, o: { hero?: FormatHero; item?: FormatItem; heroX?: number; fast?: boolean; badge?: string; badgeBad?: boolean; id: string }): string {
  const kind = o.hero ?? "cat";
  const sky = kind === "ghost" || kind === "rocket" ? "url(#knight)" : "url(#ksky)";
  const hx = x + w * (o.heroX ?? 0.2);
  const speed = o.fast ? [0, 1, 2, 3].map((i) => `<path d="M${hx - 20 - i * 30} ${y + h - 130 + i * 20} h-${110 + i * 20}" stroke="${PAPER}" stroke-width="${8 - i}" stroke-linecap="round" opacity="${0.9 - i * 0.18}"/>`).join("") : "";
  const lift = kind === "bunny" ? 68 : kind === "ghost" ? 64 : kind === "rocket" ? 120 : 84;
  return `${soft(x, y, w, h, PAPER, 30, 0.2)}<clipPath id="c${o.id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30"/></clipPath><g clip-path="url(#c${o.id})">
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${sky}"/><ellipse cx="${x + w * 0.3}" cy="${y + h - 30}" rx="${w * 0.6}" ry="60" fill="url(#kgrass)"/><ellipse cx="${x + w * 0.85}" cy="${y + h - 22}" rx="${w * 0.45}" ry="50" fill="#25b877" opacity="0.55"/><rect x="${x}" y="${y + h - 26}" width="${w}" height="26" fill="url(#kgrass)"/>
${sparkle(x + 48, y + 44)}${sparkle(x + w * 0.52, y + 34, 9)}${sparkle(x + w * 0.72, y + 70, 7, "#ffffff")}
<g transform="translate(${x + w - 130},${y + h - 40}) scale(0.8)">${item(o.item ?? "pizza", 0, 0)}</g>
${speed}<g transform="translate(${hx},${y + h - 40 - lift}) scale(0.85)">${hero(kind, 0, 0, o.fast ? -6 : 0)}</g>
${o.badge ? `<rect x="${x + w - 196}" y="${y + 18}" width="176" height="44" rx="22" fill="${o.badgeBad ? CORAL : "#2a1d12"}"/>${text(x + w - 108, y + 48, o.badge, { f: "JetBrains Mono", w: 700, s: 22, c: "#fff", a: "middle" })}` : ""}
</g>`;
}

/**
 * Pip, CodeIt's mascot, as on the CodeIt Instagram: a round orange character
 * with a three-feather tuft, big navy eyes with a white shine, navy brows, an
 * open smile, and a yellow hoodie whose drawstrings end in navy tips. Flat,
 * no outlines. (cx, cy) is the centre of the head; r its radius.
 */
export function pip(cx: number, cy: number, r: number, pose: "think" | "type" | "jump" | "cheer" = "think"): string {
  const NAVY = "#1d2654", OR = "#ff6b1a", OR_D = "#e85a10", YE = "#ffd23f", YE_D = "#f1b91f";
  const up = pose === "cheer" || pose === "jump";
  const look = pose === "think" ? r * 0.06 : 0;
  const down = pose === "type" ? r * 0.08 : 0;
  const tuft = `<path d="M${cx - r * 0.34} ${cy - r * 0.8} Q${cx - r * 0.5} ${cy - r * 1.28} ${cx - r * 0.12} ${cy - r * 1.36} Q${cx - r * 0.2} ${cy - r * 1.1} ${cx - r * 0.06} ${cy - r * 0.94} Z" fill="${OR}"/>
<path d="M${cx - r * 0.12} ${cy - r * 0.9} Q${cx - r * 0.06} ${cy - r * 1.5} ${cx + r * 0.32} ${cy - r * 1.42} Q${cx + r * 0.14} ${cy - r * 1.2} ${cx + r * 0.16} ${cy - r * 0.92} Z" fill="${OR}"/>
<path d="M${cx + r * 0.1} ${cy - r * 0.92} Q${cx + r * 0.36} ${cy - r * 1.28} ${cx + r * 0.62} ${cy - r * 1.12} Q${cx + r * 0.4} ${cy - r * 1.02} ${cx + r * 0.36} ${cy - r * 0.8} Z" fill="${OR_D}"/>`;
  const hand = (hx: number, hy: number) => `<circle cx="${hx}" cy="${hy}" r="${r * 0.17}" fill="${OR}"/>`;
  const sleeve = (x1: number, y1: number, x2: number, y2: number) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${YE}" stroke-width="${r * 0.3}" stroke-linecap="round"/>`;
  const arms = up
    ? `${sleeve(cx - r * 0.7, cy + r * 0.75, cx - r * 1.05, cy + r * 0.05)}${hand(cx - r * 1.08, cy - r * 0.08)}${sleeve(cx + r * 0.7, cy + r * 0.75, cx + r * 1.05, cy + r * 0.05)}${hand(cx + r * 1.08, cy - r * 0.08)}`
    : pose === "type"
      ? `${sleeve(cx - r * 0.7, cy + r * 0.8, cx - r * 0.4, cy + r * 1.1)}${hand(cx - r * 0.32, cy + r * 1.16)}${sleeve(cx + r * 0.7, cy + r * 0.8, cx + r * 0.4, cy + r * 1.1)}${hand(cx + r * 0.32, cy + r * 1.16)}`
      : `${sleeve(cx - r * 0.74, cy + r * 0.78, cx - r * 0.84, cy + r * 1.16)}${hand(cx - r * 0.84, cy + r * 1.22)}${sleeve(cx + r * 0.74, cy + r * 0.8, cx + r * 0.5, cy + r * 0.66)}${hand(cx + r * 0.42, cy + r * 0.6)}`;
  const eye = (ex: number) => `<ellipse cx="${ex}" cy="${cy - r * 0.12}" rx="${r * 0.23}" ry="${r * 0.27}" fill="#ffffff"/><circle cx="${ex + look}" cy="${cy - r * 0.08 + down}" r="${r * 0.15}" fill="${NAVY}"/><circle cx="${ex + look - r * 0.05}" cy="${cy - r * 0.14 + down}" r="${r * 0.05}" fill="#ffffff"/>`;
  const brow = (ex: number, tilt: number) => `<path d="M${ex - r * 0.14} ${cy - r * 0.46 + tilt} Q${ex} ${cy - r * 0.54} ${ex + r * 0.14} ${cy - r * 0.46 - tilt}" fill="none" stroke="${NAVY}" stroke-width="${r * 0.06}" stroke-linecap="round"/>`;
  const worried = pose === "think" ? r * 0.04 : 0;
  const mouth = up
    ? `<path d="M${cx - r * 0.28} ${cy + r * 0.22} Q${cx} ${cy + r * 0.74} ${cx + r * 0.28} ${cy + r * 0.22} Z" fill="${NAVY}"/><path d="M${cx - r * 0.14} ${cy + r * 0.5} Q${cx} ${cy + r * 0.4} ${cx + r * 0.14} ${cy + r * 0.5} Q${cx} ${cy + r * 0.6} ${cx - r * 0.14} ${cy + r * 0.5} Z" fill="#ff7a8a"/>`
    : pose === "think"
      ? `<path d="M${cx - r * 0.1} ${cy + r * 0.32} Q${cx} ${cy + r * 0.28} ${cx + r * 0.1} ${cy + r * 0.32}" fill="none" stroke="${NAVY}" stroke-width="${r * 0.06}" stroke-linecap="round"/>`
      : `<path d="M${cx - r * 0.16} ${cy + r * 0.26} Q${cx} ${cy + r * 0.44} ${cx + r * 0.16} ${cy + r * 0.26} Z" fill="${NAVY}"/>`;
  return `<g>
<ellipse cx="${cx}" cy="${cy + r * 1.42}" rx="${r * 0.85}" ry="${r * 0.1}" fill="${BROWN}" opacity="0.12"/>
${tuft}
<path d="M${cx - r * 0.86} ${cy + r * 0.62} Q${cx - r * 0.95} ${cy + r * 1.36} ${cx} ${cy + r * 1.38} Q${cx + r * 0.95} ${cy + r * 1.36} ${cx + r * 0.86} ${cy + r * 0.62} Z" fill="${YE}"/>
<ellipse cx="${cx}" cy="${cy}" rx="${r * 0.92}" ry="${r}" fill="${OR}"/>
<ellipse cx="${cx - r * 0.34}" cy="${cy - r * 0.6}" rx="${r * 0.26}" ry="${r * 0.14}" fill="#ffffff" opacity="0.16" transform="rotate(-25 ${cx - r * 0.34} ${cy - r * 0.6})"/>
<path d="M${cx - r * 0.84} ${cy + r * 0.52} Q${cx} ${cy + r * 0.98} ${cx + r * 0.84} ${cy + r * 0.52} Q${cx + r * 0.9} ${cy + r * 0.78} ${cx + r * 0.7} ${cy + r * 0.92} Q${cx} ${cy + r * 1.2} ${cx - r * 0.7} ${cy + r * 0.92} Q${cx - r * 0.9} ${cy + r * 0.78} ${cx - r * 0.84} ${cy + r * 0.52} Z" fill="${YE_D}"/>
<path d="M${cx - r * 0.2} ${cy + r * 0.95} L${cx - r * 0.24} ${cy + r * 1.24} M${cx + r * 0.2} ${cy + r * 0.95} L${cx + r * 0.24} ${cy + r * 1.24}" stroke="#ffffff" stroke-width="${r * 0.04}" stroke-linecap="round"/>
<circle cx="${cx - r * 0.24}" cy="${cy + r * 1.27}" r="${r * 0.06}" fill="${NAVY}"/><circle cx="${cx + r * 0.24}" cy="${cy + r * 1.27}" r="${r * 0.06}" fill="${NAVY}"/>
${arms}
${eye(cx - r * 0.33)}${eye(cx + r * 0.33)}${brow(cx - r * 0.33, worried)}${brow(cx + r * 0.33, -worried)}
<circle cx="${cx - r * 0.62}" cy="${cy + r * 0.14}" r="${r * 0.1}" fill="#ff8f7a" opacity="0.55"/><circle cx="${cx + r * 0.62}" cy="${cy + r * 0.14}" r="${r * 0.1}" fill="#ff8f7a" opacity="0.55"/>
${mouth}</g>`;
}

const laptop = (x: number, y: number, w: number, code?: string) => {
  const h = w * 0.62;
  return `${soft(x, y, w, h, "url(#kcode)", 16, 0.25)}${code ? mono(x + 20, y + h * 0.56, code, Math.min(24, (w - 40) / (0.62 * code.length)), MINT) : ""}<rect x="${x - 18}" y="${y + h}" width="${w + 36}" height="16" rx="8" fill="#8a7563"/>`;
};

/** The body of a creative card under the shared header. */
export function formatSvg(eyebrow: string, headline: string, sub: string, f: CardFormat): string {
  let body = "";
  switch (f.kind) {
    case "split": {
      const sw = W - PAD * 2, sh = 260;
      const row = (y: number, part: SplitSide, second: boolean, id: string) => {
        const fast = part.fast ?? (part.badge ? false : second);
        const badge = part.badge ? `${soft(W / 2 - 100, y + 22, 200, 58, second ? "url(#korange)" : PAPER, 29, 0.18)}${text(W / 2, y + 62, part.badge, { f: "JetBrains Mono", w: 700, s: 28, c: second ? "#fff" : BROWN, a: "middle" })}` : "";
        return `${scene(PAD, y, sw, sh, { hero: f.hero, item: f.item, heroX: fast ? 0.56 : part.badge && second ? 0.4 : 0.08, fast, id })}${chip(PAD + 22, y + 22, part.code, 32)}${badge}${pill(W - PAD - 22 - pillWidth(part.caption) / 2, y + 22, part.caption, second, 28)}`;
      };
      body = `${row(258, f.top, false, "a")}
<circle cx="${W / 2}" cy="${566}" r="38" fill="url(#korange)"/>${text(W / 2, 579, "vs", { f: "Baloo 2", w: 700, s: 36, c: "#fff", a: "middle" })}
${row(612, f.bottom, true, "b")}
${head(PAD, 980, f.note ?? "Same game. One number changed.", 40)}`;
      break;
    }
    case "bug": {
      const codeW = W - PAD * 2 - 456, longest = Math.max(...f.code.map((c) => c.length));
      body = `${scene(PAD, 258, 420, 280, { hero: f.hero, item: f.item, heroX: 0.18, badge: f.symptom, badgeBad: true, id: "bug" })}
${soft(PAD + 456, 258, codeW, 280, "url(#kcode)", 30, 0.3)}<circle cx="${PAD + 490}" cy="${290}" r="8" fill="#ff5f57"/><circle cx="${PAD + 516}" cy="${290}" r="8" fill="#febc2e"/><circle cx="${PAD + 542}" cy="${290}" r="8" fill="#28c840"/>
${f.code.map((l, i) => `${mono(PAD + 490, 362 + i * 58, String(i + 1), 24, "#7d6a58")}${mono(PAD + 528, 362 + i * 58, l, Math.min(30, (codeW - 80) / (0.62 * longest)), MINT)}`).join("")}
${soft(PAD, 584, W - PAD * 2, 300, PAPER, 36)}${head(W / 2, 660, f.question, 46, BROWN, "middle")}
${f.code.map((_, i, a) => { const n = a.length, gw = (W - PAD * 2 - 80 - (n - 1) * 24) / n, gx = PAD + 40 + i * (gw + 24); return `<rect x="${gx}" y="712" width="${gw}" height="116" rx="28" fill="#fff1e2"/>${text(gx + gw / 2, 785, `Line ${i + 1}`, { f: "Baloo 2", w: 700, s: 42, a: "middle" })}`; }).join("")}
${text(W / 2, 940, "Comment your answer. It's in tomorrow's story.", { w: 800, s: 30, c: ORANGE_T, a: "middle" })}`;
      break;
    }
    case "comic": {
      const pw = (W - PAD * 2 - 28) / 2, ph = 336;
      const tints = [PAPER, "#fff3e6", "#ecfbf3", "#fff8de"];
      body = f.panels.slice(0, 4).map((p, i) => {
        const x = PAD + (i % 2) * (pw + 28), y = 252 + Math.floor(i / 2) * (ph + 28);
        const cx = x + pw * 0.3, cy = y + ph * 0.6;
        const jumps = p.pose === "jump" ? Array.from({ length: p.jumps ?? 3 }, (_, k) => `<path d="M${x + 40 + k * 80} ${y + ph - 50} q40 -${90 + k * 10} 80 0" fill="none" stroke="${ORANGE}" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12"/>`).join("") : "";
        const prop = p.pose === "type" ? laptop(x + pw - 244, y + ph - 196, 214, p.code) : p.code ? chip(x + pw - 24 - chipWidth(p.code, 22), y + ph - 84, p.code, 22) : "";
        const px = p.pose === "type" ? x + 100 : cx, py = p.pose === "jump" ? cy - 40 : cy;
        return `${soft(x, y, pw, ph, tints[i]!, 30, 0.14)}<circle cx="${x + 38}" cy="${y + 38}" r="18" fill="url(#korange)"/>${text(x + 38, y + 47, `${i + 1}`, { f: "Baloo 2", w: 700, s: 24, c: "#fff", a: "middle" })}${jumps}${pip(px, py, 60, p.pose)}${prop}${p.bubble ? bubble(x + pw * 0.4, y + 22, pw * 0.56, p.bubble, cx + 36, cy - 66, 28) : ""}${text(x + pw / 2, y + ph - 18, p.caption, { w: 800, s: 22, c: BROWN, a: "middle", op: 0.7 })}`;
      }).join("");
      break;
    }
    case "cheat": {
      const ox = PAD + 228, oy = 470;
      const obj = f.object === "jar"
        ? `<rect x="${ox - 110}" y="${oy - 140}" width="220" height="38" rx="14" fill="${CORAL}"/><path d="M${ox - 100} ${oy - 102} h200 v220 q0 44 -44 44 h-112 q-44 0 -44 -44 z" fill="#e8f5ff"/><path d="M${ox - 80} ${oy - 90} v200" stroke="#ffffff" stroke-width="14" stroke-linecap="round" opacity="0.8"/><rect x="${ox - 70}" y="${oy - 40}" width="140" height="64" rx="14" fill="${PAPER}"/>${mono(ox, oy + 2, "score", 28, BROWN, "middle")}${[0, 1, 2].map((k) => `<circle cx="${ox - 50 + k * 50}" cy="${oy + 104}" r="18" fill="${YELLOW}"/>`).join("")}`
        : f.object === "loop"
          ? `<circle cx="${ox}" cy="${oy}" r="120" fill="none" stroke="url(#korange)" stroke-width="24" stroke-linecap="round" stroke-dasharray="640 120"/><path d="M${ox + 100} ${oy - 108} l36 18 l-30 26 z" fill="${ORANGE}"/>${text(ox, oy + 26, "×3", { f: "Baloo 2", w: 700, s: 84, a: "middle" })}`
          : `<path d="M${ox} ${oy + 150} V${oy} M${ox} ${oy} L${ox - 110} ${oy - 130} M${ox} ${oy} L${ox + 110} ${oy - 130}" stroke="${BROWN}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.85"/><rect x="${ox - 190}" y="${oy - 196}" width="150" height="58" rx="29" fill="${MINT}"/>${text(ox - 115, oy - 156, "yes", { w: 800, s: 28, a: "middle" })}<rect x="${ox + 40}" y="${oy - 196}" width="150" height="58" rx="29" fill="${CORAL}"/>${text(ox + 115, oy - 156, "no", { w: 800, s: 28, c: "#fff", a: "middle" })}`;
      body = `${soft(PAD, 256, 456, 430, PAPER, 40)}${obj}
${text(580, 322, "IT'S LIKE", { w: 800, s: 24, c: ORANGE_T, ls: 4 })}${f.like.split("\n").map((l, i) => head(580, 392 + i * 60, l, 56)).join("")}
${soft(PAD, 716, W - PAD * 2, 56 + f.lines.length * 56, PAPER, 32, 0.12)}${f.lines.map((l, i) => `<circle cx="${PAD + 40}" cy="${762 + i * 56}" r="9" fill="${ORANGE}"/>${text(PAD + 66, 773 + i * 56, l, { w: 700, s: 31 })}`).join("")}
${chip(PAD, 716 + 56 + f.lines.length * 56 + 30, f.code, 32)}`;
      break;
    }
    case "guess": {
      const size = Math.min(40, Math.floor((W - PAD * 2 - 140) / (0.6 * Math.max(...f.code.map((l) => l.length)))));
      const lh = size * 1.55, h = 100 + f.code.length * lh;
      body = `${soft(PAD, 252, W - PAD * 2, h, "url(#kcode)", 36, 0.3)}<circle cx="${PAD + 42}" cy="290" r="10" fill="#ff5f57"/><circle cx="${PAD + 72}" cy="290" r="10" fill="#febc2e"/><circle cx="${PAD + 102}" cy="290" r="10" fill="#28c840"/>${mono(W / 2, 298, "mystery.py", 24, "#b9a590", "middle")}
${f.code.map((l, i) => `${mono(PAD + 40, 360 + i * lh + size * 0.4, String(i + 1), size * 0.6, "#7d6a58")}${mono(PAD + 88, 360 + i * lh + size * 0.4, l, size, l.trim().startsWith("#") ? "#9c8670" : MINT)}`).join("")}
${f.options.slice(0, 4).map((o, i) => { const gw = (W - PAD * 2 - 24) / 2, gx = PAD + (i % 2) * (gw + 24), gy = 704 + Math.floor(i / 2) * 106; return `${soft(gx, gy, gw, 86, PAPER, 43, 0.12)}<circle cx="${gx + 44}" cy="${gy + 43}" r="27" fill="url(#korange)"/>${text(gx + 44, gy + 55, "ABCD"[i]!, { f: "Baloo 2", w: 700, s: 32, c: "#fff", a: "middle" })}${text(gx + 88, gy + 55, o, { w: 800, s: 32 })}`; }).join("")}
${text(W / 2, 948, f.hint, { w: 800, s: 28, c: ORANGE_T, a: "middle" })}`;
      break;
    }
    case "ask": {
      body = `${pip(232, 600, 118, "cheer")}
${bubble(400, 262, 610, f.prompt, 330, 470, 34)}
${soft(400, 560, 610, 112, PAPER, 30, 0.14)}${text(432, 628, f.example, { w: 700, s: 32 })}<rect x="${444 + Math.min(540, f.example.length * 16)}" y="592" width="4" height="48" rx="2" fill="${ORANGE}"/>
${text(404, 718, "EXAMPLE COMMENT", { w: 800, s: 20, c: ORANGE_T, ls: 4 })}
${pill(W / 2, 806, f.promise, true, 34)}
${text(W / 2, 950, "Comment below. Kids' ideas only, no names needed.", { w: 800, s: 28, c: BROWN, a: "middle", op: 0.7 })}`;
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${backdrop()}${header(eyebrow, headline, sub)}${body}${footer()}</svg>`;
}
