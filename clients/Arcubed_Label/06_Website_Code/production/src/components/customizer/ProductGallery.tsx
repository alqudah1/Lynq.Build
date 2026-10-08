"use client";

// Product gallery. Media precedence:
//   1. approved production 3D (bag.model3D) — none exists for any product yet
//   2. real photography of the SELECTED colourway
//   3. an APPROVED colour preview of the selected colourway, labelled as a
//      preview (src/lib/colour-previews.ts — empty today: every confirmed
//      colourway is photographed)
//   4. real photography of another colourway, explicitly labelled as such
//   5. the illustrated placeholder — unreachable while (2) resolves
//
// The honesty rule that governs this file: never present a photograph of one
// colourway as if it were another. When only another colourway is available,
// the image is shown WITH a visible note naming what is pictured, so the
// customer is never misled about what they are buying.

import { useEffect, useMemo, useState } from "react";
import Image, { getImageProps } from "next/image";
import type { Bag, Selection } from "@/lib/types";
import { toRenderInput, resolveProductImages } from "@/lib/pricing";
import { framesForColour, resolveMedia, altFor, type Frame } from "@/lib/product-media";
import { previewFor } from "@/lib/colour-previews";
import BagArt from "../BagArt";
import BagViewer3D from "../three/BagViewer3D";

/** Everything that decides which file the stage downloads, in one place, so
 *  the preloader below asks for byte-for-byte the same derivative. */
function stageImage(frame: Frame) {
  const useCut = frame.cutOk;
  return {
    src: useCut ? frame.cut : frame.photo,
    width: 1600,
    height: Math.round(1600 / frame.ratio),
    // Two different stages share this element, so one budget cannot serve
    // both: a cut-out sits on the 62vw object stage, while a photograph
    // now runs full-bleed. Declaring the photograph at 100vw is what
    // stops Next handing back a 1200px derivative for a 1440px box.
    sizes: useCut ? "(max-width: 860px) 96vw, 62vw" : "100vw",
    // The primary product image is the largest thing on the page and
    // the one a customer studies. 75 leaves visible blocking in the
    // crochet.
    quality: 90,
  };
}

/**
 * Warms the browser cache with the first stage photograph of every other
 * colourway, so choosing a colour shows it at once instead of after a
 * download (measured: 1.2-3.9s of waiting per new colour on a throttled
 * phone without this, about one frame with it).
 *
 * It costs data — on a DPR3 phone, Nova's six colourways add about 1.2MB and
 * Mini Luna's about 1.4MB — so it only starts when the colour swatches come
 * near the screen (on a product page that is almost always on arrival — the
 * row sits at the fold), then waits for the browser to be idle. Never for a
 * visitor who has asked to save data or is on 3G or slower. Without it, the
 * previous photograph still stays on the stage until the next one is ready
 * (see Photos), so nobody sees an empty stage.
 */
function usePreloadColourways(bag: Bag) {
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    // Fast connections only. Safari has no connection API, so iPhones (most
    // of Arcubed's visitors, arriving from Instagram) count as fast.
    if (conn?.saveData || ["slow-2g", "2g", "3g"].includes(conn?.effectiveType ?? "")) return;
    let cancelled = false;
    const warmed: HTMLImageElement[] = [];
    const run = () => {
      if (cancelled) return;
      for (const colour of bag.colours) {
        const frame = framesForColour(bag, colour.name)[0] ?? previewFor(bag, colour.name)?.frames[0];
        if (!frame) continue;
        const { props } = getImageProps({ ...stageImage(frame), alt: "" });
        const img = new window.Image();
        img.decoding = "async";
        img.fetchPriority = "low";
        if (props.sizes) img.sizes = props.sizes;
        if (props.srcSet) img.srcset = props.srcSet;
        img.src = props.src;
        warmed.push(img);
      }
    };
    const idle = () => ("requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 1500));
    // Intent: the swatch row within 300px of the viewport. One observer, and
    // it disconnects after the first hit, so this runs at most once per bag.
    const row = document.querySelector(".swatch-row");
    let io: IntersectionObserver | null = null;
    const start = () => {
      if (!row || !("IntersectionObserver" in window)) return idle();
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io?.disconnect(); idle(); }
      }, { rootMargin: "300px 0px" });
      io.observe(row);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      io?.disconnect();
      window.removeEventListener("load", start);
      for (const img of warmed) img.src = "";
    };
  }, [bag]);
}

function Photos({ bag, selection }: { bag: Bag; selection: Selection }) {
  const colourName = bag.colours.find((c) => c.id === selection.colourId)?.name ?? null;

  const { frames, exact, shown, previewOf } = useMemo(() => {
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
        previewOf: null,
      };
    }
    const own = framesForColour(bag, colourName);
    if (own.length) return { frames: own, exact: true, shown: colourName, previewOf: null };
    const preview = previewFor(bag, colourName);
    if (preview?.frames.length) return { frames: preview.frames, exact: true, shown: colourName, previewOf: preview.sourceColour };
    const fallback = resolveMedia(bag, colourName);
    return fallback
      ? { frames: [fallback.frame], exact: false, shown: fallback.shownColour, previewOf: null }
      : { frames: [], exact: false, shown: null, previewOf: null };
  }, [bag, selection, colourName]);

  // Selected thumbnail, reset to the first shot when the colour changes.
  // This used to be done by REMOUNTING the gallery on every colour change,
  // which threw away the stage <img>: the stage went blank until the new
  // colour's photograph arrived — measured at 1.2-3.9s on a throttled phone
  // for a colour not yet viewed. Resetting here (React's "adjust state when a
  // prop changes" pattern) keeps the element, so the previous photograph stays
  // painted until the next one has decoded, as thumbnail taps already did.
  const [view, setView] = useState({ colourId: selection.colourId, index: 0 });
  if (view.colourId !== selection.colourId) setView({ colourId: selection.colourId, index: 0 });
  const active = view.colourId === selection.colourId ? view.index : 0;
  const setActive = (index: number) => setView({ colourId: selection.colourId, index });

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
          // src, size budget and quality: stageImage(), shared with the preloader.
          {...stageImage(current)}
          // NO key HERE, DELIBERATELY. Keying by frame id remounted the
          // element on every thumbnail tap, so the stage went EMPTY until the
          // next photograph arrived: measured at 0.4-1.1s per tap on a
          // throttled phone connection, a blank pink box where the bag was.
          // Re-using the element swaps the source and the browser keeps the
          // previous frame painted until the new one decodes.
          // A macro frame carries its own description. The generic alt says
          // "Loco, hand-crocheted by Arcubed in Brown", which is a lie about
          // a picture that shows six inches of stitching.
          alt={current.alt ?? altFor(bag, shown, exact)}
          loading="eager"
          fetchPriority="high"
          className="pg-img"
        />
      </div>

      {previewOf ? (
        <p className="pg-note">
          Colour preview of <strong>{shown}</strong>, made from a photograph of the {previewOf}{" "}
          {bag.name}. Not a photograph of this colourway.
        </p>
      ) : null}
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
  // NOT keyed on the colourway any more — see the thumbnail state in Photos.
  usePreloadColourways(bag);
  const fallback = <Photos bag={bag} selection={selection} />;

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
