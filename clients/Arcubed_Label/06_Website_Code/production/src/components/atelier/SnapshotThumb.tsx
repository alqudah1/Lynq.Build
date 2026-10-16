"use client";

// The thumbnail for a made-to-order line (cart, checkout, order confirmation).
//   - a colour Rand photographed: its photograph, exactly as before
//   - a colour published from the colour workflow (no photograph yet): the
//     bag's locked photograph recoloured to the colour's measured yarn code,
//     the same picture the product page showed when it was chosen
//   - otherwise: the product's first photograph (previous behaviour)
// So a new colour is never represented in the cart by a different colour.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { framesForColour, mediaForSnapshot } from "@/lib/product-media";
import { loadSource } from "@/components/customizer/RecolourStage";
import { profilesFor } from "@/lib/recolour/data";
import { buildLut, renderInto } from "@/lib/recolour/engine";
import { PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";

const HEX = /^#[0-9a-f]{6}$/i;

function RecolouredThumb({ slug, frame, hex }: { slug: string; frame: string; hex: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let off = false;
    loadSource(frame).then((src) => {
      const c = ref.current;
      if (off || !c) return;
      const full = new ImageData(src.w, src.h);
      renderInto(full.data, src.rgba, src.mask, src.analysis, buildLut({ key: hex, name: hex, swatch: hex, value: hex, products: [slug] }, profilesFor(slug), src.analysis));
      const tmp = document.createElement("canvas");
      tmp.width = src.w; tmp.height = src.h;
      tmp.getContext("2d")!.putImageData(full, 0, 0);
      const W = 320, H = Math.round((W * src.h) / src.w);
      c.width = W; c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(tmp, 0, 0, W, H);
      setReady(true);
    }, () => {});
    return () => { off = true; };
  }, [slug, frame, hex]);
  return <canvas ref={ref} className="snap-thumb" style={ready ? undefined : { visibility: "hidden" }} aria-hidden="true" />;
}

export default function SnapshotThumb({ bagSlug, bagName, colourName, colourHex, sizes = "88px", width = 200 }: {
  bagSlug: string | null; bagName: string | null; colourName: string | null; colourHex: string | null;
  sizes?: string; width?: number;
}) {
  const bag = { slug: bagSlug ?? "", name: bagName ?? "" };
  const exact = framesForColour(bag, colourName)[0];
  const locked = bagSlug ? (PREVIEW_SOURCES[bagSlug] ?? []).find((s) => s.locked) : undefined;
  if (!exact && locked && colourHex && HEX.test(colourHex)) {
    return <RecolouredThumb slug={bagSlug as string} frame={locked.frame} hex={colourHex.toLowerCase()} />;
  }
  const frame = exact ?? mediaForSnapshot(bagSlug, bagName, colourName);
  if (!frame) return null;
  return <Image src={frame.photoSmall} alt="" width={width} height={Math.round(width / frame.ratio)} sizes={sizes} />;
}
