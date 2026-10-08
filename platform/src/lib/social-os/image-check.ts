/**
 * Edge check for generated feed images: the one thing that kept going wrong
 * was a logo or headline sitting on the edge of the frame (and then being
 * cut by the platform or the crop). Before an image is attached to a post,
 * its outer band is inspected: if a meaningful amount of the band differs
 * from the band's own background, something is touching that edge.
 *
 * Pure pixel maths on a small greyscale copy; sharp is loaded lazily so
 * tests and environments without it degrade to "looks fine".
 */
export interface EdgeReport {
  ok: boolean;
  /** Per-side score; 1.0 is the limit, above it something is touching that edge. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Share of an edge band's pixels that may sit on a sharp transition (text and logo outlines) before the edge counts as "touched". */
export const EDGE_TOLERANCE = 0.045;
/** Share of an edge band's pixels that may differ strongly from the band's own background (a solid badge, a block of colour) before the edge counts as "touched". */
export const FILL_TOLERANCE = 0.15;
/** How much of the frame counts as the edge band (per side). */
export const EDGE_BAND = 0.05;
const SHARP = 40;
const CONTRAST = 48;

/**
 * Scores the four edge bands of a greyscale image given as rows of 0–255 values.
 * Each band's score is the larger of: the share of pixels on a sharp transition
 * (scaled to the sharp tolerance) and the share of pixels that stand out from the
 * band's median (scaled to the fill tolerance), so 1.0 is exactly the limit.
 */
export function scoreEdges(rows: number[][], band = EDGE_BAND): EdgeReport {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (!h || !w) return { ok: true, top: 0, bottom: 0, left: 0, right: 0 };
  const bh = Math.max(1, Math.round(h * band));
  const bw = Math.max(1, Math.round(w * band));
  const score = (y0: number, y1: number, x0: number, x1: number) => {
    const pixels: number[] = [];
    let sharp = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = rows[y]![x]!;
        pixels.push(p);
        const r = x + 1 < w ? rows[y]![x + 1]! : p;
        const d = y + 1 < h ? rows[y + 1]![x]! : p;
        if (Math.abs(p - r) > SHARP || Math.abs(p - d) > SHARP) sharp++;
      }
    }
    if (!pixels.length) return 0;
    const sorted = [...pixels].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    let fill = 0;
    for (const p of pixels) if (Math.abs(p - median) > CONTRAST) fill++;
    return Math.max(sharp / pixels.length / EDGE_TOLERANCE, fill / pixels.length / FILL_TOLERANCE);
  };
  const top = score(0, bh, 0, w);
  const bottom = score(h - bh, h, 0, w);
  const left = score(0, h, 0, bw);
  const right = score(0, h, w - bw, w);
  const ok = [top, bottom, left, right].every((s) => s <= 1);
  return { ok, top, bottom, left, right };
}

/** The worst side's score: what a retry loop minimises. */
export function worstEdge(report: EdgeReport): number {
  return Math.max(report.top, report.bottom, report.left, report.right);
}

/** Decodes the image (any format sharp reads) and scores its edges. Unreadable image or no sharp → ok. */
export async function checkImageEdges(bytes: Uint8Array): Promise<EdgeReport> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(Buffer.from(bytes)).greyscale().resize({ width: 256, height: 256, fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    const rows: number[][] = [];
    for (let y = 0; y < info.height; y++) rows.push(Array.from(data.subarray(y * info.width, (y + 1) * info.width)));
    return scoreEdges(rows);
  } catch {
    return { ok: true, top: 0, bottom: 0, left: 0, right: 0 };
  }
}

/** The instruction appended to a retry after an edge was touched. */
export function edgeRetryInstruction(report: EdgeReport): string {
  const sides = (["top", "bottom", "left", "right"] as const).filter((s) => report[s] > 1);
  return `The previous attempt had elements touching the ${sides.join(" and ")} edge. Leave the outer 12% of the frame on every side as plain, empty background. Every logo, badge, headline and object must sit fully inside the central area with clear space around it.`;
}
