/**
 * Creative CodeIt feed formats, drawn in the website's own system (cream,
 * brown, orange, Baloo 2, Nunito, JetBrains Mono). Each is a 1080×1080
 * card under the same header as the step cards, so the grid stays one
 * family while the formats vary:
 *
 * - split:  one line of code, two games (the same game with one value changed)
 * - bug:    bug hunt — a broken game, its code, "which line is the bug?"
 * - comic:  a four-panel Pip strip that teaches one idea
 * - cheat:  a parent cheat sheet — one coding word explained with a kitchen object
 * - guess:  guess the game from four lines of code
 * - ask:    "you send it, we build it" — a call for game ideas
 */
export type FormatHero = "cat" | "ghost" | "rocket" | "bunny";
export type FormatItem = "pizza" | "candy" | "asteroid" | "carrot";

export type CardFormat =
  | { kind: "split"; top: { code: string; caption: string }; bottom: { code: string; caption: string }; hero?: FormatHero; item?: FormatItem }
  | { kind: "bug"; hero?: FormatHero; item?: FormatItem; symptom: string; code: string[]; question: string }
  | { kind: "comic"; panels: { caption: string; pose: "think" | "type" | "jump" | "cheer"; bubble?: string; code?: string; jumps?: number }[] }
  | { kind: "cheat"; word: string; like: string; object: "jar" | "loop" | "fork"; lines: string[]; code: string }
  | { kind: "guess"; code: string[]; options: string[]; hint: string }
  | { kind: "ask"; prompt: string; example: string; promise: string };

const W = 1080;
const PAD = 72;
const CREAM = "#fff4e5", BROWN = "#35220e", ORANGE = "#ff7a00", ORANGE_T = "#d46500", YELLOW = "#f5d04a", DARK = "#2b1d12", MINT = "#3ddc97", MINT_T = "#1a7a50", CORAL = "#ff5a5f", SKY = "#bfe3ff", NIGHT = "#2a2b5a", PAPER = "#ffffff";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
type TO = { f?: string; w?: number; s?: number; c?: string; a?: "start" | "middle" | "end"; ls?: number; op?: number };
const text = (x: number, y: number, t: string, o: TO = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.f ?? "Nunito"}" font-weight="${o.w ?? 700}" font-size="${o.s ?? 36}" fill="${o.c ?? BROWN}" text-anchor="${o.a ?? "start"}" letter-spacing="${o.ls ?? 0}" opacity="${o.op ?? 1}" xml:space="preserve">${esc(t)}</text>`;
const head = (x: number, y: number, t: string, s: number, c = BROWN, a: "start" | "middle" = "start") => text(x, y, t, { f: "Baloo 2", w: 700, s, c, a });
const mono = (x: number, y: number, t: string, s: number, c: string, a: "start" | "middle" = "start") => text(x, y, t, { f: "JetBrains Mono", w: 500, s, c, a });
const card = (x: number, y: number, w: number, h: number, fill = CREAM, r = 28) =>
  `<rect x="${x + 8}" y="${y + 8}" width="${w}" height="${h}" rx="${r}" fill="${DARK}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${DARK}" stroke-width="4"/>`;
const chip = (x: number, y: number, t: string, fill = DARK, c = MINT, s = 30) => {
  const w = t.length * s * 0.62 + 44;
  return `<rect x="${x}" y="${y}" width="${w}" height="${s + 30}" rx="14" fill="${fill}" stroke="${DARK}" stroke-width="3"/>${mono(x + 22, y + s + 6, t, s, c)}`;
};
const pillText = (cx: number, y: number, t: string, fill: string, c: string, s = 28) => {
  const w = t.length * s * 0.56 + 56;
  return `<rect x="${cx - w / 2 + 5}" y="${y + 5}" width="${w}" height="${s + 32}" rx="${(s + 32) / 2}" fill="${DARK}"/><rect x="${cx - w / 2}" y="${y}" width="${w}" height="${s + 32}" rx="${(s + 32) / 2}" fill="${fill}" stroke="${DARK}" stroke-width="4"/>${text(cx, y + s + 6, t, { w: 800, s, c, a: "middle" })}`;
};

