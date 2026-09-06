"use client";

// Crossfade preview, ported from the prototype's updatePreview() in customizer.js:
// each selection change appends a new layer on top and fades the previous one
// out, rather than replacing the image outright — keeps the <300ms crossfade feel
// with no flash of empty content.
//
// REAL-PHOTO FALLBACK RULE (motion-and-art-direction.md): production 3D →
// real photography → BagArt. When bag.model3D is set (a real GLB has been
// linked via product_models — true for zero real products today), this
// renders the interactive 3D viewer, live-bound to `selection`. Otherwise
// (and as BagViewer3D's own fallback if the model fails to load), each
// crossfade layer independently resolves: a real photo for THIS layer's
// exact selection if one exists in product_images, BagArt otherwise — so a
// customer can cross a real-photo colourway and a not-yet-photographed one
// in the same session without either looking broken.

import { useEffect, useRef, useState } from "react";
import type { Bag, Selection } from "@/lib/types";
import { toRenderInput, resolveProductImages } from "@/lib/pricing";
import { resolveProductMediaForColour } from "@/lib/product-media";
import BagArt from "../BagArt";
import BagViewer3D from "../three/BagViewer3D";

interface Layer {
  key: number;
  selection: Selection;
  show: boolean;
}

// One crossfade layer's content — a real photo if this exact selection has
// one, BagArt otherwise. Never fakes a photorealistic recolour: a colour
// with no real photo always falls to the honest illustrative placeholder,
// it never reuses a different colour's real photo.
function LayerContent({ bag, selection }: { bag: Bag; selection: Selection }) {
  const images = resolveProductImages(bag, selection);
  const primary = images[0];
  if (primary) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- real photo
      // host isn't fixed yet, see CartLineItem.tsx's note.
      <img src={primary.url} alt={`${bag.name} — real product photography`} />
    );
  }

  // Second tier: real client photography imported to /media, matched on the
  // SELECTED COLOURWAY. Keyed by colour precisely so a customer looking at
  // Black never gets shown the Gold frame — a photo of the wrong colourway is
  // worse than the honest illustration, because it looks authoritative.
  const colourName = bag.colours.find((c) => c.id === selection.colourId)?.name ?? null;
  const media = resolveProductMediaForColour(bag, colourName);
  if (media) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- same note
      <img src={media.src} alt={media.alt} />
    );
  }

  return <BagArt input={toRenderInput(bag, selection)} />;
}

function MediaCrossfade({ bag, selection }: { bag: Bag; selection: Selection }) {
  const nextKey = useRef(1);
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, selection, show: true }]);
  const isFirst = useRef(true);
  const addonIdsKey = selection.addonIds.join(",");

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    const key = nextKey.current++;
    setLayers((prev) => [...prev, { key, selection, show: false }]);

    const showId = requestAnimationFrame(() => {
      setLayers((prev) => prev.map((l) => (l.key === key ? { ...l, show: true } : l)));
    });
    const cleanupId = setTimeout(() => {
      setLayers((prev) => {
        const idx = prev.findIndex((l) => l.key === key);
        return idx > 0 ? prev.slice(idx) : prev;
      });
    }, 320);

    return () => {
      cancelAnimationFrame(showId);
      clearTimeout(cleanupId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selection.colourId,
    selection.secondaryColourId,
    selection.strapId,
    selection.handleId,
    selection.chainId,
    addonIdsKey,
  ]);

  return (
    <>
      {layers.map((l) => (
        <div className={`bag-art-layer${l.show ? " show" : ""}`} key={l.key}>
          <LayerContent bag={bag} selection={l.selection} />
        </div>
      ))}
    </>
  );
}

export default function ProductGallery({ bag, selection }: { bag: Bag; selection: Selection }) {
  const fallback = <MediaCrossfade bag={bag} selection={selection} />;

  if (!bag.model3D) {
    return (
      <div className="product-media">
        <div className="media-frame">{fallback}</div>
      </div>
    );
  }

  const render = toRenderInput(bag, selection);
  const strap = bag.straps?.find((s) => s.id === selection.strapId);
  const chain = bag.chains?.find((c) => c.id === selection.chainId);
  const handle = bag.handles?.find((h) => h.id === selection.handleId);

  return (
    <div className="product-media">
      <div className="media-frame">
        <BagViewer3D
          label={bag.name}
          body={bag.model3D}
          primaryColourHex={render.colourHex}
          secondaryColourHex={render.secondaryColourHex}
          strap={strap?.model3D}
          chain={chain?.model3D}
          handle={handle?.model3D}
          fallback={fallback}
        />
      </div>
    </div>
  );
}
