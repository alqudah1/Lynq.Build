/**
 * Rendered reels: short 9:16 animations drawn frame by frame from SVG (the
 * same fonts and looks as the cards and stories), encoded to MP4 with ffmpeg.
 * No screen recording and no AI video spend. They are rendered ahead of time
 * (see reel-render.render.test.ts) and bundled in src/assets/reels, and the
 * week plan attaches the file to the reel like the case-study story frames.
 *
 * Each reel is a pure function of time, so a frame can be checked on its own.
 */
import { BROWN, CORAL, MINT, ORANGE, ORANGE_T, PAPER, YELLOW, esc, mono, soft } from "./codeit-kit";
import { hero, item, pip } from "./codeit-formats";

export const RW = 1080;
export const RH = 1920;
export const FPS = 30;

export interface ReelDef {
  /** File name in src/assets/reels. */
  file: string;
  seconds: number;
  frame: (t: number) => string;
}

// ---------- timing ----------
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** 0 → 1 over [start, start + dur], eased out. */
const ease = (t: number, start: number, dur: number) => {
  const p = clamp((t - start) / dur);
  return 1 - Math.pow(1 - p, 3);
};
/** Springy pop: overshoots a little, then settles at 1. */
const pop = (t: number, start: number, dur = 0.45) => {
  const p = clamp((t - start) / dur);
  if (p <= 0) return 0;
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};
/** Fades in at `a`, out at `b`. */
const window_ = (t: number, a: number, b: number, f = 0.3) => Math.min(ease(t, a, f), 1 - ease(t, b - f, f));
const typed = (s: string, t: number, start: number, cps = 22) => s.slice(0, Math.max(0, Math.floor((t - start) * cps)));

type TO = { f?: string; w?: number; s?: number; c?: string; a?: "start" | "middle" | "end"; ls?: number; op?: number };
const T = (x: number, y: number, t: string, o: TO = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.f ?? "Nunito"}" font-weight="${o.w ?? 700}" font-size="${o.s ?? 40}" fill="${o.c ?? BROWN}" text-anchor="${o.a ?? "start"}" letter-spacing="${o.ls ?? 0}" opacity="${(o.op ?? 1).toFixed(3)}" xml:space="preserve">${esc(t)}</text>`;
const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${RW}" height="${RH}" viewBox="0 0 ${RW} ${RH}">${inner}</svg>`;
const at = (x: number, y: number, s: number, inner: string, op = 1) => `<g transform="translate(${x} ${y}) scale(${s.toFixed(4)})" opacity="${op.toFixed(3)}">${inner}</g>`;

// ---------------------------------------------------------------------------
// CodeIt: the modern look, tall.
// ---------------------------------------------------------------------------
const cDefs = `<defs>
<linearGradient id="kbg" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#fff9f0"/><stop offset="1" stop-color="#ffeedd"/></linearGradient>
<filter id="kblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="90"/></filter>
<filter id="kshadow" x="-20%" y="-20%" width="140%" height="170%"><feGaussianBlur stdDeviation="18"/></filter>
<linearGradient id="korange" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff6a00"/></linearGradient>
<linearGradient id="kcode" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#33241a"/><stop offset="1" stop-color="#1f150d"/></linearGradient>
<linearGradient id="knight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f3170"/><stop offset="1" stop-color="#1c1d45"/></linearGradient>
</defs>`;
const cBack = (t: number) => `${cDefs}<rect width="${RW}" height="${RH}" fill="url(#kbg)"/>
<circle cx="${RW - 40 + Math.sin(t * 0.6) * 30}" cy="300" r="320" fill="${ORANGE}" opacity="0.3" filter="url(#kblur)"/>
<circle cx="${40 + Math.cos(t * 0.5) * 30}" cy="1150" r="300" fill="${YELLOW}" opacity="0.4" filter="url(#kblur)"/>
<circle cx="${RW - 100}" cy="${RH - 180}" r="320" fill="${MINT}" opacity="0.25" filter="url(#kblur)"/>`;
const cPill = (cx: number, y: number, t: string, op = 1) => {
  const e = t.toUpperCase();
  const w = e.length * 19 + 100;
  return `<g opacity="${op.toFixed(3)}"><rect x="${cx - w / 2}" y="${y}" width="${w}" height="64" rx="32" fill="${ORANGE}" opacity="0.14"/><circle cx="${cx - w / 2 + 38}" cy="${y + 32}" r="9" fill="${ORANGE}"/>${T(cx + 16, y + 43, e, { w: 800, s: 28, c: ORANGE_T, ls: 5, a: "middle" })}</g>`;
};
const cHead = (y: number, t: string, s: number, c = BROWN, op = 1) => T(RW / 2, y, t, { f: "Baloo 2", s, c, a: "middle", op });

