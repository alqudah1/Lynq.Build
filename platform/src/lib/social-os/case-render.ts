/**
 * LYNQ case-study stories: the client's own photos and real screenshots of
 * the site LYNQ built, set in LYNQ's dark editorial frame. Built for a
 * highlight: a numbered run (cover, brief, the build in phones, what we
 * built, the result) that reads like a product launch, not a slide deck.
 *
 * Images are passed in as bytes by name; nothing here is AI-generated.
 */
import { prepareFonts } from "./story-card";

const W = 1080;
const H = 1920;
const BK = "#0b0b0c", WH = "#ffffff", LI = "#c7ff3d", MU = "#8a8a8f";
const MONO = "JetBrains Mono";

/** Which part of an image to keep when it is cropped to fit. */
export type Focus = "center" | "top" | "bottom" | "left" | "right" | "attention";
/** A real screenshot or photo, by name, and where to look in it. */
export interface Shot { img: string; /** Source y offset in px (screenshots). */ y?: number }

export type CaseFrame =
  | { kind: "cover"; photo: string; focus?: Focus; caseNo: string; name: [string, string]; line: string }
  | { kind: "brief"; photo: string; focus?: Focus; label: string; lines: string[]; accentWord: string; byline: string }
  | { kind: "phones"; step: string; headline: [string, string]; detail: string; shots: [Shot] | [Shot, Shot] }
  | { kind: "bento"; headline: string; tiles: { shot: Shot; label: string; sub: string }[]; note: string }
  | { kind: "cta"; photo: string; focus?: Focus; lines: string[]; accentWord: string; button: string };

