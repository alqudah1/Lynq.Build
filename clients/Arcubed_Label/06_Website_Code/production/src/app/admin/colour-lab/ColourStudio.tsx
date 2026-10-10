"use client";

// Arcubed Colour Studio — the customer-facing composition of the colour
// preview work, reviewed behind admin sign-in before anything reaches the
// shop. The bag is the hero; colour is chosen beside it, so the result of a
// choice is always in view.
//
// It deliberately does NOT reuse the shop's product-page Customizer layout:
// that layout stacks the stage above the options (the bag scrolled away
// while choosing), fits colour swatches to 62px photo-tile columns
// (experimental colour labels overflowed their columns and overlapped), and
// carries a fixed purchase bar that covered content. The shop's product page
// is untouched by this file.
//
// Nothing here can be ordered: there is no cart action at all. A
// photographed colour links to its real page on the shop.

import { useEffect, useState } from "react";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import type { Bag, Selection } from "@/lib/types";
import { computeUnitPrice, defaultSelectionFor, money } from "@/lib/pricing";
import { framesForColour, altFor, type Frame } from "@/lib/product-media";
import RecolourStage, { loadSource } from "@/components/customizer/RecolourStage";
import SizeSelector from "@/components/customizer/SizeSelector";
import StrapHandleSelector from "@/components/customizer/StrapHandleSelector";
import { profilesFor, SOURCES } from "@/lib/recolour/data";
import { labToSrgb, srgbToLab, hexToRgb, buildLut, renderInto, type YarnProfile } from "@/lib/recolour/engine";
import { PREVIEW_COLOURS, PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";
import { variantHref } from "@/lib/variant";

const toHex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

/** A real colourway's swatch: the measured mid-tone of Rand's photographed
 *  yarn, never a guessed value. Two-tone colourways split the swatch. */
function realSwatch(name: string, refs: YarnProfile[], slug: string, fallback: string | null): string {
  const tone = (n: string) => {
    const p = refs.find((r) => r.product === slug && r.colour.toLowerCase() === n.trim().toLowerCase());
    return p ? toHex(labToSrgb(p.midLab[0], p.midLab[1], p.midLab[2])) : null;
  };
  if (name.includes("&")) {
    const [a, b] = name.split("&").map((s) => tone(s));
    if (a && b) return `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)`;
  }
  return tone(name) ?? fallback ?? "#d8d8d8";
}

/** The image the stage shows for a photographed colourway: the field-safe
 *  tile cut-out (made for coloured backgrounds), else the cut-out, else the
 *  framed photograph. `failed` lists sources that did not load. */
function stageSrc(frame: Frame, failed: Set<string> = new Set()): string {
  const tile = `/media/${frame.frameId}-tile-2600.webp`;
  if (!failed.has(tile)) return tile;
  return frame.cutOk && !failed.has(frame.cut) ? frame.cut : frame.photo;
}

/** Where each bag's swatch close-up is taken (fractions of the photograph):
 *  on the body's stitches — not Mini Luna's handle arch, not Loco's fringe. */
const SWATCH_FOCUS: Record<string, [number, number]> = {
  nova: [0.5, 0.56], "mini-luna": [0.5, 0.74], vault: [0.5, 0.62], loco: [0.5, 0.34],
};
/** Width of the close-up, as a fraction of the photograph: about three
 *  stitches across, so the swatch shows the material, not a flat colour. */
const SWATCH_SPAN = 0.1;

const STAGE_SIZES = "(max-width: 767px) 100vw, (max-width: 1099px) 56vw, 60vw";

/** A photographed colour's swatch: a close-up of its own photograph's
 *  stitches, over its measured mid-tone (shown until the image loads). */
function realChip(bag: Bag, name: string, flat: string, fx: number, fy: number): React.CSSProperties {
  const f = framesForColour(bag, name)[0];
  if (!f) return { background: flat };
  const zoom = 100 / SWATCH_SPAN;
  // background-position maps the focus point of the photograph to the
  // middle of the chip: p = (f - span/2) / (1 - span), as a percentage.
  const pos = (v: number) => `${(((v - SWATCH_SPAN / 2) / (1 - SWATCH_SPAN)) * 100).toFixed(2)}%`;
  return {
    background: flat,
    backgroundImage: `url(/media/${f.frameId}-tile-1200.webp)`,
    backgroundSize: `${zoom}% auto`,
    backgroundPosition: `${pos(fx)} ${pos(fy)}`,
    backgroundRepeat: "no-repeat",
  };
}

type Choice = { kind: "real"; colourId: string } | { kind: "exp"; key: string };

export default function ColourStudio({ bag }: { bag: Bag }) {
  const refs = profilesFor(bag.slug);
  const source = (PREVIEW_SOURCES[bag.slug] ?? []).find((s) => !s.evaluation);
  const experimental = PREVIEW_COLOURS.filter(
    (c) => c.products.includes(bag.slug) && !bag.colours.some((bc) => bc.name.toLowerCase() === c.name.toLowerCase()),
  );
  const tooLight = (hex: string) => source?.maxLightness !== undefined && srgbToLab(...hexToRgb(hex))[0] > source.maxLightness;

  const [selection, setSelection] = useState<Selection>(() => defaultSelectionFor(bag));
  const [choice, setChoice] = useState<Choice>(() => ({ kind: "real", colourId: selection.colourId }));
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [expSwatches, setExpSwatches] = useState<Record<string, string>>({});
  const [fx, fy] = SWATCH_FOCUS[bag.slug] ?? [0.5, 0.55];
  const price = computeUnitPrice(bag, selection);

  const realColour = bag.colours.find((c) => c.id === selection.colourId)!;
  const expColour = choice.kind === "exp" ? experimental.find((c) => c.key === choice.key) ?? null : null;
  const frame = framesForColour(bag, realColour.name)[0] ?? null;

  // The stage keeps one proportion per bag (from its photographs), so a
  // colour change never resizes it: Nova is wide, Mini Luna nearly square.
  const srcInfo = source ? SOURCES[source.frame] : null;
  const ratio = Math.min(1.6, Math.max(1.15, srcInfo ? srcInfo.width / srcInfo.height : 1.4));

  // Warm every photographed colourway's stage image once the page is idle,
  // with the same derivative the stage asks for, so switching is instant.
  useEffect(() => {
    const warmed: HTMLImageElement[] = [];
    const id = window.setTimeout(() => {
      for (const c of bag.colours) {
        const f = framesForColour(bag, c.name)[0];
        if (!f) continue;
        const { props } = getImageProps({ src: stageSrc(f), alt: "", fill: true, sizes: STAGE_SIZES, quality: 90 });
        const img = new window.Image();
        if (props.sizes) img.sizes = props.sizes;
        if (props.srcSet) img.srcset = props.srcSet;
        img.src = props.src;
        warmed.push(img);
      }
    }, 900);
    return () => { window.clearTimeout(id); for (const img of warmed) img.src = ""; };
  }, [bag]);

  // Experimental swatches: the same close-up, recoloured by the engine from
  // the source photograph, so photographed and experimental colours share
  // one swatch language (crochet texture, not a flat chip).
  useEffect(() => {
    if (!source) return;
    let off = false;
    loadSource(source.frame).then((src) => {
      if (off) return;
      const span = Math.round(src.w * SWATCH_SPAN);
      const x0 = Math.max(0, Math.min(src.w - span, Math.round(src.w * fx - span / 2)));
      const y0 = Math.max(0, Math.min(src.h - span, Math.round(src.h * fy - span / 2)));
      const n = span * span;
      const rgba = new Uint8ClampedArray(n * 4), mask = new Uint8ClampedArray(n), bins = new Uint16Array(n);
      for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
        const s = (y0 + y) * src.w + (x0 + x), d = y * span + x;
        rgba.set(src.rgba.subarray(s * 4, s * 4 + 4), d * 4); mask[d] = src.mask[s]; bins[d] = src.analysis.bins[s];
      }
      const canvas = document.createElement("canvas");
      canvas.width = span; canvas.height = span;
      const ctx = canvas.getContext("2d")!;
      const out: Record<string, string> = {};
      for (const c of experimental) {
        const img = new ImageData(span, span);
        renderInto(img.data, rgba, mask, { bins, rank: src.analysis.rank }, buildLut(c, refs, src.analysis));
        ctx.putImageData(img, 0, 0);
        out[c.key] = canvas.toDataURL("image/webp", 0.9);
      }
      setExpSwatches(out);
    });
    return () => { off = true; };
    // experimental and refs derive from the bag; recomputed per bag (the studio is keyed by bag).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bag.slug, source?.frame]);

  const pickReal = (colourId: string) => {
    setChoice({ kind: "real", colourId });
    setSelection((prev) => ({
      ...prev,
      colourId,
      secondaryColourId: bag.colours.find((c) => c.id === colourId)?.isTwoTone ? colourId : null,
    }));
  };
  // Strap or chain, not both — the same rule as the shop.
  const pickStrap = (strapId: string | null) => setSelection((p) => ({ ...p, strapId, chainId: strapId ? null : p.chainId }));
  const pickChain = (chainId: string | null) => setSelection((p) => ({ ...p, chainId, strapId: chainId ? null : p.strapId }));

  const shownName = expColour ? expColour.name : realColour.name;
  const photo = frame ? (
    <Image
      key="photo"
      src={stageSrc(frame, failed)}
      onError={() => setFailed((prev) => new Set(prev).add(stageSrc(frame, prev)))}
      alt={altFor(bag, realColour.name, true)}
      fill
      sizes={STAGE_SIZES}
      quality={90}
      priority
      className="cs-photo"
    />
  ) : null;

  return (
    <div className="cs" style={{ ["--cs-ratio" as string]: ratio }}>
      <div className="cs-media">
        <div className="cs-stage" aria-live="polite">
          <div className="cs-frame">
          {expColour && source ? (
            <RecolourStage
              frame={source.frame}
              colour={expColour}
              profiles={refs}
              fallback={photo}
              alt={`Digital colour preview of the ${bag.name} in ${expColour.name}`}
            />
          ) : (
            photo
          )}
          </div>
        </div>
        <p className={`cs-caption${expColour ? " is-preview" : ""}`}>
          {expColour && source ? (
            <>
              <span className="cs-tag">Digital colour preview</span>
              Recoloured from a photograph of the {source.colour} {bag.name}. Not a photograph of {expColour.name}.
            </>
          ) : (
            <>
              <span className="cs-tag">Photograph</span>
              {bag.name} in {realColour.name}, as it is made.
            </>
          )}
        </p>
      </div>

      <div className="cs-panel">
        <p className="cs-kicker">Colour Studio</p>
        <div className="cs-titlerow">
          <h2 className="cs-name">{bag.name}</h2>
          <p className="cs-price">{money(price)}</p>
        </div>

        <section className="cs-group" aria-labelledby="cs-colour-h">
          <h3 id="cs-colour-h" className="cs-label">
            Colour <span className="cs-label-value">{shownName}</span>
          </h3>
          <div className="cs-swatches" role="group" aria-label={`${bag.name} colours, photographed`}>
            {bag.colours.map((c) => {
              const on = choice.kind === "real" && c.id === selection.colourId;
              return (
                <button key={c.id} type="button" className={`cs-sw${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => pickReal(c.id)}>
                  <span className="cs-chip" style={realChip(bag, c.name, realSwatch(c.name, refs, bag.slug, c.hex ?? null), fx, fy)} aria-hidden="true" />
                  <span className="cs-sw-name">{c.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        {experimental.length && source ? (
          <section className="cs-group cs-exp" aria-labelledby="cs-exp-h">
            <h3 id="cs-exp-h" className="cs-label">
              Experimental colours <span className="cs-badge">Admin review · not for sale</span>
            </h3>
            <div className="cs-swatches" role="group" aria-label="Experimental colours, digital previews">
              {experimental.map((c) => {
                const off = tooLight(c.value);
                const on = choice.kind === "exp" && choice.key === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`cs-sw${on ? " is-on" : ""}${off ? " is-off" : ""}`}
                    aria-pressed={on}
                    disabled={off}
                    aria-label={off ? `${c.name}: no reliable preview for this bag` : `${c.name}, digital preview`}
                    onClick={() => setChoice({ kind: "exp", key: c.key })}
                  >
                    <span
                      className="cs-chip"
                      style={{ background: c.swatch, backgroundImage: expSwatches[c.key] ? `url(${expSwatches[c.key]})` : undefined, backgroundSize: "cover" }}
                      aria-hidden="true"
                    />
                    <span className="cs-sw-name">{c.name}</span>
                  </button>
                );
              })}
            </div>
            {experimental.some((c) => tooLight(c.value)) ? (
              <p className="cs-note">
                Crossed-out colours have no reliable preview: this bag&rsquo;s photograph is too dark to show them convincingly.
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="cs-options">
          {bag.sizes ? (
            <SizeSelector sizes={bag.sizes} selectedId={selection.sizeId} onSelect={(sizeId) => setSelection((p) => ({ ...p, sizeId }))} />
          ) : null}
          {bag.handles ? (
            <StrapHandleSelector label="Handle" kind="handle" bag={bag} options={bag.handles} selectedId={selection.handleId}
              colourId={selection.colourId} onSelect={(handleId) => setSelection((p) => ({ ...p, handleId }))} />
          ) : null}
          {bag.straps ? (
            <StrapHandleSelector label="Strap" kind="strap" bag={bag} options={bag.straps} selectedId={selection.strapId}
              colourId={selection.colourId} onSelect={pickStrap} />
          ) : null}
          {bag.chains ? (
            <StrapHandleSelector label="Chain" kind="chain" bag={bag} options={bag.chains} selectedId={selection.chainId}
              colourId={selection.colourId} onSelect={pickChain} />
          ) : null}
          {bag.straps?.length && bag.chains?.length ? <p className="cs-note">Choose a strap or a chain, not both.</p> : null}
        </div>

        <div className={`cs-status${expColour ? " is-preview" : ""}`} role="status">
          {expColour ? (
            <>
              <p className="cs-status-h">Not available to order</p>
              <p>{expColour.name} is an experimental colour shown only in this admin studio. Rand has not confirmed it.</p>
            </>
          ) : (
            <>
              <p className="cs-status-h">On the shop</p>
              <p>
                {bag.name} in {realColour.name} is a confirmed colour.{" "}
                <Link href={variantHref(bag.slug, realColour.name)} className="cs-link">View it on the shop</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
