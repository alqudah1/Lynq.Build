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
  // Prefer the QA-passed alpha cut-out on the product stage: the bag floats on
  // the page instead of sitting inside a grey studio rectangle. Frames whose
  // cut-out failed QA (REJECTED_CUTOUTS) and DB-imported images keep the full
  // photograph — a bad matte is worse than a visible seamless.
  const useCut = current.cutOk;
  return (
    <div className="pg">
      <div className={`pg-main${useCut ? " is-cut" : ""}`}>
        <Image
          // NO key HERE, DELIBERATELY. Keying by frame id remounted the
          // element on every thumbnail tap, so the stage went EMPTY until the
          // next photograph arrived: measured at 0.4-1.1s per tap on a
          // throttled phone connection, a blank pink box where the bag was.
          // Re-using the element swaps the source and the browser keeps the
          // previous frame painted until the new one decodes.
          src={useCut ? current.cut : current.photo}
          // A macro frame carries its own description. The generic alt says
          // "Loco, hand-crocheted by Arcubed in Brown", which is a lie about
          // a picture that shows six inches of stitching.
          alt={current.alt ?? altFor(bag, shown, exact)}
          width={1600}
          height={Math.round(1600 / current.ratio)}
          // Two different stages share this element, so one budget cannot serve
          // both: a cut-out sits on the 62vw object stage, while a photograph
          // now runs full-bleed. Declaring the photograph at 100vw is what
          // stops Next handing back a 1200px derivative for a 1440px box.
          sizes={useCut ? "(max-width: 860px) 96vw, 62vw" : "100vw"}
          // The primary product image is the largest thing on the page and
          // the one a customer studies. 75 leaves visible blocking in the
          // crochet.
          quality={90}
          loading="eager"
          fetchPriority="high"
          className="pg-img"
        />
      </div>

      {!exact && shown ? (
        <p className="pg-note">
          Pictured in <strong>{shown}</strong>. Photography of this colourway is coming. The bag
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
              aria-label={
                f.detail
                  ? `View close detail of the ${bag.name}, photograph ${i + 1} of ${frames.length}`
                  : `View ${bag.name} photograph ${i + 1} of ${frames.length}`
              }
              className={`pg-thumb${i === active ? " is-on" : ""}`}
              onClick={() => setActive(i)}
            >
              {/* 160, not 128. The thumb is 108 CSS px and cover crops up to
                  23% of the file away before it is drawn, so a 128px
                  candidate left 99 source pixels on 106 physical ones — the
                  last two under-resolved images on the site. The next rung up
                  costs about 2kB. */}
              <Image src={f.photoSmall} alt="" width={320} height={Math.round(320 / f.ratio)} sizes="160px" />
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
