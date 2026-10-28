/**
 * The CodeIt modern look, shared by the feed cards (codeit-card.ts and
 * codeit-formats.ts): the same system as the CodeIt stories. A warm cream
 * gradient with soft light blooms, white cards that float on blurred shadows,
 * dark glass code windows, orange gradient accents, and no outlines or hard
 * offset shadows.
 */
export const W = 1080;
export const PAD = 72;
export const CREAM = "#fff4e5", BROWN = "#35220e", ORANGE = "#ff7a00", ORANGE_T = "#d46500", YELLOW = "#f5d04a", MINT = "#3ddc97", MINT_T = "#1a7a50", CORAL = "#ff5a5f", SKY = "#bfe3ff", NIGHT = "#2a2b5a", PAPER = "#ffffff";
/** Ink for illustration lines: brown, never black. */
export const INK = "#4a2f17";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export type TO = { f?: string; w?: number; s?: number; c?: string; a?: "start" | "middle" | "end"; ls?: number; op?: number };
export const text = (x: number, y: number, t: string, o: TO = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.f ?? "Nunito"}" font-weight="${o.w ?? 700}" font-size="${o.s ?? 36}" fill="${o.c ?? BROWN}" text-anchor="${o.a ?? "start"}" letter-spacing="${o.ls ?? 0}" opacity="${o.op ?? 1}" xml:space="preserve">${esc(t)}</text>`;
export const head = (x: number, y: number, t: string, s: number, c = BROWN, a: "start" | "middle" | "end" = "start") => text(x, y, t, { f: "Baloo 2", w: 700, s, c, a });
export const mono = (x: number, y: number, t: string, s: number, c: string, a: "start" | "middle" | "end" = "start") => text(x, y, t, { f: "JetBrains Mono", w: 500, s, c, a });

export const defs = `<defs>
<linearGradient id="kbg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#fff9f0"/><stop offset="1" stop-color="#ffeedd"/></linearGradient>
<filter id="kblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="80"/></filter>
<filter id="kshadow" x="-20%" y="-20%" width="140%" height="170%"><feGaussianBlur stdDeviation="18"/></filter>
<linearGradient id="korange" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff6a00"/></linearGradient>
<linearGradient id="kcode" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#33241a"/><stop offset="1" stop-color="#1f150d"/></linearGradient>
<linearGradient id="ksky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6eeff"/><stop offset="1" stop-color="#b3dcff"/></linearGradient>
<linearGradient id="knight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f3170"/><stop offset="1" stop-color="#22234d"/></linearGradient>
<linearGradient id="kgrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fe3a3"/><stop offset="1" stop-color="#2cc585"/></linearGradient>
</defs>`;

/** Gradient square with three soft blooms of light. */
export const backdrop = () => `${defs}<rect width="${W}" height="${W}" fill="url(#kbg)"/>
<circle cx="${W - 40}" cy="120" r="260" fill="${ORANGE}" opacity="0.28" filter="url(#kblur)"/>
<circle cx="40" cy="${W - 260}" r="240" fill="${YELLOW}" opacity="0.38" filter="url(#kblur)"/>
<circle cx="${W - 80}" cy="${W - 60}" r="260" fill="${MINT}" opacity="0.22" filter="url(#kblur)"/>`;

/** A card that floats: blurred shadow below, no outline. */
export const soft = (x: number, y: number, w: number, h: number, fill = PAPER, r = 32, shade = 0.16) =>
  `<rect x="${x + 8}" y="${y + 20}" width="${Math.max(0, w - 16)}" height="${h}" rx="${r}" fill="${BROWN}" opacity="${shade}" filter="url(#kshadow)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;

/** A dark code chip with a mint line of code. */
export const chip = (x: number, y: number, t: string, s = 30) => {
  const w = t.length * s * 0.62 + 48;
  return `${soft(x, y, w, s + 32, "url(#kcode)", 16, 0.28)}${mono(x + 24, y + s + 7, t, s, MINT)}`;
};
export const chipWidth = (t: string, s = 30) => t.length * s * 0.62 + 48;

/** A rounded pill: solid orange gradient (on) or white (off). */
export const pill = (cx: number, y: number, t: string, on: boolean, s = 28) => {
  const w = t.length * s * 0.56 + 60;
  return `${soft(cx - w / 2, y, w, s + 32, on ? "url(#korange)" : PAPER, (s + 32) / 2, on ? 0.22 : 0.14)}${text(cx, y + s + 6, t, { w: 800, s, c: on ? "#fff" : BROWN, a: "middle" })}`;
};
export const pillWidth = (t: string, s = 28) => t.length * s * 0.56 + 60;

/** Numbered step: an orange gradient dot and a label. */
export const stepDot = (x: number, y: number, n: number, label: string) =>
  `<circle cx="${x + 24}" cy="${y}" r="24" fill="url(#korange)"/>${text(x + 24, y + 10, String(n), { f: "Baloo 2", w: 700, s: 30, c: "#fff", a: "middle" })}${text(x + 64, y + 10, label, { w: 800, s: 29 })}`;

/** The shared header: eyebrow pill, headline, orange sub, beside the logo. */
export const header = (eyebrow: string, headline: string, sub: string) => {
  const e = eyebrow.toUpperCase();
  const ew = e.length * 17.5 + 84;
  return `<rect x="270" y="50" width="${ew}" height="46" rx="23" fill="${ORANGE}" opacity="0.13"/><circle cx="296" cy="73" r="7" fill="${ORANGE}"/>${text(314, 82, e, { w: 800, s: 22, c: ORANGE_T, ls: 4 })}
${head(270, 156, headline, 56)}${head(270, 202, sub, 42, ORANGE)}`;
};
export const footer = () => text(W - PAD, W - 30, "codeitlearn.com", { w: 800, s: 24, c: ORANGE_T, a: "end", op: 0.85 });

/** A speech bubble: white, soft shadow, tail toward (tailX, tailY). */
export const bubble = (x: number, y: number, w: number, t: string, tailX: number, tailY: number, s = 30) => {
  const lines = t.split("\n");
  const h = 30 + lines.length * (s + 8);
  return `<path d="M${x + 24} ${y + h - 6} L${tailX} ${tailY} L${x + 74} ${y + h - 6} Z" fill="${PAPER}"/>${soft(x, y, w, h, PAPER, 24, 0.12)}<path d="M${x + 26} ${y + h - 2} L${tailX} ${tailY} L${x + 72} ${y + h - 2} Z" fill="${PAPER}"/>${lines.map((l, i) => text(x + w / 2, y + 16 + (i + 1) * (s + 8) - 6, l, { f: "Baloo 2", w: 700, s, a: "middle" })).join("")}`;
};