function hero(kind: FormatHero, x: number, y: number, tilt = -16): string {
  const g = (inner: string) => `<g transform="translate(${x},${y}) rotate(${tilt})">${inner}</g>`;
  if (kind === "ghost") return g(`<path d="M0 60 L0 20 Q0 -20 50 -20 Q100 -20 100 20 L100 60 L84 48 L68 60 L50 48 L34 60 L16 48 Z" fill="#fff8f0" stroke="${DARK}" stroke-width="3"/><circle cx="36" cy="18" r="6" fill="${DARK}"/><circle cx="64" cy="18" r="6" fill="${DARK}"/>`);
  if (kind === "rocket") return g(`<path d="M50 -30 Q90 20 70 80 L30 80 Q10 20 50 -30 Z" fill="#fff8f0" stroke="${DARK}" stroke-width="3"/><circle cx="50" cy="20" r="12" fill="${SKY}" stroke="${DARK}" stroke-width="3"/><path d="M30 60 L8 84 L34 80 Z M70 60 L92 84 L66 80 Z" fill="${CORAL}" stroke="${DARK}" stroke-width="3"/>`);
  if (kind === "bunny") return g(`<ellipse cx="56" cy="46" rx="54" ry="34" fill="#fff8f0" stroke="${DARK}" stroke-width="3"/><circle cx="108" cy="24" r="30" fill="#fff8f0" stroke="${DARK}" stroke-width="3"/><path d="M96 -2 L92 -52 L114 -8 Z M124 -2 L136 -52 L142 -6 Z" fill="#fff8f0" stroke="${DARK}" stroke-width="3"/><circle cx="100" cy="20" r="4" fill="${DARK}"/><circle cx="118" cy="20" r="4" fill="${DARK}"/>`);
  return g(`<ellipse cx="60" cy="40" rx="64" ry="36" fill="${ORANGE}" stroke="${DARK}" stroke-width="3"/><ellipse cx="60" cy="52" rx="34" ry="16" fill="#ffc98a" opacity="0.9"/><circle cx="118" cy="22" r="30" fill="${ORANGE}" stroke="${DARK}" stroke-width="3"/><path d="M98 0 L104 -22 L120 -2 Z M138 0 L146 -22 L128 -2 Z" fill="${ORANGE}" stroke="${DARK}" stroke-width="3"/><circle cx="110" cy="20" r="4" fill="${DARK}"/><circle cx="128" cy="20" r="4" fill="${DARK}"/><path d="M20 70 l-8 22 M70 72 l-4 22 M104 60 l10 20" stroke="${DARK}" stroke-width="8" stroke-linecap="round"/><path d="M20 70 l-8 22 M70 72 l-4 22 M104 60 l10 20" stroke="${ORANGE}" stroke-width="4" stroke-linecap="round"/>`);
}

function item(kind: FormatItem, x: number, y: number): string {
  if (kind === "candy") return `<g transform="translate(${x},${y - 40}) rotate(-20)"><rect x="0" y="0" width="90" height="44" rx="22" fill="${CORAL}" stroke="${DARK}" stroke-width="3"/><path d="M0 10 L-22 -4 L-22 48 L0 34 Z M90 10 L112 -4 L112 48 L90 34 Z" fill="${CORAL}" stroke="${DARK}" stroke-width="3"/></g>`;
  if (kind === "asteroid") return `<path d="M${x} ${y - 40} l40 -30 l50 10 l20 40 l-30 40 l-50 5 l-35 -30 Z" fill="#9a8d82" stroke="${DARK}" stroke-width="3"/>`;
  if (kind === "carrot") return `<g transform="translate(${x},${y - 90}) rotate(30)"><path d="M0 0 L40 0 L20 110 Z" fill="${ORANGE}" stroke="${DARK}" stroke-width="3"/><path d="M8 -4 L0 -36 L20 -10 L30 -40 L34 -4 Z" fill="${MINT}" stroke="${DARK}" stroke-width="3"/></g>`;
  return `<path d="M${x} ${y} L${x + 120} ${y} L${x + 60} ${y - 94} Z" fill="#ffc96b" stroke="${DARK}" stroke-width="3"/><path d="M${x} ${y} L${x + 120} ${y} L${x + 110} ${y - 16} L${x + 10} ${y - 16} Z" fill="#e0902e" stroke="${DARK}" stroke-width="3"/><circle cx="${x + 45}" cy="${y - 39}" r="9" fill="${CORAL}" stroke="${DARK}" stroke-width="2"/><circle cx="${x + 78}" cy="${y - 54}" r="9" fill="${CORAL}" stroke="${DARK}" stroke-width="2"/>`;
}