/** The asteroid-dodging game, alive: the rocket weaves, rocks fall. */
function spaceGame(x: number, y: number, w: number, h: number, t: number, o: { broken?: boolean; score?: number } = {}): string {
  const rocks = [0, 1, 2, 3].map((i) => {
    const speed = 260 + i * 40;
    const ry = ((t * speed + i * 210) % (h + 160)) - 120;
    const rx = x + 60 + ((i * 197) % (w - 180));
    return `<g transform="translate(${rx} ${y + ry}) rotate(${(t * 60 + i * 40) % 360} 55 0) scale(0.7)">${item("asteroid", 0, 40)}</g>`;
  }).join("");
  const rxp = o.broken ? x + w / 2 - 40 : x + w / 2 - 40 + Math.sin(t * 2.4) * (w * 0.3);
  const ryp = o.broken ? y + h - 150 + Math.min(0, Math.sin(t * 6) * 12) : y + h - 190;
  const flame = o.broken ? "" : `<path d="M${rxp + 34} ${ryp + 92} Q${rxp + 42} ${ryp + 120 + Math.sin(t * 30) * 8} ${rxp + 50} ${ryp + 92} Z" fill="${YELLOW}"/>`;
  const stars = Array.from({ length: 14 }, (_, i) => `<circle cx="${x + ((i * 137) % w)}" cy="${y + ((i * 89 + t * 40) % h)}" r="${2 + (i % 3)}" fill="#fff" opacity="${0.35 + (i % 3) * 0.2}"/>`).join("");
  return `${soft(x, y, w, h, "url(#knight)", 36, 0.3)}<clipPath id="g${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="36"/></clipPath><g clip-path="url(#g${x}${y})">${stars}${rocks}${flame}<g transform="translate(${rxp} ${ryp}) scale(0.9)">${hero("rocket", 0, 0, o.broken ? 80 : Math.sin(t * 2.4 + 1.57) * -10)}</g></g>
<rect x="${x + w - 210}" y="${y + 24}" width="186" height="50" rx="25" fill="#ffffff" opacity="0.14"/>${mono(x + w - 117, y + 58, `SCORE ${o.score ?? Math.floor(t * 3)}`, 26, "#ffffff", "middle")}`;
}

/** Pip builds a game, episode 1: the idea. 13 seconds. */
export const PIP_EP1: ReelDef = {
  file: "pip-ep1.mp4",
  seconds: 13,
  frame: (t) => {
    const idea = "a rocket that dodges asteroids";
    const head1 = window_(t, 0.2, 5.4);
    const head2 = window_(t, 9.6, 13.2);
    const pipIn = pop(t, 0.3, 0.6);
    const pipPose = t > 8.2 ? "cheer" : t > 2 && t < 5.6 ? "type" : "think";
    const pipY = 1530 + (t > 8.2 ? -Math.abs(Math.sin((t - 8.2) * 5)) * 40 : 0);
    const inputIn = ease(t, 1.8, 0.4);
    const press = t > 5.6 && t < 6.0 ? 0.94 : 1;
    const gameIn = pop(t, 6.2, 0.55);
    const endIn = ease(t, 10.2, 0.4);
    const cursorOn = Math.floor(t * 2.5) % 2 === 0;
    const text = typed(idea, t, 2.3, 9.5);
    return svg(`${cBack(t)}
${cPill(RW / 2, 230, "Pip builds a game · Ep 1", ease(t, 0, 0.4))}
${cHead(420, "Pip has never", 96, BROWN, head1)}${cHead(520, "made a game.", 96, ORANGE, head1)}
${cHead(420, "Tonight", 96, BROWN, head2)}${cHead(520, "that changes.", 96, ORANGE, head2)}
<g opacity="${inputIn.toFixed(3)}" transform="translate(0 ${(1 - inputIn) * 40})">${soft(90, 620, RW - 180, 140, PAPER, 36)}${T(140, 708, text || " ", { w: 700, s: 46 })}${cursorOn && t < 6 ? `<rect x="${146 + text.length * 23.4}" y="660" width="5" height="60" rx="2" fill="${ORANGE}"/>` : ""}</g>
<g opacity="${inputIn.toFixed(3)}">${at(RW / 2, 840, press, `${soft(-190, -46, 380, 92, YELLOW, 46, 0.18)}<path d="M-146 -16 L-122 0 L-146 16 Z" fill="${BROWN}"/>${T(30, 14, "Build my game", { w: 800, s: 38, a: "middle" })}`)}</g>
${gameIn > 0 ? at(RW / 2, 1140, gameIn, spaceGame(-430, -260, 860, 520, Math.max(0, t - 6.2)), clamp(gameIn)) : ""}
${at(RW / 2, pipY, pipIn, pip(0, 0, 124, pipPose as "think" | "type" | "cheer"))}
<g opacity="${endIn.toFixed(3)}">${soft(110, 1700, RW - 220, 120, "url(#korange)", 60, 0.25)}${T(RW / 2, 1774, "Ep 2: it breaks. Follow for it.", { w: 800, s: 40, c: "#fff", a: "middle" })}</g>
${T(RW / 2, 1880, "codeitlearn.com", { w: 800, s: 28, c: ORANGE_T, a: "middle", op: 0.8 })}`);
  },
};