export interface CaseSet {
  /** Shown top right on every frame, e.g. "Case 04 · Arcubed Label". */
  series: string;
  /** The client's own accent colour: a soft glow behind their screens. */
  glow: string;
  frames: CaseFrame[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
type TOpts = { f?: string; w?: number; s?: number; c?: string; a?: "start" | "middle" | "end"; ls?: number; op?: number };
const T = (x: number, y: number, t: string, o: TOpts = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.f ?? "Inter Light"}" font-weight="${o.w ?? 300}" font-size="${o.s ?? 40}" fill="${o.c ?? WH}" text-anchor="${o.a ?? "start"}" letter-spacing="${o.ls ?? 0}" opacity="${o.op ?? 1}" xml:space="preserve">${esc(t)}</text>`;
const mono = (x: number, y: number, t: string, c = MU, a: "start" | "end" | "middle" = "start", s = 24) => T(x, y, t.toUpperCase(), { f: MONO, w: 500, s, c, ls: 3, a });
const svg = (inner: string, w = W, h = H) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`);
const accentLine = (x: number, y: number, line: string, word: string, s: number, f = "Inter Light") => {
  const at = line.indexOf(word);
  const w = f === "Inter SemiBold" ? 600 : 300;
  if (at < 0) return T(x, y, line, { f, w, s, ls: -3 });
  return `<text x="${x}" y="${y}" font-family="${f}" font-weight="${w}" font-size="${s}" letter-spacing="-3" fill="${WH}" xml:space="preserve">${esc(line.slice(0, at))}<tspan fill="${LI}">${esc(word)}</tspan>${esc(line.slice(at + word.length))}</text>`;
};
const wrap = (t: string, max: number) => {
  const out: string[] = [];
  let cur = "";
  for (const w of t.split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
};

/** Header and footer every frame shares, drawn over everything. */
const chrome = (series: string, folio: string, footer = true) => `
${T(90, 250, "LYNQ", { f: "Inter SemiBold", w: 600, s: 34, ls: 12 })}${mono(W - 90, 250, `${series}  ·  ${folio}`, "#b4b4b8", "end", 22)}
${footer ? `${mono(90, 1690, "lynq.build", MU, "start", 22)}${mono(W - 90, 1690, "Websites · Systems · Automation", "#55555b", "end", 18)}` : ""}`;

const defs = (glow: string) => `<defs>
<radialGradient id="spot" cx="0.25" cy="0.18" r="0.85"><stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="fadeDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BK}" stop-opacity="0.85"/><stop offset="0.22" stop-color="${BK}" stop-opacity="0"/><stop offset="0.5" stop-color="${BK}" stop-opacity="0.05"/><stop offset="0.78" stop-color="${BK}" stop-opacity="0.9"/><stop offset="1" stop-color="${BK}" stop-opacity="1"/></linearGradient>
<linearGradient id="phoneBody" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#3a3a40"/><stop offset="1" stop-color="#18181c"/></linearGradient>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="34"/></filter>
</defs>`;

/** A full-bleed photo for the background, cropped to the story and optionally dimmed and blurred. */
async function bleed(bytes: Buffer, focus: Focus = "attention", dim = 1, blur = 0): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let img = sharp(bytes).rotate().resize(W, H, { fit: "cover", position: focus === "attention" ? sharp.strategy.attention : focus });
  if (dim !== 1) img = img.modulate({ brightness: dim });
  if (blur) img = img.blur(blur);
  return img.jpeg({ quality: 92 }).toBuffer();
}

/** A phone as a transparent PNG: graphite body, the screenshot on its glass, the notch on top. */
async function phonePng(shot: Buffer, w: number, h: number, srcY = 0): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const bezel = Math.round(w * 0.028);
  const gw = w - bezel * 2, gh = h - bezel * 2, r = Math.round(w * 0.12);
  const meta = await sharp(shot).metadata();
  const scale = gw / (meta.width ?? gw);
  const resized = await sharp(shot).resize({ width: gw }).toBuffer();
  const rh = Math.round((meta.height ?? gh) * scale);
  const top = Math.min(Math.round(srcY * scale), Math.max(0, rh - gh));
  const cut = await sharp(resized).extract({ left: 0, top, width: gw, height: Math.min(gh, rh - top) }).toBuffer();
  const glass = await sharp({ create: { width: gw, height: gh, channels: 4, background: { r: 10, g: 10, b: 12, alpha: 1 } } })
    .composite([{ input: cut, left: 0, top: 0 }, { input: svg(`<rect width="${gw}" height="${gh}" rx="${r - bezel}" fill="#fff"/>`, gw, gh), blend: "dest-in" }])
    .png()
    .toBuffer();
  const body = svg(`${defs("#000")}<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r}" fill="url(#phoneBody)" stroke="#55555c" stroke-width="2"/>`, w, h);
  const notchW = Math.round(w * 0.26), notchH = Math.round(w * 0.06);
  const notch = svg(`<rect x="0" y="0" width="${notchW}" height="${notchH}" rx="${notchH / 2}" fill="#050506"/>`, notchW, notchH);
  return sharp(body)
    .composite([{ input: glass, left: bezel, top: bezel }, { input: notch, left: Math.round((w - notchW) / 2), top: bezel + Math.round(w * 0.03) }])
    .png()
    .toBuffer();
}

async function rotated(png: Buffer, deg: number): Promise<{ input: Buffer; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(png).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  return { input: out.data, width: out.info.width, height: out.info.height };
}

/** Renders one frame of a case set to a 1080×1920 JPEG. */
export async function composeCaseFrame(set: CaseSet, index: number, images: Record<string, Buffer>): Promise<Uint8Array> {
  prepareFonts();
  const sharp = (await import("sharp")).default;
  const frame = set.frames[index]!;
  const folio = `${String(index + 1).padStart(2, "0")} / ${String(set.frames.length).padStart(2, "0")}`;
  const need = (name: string) => {
    const b = images[name];
    if (!b) throw new Error(`missing image ${name}`);
    return b;
  };
  const layers: { input: Buffer; left: number; top: number }[] = [];
  let base: Buffer = await sharp({ create: { width: W, height: H, channels: 3, background: BK } }).jpeg().toBuffer();
  let over = "";

  switch (frame.kind) {
    case "cover": {
      base = await bleed(need(frame.photo), frame.focus);
      const [a, b] = frame.name;
      over = `<rect width="${W}" height="${H}" fill="url(#fadeDown)"/>
<rect x="90" y="1150" width="${frame.caseNo.length * 19 + 64}" height="54" rx="27" fill="none" stroke="${LI}" stroke-width="2"/>${mono(118, 1186, frame.caseNo, LI, "start", 22)}
${T(90, 1340, a, { f: "Inter SemiBold", w: 600, s: 132, ls: -5 })}${T(90, 1478, b, { f: "Inter SemiBold", w: 600, s: 132, ls: -5 })}
${T(90, 1560, frame.line, { s: 44, c: "#e6e6e8" })}${mono(90, 1625, "Tap through the build  ›", LI, "start", 22)}`;
      break;
    }
    case "brief": {
      base = await bleed(need(frame.photo), frame.focus, 0.32, 18);
      const size = Math.min(118, ...frame.lines.map((l) => Math.floor(900 / (0.5 * l.length))));
      const lh = size + 22;
      const top = 1000 - (frame.lines.length * lh) / 2 + size / 2;
      over = `<rect width="${W}" height="${H}" fill="${BK}" opacity="0.25"/>${mono(90, top - size - 30, frame.label, LI)}
${frame.lines.map((l, i) => accentLine(90, top + i * lh, l, frame.accentWord, size)).join("")}
<rect x="90" y="${top + (frame.lines.length - 1) * lh + 70}" width="140" height="5" fill="${LI}"/>${mono(90, top + (frame.lines.length - 1) * lh + 140, frame.byline)}`;
      break;
    }
    case "phones": {
      const two = frame.shots.length === 2;
      if (two) {
        const pw = 470, ph = 960;
        const back = await rotated(await phonePng(need(frame.shots[0].img), pw, ph, frame.shots[0].y), -7);
        const front = await rotated(await phonePng(need(frame.shots[1]!.img), pw, ph, frame.shots[1]!.y), 6);
        layers.push({ input: back.input, left: 60, top: 790 }, { input: front.input, left: W - front.width - 50, top: 830 });
      } else {
        const pw = 600, ph = 1230;
        const p = await phonePng(need(frame.shots[0].img), pw, ph, frame.shots[0].y);
        const top = 800;
        // bleeds off the bottom: crop what's below the frame
        const visible = await sharp(p).extract({ left: 0, top: 0, width: pw, height: H - top }).png().toBuffer();
        layers.push({ input: visible, left: (W - pw) / 2, top });
      }
      over = `${mono(90, 400, frame.step, LI)}${T(90, 500, frame.headline[0], { s: 96, ls: -3 })}${T(90, 610, frame.headline[1], { s: 96, ls: -3 })}
${wrap(frame.detail, 46).slice(0, 2).map((l, i) => T(90, 690 + i * 48, l, { s: 36, c: "#a4a4aa" })).join("")}`;
      break;
    }
    case "bento": {
      // A lineup of real screens: four phones, staggered and slightly turned, then the list of what each one is.
      const pw = 290, ph = 595;
      const spots = [{ x: 46, y: 650, r: -5 }, { x: 278, y: 605, r: -1.5 }, { x: 506, y: 605, r: 1.5 }, { x: 724, y: 650, r: 5 }];
      const tiles = frame.tiles.slice(0, 4);
      // outer phones first, the middle two on top
      for (const i of [0, 3, 1, 2]) {
        const t = tiles[i];
        if (!t) continue;
        const ph1 = await rotated(await phonePng(need(t.shot.img), pw, ph, t.shot.y), spots[i]!.r);
        layers.push({ input: ph1.input, left: spots[i]!.x, top: spots[i]!.y });
      }
      const listTop = 1340;
      over = `${mono(90, 400, "What we built", LI)}${T(90, 500, frame.headline, { s: 96, ls: -3 })}
${tiles.map((t, i) => {
        const x = 90 + (i % 2) * 460, y = listTop + Math.floor(i / 2) * 120;
        return `${mono(x, y, String(i + 1).padStart(2, "0"), LI, "start", 22)}${T(x + 56, y + 2, t.label, { f: "Inter SemiBold", w: 600, s: 40 })}${T(x + 56, y + 48, t.sub, { s: 30, c: "#a4a4aa" })}`;
      }).join("")}
${T(90, listTop + 262, frame.note, { s: 40, c: LI })}`;
      break;
    }
    case "cta": {
      base = await bleed(need(frame.photo), frame.focus, 0.45, 2);
      const size = Math.min(124, ...frame.lines.map((l) => Math.floor(900 / (0.5 * l.length))));
      const lh = size + 20;
      const top = 1100;
      over = `<rect width="${W}" height="${H}" fill="url(#fadeDown)"/>${mono(90, top - size - 40, "The result", LI)}
${frame.lines.map((l, i) => accentLine(90, top + i * lh, l, frame.accentWord, size)).join("")}
<rect x="90" y="${top + (frame.lines.length - 1) * lh + 80}" width="${frame.button.length * 26 + 110}" height="96" rx="48" fill="${LI}"/>${T(140, top + (frame.lines.length - 1) * lh + 143, frame.button, { f: "Inter SemiBold", w: 600, s: 40, c: BK })}`;
      break;
    }
  }
  // Glows and shadows go under the phones, text over everything.
  const behind = frame.kind === "phones" ? svg(`${defs(set.glow)}<rect width="${W}" height="${H}" fill="url(#spot)"/><circle cx="${W / 2}" cy="1260" r="520" fill="url(#glow)"/><ellipse cx="560" cy="1800" rx="420" ry="40" fill="#000" opacity="0.9" filter="url(#soft)"/>`) : svg(`${defs(set.glow)}${frame.kind === "bento" ? `<rect width="${W}" height="${H}" fill="url(#spot)"/><circle cx="${W / 2}" cy="930" r="560" fill="url(#glow)"/><ellipse cx="${W / 2}" cy="1290" rx="470" ry="34" fill="#000" opacity="0.9" filter="url(#soft)"/>` : ""}`);
  const out = await sharp(base)
    .composite([{ input: behind, left: 0, top: 0 }, ...layers, { input: svg(`${defs(set.glow)}${over}${chrome(set.series, folio, frame.kind !== "phones")}`), left: 0, top: 0 }])
    .flatten({ background: BK })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