const star = (sx: number, sy: number) => `<path d="M${sx} ${sy} l6 14 15 1 -12 9 5 15 -14 -9 -14 9 5 -15 -12 -9 15 -1z" fill="${YELLOW}" stroke="${DARK}" stroke-width="2"/>`;

/** A game window: sky, ground, the hero at `heroX` (0–1), optional speed lines and an alert badge. */
function scene(x: number, y: number, w: number, h: number, o: { hero?: FormatHero; item?: FormatItem; heroX?: number; fast?: boolean; badge?: string; badgeBad?: boolean; id: string }): string {
  const kind = o.hero ?? "cat";
  const sky = kind === "ghost" || kind === "rocket" ? NIGHT : SKY;
  const hx = x + w * (o.heroX ?? 0.2);
  const speed = o.fast ? [0, 1, 2, 3].map((i) => `<path d="M${hx - 20 - i * 30} ${y + h - 130 + i * 20} h-${110 + i * 20}" stroke="${PAPER}" stroke-width="${8 - i}" stroke-linecap="round" opacity="${0.9 - i * 0.18}"/>`).join("") : "";
  return `${card(x - 14, y - 14, w + 28, h + 28, DARK, 26)}<clipPath id="c${o.id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/></clipPath><g clip-path="url(#c${o.id})">
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${sky}"/><rect x="${x}" y="${y + h - 46}" width="${w}" height="46" fill="${MINT}"/><rect x="${x}" y="${y + h - 16}" width="${w}" height="16" fill="${MINT_T}" opacity="0.5"/>
${star(x + 40, y + 30)}${star(x + w * 0.5, y + 22)}
<g transform="translate(${x + w - 130},${y + h - 46}) scale(0.8)">${item(o.item ?? "pizza", 0, 0)}</g>
${speed}<g transform="translate(${hx},${y + h - 46 - 84}) scale(0.85)">${hero(kind, 0, 0, o.fast ? -6 : 0)}</g>
${o.badge ? `<rect x="${x + w - 190}" y="${y + 14}" width="176" height="42" rx="12" fill="${o.badgeBad ? CORAL : DARK}"/>${text(x + w - 102, y + 43, o.badge, { f: "JetBrains Mono", w: 700, s: 22, c: "#fff", a: "middle" })}` : ""}
</g>`;
}

