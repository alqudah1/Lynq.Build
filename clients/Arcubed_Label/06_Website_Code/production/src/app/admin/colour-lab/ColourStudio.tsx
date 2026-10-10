"use client";

// Arcubed Atelier — the customer-facing composition of the colour preview
// work, reviewed behind admin sign-in before anything reaches the shop.
//
// Composition: a campaign stage (the bag cut-out anchored low on the pale
// pink field, its colour name set large in white behind it) beside one
// compact rail: name and price, the selected colour, a single palette of
// circular material swatches, compact options, one status line. Product ->
// colour -> result -> configuration, with the bag always beside its
// controls. Phones keep the same stage, unpinned, with the palette directly
// beneath it.
//
// The shop's product page is untouched by this file. Nothing here can be
// ordered: there is no cart action at all. A photographed colour links to
// its real page on the shop; an experimental colour is marked as a digital
// preview that is not for sale everywhere it appears.

import { useEffect, useRef, useState } from "react";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import type { Bag, Selection } from "@/lib/types";
import { computeUnitPrice, defaultSelectionFor, isOptIn, money } from "@/lib/pricing";
import { framesForColour, altFor, type Frame } from "@/lib/product-media";
import RecolourStage, { loadSource } from "@/components/customizer/RecolourStage";
import { familyOf, profilesFor, SOURCES } from "@/lib/recolour/data";
import { labToSrgb, srgbToLab, hexToRgb, buildLut, renderInto, type YarnProfile } from "@/lib/recolour/engine";
import { PREVIEW_COLOURS, PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";
import { variantHref } from "@/lib/variant";

const toHex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

const MATERIAL: Record<string, string> = {
  "metallic-raffia": "Metallic raffia",
  "matte-cord": "Matte cord",
  "fringe-cord": "Fringe cord",
};

/** A real colourway's flat tone (shown until its texture loads): the
 *  measured mid-tone of Rand's photographed yarn, never a guessed value.
 *  Two-tone colourways split the swatch. */
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
/** Width of the close-up, as a fraction of the photograph: a few stitches
 *  across, so the swatch shows the material, not a flat colour. */
const SWATCH_SPAN = 0.08;

const STAGE_SIZES = "(max-width: 767px) 100vw, 62vw";

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
type SegOption = { id: string | null; label: string; delta: number; disabled?: boolean };

/** One option group as a compact segmented row: label, then the choices. */
function Segment({ label, options, value, onPick }: { label: string; options: SegOption[]; value: string | null; onPick: (id: string | null) => void }) {
  return (
    <div className="at-opt" role="group" aria-label={label}>
      <span className="at-opt-label" aria-hidden="true">{label}</span>
      <div className="at-seg">
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id ?? "none"}
              type="button"
              className={on ? "is-on" : undefined}
              aria-pressed={on}
              disabled={o.disabled}
              aria-label={`${label}: ${o.label}${o.delta ? `, plus ${money(o.delta)}` : ""}${o.disabled ? ", unavailable in this colour" : ""}`}
              onClick={() => onPick(o.id)}
            >
              {o.label}
              {o.delta ? <span className="at-delta">+{o.delta}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ColourStudio({ bag, index, total }: { bag: Bag; index: number; total: number }) {
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
  const [hover, setHover] = useState<string | null>(null);
  const [fx, fy] = SWATCH_FOCUS[bag.slug] ?? [0.5, 0.55];
  const price = computeUnitPrice(bag, selection);

  const realColour = bag.colours.find((c) => c.id === selection.colourId)!;
  const expColour = choice.kind === "exp" ? experimental.find((c) => c.key === choice.key) ?? null : null;
  const frame = framesForColour(bag, realColour.name)[0] ?? null;
  const shownName = expColour ? expColour.name : realColour.name;
  const choiceKey = choice.kind === "exp" ? `exp:${choice.key}` : `real:${choice.colourId}`;

  // Crossfade: the outgoing bag is copied onto a canvas above the stage and
  // faded out once the incoming one is on screen, so a colour change reads
  // as the bag changing colour, never as a blank or a jump.
  const frameRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const pending = useRef<{ kind: "exp" } | { kind: "real"; frameId: string } | null>(null);

  const snapshot = () => {
    const box = frameRef.current, g = ghostRef.current;
    if (!box || !g || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const shown = [...box.querySelectorAll<HTMLCanvasElement | HTMLImageElement>(".rc-canvas, img")].find((el) =>
      getComputedStyle(el).visibility !== "hidden" &&
      (el instanceof HTMLCanvasElement ? el.width > 0 : el.complete && el.naturalWidth > 0));
    if (!shown) return;
    const W = box.clientWidth, H = box.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    const iw = shown instanceof HTMLCanvasElement ? shown.width : shown.naturalWidth;
    const ih = shown instanceof HTMLCanvasElement ? shown.height : shown.naturalHeight;
    const s = Math.min(W / iw, H / ih), dw = iw * s, dh = ih * s;
    g.width = Math.round(W * dpr); g.height = Math.round(H * dpr);
    const ctx = g.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // the same placement as the CSS: contained, centred, standing on the floor
    ctx.drawImage(shown, (W - dw) / 2, H - dh, dw, dh);
    g.style.transition = "none";
    g.style.opacity = "1";
  };

  useEffect(() => {
    const p = pending.current, g = ghostRef.current, box = frameRef.current;
    pending.current = null;
    if (!p || !g || !box) return;
    let off = false;
    const fade = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (off) return;
      g.style.transition = "opacity 0.36s cubic-bezier(0.2, 0.6, 0.2, 1)";
      g.style.opacity = "0";
    }));
    if (p.kind === "exp" && source) {
      // RecolourStage draws as soon as the (cached) source resolves; this
      // waits on the same promise, so the fade starts after the new colour.
      loadSource(source.frame).then(fade, fade);
    } else if (p.kind === "real") {
      let frames = 0; // give up waiting after ~1.5s of frames
      const tick = () => {
        if (off) return;
        frames++;
        const img = [...box.querySelectorAll("img")].find((i) => (i.currentSrc || i.src).includes(p.frameId));
        if ((img && img.complete && img.naturalWidth > 0) || frames > 90) fade();
        else requestAnimationFrame(tick);
      };
      tick();
    } else fade();
    return () => { off = true; };
  }, [choiceKey, source]);

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
    if (choice.kind === "real" && choice.colourId === colourId) return;
    const f = framesForColour(bag, bag.colours.find((c) => c.id === colourId)?.name)[0];
    snapshot();
    pending.current = f ? { kind: "real", frameId: f.frameId } : null;
    setChoice({ kind: "real", colourId });
    setSelection((prev) => ({
      ...prev,
      colourId,
      secondaryColourId: bag.colours.find((c) => c.id === colourId)?.isTwoTone ? colourId : null,
    }));
  };
  const pickExp = (key: string) => {
    if (choice.kind === "exp" && choice.key === key) return;
    snapshot();
    pending.current = { kind: "exp" };
    setChoice({ kind: "exp", key });
  };
  // Strap or chain, not both — the same rule as the shop.
  const pickStrap = (strapId: string | null) => setSelection((p) => ({ ...p, strapId, chainId: strapId ? null : p.chainId }));
  const pickChain = (chainId: string | null) => setSelection((p) => ({ ...p, chainId, strapId: chainId ? null : p.strapId }));

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
      className="at-photo"
    />
  ) : null;

  const opts = (list: { id: string; label: string; priceDelta: number; compatibleWith?: string[] }[], strip?: RegExp): SegOption[] =>
    list.map((o) => ({
      id: o.id,
      label: strip ? o.label.replace(strip, "").trim() || o.label : o.label,
      delta: o.priceDelta,
      disabled: !!o.compatibleWith && !o.compatibleWith.includes(selection.colourId),
    }));
  const withNone = (list: { priceDelta: number }[], o: SegOption[]) => (isOptIn(list) ? [{ id: null, label: "None", delta: 0 }, ...o] : o);
  const sizeNote = bag.sizes?.find((s) => s.id === selection.sizeId)?.note;
  const material = MATERIAL[familyOf(bag.slug) ?? ""];
  // The stage takes its proportion from the bag's photograph: wide bags get
  // a wider stage, so the field never turns into empty pink around them.
  const srcInfo = source ? SOURCES[source.frame] : null;
  const r = (srcInfo ? srcInfo.width / srcInfo.height : 1.4) * 0.6;
  const ar = Math.min(1.15, Math.max(0.82, r));
  // Phones: never taller than wide-ish, so the palette stays right below.
  const arPhone = Math.min(1.15, Math.max(0.98, r));
  // Hovering another swatch previews its name in the colour line.
  const hovered = hover && hover !== shownName ? hover : null;

  return (
    <div className="at" style={{ ["--at-ar" as string]: ar.toFixed(3), ["--at-ar-phone" as string]: arPhone.toFixed(3) }}>
      <div className="at-media">
        <div className="at-stage">
          <p className="at-meta at-meta-tl">
            <span>Nº {String(index + 1).padStart(2, "0")}</span>
            <span className="at-meta-dim">/ {String(total).padStart(2, "0")}</span>
          </p>
          <p className={`at-meta at-meta-tr${expColour ? " is-preview" : ""}`}>{expColour ? "Digital preview" : "Photograph"}</p>
          <p key={shownName} className="at-word" aria-hidden="true">{shownName}</p>
          <div className="at-frame" ref={frameRef}>
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
            <canvas ref={ghostRef} className="at-ghost" aria-hidden="true" />
          </div>
          {material ? <p className="at-meta at-meta-bl">{material}</p> : null}
          <p className="at-meta at-meta-br">Arcubed Atelier</p>
        </div>
      </div>

      <div className="at-rail">
        <div className="at-head">
          <h2 className="at-name">{bag.name}</h2>
          <p className="at-price" aria-label={`Price ${money(price)}`}>{money(price)}</p>
        </div>

        <section className="at-colour" aria-label="Colour">
          <p className="at-line">
            <span className="at-line-label">Colour</span>
            <span className={`at-line-name${hovered ? " is-hover" : ""}`}>{hovered ?? shownName}</span>
            {!hovered ? <span className="at-line-kind">{expColour ? "Preview · not for sale" : "Photographed"}</span> : null}
          </p>
          <div className="at-palette">
            <div className="at-swatches" role="group" aria-label={`${bag.name} colours, photographed`}>
              {bag.colours.map((c) => {
                const on = choice.kind === "real" && c.id === selection.colourId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`at-sw${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    aria-label={`${c.name}, photographed colour`}
                    title={c.name}
                    onClick={() => pickReal(c.id)}
                    onMouseEnter={() => setHover(c.name)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <span className="at-dot" style={realChip(bag, c.name, realSwatch(c.name, refs, bag.slug, c.hex ?? null), fx, fy)} />
                  </button>
                );
              })}
            </div>
            {experimental.length && source ? (
              <div className="at-swatches at-swatches-exp" role="group" aria-label="Experimental colours, digital previews, not for sale">
                {experimental.map((c) => {
                  const off = tooLight(c.value);
                  const on = choice.kind === "exp" && choice.key === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={`at-sw is-exp${on ? " is-on" : ""}${off ? " is-off" : ""}`}
                      aria-pressed={on}
                      disabled={off}
                      aria-label={off ? `${c.name}: no reliable preview for this bag` : `${c.name}, digital preview, not for sale`}
                      title={off ? `${c.name} — no reliable preview` : `${c.name} — digital preview`}
                      onClick={() => pickExp(c.key)}
                      onMouseEnter={() => setHover(c.name)}
                      onMouseLeave={() => setHover(null)}
                    >
                      <span
                        className="at-dot"
                        style={{ background: c.swatch, backgroundImage: expSwatches[c.key] ? `url(${expSwatches[c.key]})` : undefined, backgroundSize: "cover" }}
                      />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {experimental.length && source ? (
            <p className="at-legend">
              <span className="at-legend-ring" aria-hidden="true" />
              Digital previews · admin review, not for sale
              {experimental.some((c) => tooLight(c.value)) ? <> · crossed out: too light for this photograph</> : null}
            </p>
          ) : null}
        </section>

        <div className="at-options">
          {bag.sizes?.length ? (
            <Segment label="Size" options={opts(bag.sizes)} value={selection.sizeId} onPick={(sizeId) => sizeId && setSelection((p) => ({ ...p, sizeId }))} />
          ) : null}
          {sizeNote ? <p className="at-note">{sizeNote}</p> : null}
          {bag.handles?.length ? (
            <Segment label="Handle" options={withNone(bag.handles, opts(bag.handles))} value={selection.handleId}
              onPick={(handleId) => setSelection((p) => ({ ...p, handleId }))} />
          ) : null}
          {bag.straps?.length ? (
            <Segment label="Strap" options={withNone(bag.straps, opts(bag.straps, /\s*strap$/i))} value={selection.strapId} onPick={pickStrap} />
          ) : null}
          {bag.chains?.length ? (
            <Segment label="Chain" options={withNone(bag.chains, opts(bag.chains, /\s*chain$/i))} value={selection.chainId} onPick={pickChain} />
          ) : null}
          {bag.straps?.length && bag.chains?.length ? <p className="at-note">A strap or a chain, not both.</p> : null}
        </div>

        <p className={`at-status${expColour ? " is-preview" : ""}`} role="status">
          {expColour && source ? (
            <>
              <strong>Not available to order.</strong> {expColour.name} is an unconfirmed colour, recoloured from the {source.colour} {bag.name} photograph.
            </>
          ) : (
            <>
              <strong>Confirmed colour.</strong>{" "}
              <Link href={variantHref(bag.slug, realColour.name)} className="at-link">View {realColour.name} on the shop</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
