"use client";

// Arcubed Atelier — the customer-facing composition of the colour preview
// work, reviewed behind admin sign-in before anything reaches the shop.
//
// ONE BAG, ONE PHOTOGRAPH. Each bag has a locked photograph (chosen from
// all of Rand's frames, see PREVIEW_SOURCES). Every swatch — a confirmed
// colourway or an experimental one — recolours that same image, so the
// angle, silhouette, handle and background never change; only the yarn
// does. Confirmed colourways are calibrated to Rand's own photographed yarn
// of that colour; the locked photograph's own colour is shown unchanged.
// Two-tone colourways cannot be produced from a single-yarn photograph and
// are marked as such.
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
import Image from "next/image";
import Link from "next/link";
import type { Bag, Selection } from "@/lib/types";
import { computeUnitPrice, defaultSelectionFor, isOptIn, money } from "@/lib/pricing";
import { framesForColour } from "@/lib/product-media";
import RecolourStage, { loadSource, SOURCE_COLOUR_KEY } from "@/components/customizer/RecolourStage";
import { profilesFor } from "@/lib/recolour/data";
import { labToSrgb, srgbToLab, hexToRgb, buildLut, renderInto, type PreviewColour, type YarnProfile } from "@/lib/recolour/engine";
import { PREVIEW_COLOURS, PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";
import { variantHref } from "@/lib/variant";

const toHex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");


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
/** Why a confirmed colourway cannot be shown on the locked photograph, or null. */
function realLimit(name: string, profile: YarnProfile | undefined, maxLightness: number | undefined): string | null {
  if (name.includes("&")) return "two yarns, which one single-yarn photograph cannot show";
  if (!profile) return "no photographed yarn reference";
  if (maxLightness !== undefined && profile.midLab[0] > maxLightness) return "too light for this photograph";
  return null;
}

type PillOption = { id: string | null; label: string; delta: number; disabled?: boolean };

/** One option group: a heading and slim outlined pills (the reference's
 *  controls). Price differences are the catalogue's, never the reference's. */
function Pills({ label, options, value, onPick, aside }: {
  label: string; options: PillOption[]; value: string | null; onPick: (id: string | null) => void; aside?: React.ReactNode;
}) {
  return (
    <div className="at-group" role="group" aria-label={label}>
      <div className="at-group-head">
        <h3 className="at-h">{label}</h3>
        {aside}
      </div>
      <div className="at-pills">
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id ?? "none"}
              type="button"
              className={`at-pill${on ? " is-on" : ""}`}
              aria-pressed={on}
              disabled={o.disabled}
              title={o.disabled ? "Unavailable in this colour" : undefined}
              onClick={() => onPick(o.id)}
            >
              {o.label}{o.delta ? ` (+${money(o.delta)})` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A small "about" toggle beside a heading, opening a note in place. */
function Info({ label, open, onToggle, controls }: { label: string; open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button type="button" className="at-info" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span>{label}</span>
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.1" /><path d="M8 7v4.2M8 4.6v.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
    </button>
  );
}

export default function ColourStudio({ bag, productionTime }: { bag: Bag; productionTime: string | null }) {
  const refs = profilesFor(bag.slug);
  const sources = PREVIEW_SOURCES[bag.slug] ?? [];
  const source = sources.find((s) => s.locked) ?? sources.find((s) => !s.evaluation);
  const profileOf = (name: string) => refs.find((r) => r.product === bag.slug && r.colour.toLowerCase() === name.toLowerCase());
  const limitOf = (name: string) => realLimit(name, profileOf(name), source?.maxLightness);
  const isSourceColour = (name: string) => !!source && name.toLowerCase() === source.colour.toLowerCase();
  const experimental = PREVIEW_COLOURS.filter(
    (c) => c.products.includes(bag.slug) && !bag.colours.some((bc) => bc.name.toLowerCase() === c.name.toLowerCase()),
  );
  const tooLight = (hex: string) => source?.maxLightness !== undefined && srgbToLab(...hexToRgb(hex))[0] > source.maxLightness;

  const [selection, setSelection] = useState<Selection>(() => {
    const sel = defaultSelectionFor(bag);
    const def = bag.colours.find((c) => c.id === sel.colourId);
    if (def && !realLimit(def.name, profilesFor(bag.slug).find((r) => r.product === bag.slug && r.colour === def.name), undefined)) return sel;
    const src = (PREVIEW_SOURCES[bag.slug] ?? []).find((s) => s.locked);
    const alt = bag.colours.find((c) => c.name === src?.colour);
    return alt ? { ...sel, colourId: alt.id, secondaryColourId: null } : sel;
  });
  // Start on the default colourway when it can be shown, else on the locked
  // photograph's own colour.
  const [choice, setChoice] = useState<Choice>(() => {
    const def = bag.colours.find((c) => c.id === selection.colourId);
    const fallback = bag.colours.find((c) => isSourceColour(c.name));
    return { kind: "real", colourId: def && !limitOf(def.name) ? def.id : fallback?.id ?? selection.colourId };
  });
  const [expSwatches, setExpSwatches] = useState<Record<string, string>>({});
  const [aboutColours, setAboutColours] = useState(false);
  const [sizeGuide, setSizeGuide] = useState(false);
  const [fx, fy] = SWATCH_FOCUS[bag.slug] ?? [0.5, 0.55];
  const price = computeUnitPrice(bag, selection);

  const realColour = bag.colours.find((c) => c.id === (choice.kind === "real" ? choice.colourId : selection.colourId))!;
  const expColour = choice.kind === "exp" ? experimental.find((c) => c.key === choice.key) ?? null : null;
  const identity = !expColour && isSourceColour(realColour.name);
  // What the stage draws: the locked photograph unchanged, recoloured to a
  // confirmed colourway's own measured yarn, or to an experimental colour.
  const realProfile = profileOf(realColour.name);
  const stageColour: PreviewColour | null = expColour
    ? expColour
    : identity
      ? { key: SOURCE_COLOUR_KEY, name: realColour.name, swatch: "", value: "#000000", products: [bag.slug] }
      : realProfile
        ? { key: `real-${realColour.name}`, name: realColour.name, swatch: "", value: toHex(labToSrgb(realProfile.midLab[0], realProfile.midLab[1], realProfile.midLab[2])), products: [bag.slug] }
        : null;
  const stageProfiles = expColour || identity || !realProfile ? refs : [realProfile];
  const choiceKey = choice.kind === "exp" ? `exp:${choice.key}` : `real:${choice.colourId}`;

  // Crossfade: the outgoing bag is copied onto a canvas above the stage and
  // faded out once the incoming one is on screen, so a colour change reads
  // as the bag changing colour, never as a blank or a jump.
  const frameRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const pending = useRef(false);

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
    const g = ghostRef.current;
    if (!pending.current || !g) return;
    pending.current = false;
    let off = false;
    // Same photograph, same placement: only the yarn changes, so a short
    // dissolve is enough. RecolourStage draws as soon as the (cached) source
    // resolves; this waits on the same promise, so it fades after the draw.
    const fade = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (off) return;
      g.style.transition = "opacity 0.18s ease-out";
      g.style.opacity = "0";
    }));
    if (source) loadSource(source.frame).then(fade, fade); else fade();
    return () => { off = true; };
  }, [choiceKey, source]);

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
    snapshot();
    pending.current = true;
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
    pending.current = true;
    setChoice({ kind: "exp", key });
  };
  // Strap or chain, not both — the same rule as the shop.
  const pickStrap = (strapId: string | null) => setSelection((p) => ({ ...p, strapId, chainId: strapId ? null : p.chainId }));
  const pickChain = (chainId: string | null) => setSelection((p) => ({ ...p, chainId, strapId: chainId ? null : p.strapId }));

  // Shown only until the first canvas draw: the locked photograph itself,
  // in exactly the canvas's placement.
  const lockedPhoto = source ? (
    <Image
      key="locked"
      src={`/media/${source.frame}-tile-2600.webp`}
      alt={`${bag.name} in ${source.colour}, photograph`}
      fill
      sizes={STAGE_SIZES}
      quality={90}
      priority
      className="at-photo"
    />
  ) : null;

  const opt = (o: { id: string; label: string; priceDelta: number; compatibleWith?: string[] }): PillOption => ({
    id: o.id, label: o.label, delta: o.priceDelta,
    disabled: !!o.compatibleWith && !o.compatibleWith.includes(selection.colourId),
  });
  // Strap and chain are one choice (a bag takes one or the other), so one
  // group: None, each strap, each chain. Ids are prefixed by kind.
  const straps = bag.straps ?? [], chains = bag.chains ?? [];
  const carryLabel = straps.length && chains.length ? "Strap or chain" : straps.length ? "Strap" : "Chain";
  const carryValue = selection.strapId ? `s:${selection.strapId}` : selection.chainId ? `c:${selection.chainId}` : null;
  const carryOptions: PillOption[] = [
    { id: null, label: "None", delta: 0 },
    ...straps.map((o) => ({ ...opt(o), id: `s:${o.id}` })),
    ...chains.map((o) => ({ ...opt(o), id: `c:${o.id}` })),
  ];
  const pickCarry = (id: string | null) => {
    if (!id) { pickStrap(null); pickChain(null); return; }
    if (id.startsWith("s:")) pickStrap(id.slice(2)); else pickChain(id.slice(2));
  };
  const handleOptions = bag.handles?.length ? (isOptIn(bag.handles) ? [{ id: null, label: "None", delta: 0 }, ...bag.handles.map(opt)] : bag.handles.map(opt)) : [];
  const limited = bag.colours.filter((c) => limitOf(c.name));
  const refused = experimental.filter((c) => tooLight(c.value));

  return (
    <div className="at" data-bag={bag.slug}>
      <div className="at-media">
        <div className="at-stage">
          <div className="at-set" aria-hidden="true" />
          <p className="at-word" aria-hidden="true">{bag.name}</p>
          <div className="at-frame" ref={frameRef} data-frame={source?.frame}>
            {source && stageColour ? (
              <RecolourStage
                frame={source.frame}
                colour={stageColour}
                profiles={stageProfiles}
                fallback={lockedPhoto}
                alt={expColour
                  ? `Digital colour preview of the ${bag.name} in ${expColour.name}`
                  : identity
                    ? `${bag.name} in ${realColour.name}, photograph`
                    : `${bag.name} in ${realColour.name}, recoloured from the ${source.colour} photograph`}
              />
            ) : (
              lockedPhoto
            )}
            <canvas ref={ghostRef} className="at-ghost" aria-hidden="true" />
          </div>
          <p className="at-meta at-meta-tl">{money(price)}</p>
          <p className="at-meta at-meta-tr">Handmade<br />in Jordan</p>
          <p className="at-meta at-meta-bl">Arcubed<br />Atelier</p>
          <p className="at-meta at-meta-br">One bag<br />endless colours</p>
        </div>
      </div>

      <div className="at-rail">
        <div className="at-head">
          <h2 className="at-name">{bag.name}</h2>
          <p className="at-price">{money(price)}</p>
          <p className="at-tag">Make it yours.</p>
          <p className="at-lead">Handmade to order{productionTime ? <><br />{productionTime}</> : null}</p>
        </div>

        <section className="at-colour" aria-labelledby="at-colour-h">
          <div className="at-group-head">
            <h3 id="at-colour-h" className="at-h">Colour</h3>
            <Info label="About our colours" open={aboutColours} onToggle={() => setAboutColours((v) => !v)} controls="at-about-colours" />
          </div>
          {aboutColours ? (
            <p id="at-about-colours" className="at-note">
              Every colour is shown on the same photograph of the {bag.name}{source ? ` (the ${source.colour} one)` : ""}: only the yarn changes.
              Real colours are recoloured to Rand&rsquo;s own photographed yarn of that colour. Preview colours are digital, for admin
              review, and cannot be ordered.
              {limited.map((c) => ` ${c.name} is crossed out: ${limitOf(c.name)}.`).join("")}
              {refused.length ? ` ${refused.map((c) => c.name).join(", ")} ${refused.length > 1 ? "are" : "is"} crossed out: too light for this photograph.` : ""}
            </p>
          ) : null}

          <p className="at-sub">Real colours</p>
          <div className="at-swatches" role="group" aria-label={`${bag.name} real colours`}>
            {bag.colours.map((c) => {
              const on = choice.kind === "real" && c.id === choice.colourId;
              const limit = limitOf(c.name);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`at-sw${on ? " is-on" : ""}${limit ? " is-off" : ""}`}
                  aria-pressed={on}
                  disabled={!!limit}
                  aria-label={limit ? `${c.name}: ${limit}` : `${c.name}, real colour`}
                  title={limit ? `${c.name}: ${limit}` : undefined}
                  onClick={() => pickReal(c.id)}
                >
                  <span className="at-dot" style={realChip(bag, c.name, realSwatch(c.name, refs, bag.slug, c.hex ?? null), fx, fy)} />
                  <span className="at-sw-name">{c.name}</span>
                </button>
              );
            })}
          </div>
          {experimental.length && source ? (
            <>
              <p className="at-sub">Preview colours <span className="at-sub-dim">· Admin review · Not for sale</span></p>
              <div className="at-swatches" role="group" aria-label="Preview colours, digital, not for sale">
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
                      aria-label={off ? `${c.name}: too light for this photograph` : `${c.name}, digital preview, not for sale`}
                      title={off ? `${c.name}: too light for this photograph` : undefined}
                      onClick={() => pickExp(c.key)}
                    >
                      <span
                        className="at-dot"
                        style={{ background: c.swatch, backgroundImage: expSwatches[c.key] ? `url(${expSwatches[c.key]})` : undefined, backgroundSize: "cover" }}
                      />
                      <span className="at-sw-name">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>

        {bag.sizes?.length ? (
          <Pills
            label="Size"
            options={bag.sizes.map(opt)}
            value={selection.sizeId}
            onPick={(sizeId) => sizeId && setSelection((p) => ({ ...p, sizeId }))}
            aside={bag.sizes.some((s) => s.note) ? <Info label="Size guide" open={sizeGuide} onToggle={() => setSizeGuide((v) => !v)} controls="at-size-guide" /> : null}
          />
        ) : null}
        {sizeGuide && bag.sizes?.length ? (
          <dl id="at-size-guide" className="at-guide">
            {bag.sizes.filter((s) => s.note).map((s) => <div key={s.id}><dt>{s.label}</dt><dd>{s.note}</dd></div>)}
          </dl>
        ) : null}
        {handleOptions.length ? (
          <Pills label="Handle" options={handleOptions} value={selection.handleId} onPick={(handleId) => setSelection((p) => ({ ...p, handleId }))} />
        ) : null}
        {straps.length || chains.length ? (
          <Pills label={carryLabel} options={carryOptions} value={carryValue} onPick={pickCarry} />
        ) : null}

        <div className={`at-notice${expColour ? " is-preview" : ""}`} role="status">
          {expColour ? (
            <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path d="M2.5 14S7 6.5 14 6.5 25.5 14 25.5 14 21 21.5 14 21.5 2.5 14 2.5 14Z" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="14" cy="14" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="14" cy="14" r="1.6" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9 14.3l3.3 3.2L19.2 10.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
          <div>
            {expColour ? (
              <>
                <p className="at-notice-h">Preview only</p>
                <p>This colour is a digital preview and is not available to order.</p>
              </>
            ) : (
              <>
                <p className="at-notice-h">{identity ? "Photographed colour" : "Confirmed colour"}</p>
                <p>
                  {identity
                    ? <>Rand&rsquo;s photograph of the {bag.name} in {realColour.name}. </>
                    : source ? <>Shown on the {source.colour} photograph, recoloured to Rand&rsquo;s {realColour.name} yarn. </> : null}
                  <Link href={variantHref(bag.slug, realColour.name)} className="at-link">Order {realColour.name} on the shop</Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