/** One line, two games, live: the same cat game at speed 2 and speed 20. 12 seconds. */
export const SPLIT_SPEED: ReelDef = {
  file: "codeit-speed.mp4",
  seconds: 12,
  frame: (t) => {
    const lane = (y: number, speed: number, label: string, on: boolean, t0: number) => {
      const w = RW - 160, h = 420, x = 80;
      const run = Math.max(0, t - t0);
      const span = w - 260;
      const px = x + 40 + ((run * speed * 40) % (span * 2) > span ? span * 2 - ((run * speed * 40) % (span * 2)) : (run * speed * 40) % (span * 2));
      const hop = Math.abs(Math.sin(run * (speed > 5 ? 14 : 4))) * 18;
      const lines = speed > 5 ? [0, 1, 2].map((i) => `<path d="M${px - 10 - i * 30} ${y + h - 150 + i * 22} h-${120 + i * 30}" stroke="#fff" stroke-width="${8 - i * 2}" stroke-linecap="round" opacity="${0.85 - i * 0.2}"/>`).join("") : "";
      return `${soft(x, y, w, h, "#d6eeff", 40, 0.2)}<clipPath id="l${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="40"/></clipPath><g clip-path="url(#l${y})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#cfe9ff"/><ellipse cx="${x + w * 0.35}" cy="${y + h - 30}" rx="${w * 0.65}" ry="80" fill="#4fe3a3"/><rect x="${x}" y="${y + h - 36}" width="${w}" height="36" fill="#38d494"/>${lines}<g transform="translate(${px} ${y + h - 36 - 100 - hop})">${hero("cat", 0, 0, speed > 5 ? -6 : 0)}</g><g transform="translate(${x + w - 170} ${y + h - 36})">${item("pizza", 0, 0)}</g></g>
${soft(x + 30, y + 30, label.length * 25 + 60, 76, "url(#kcode)", 20, 0.25)}${mono(x + 60, y + 82, label, 40, MINT)}${on ? `<circle cx="${x + w - 60}" cy="${y + 66}" r="14" fill="${CORAL}" opacity="${0.5 + Math.sin(t * 8) * 0.5}"/>` : ""}`;
    };
    const editing = t >= 4 && t < 6.4;
    const label2 = t < 4 ? "speed = 2" : editing ? `speed = 2${"0".slice(0, t > 5.2 ? 1 : 0)}` : "speed = 20";
    const endIn = ease(t, 9.4, 0.4);
    return svg(`${cBack(t)}
${cPill(RW / 2, 200, "One line, two games", ease(t, 0, 0.4))}
${cHead(380, "Same game.", 96, BROWN, ease(t, 0.2, 0.4))}${cHead(480, "One number.", 96, ORANGE, ease(t, 0.5, 0.4))}
${lane(600, 2, "speed = 2", false, 0.6)}
${t > 3.4 ? lane(1100, t < 6.4 ? 2 : 20, label2, editing, t < 6.4 ? 3.4 : 6.4) : ""}
${editing ? T(RW / 2, 1600, "change one line…", { w: 800, s: 40, c: ORANGE_T, a: "middle" }) : ""}
<g opacity="${endIn.toFixed(3)}">${cHead(1650, "What number next?", 72)}${soft(130, 1700, RW - 260, 110, "url(#korange)", 55, 0.25)}${T(RW / 2, 1770, "Comment it. We'll run it.", { w: 800, s: 42, c: "#fff", a: "middle" })}</g>
${T(RW / 2, 1880, "codeitlearn.com", { w: 800, s: 28, c: ORANGE_T, a: "middle", op: 0.8 })}`);
  },
};