/** Pip, CodeIt's mascot, drawn flat: a round orange fluff ball in a yellow hoodie. */
function pip(cx: number, cy: number, r: number, pose: "think" | "type" | "jump" | "cheer" = "think"): string {
  const fluff = Array.from({ length: 18 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 18;
    return `<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.95).toFixed(1)}" r="${(r * 0.2).toFixed(1)}" fill="${ORANGE}"/>`;
  }).join("");
  const armUp = pose === "cheer" || pose === "jump";
  const arms = armUp
    ? `<path d="M${cx - r * 0.85} ${cy + r * 0.2} q-${r * 0.35} -${r * 0.5} -${r * 0.25} -${r * 0.85} M${cx + r * 0.85} ${cy + r * 0.2} q${r * 0.35} -${r * 0.5} ${r * 0.25} -${r * 0.85}" stroke="${DARK}" stroke-width="${r * 0.16}" stroke-linecap="round" fill="none"/><path d="M${cx - r * 0.85} ${cy + r * 0.2} q-${r * 0.35} -${r * 0.5} -${r * 0.25} -${r * 0.85} M${cx + r * 0.85} ${cy + r * 0.2} q${r * 0.35} -${r * 0.5} ${r * 0.25} -${r * 0.85}" stroke="${YELLOW}" stroke-width="${r * 0.09}" stroke-linecap="round" fill="none"/>`
    : `<path d="M${cx - r * 0.8} ${cy + r * 0.45} q-${r * 0.2} ${r * 0.3} ${r * 0.1} ${r * 0.45} M${cx + r * 0.8} ${cy + r * 0.45} q${r * 0.2} ${r * 0.3} -${r * 0.1} ${r * 0.45}" stroke="${DARK}" stroke-width="${r * 0.16}" stroke-linecap="round" fill="none"/><path d="M${cx - r * 0.8} ${cy + r * 0.45} q-${r * 0.2} ${r * 0.3} ${r * 0.1} ${r * 0.45} M${cx + r * 0.8} ${cy + r * 0.45} q${r * 0.2} ${r * 0.3} -${r * 0.1} ${r * 0.45}" stroke="${YELLOW}" stroke-width="${r * 0.09}" stroke-linecap="round" fill="none"/>`;
  const eyeDy = pose === "type" ? r * 0.12 : 0;
  const lookX = pose === "think" ? r * 0.08 : 0;
  const mouth = pose === "cheer" || pose === "jump" ? `<path d="M${cx - r * 0.22} ${cy + r * 0.08} q${r * 0.22} ${r * 0.3} ${r * 0.44} 0 z" fill="${DARK}"/>` : pose === "think" ? `<path d="M${cx - r * 0.12} ${cy + r * 0.14} h${r * 0.26}" stroke="${DARK}" stroke-width="${r * 0.06}" stroke-linecap="round"/>` : `<path d="M${cx - r * 0.16} ${cy + r * 0.12} q${r * 0.16} ${r * 0.14} ${r * 0.32} 0" fill="none" stroke="${DARK}" stroke-width="${r * 0.06}" stroke-linecap="round"/>`;
  return `<g>
<circle cx="${cx}" cy="${cy}" r="${r * 1.02}" fill="${DARK}"/>${fluff}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ORANGE}" stroke="${DARK}" stroke-width="4"/>
<path d="M${cx - r * 0.97} ${cy + r * 0.25} Q${cx} ${cy + r * 0.5} ${cx + r * 0.97} ${cy + r * 0.25} A${r} ${r} 0 0 1 ${cx - r * 0.97} ${cy + r * 0.25} Z" fill="${YELLOW}" stroke="${DARK}" stroke-width="4"/>
<path d="M${cx - r * 0.78} ${cy + r * 0.36} Q${cx} ${cy + r * 0.62} ${cx + r * 0.78} ${cy + r * 0.36}" fill="none" stroke="#e0b52e" stroke-width="${r * 0.12}" stroke-linecap="round"/>
<rect x="${cx - r * 0.36}" y="${cy + r * 0.62}" width="${r * 0.72}" height="${r * 0.24}" rx="${r * 0.1}" fill="#e8c23a" stroke="${DARK}" stroke-width="3"/>
<circle cx="${cx - r * 0.16}" cy="${cy + r * 0.56}" r="${r * 0.05}" fill="${PAPER}" stroke="${DARK}" stroke-width="2"/><circle cx="${cx + r * 0.16}" cy="${cy + r * 0.56}" r="${r * 0.05}" fill="${PAPER}" stroke="${DARK}" stroke-width="2"/>
${arms}
<ellipse cx="${cx - r * 0.34 + lookX}" cy="${cy - r * 0.22 + eyeDy}" rx="${r * 0.2}" ry="${r * 0.24}" fill="${PAPER}" stroke="${DARK}" stroke-width="3"/><ellipse cx="${cx + r * 0.34 + lookX}" cy="${cy - r * 0.22 + eyeDy}" rx="${r * 0.2}" ry="${r * 0.24}" fill="${PAPER}" stroke="${DARK}" stroke-width="3"/>
<circle cx="${cx - r * 0.3 + lookX * 2}" cy="${cy - r * 0.18 + eyeDy * 1.6}" r="${r * 0.09}" fill="${DARK}"/><circle cx="${cx + r * 0.38 + lookX * 2}" cy="${cy - r * 0.18 + eyeDy * 1.6}" r="${r * 0.09}" fill="${DARK}"/>
${mouth}</g>`;
}

