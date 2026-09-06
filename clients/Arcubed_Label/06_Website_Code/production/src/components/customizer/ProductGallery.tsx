"use client";

// Product gallery. Media precedence:
//   1. approved production 3D (bag.model3D) — none exists for any product yet
//   2. real photography of the SELECTED colourway
//   3. real photography of another colourway, explicitly labelled as such
//   4. the illustrated placeholder — unreachable while (2) resolves
//
// The honesty rule that governs this file: never present a photograph of one
// colourway as if it were another. When only another colourway is available,
// the image is shown WITH a visible note naming what is pictured, so the
// customer is never misled about what they are buying.

import { useMemo, useState } from "react";
import Image from "next/image";
import type { Bag, Selection } from "@/lib/types";
import { toRenderInput, resolveProductImages } from "@/lib/pricing";
import { framesForColour, resolveMedia, altFor, type Frame } from "@/lib/product-media";
import BagArt from "../BagArt";
import BagViewer3D from "../three/BagViewer3D";

function Photos({ bag, selection }: { bag: Bag; selection: Selection }) {
  const colourName = bag.colours.find((c) => c.id === selection.colourId)?.name ?? null;

  const { frames, exact, shown } = useMemo(() => {
    // Imported database photography wins outright when it exists.
    const db = resolveProductImages(bag, selection);
    if (db.length) {
      return {
        frames: db.map<Frame>((img) => ({
          photo: img.url, photoSmall: img.url, cut: img.url, cutSmall: img.url,
          ratio: 1.4, frameId: img.id, cutOk: false,
        })),
        exact: true,
        shown: colourName,
      };
    }
    const own = framesForColour(bag, colourName);
    if (own.length) return { frames: own, exact: true, shown: colourName };
    const fallback = resolveMedia(bag, colourName);
    return fallback
      ? { frames: [fallback.frame], exact: false, shown: fallback.shownColour }
      : { frames: [], exact: false, shown: null };
  }, [bag, selection, colourName]);

  // Selected thumbnail. Reset on colour change is handled by REMOUNTING this
  // component (see the `key` where it's rendered) rather than by setting state
  // in an effect — same result, no cascading render.
  const [active, setActive] = useState(0);

  if (!frames.length) return <BagArt input={toRenderInput(bag, selection)} />;

  const current = frames[Math.min(active, frames.length - 1)];
  return (
    <div className="pg">
      <div className="pg-main">
        <Image
          key={current.frameId}
          src={current.photo}
          alt={altFor(bag, shown, exact)}
          width={1600}
          height={Math.round(1600 / current.ratio)}
          sizes="(max-width: 860px) 100vw, 52vw"
          priority
          className="pg-img"
        />
      </div>

      {!exact && shown ? (
        <p className="pg-note">
          Pictured in <strong>{shown}</strong>. Photography of this colourway is coming — the bag
          shape and construction are identical.
        </p>
      ) : null}

      {frames.length > 1 ? (
        <div className="pg-thumbs" role="tablist" aria-label={`${bag.name} photographs`}>
          {frames.map((f, i) => (
            <button
              key={f.frameId}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`View ${bag.name} photograph ${i + 1} of ${frames.length}`}
              className={`pg-thumb${i === active ? " is-on" : ""}`}
              onClick={() => setActive(i)}
            >
              <Image src={f.photoSmall} alt="" width={200} height={Math.round(200 / f.ratio)} sizes="90px" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ProductGallery({ bag, selection }: { bag: Bag; selection: Selection }) {
  // Keyed on the colourway: changing colour swaps in a different set of
  // photographs, so the gallery starts again at its first shot.
  const fallback = <Photos key={selection.colourId} bag={bag} selection={selection} />;

  if (!bag.model3D) return <div className="product-media">{fallback}</div>;

  const render = toRenderInput(bag, selection);
  const strap = bag.straps?.find((s) => s.id === selection.strapId);
  const chain = bag.chains?.find((c) => c.id === selection.chainId);
  const handle = bag.handles?.find((h) => h.id === selection.handleId);

  return (
    <div className="product-media">
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
  );
}
