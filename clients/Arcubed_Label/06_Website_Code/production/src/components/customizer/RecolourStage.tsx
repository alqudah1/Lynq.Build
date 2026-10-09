"use client";

// Draws a colour preview: an authentic photograph with only the yarn
// recoloured (src/lib/recolour/engine.ts), on a canvas, in the browser.
//
// INSTANT AND NEVER BLANK
//   - each source photograph and its yarn mask are fetched and analysed once
//     per page (module cache), then every colour is a 1024-entry lookup table
//     plus one pass over the pixels
//   - finished colours are kept as ImageBitmaps (last 6), so going back to a
//     colour is a single draw
//   - the canvas keeps its previous picture until the next one is drawn, and
//     `fallback` (the real photography) is shown until the very first preview
//     exists, so the stage is never empty
//
// No network request is made per colour and nothing is generated remotely.

import { useEffect, useRef, useState } from "react";
import { analyseSource, buildLut, renderInto, type PreviewColour, type SourceAnalysis, type YarnProfile } from "@/lib/recolour/engine";
import { maskUrl, sourceUrl } from "@/lib/recolour/data";

interface Source {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  mask: Uint8ClampedArray;
  analysis: SourceAnalysis;
}

const sources = new Map<string, Promise<Source>>();
const bitmaps = new Map<string, ImageBitmap>();
const MAX_BITMAPS = 6;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

function pixels(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

export function loadSource(frame: string): Promise<Source> {
  let p = sources.get(frame);
  if (!p) {
    p = Promise.all([loadImage(sourceUrl(frame)), loadImage(maskUrl(frame))]).then(([src, msk]) => {
      const s = pixels(src);
      const m = pixels(msk);
      // The mask is greyscale: take one channel.
      const mask = new Uint8ClampedArray(s.width * s.height);
      for (let i = 0, p2 = 0; p2 < mask.length; p2++, i += 4) mask[p2] = m.data[i];
      return { w: s.width, h: s.height, rgba: s.data, mask, analysis: analyseSource(s.data, mask) };
    });
    p.catch(() => sources.delete(frame));
    sources.set(frame, p);
  }
  return p;
}

function remember(key: string, bmp: ImageBitmap) {
  bitmaps.set(key, bmp);
  while (bitmaps.size > MAX_BITMAPS) {
    const oldest = bitmaps.keys().next().value as string;
    bitmaps.get(oldest)?.close();
    bitmaps.delete(oldest);
  }
}

export default function RecolourStage({
  frame,
  colour,
  profiles,
  fallback,
  alt,
}: {
  frame: string;
  colour: PreviewColour;
  profiles: YarnProfile[];
  /** Shown until the first preview has been drawn. */
  fallback: React.ReactNode;
  alt: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [timing, setTiming] = useState<{ ms: number; cached: boolean } | null>(null);
  const scratch = useRef<ImageData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = `${frame}|${colour.key}|${colour.value}|${colour.render?.chroma ?? 1}|${colour.render?.contrast ?? 1}`;
    loadSource(frame).then(async (src) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const t0 = performance.now();
      if (canvas.width !== src.w || canvas.height !== src.h) {
        canvas.width = src.w;
        canvas.height = src.h;
      }
      const ctx = canvas.getContext("2d")!;
      const cachedBmp = bitmaps.get(key);
      if (cachedBmp) {
        ctx.clearRect(0, 0, src.w, src.h);
        ctx.drawImage(cachedBmp, 0, 0);
        setTiming({ ms: performance.now() - t0, cached: true });
      } else {
        if (!scratch.current || scratch.current.width !== src.w || scratch.current.height !== src.h) {
          scratch.current = new ImageData(src.w, src.h);
        }
        const lut = buildLut(colour, profiles, src.analysis);
        renderInto(scratch.current.data, src.rgba, src.mask, src.analysis, lut);
        ctx.putImageData(scratch.current, 0, 0);
        setTiming({ ms: performance.now() - t0, cached: false });
        if ("createImageBitmap" in window) {
          const bmp = await createImageBitmap(scratch.current);
          if (bitmaps.has(key)) bmp.close(); else remember(key, bmp);
        }
      }
      setDrawn(true);
    });
    return () => { cancelled = true; };
  }, [frame, colour, profiles]);

  return (
    <div className="rc-stage">
      {drawn ? null : fallback}
      <canvas
        ref={canvasRef}
        className="pg-img rc-canvas"
        role="img"
        aria-label={alt}
        data-render-ms={timing ? timing.ms.toFixed(1) : undefined}
        data-cached={timing ? String(timing.cached) : undefined}
        data-colour={colour.key}
        style={drawn ? undefined : { position: "absolute", visibility: "hidden" }}
      />
    </div>
  );
}