const laptop = (x: number, y: number, w: number, code?: string) => `<rect x="${x}" y="${y}" width="${w}" height="${w * 0.62}" rx="12" fill="${DARK}" stroke="${DARK}" stroke-width="4"/><rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${w * 0.62 - 20}" rx="6" fill="#3a2a1c"/>${code ? mono(x + 22, y + w * 0.36, code, Math.min(22, (w - 40) / (0.62 * code.length)), MINT) : ""}<path d="M${x - 20} ${y + w * 0.62} h${w + 40} l-16 18 h-${w + 8} z" fill="#6b5846" stroke="${DARK}" stroke-width="4"/>`;
const bubble = (x: number, y: number, w: number, t: string, tailX: number, tailY: number) => {
  const lines = t.split("\n");
  const h = 34 + lines.length * 38;
  return `<path d="M${x + 20} ${y + h - 2} L${tailX} ${tailY} L${x + 70} ${y + h - 2}" fill="${PAPER}" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${PAPER}" stroke="${DARK}" stroke-width="4"/><rect x="${x + 22}" y="${y + h - 8}" width="46" height="10" fill="${PAPER}"/>${lines.map((l, i) => text(x + w / 2, y + 44 + i * 38, l, { f: "Baloo 2", w: 700, s: 30, a: "middle" })).join("")}`;
};

function header(eyebrow: string, headline: string, sub: string): string {
  return `<rect width="${W}" height="${W}" fill="${CREAM}"/>${text(270, 96, eyebrow.toUpperCase(), { w: 800, s: 26, c: ORANGE_T, ls: 5 })}${head(270, 150, headline, 54)}${head(270, 192, sub, 40, ORANGE)}`;
}
const footer = () => text(W - PAD, W - 28, "codeitlearn.com", { w: 800, s: 24, c: ORANGE_T, a: "end" });