// ---------------------------------------------------------------------------
// LYNQ: black studio, thin white type, one lime.
// ---------------------------------------------------------------------------
const BK = "#0b0b0c", WH = "#ffffff", LI = "#c7ff3d", MU = "#8a8a8f", LN = "#2a2a2e";
const lText = (x: number, y: number, t: string, s: number, c = WH, op = 1, a: "start" | "middle" = "start", w = 300) => T(x, y, t, { f: w >= 600 ? "Inter SemiBold" : "Inter Light", w, s, c, a, op, ls: s > 60 ? -2 : 0 });
const lLabel = (x: number, y: number, t: string, c = MU, a: "start" | "end" | "middle" = "start", op = 1) => T(x, y, t.toUpperCase(), { f: "JetBrains Mono", w: 500, s: 26, c, ls: 4, a, op });
const lBack = (t: number, series: string) => `<defs><radialGradient id="lglow" cx="0.3" cy="0.2" r="0.9"><stop offset="0" stop-color="#1c1c20"/><stop offset="1" stop-color="${BK}"/></radialGradient></defs>
<rect width="${RW}" height="${RH}" fill="url(#lglow)"/>
${lLabel(90, 150, "LYNQ", WH)}${lLabel(RW - 90, 150, series, MU, "end")}
<line x1="90" y1="${RH - 170}" x2="${RW - 90}" y2="${RH - 170}" stroke="${LN}" stroke-width="2"/>${lLabel(90, RH - 110, "lynq.build")}${lLabel(RW - 90, RH - 110, `0:${String(Math.min(59, Math.floor(t))).padStart(2, "0")}`, MU, "end")}`;

/** A phone in the LYNQ studio look, with one main button. */
function lPhone(x: number, y: number, w: number, h: number, button: string, sub: string, hot: boolean, glow: number): string {
  const r = 56;
  return `<rect x="${x + 14}" y="${y + 30}" width="${w}" height="${h}" rx="${r}" fill="#000" opacity="0.6"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#141416" stroke="#2e2e33" stroke-width="3"/>
<rect x="${x + w / 2 - 60}" y="${y + 22}" width="120" height="30" rx="15" fill="#050506"/>
<rect x="${x + 36}" y="${y + 100}" width="${w - 72}" height="190" rx="18" fill="#1d1d21"/>${lLabel(x + w / 2, y + 205, "slideshow", "#4a4a50", "middle")}
<rect x="${x + 36}" y="${y + 320}" width="${w * 0.6}" height="18" rx="9" fill="${LN}"/><rect x="${x + 36}" y="${y + 354}" width="${w * 0.45}" height="18" rx="9" fill="${LN}"/>
${hot && glow > 0 ? `<rect x="${x + 26}" y="${y + 400}" width="${w - 52}" height="116" rx="58" fill="${LI}" opacity="${(0.25 * glow).toFixed(3)}"/>` : ""}
<rect x="${x + 36}" y="${y + 410}" width="${w - 72}" height="96" rx="48" fill="${hot && glow > 0.5 ? LI : "none"}" stroke="${hot && glow > 0.5 ? LI : "#6a6a70"}" stroke-width="3"/>
${lText(x + w / 2, y + 470, button, Math.min(34, Math.floor((w - 110) / (0.56 * button.length))), hot && glow > 0.5 ? BK : WH, 1, "middle", 600)}
${T(x + w / 2, y + 560, sub, { f: "Inter Light", w: 300, s: 24, c: MU, a: "middle" })}
<rect x="${x + 36}" y="${y + 620}" width="${w - 72}" height="18" rx="9" fill="${LN}"/><rect x="${x + 36}" y="${y + 654}" width="${w * 0.5}" height="18" rx="9" fill="${LN}"/>`;
}

/** A or B: which button gets the call? 12 seconds; the answer is held for tomorrow's story. */
export const LYNQ_AB: ReelDef = {
  file: "lynq-ab-button.mp4",
  seconds: 12,
  frame: (t) => {
    const l1 = ease(t, 0.2, 0.5), l2 = ease(t, 0.9, 0.5);
    const phones = ease(t, 2.0, 0.7);
    const hover = t > 6.2 && t < 9 ? Math.floor((t - 6.2) / 0.7) % 2 : -1;
    const ask = ease(t, 6.0, 0.4);
    const end = ease(t, 9.2, 0.5);
    const py = 640 + (1 - phones) * 120;
    const marker = (x: number, label: string, on: boolean) => `${lText(x, py + 860, label, 120, on ? LI : WH, phones, "middle")}`;
    return svg(`${lBack(t, "A or B")}
${lText(90, 330, "Two buttons.", 104, WH, l1 * (1 - end))}${lText(90, 450, "One gets the call.", 104, MU, l2 * (1 - end))}
<g opacity="${(phones * (1 - end * 0.7)).toFixed(3)}">${lPhone(90, py, 420, 760, "Contact us", "button A", false, 0)}${lPhone(570, py, 420, 760, "Call now, we answer", "button B", false, 0)}</g>
${marker(300, "A", hover === 0)}${marker(780, "B", hover === 1)}
${lText(90, 1640, "Which one would you tap?", 56, WH, ask * (1 - end))}
<g opacity="${end.toFixed(3)}">${lText(90, 380, "Comment", 104, WH)}${lText(90, 500, "A or B.", 104, LI)}${lText(90, 1640, "The answer is in tomorrow's story.", 44, MU)}</g>`);
  },
};

export const REELS: ReelDef[] = [PIP_EP1, SPLIT_SPEED, LYNQ_AB];
