/**
 * Story cards and highlight covers, composed deterministically (no AI) so
 * every story on a profile reads as one system: brand wordmark, the series
 * label, the post's square image, one line from the caption, one next step.
 * 1080×1920, with the top 250 px and bottom 320 px (Instagram's own UI)
 * kept clear of anything that matters.
 *
 * Text is rendered through librsvg, which needs fontconfig to find the
 * bundled fonts (Inter for LYNQ, Outfit for CodeIt); `prepareFonts()`
 * writes a fonts.conf pointing at them and sets FONTCONFIG_FILE before the
 * first render.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type StoryBrand = "lynq" | "codeit";

export interface StoryCardInput {
  brand: StoryBrand;
  /** The square feed image (PNG/JPEG bytes). */
  image: Uint8Array;
  /** Series label shown above the image, e.g. "FIX THIS", "PROOF", "LESSON 1 OF 31". */
  series: string;
  /** One line from the caption. Wrapped to at most three lines. */
  line: string;
  /** The next step, e.g. "DM AUDIT", "Link in bio", "New post". */
  cta: string;
}

const W = 1080;
const H = 1920;
const IMAGE = 940;
const IMAGE_TOP = 400;

const THEME: Record<StoryBrand, { bg: string; fg: string; accent: string; muted: string; wordmark: string; font: string; fontBold: string; radius: number }> = {
  lynq: { bg: "#0b0b0c", fg: "#ffffff", accent: "#c7ff3d", muted: "#8a8a8f", wordmark: "LYNQ", font: "Inter Light", fontBold: "Inter SemiBold", radius: 24 },
  codeit: { bg: "#fff6ec", fg: "#1e2a44", accent: "#f97316", muted: "#6b7280", wordmark: "CODEIT", font: "Outfit", fontBold: "Outfit", radius: 40 },
};

const FONT_DIR = path.join(process.cwd(), "src", "assets", "fonts");

let fontsReady = false;
/** Points fontconfig at the bundled fonts (idempotent). Safe to call before every render. */
export function prepareFonts(): void {
  if (fontsReady) return;
  try {
    const cacheDir = path.join(tmpdir(), "lynq-fontconfig");
    mkdirSync(cacheDir, { recursive: true });
    const conf = readFileSync(path.join(FONT_DIR, "fonts.conf"), "utf8").replace("__FONT_DIR__", FONT_DIR).replace("__CACHE_DIR__", cacheDir);
    const confPath = path.join(cacheDir, "fonts.conf");
    writeFileSync(confPath, conf);
    process.env.FONTCONFIG_FILE = confPath;
    process.env.FONTCONFIG_PATH = cacheDir;
    fontsReady = true;
  } catch {
    // Without the bundled fonts librsvg falls back to whatever the host has; the card still renders.
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Greedy word wrap by estimated glyph width (Inter/Outfit average ≈ 0.52 em). */
export function wrapLine(text: string, fontSize: number, maxWidth: number, maxLines = 3): string[] {
  const perChar = fontSize * 0.52;
  const maxChars = Math.max(8, Math.floor(maxWidth / perChar));
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/[.,;:]?$/, "")}…`;
  return lines;
}

/** The SVG overlay (everything except the photo): wordmark, series, caption line, CTA pill. */
export function storyOverlaySvg(input: Omit<StoryCardInput, "image">): string {
  const t = THEME[input.brand];
  const lines = wrapLine(input.line, 54, W - 160, 3);
  const textTop = IMAGE_TOP + IMAGE + 90;
  const ctaY = textTop + lines.length * 70 + 60;
  const ctaW = Math.min(W - 160, input.cta.length * 22 + 120);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  <text x="80" y="330" font-family="${t.fontBold}" font-weight="600" font-size="34" letter-spacing="8" fill="${t.fg}">${esc(t.wordmark)}</text>
  <text x="${W - 80}" y="330" text-anchor="end" font-family="${t.fontBold}" font-weight="600" font-size="30" letter-spacing="6" fill="${t.accent}">${esc(input.series.toUpperCase())}</text>
  <rect x="80" y="352" width="${W - 160}" height="2" fill="${t.accent}" opacity="0.6"/>
  ${lines.map((l, i) => `<text x="80" y="${textTop + i * 70}" font-family="${t.font}" font-weight="300" font-size="54" fill="${t.fg}">${esc(l)}</text>`).join("\n  ")}
  <rect x="80" y="${ctaY - 46}" width="${ctaW}" height="76" rx="38" fill="${t.accent}"/>
  <text x="${80 + ctaW / 2}" y="${ctaY + 6}" text-anchor="middle" font-family="${t.fontBold}" font-weight="600" font-size="30" letter-spacing="3" fill="${t.bg}">${esc(input.cta.toUpperCase())}</text>
</svg>`;
}

/** Composes the 1080×1920 story card. */
export async function composeStoryCard(input: StoryCardInput): Promise<{ bytes: Uint8Array; width: number; height: number; contentType: "image/png" }> {
  prepareFonts();
  const sharp = (await import("sharp")).default;
  const t = THEME[input.brand];
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE}" height="${IMAGE}"><rect width="${IMAGE}" height="${IMAGE}" rx="${t.radius}" fill="#fff"/></svg>`);
  const photo = await sharp(Buffer.from(input.image)).resize(IMAGE, IMAGE, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const out = await sharp(Buffer.from(storyOverlaySvg(input)))
    .composite([{ input: photo, left: Math.round((W - IMAGE) / 2), top: IMAGE_TOP }])
    .png()
    .toBuffer();
  return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: W, height: H, contentType: "image/png" };
}

/** A highlight cover: brand background, one word, the accent as a single dot. 1080×1920 so Instagram's circular crop takes the centre. */
export async function composeHighlightCover(brand: StoryBrand, label: string): Promise<Uint8Array> {
  prepareFonts();
  const sharp = (await import("sharp")).default;
  const t = THEME[brand];
  const size = label.length > 12 ? 60 : label.length > 9 ? 84 : 110;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  <circle cx="${W / 2}" cy="${H / 2 - 130}" r="22" fill="${t.accent}"/>
  <text x="${W / 2}" y="${H / 2 + 30}" text-anchor="middle" font-family="${t.fontBold}" font-weight="600" font-size="${size}" letter-spacing="6" fill="${t.fg}">${esc(label.toUpperCase())}</text>
</svg>`;
  const out = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