/** The body of a creative card under the shared header. */
export function formatSvg(eyebrow: string, headline: string, sub: string, f: CardFormat): string {
  let body = "";
  switch (f.kind) {
    case "split": {
      const sw = W - PAD * 2 - 28, sh = 250;
      const row = (y: number, part: { code: string; caption: string }, fast: boolean, id: string) =>
        `${scene(PAD + 14, y, sw, sh, { hero: f.hero, item: f.item, heroX: fast ? 0.56 : 0.08, fast, id })}${chip(PAD + 34, y + 20, part.code, DARK, MINT, 32)}${pillText(W - PAD - 30 - (part.caption.length * 28 * 0.56 + 56) / 2, y + 20, part.caption, fast ? ORANGE : PAPER, fast ? "#fff" : BROWN, 28)}`;
      body = `${row(262, f.top, false, "a")}
<g transform="translate(${W / 2} 568)"><circle r="40" fill="${ORANGE}" stroke="${DARK}" stroke-width="4"/>${text(0, 14, "vs", { f: "Baloo 2", w: 700, s: 38, c: "#fff", a: "middle" })}</g>
${row(624, f.bottom, true, "b")}
${head(PAD, 978, "Same game. One number changed.", 40)}`;
      break;
    }
    case "bug": {
      body = `${scene(PAD + 14, 262, 400, 260, { hero: f.hero, item: f.item, heroX: 0.22, badge: f.symptom, badgeBad: true, id: "bug" })}
${card(PAD + 470, 248, W - PAD * 2 - 470, 288, DARK)}${f.code.map((l, i) => `${mono(PAD + 500, 306 + i * 56, String(i + 1), 26, "#8e7b69")}${mono(PAD + 540, 306 + i * 56, l, Math.min(30, (W - PAD * 2 - 470 - 100) / (0.62 * Math.max(...f.code.map((c) => c.length)))), "#fff4e5")}`).join("")}
${card(PAD, 580, W - PAD * 2, 300, PAPER)}${head(W / 2, 654, f.question, 44, BROWN, "middle")}
${f.code.map((_, i, a) => { const n = a.length, gw = (W - PAD * 2 - 80 - (n - 1) * 24) / n, gx = PAD + 40 + i * (gw + 24); return `<rect x="${gx + 6}" y="${716}" width="${gw}" height="110" rx="24" fill="${DARK}"/><rect x="${gx}" y="${710}" width="${gw}" height="110" rx="24" fill="${i % 2 ? CREAM : "#fff0e0"}" stroke="${DARK}" stroke-width="4"/>${text(gx + gw / 2, 785, `Line ${i + 1}`, { f: "Baloo 2", w: 700, s: 40, a: "middle" })}`; }).join("")}
${text(W / 2, 930, "Comment your answer. It's in tomorrow's story.", { w: 800, s: 30, c: ORANGE_T, a: "middle" })}`;
      break;
    }
    case "comic": {
      const pw = (W - PAD * 2 - 28) / 2, ph = 340;
      body = f.panels.slice(0, 4).map((p, i) => {
        const x = PAD + (i % 2) * (pw + 28), y = 250 + Math.floor(i / 2) * (ph + 28);
        const fill = [PAPER, "#fff0e0", "#eafaf2", "#fff7d6"][i]!;
        const cx = x + pw * 0.3, cy = y + ph * 0.6;
        const jumps = p.pose === "jump" ? Array.from({ length: p.jumps ?? 3 }, (_, k) => `<path d="M${x + 40 + k * 80} ${y + ph - 40} q40 -${90 + k * 10} 80 0" fill="none" stroke="${ORANGE}" stroke-width="5" stroke-dasharray="10 9"/>`).join("") : "";
        const prop = p.pose === "type" ? laptop(x + pw - 250, y + ph - 200, 220, p.code) : p.code ? chip(x + pw - 30 - (p.code.length * 22 * 0.62 + 44), y + ph - 80, p.code, DARK, MINT, 22) : "";
        return `${card(x, y, pw, ph, fill, 26)}${text(x + 24, y + 44, `${i + 1}`, { f: "Baloo 2", w: 700, s: 30, c: ORANGE_T })}${jumps}${pip(p.pose === "type" ? x + 110 : cx, p.pose === "jump" ? cy - 40 : cy, 62, p.pose)}${prop}${p.bubble ? bubble(x + pw * 0.42, y + 24, pw * 0.54, p.bubble, cx + 40, cy - 70) : ""}${text(x + pw / 2, y + ph - 16, p.caption, { w: 800, s: 22, c: BROWN, a: "middle", op: 0.75 })}`;
      }).join("");
      break;
    }
    case "cheat": {
      const obj = f.object === "jar"
        ? `<rect x="190" y="330" width="220" height="40" rx="10" fill="${CORAL}" stroke="${DARK}" stroke-width="4"/><path d="M200 370 h200 v230 q0 40 -40 40 h-120 q-40 0 -40 -40 z" fill="#eaf6ff" stroke="${DARK}" stroke-width="4"/><rect x="225" y="440" width="150" height="70" rx="10" fill="${PAPER}" stroke="${DARK}" stroke-width="3"/>${mono(300, 486, "score", 30, BROWN, "middle")}${[0, 1, 2].map((k) => `<circle cx="${250 + k * 50}" cy="580" r="18" fill="${YELLOW}" stroke="${DARK}" stroke-width="3"/>`).join("")}`
        : f.object === "loop"
          ? `<circle cx="300" cy="480" r="130" fill="none" stroke="${ORANGE}" stroke-width="22"/><path d="M420 420 l20 70 l-70 -10" fill="${ORANGE}" stroke="${DARK}" stroke-width="3"/>${text(300, 500, "×3", { f: "Baloo 2", w: 700, s: 80, a: "middle" })}`
          : `<path d="M300 640 V470 M300 470 L190 340 M300 470 L410 340" stroke="${BROWN}" stroke-width="20" stroke-linecap="round" fill="none"/><rect x="120" y="290" width="140" height="56" rx="12" fill="${MINT}" stroke="${DARK}" stroke-width="3"/>${text(190, 328, "yes", { w: 800, s: 28, a: "middle" })}<rect x="340" y="290" width="140" height="56" rx="12" fill="${CORAL}" stroke="${DARK}" stroke-width="3"/>${text(410, 328, "no", { w: 800, s: 28, c: "#fff", a: "middle" })}`;
      body = `${card(PAD, 260, 456, 420, PAPER)}${obj}
${head(580, 320, `It's like`, 40, ORANGE_T)}${f.like.split("\n").map((l, i) => head(580, 380 + i * 58, l, 54)).join("")}
${f.lines.map((l, i) => `<circle cx="${PAD + 18}" cy="${742 + i * 58}" r="10" fill="${ORANGE}"/>${text(PAD + 44, 754 + i * 58, l, { w: 700, s: 32 })}`).join("")}
${chip(PAD, 760 + f.lines.length * 58, f.code, DARK, MINT, 34)}`;
      break;
    }
    case "guess": {
      const size = Math.min(40, Math.floor((W - PAD * 2 - 140) / (0.6 * Math.max(...f.code.map((l) => l.length)))));
      body = `${card(PAD, 250, W - PAD * 2, 90 + f.code.length * size * 1.55, DARK)}<circle cx="${PAD + 40}" cy="285" r="10" fill="${CORAL}"/><circle cx="${PAD + 70}" cy="285" r="10" fill="${YELLOW}"/><circle cx="${PAD + 100}" cy="285" r="10" fill="${MINT}"/>${mono(W / 2, 293, "mystery.py", 24, "#c9b8a6", "middle")}
${f.code.map((l, i) => `${mono(PAD + 34, 352 + i * size * 1.55 + size * 0.4, String(i + 1), size * 0.6, "#8e7b69")}${mono(PAD + 84, 352 + i * size * 1.55 + size * 0.4, l, size, l.trim().startsWith("#") ? "#9c8670" : MINT)}`).join("")}
${f.options.slice(0, 4).map((o, i) => { const gw = (W - PAD * 2 - 24) / 2, gx = PAD + (i % 2) * (gw + 24), gy = 700 + Math.floor(i / 2) * 104; return `<rect x="${gx + 6}" y="${gy + 6}" width="${gw}" height="84" rx="42" fill="${DARK}"/><rect x="${gx}" y="${gy}" width="${gw}" height="84" rx="42" fill="${i % 2 ? CREAM : "#fff0e0"}" stroke="${DARK}" stroke-width="4"/><circle cx="${gx + 42}" cy="${gy + 42}" r="26" fill="${ORANGE}" stroke="${DARK}" stroke-width="3"/>${text(gx + 42, gy + 54, "ABCD"[i]!, { f: "Baloo 2", w: 700, s: 32, c: "#fff", a: "middle" })}${text(gx + 86, gy + 54, o, { w: 800, s: 32 })}`; }).join("")}
${text(W / 2, 940, f.hint, { w: 800, s: 28, c: ORANGE_T, a: "middle" })}`;
      break;
    }
    case "ask": {
      body = `${pip(230, 560, 120, "cheer")}
${bubble(400, 260, 610, f.prompt, 330, 470)}
${card(400, 560, 610, 110, PAPER)}${text(430, 628, f.example, { w: 700, s: 32 })}<rect x="${440 + Math.min(540, f.example.length * 16)}" y="590" width="4" height="50" fill="${ORANGE}"/>
${text(400, 720, "Example comment", { w: 800, s: 22, c: ORANGE_T, ls: 3 })}
${pillText(W / 2, 800, f.promise, ORANGE, "#fff", 34)}
${text(W / 2, 950, "Comment below. Kids' ideas only, no names needed.", { w: 800, s: 28, c: BROWN, a: "middle", op: 0.75 })}`;
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${header(eyebrow, headline, sub)}${body}${footer()}</svg>`;
}
