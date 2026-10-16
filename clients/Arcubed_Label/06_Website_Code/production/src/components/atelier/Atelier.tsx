"use client";

// Arcubed Atelier — the colour studio Rand approved (2026-10-13), used in
// three places:
//   mode "shop"   the product page: real, purchasable colours only, with
//                 Add to Cart / Save Changes wired to the existing cart
//   mode "client" /atelier-preview: the demonstration shared with Rand
//   mode "admin"  /admin/colour-lab: the same, with internal wording
//
// ONE BAG, ONE PHOTOGRAPH. Each bag has a locked photograph (PREVIEW_SOURCES,
// `locked`). Every colour recolours that same image in the browser, so the
// angle, silhouette, handle and background never change; only the yarn does.
// What the stage draws for a catalogue colour, in order of preference:
//   1. the locked photograph's own colour: the photograph, unchanged
//   2. a colour Rand photographed: recoloured to that photographed yarn
//   3. a colour published from the colour workflow (no bag photograph yet):
//      recoloured to its measured yarn colour (colours.hex_value), borrowing
//      shading from the real yarns of the same material
//   4. anything the locked photograph cannot show faithfully (two-tone
//      Silver & Gold; a colour too light for the photograph): in the shop,
//      that colour's own real photograph if one exists, labelled as such;
//      elsewhere, crossed out with the reason. Never a misleading render.
//
// Ordering goes through the same cart line, snapshot and server-side price
// authority as before (src/lib/orders.ts recomputes every amount).

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Bag, CartItem, Selection } from "@/lib/types";
import { buildCartSnapshot, computeUnitPrice, defaultSelectionFor, isOptIn, money } from "@/lib/pricing";
import { useCart, uid } from "@/lib/cart-context";
import { showToast } from "@/lib/toast";
import { altFor, framesForColour } from "@/lib/product-media";
import RecolourStage, { loadSource, SOURCE_COLOUR_KEY } from "@/components/customizer/RecolourStage";
import { profilesFor } from "@/lib/recolour/data";
import { labToSrgb, srgbToLab, hexToRgb, buildLut, renderInto, type PreviewColour, type YarnProfile } from "@/lib/recolour/engine";
import { PREVIEW_COLOURS, PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";
import { variantHref } from "@/lib/variant";
import { SWATCH_FOCUS, SWATCH_SPAN } from "@/lib/swatch";
import { sourceUrl } from "@/lib/recolour/data";

export type AtelierMode = "shop" | "client" | "admin";

const toHex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
const HEX = /^#[0-9a-f]{6}$/i;

const STAGE_SIZES = "(max-width: 767px) 100vw, 62vw";

/** A photographed colour's flat tone (shown until its texture loads): the
 *  measured mid-tone of Rand's yarn. Two-tone colourways split the swatch. */
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

/** A photographed colour's swatch: a close-up of its own photograph's
 *  stitches, pre-cut by scripts/build-swatches.mjs (192px, a few KB). */
function photoChip(bag: Bag, name: string, flat: string): React.CSSProperties {
  const f = framesForColour(bag, name).find((x) => !x.detail);
  if (!f) return { background: flat };
  return { background: flat, backgroundImage: `url(/media/swatch/${f.frameId}.webp)`, backgroundSize: "cover" };
}

/** How the stage shows one catalogue colour. */
type Render =
  | { kind: "source" }                                   // the locked photograph itself
  | { kind: "profile"; profile: YarnProfile }            // Rand's photographed yarn
  | { kind: "measured"; value: string }                  // published colour, measured yarn colour
  | { kind: "photo"; reason: string }                    // shop: its own photograph instead
  | { kind: "none"; reason: string };                    // cannot be shown faithfully

type Choice = { kind: "real"; colourId: string } | { kind: "exp"; key: string };
type PillOption = { id: string | null; label: string; delta: number; disabled?: boolean };

/** One option group: a heading and slim outlined pills. Prices are the catalogue's. */
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

export default function Atelier({
  bag,
  productionTime,
  mode,
  initialColourId = null,
  editingLine = null,
}: {
  bag: Bag;
  productionTime: string | null;
  mode: AtelierMode;
  /** Shop: the colourway from the URL, resolved server-side. */
  initialColourId?: string | null;
  /** Shop: the cart line being edited (?edit=), if any. */
  editingLine?: CartItem | null;
}) {
  const shop = mode === "shop", client = mode === "client";
  const router = useRouter();
  const { addOrUpdateLine, openCartDrawer } = useCart();
  const addLock = useRef(-1000);

  const refs = profilesFor(bag.slug);
  const sources = PREVIEW_SOURCES[bag.slug] ?? [];
  const source = sources.find((s) => s.locked) ?? sources.find((s) => !s.evaluation);
  const maxL = source?.maxLightness;
  const tooLight = (hex: string) => maxL !== undefined && srgbToLab(...hexToRgb(hex))[0] > maxL;
  const profileOf = (name: string) => refs.find((r) => r.product === bag.slug && r.colour.toLowerCase() === name.toLowerCase());

  const renderOf = (c: Bag["colours"][number]): Render => {
    const hasPhoto = framesForColour(bag, c.name).length > 0;
    const unable = (reason: string): Render => (shop && hasPhoto ? { kind: "photo", reason } : { kind: "none", reason });
    if (source && c.name.toLowerCase() === source.colour.toLowerCase()) return { kind: "source" };
    if (c.isTwoTone || c.name.includes("&")) return unable("two yarns, which one single-yarn photograph cannot show");
    const p = profileOf(c.name);
    if (p) return maxL !== undefined && p.midLab[0] > maxL ? unable("too light for this photograph") : { kind: "profile", profile: p };
    if (c.hex && HEX.test(c.hex)) return tooLight(c.hex) ? unable("too light for this photograph") : { kind: "measured", value: c.hex.toLowerCase() };
    return unable("no yarn reference yet");
  };
  const showable = (c: Bag["colours"][number]) => renderOf(c).kind !== "none";

  // Experimental previews: admin and client only. The shop shows the catalogue.
  const experimental = shop ? [] : PREVIEW_COLOURS.filter(
    (c) => c.products.includes(bag.slug) && !bag.colours.some((bc) => bc.name.toLowerCase() === c.name.toLowerCase()),
  );

  const [selection, setSelection] = useState<Selection>(() => {
    if (editingLine) {
      return {
        colourId: editingLine.colourId, secondaryColourId: editingLine.secondaryColourId, sizeId: editingLine.sizeId,
        strapId: editingLine.strapId, handleId: editingLine.handleId, chainId: editingLine.chainId, addonIds: [...editingLine.addonIds],
      };
    }
    const sel = defaultSelectionFor(bag, initialColourId);
    const def = bag.colours.find((c) => c.id === sel.colourId);
    if (shop || (def && showable(def))) return sel;
    // admin / client: start on a colour the photograph can show
    const alt = bag.colours.find((c) => c.name === source?.colour) ?? bag.colours.find(showable);
    return alt ? { ...sel, colourId: alt.id, secondaryColourId: null } : sel;
  });
  const [choice, setChoice] = useState<Choice>(() => ({ kind: "real", colourId: selection.colourId }));
  const [swatchTex, setSwatchTex] = useState<Record<string, string>>({});
  const [aboutColours, setAboutColours] = useState(false);
  const [sizeGuide, setSizeGuide] = useState(false);
  // Phones, shop only: a slim bar with the price and Add to cart while the
  // panel's own button is still below the screen. It never shows once that
  // button has been reached, so it never covers what comes after it.
  const buyRef = useRef<HTMLDivElement>(null);
  const [buyBelow, setBuyBelow] = useState(false);
  useEffect(() => {
    const el = buyRef.current;
    if (!shop || !el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setBuyBelow(!e.isIntersecting && e.boundingClientRect.top > 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [shop]);
  const [fx, fy] = SWATCH_FOCUS[bag.slug] ?? [0.5, 0.55];
  const price = computeUnitPrice(bag, selection);

  const realColour = bag.colours.find((c) => c.id === (choice.kind === "real" ? choice.colourId : selection.colourId)) ?? bag.colours[0];
  const expColour = choice.kind === "exp" ? experimental.find((c) => c.key === choice.key) ?? null : null;
  const render = renderOf(realColour);
  const identity = !expColour && render.kind === "source";
  const photoFrame = !expColour && render.kind === "photo" ? framesForColour(bag, realColour.name)[0] : null;

  // What the canvas draws (null: no canvas, the stage shows a photograph).
  const stageColour: PreviewColour | null = expColour
    ? expColour
    : render.kind === "source"
      ? { key: SOURCE_COLOUR_KEY, name: realColour.name, swatch: "", value: "#000000", products: [bag.slug] }
      : render.kind === "profile"
        ? { key: `real-${realColour.name}`, name: realColour.name, swatch: "", value: toHex(labToSrgb(render.profile.midLab[0], render.profile.midLab[1], render.profile.midLab[2])), products: [bag.slug] }
        : render.kind === "measured"
          ? { key: `measured-${realColour.name}-${render.value}`, name: realColour.name, swatch: render.value, value: render.value, products: [bag.slug] }
          : null;
  const stageProfiles = render.kind === "profile" && !expColour ? [render.profile] : refs;
  const choiceKey = choice.kind === "exp" ? `exp:${choice.key}` : `real:${choice.colourId}`;

  // Crossfade: the outgoing picture is copied onto a canvas above the stage
  // and faded out once the incoming one is on screen: never a blank or a jump.
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
    ctx.drawImage(shown, (W - dw) / 2, H - dh, dw, dh); // contained, centred, standing on the floor
    g.style.transition = "none";
    g.style.opacity = "1";
  };

  const photoId = photoFrame?.frameId ?? null;
  useEffect(() => {
    const g = ghostRef.current, box = frameRef.current;
    if (!pending.current || !g || !box) return;
    pending.current = false;
    let off = false, frames = 0;
    const fade = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (off) return;
      g.style.transition = "opacity 0.18s ease-out";
      g.style.opacity = "0";
    }));
    if (photoId) {
      // A photograph: fade once it has decoded (or after ~1.5s regardless).
      const tick = () => {
        if (off) return;
        frames++;
        const img = [...box.querySelectorAll("img")].find((i) => (i.currentSrc || i.src).includes(photoId));
        if ((img && img.complete && img.naturalWidth > 0) || frames > 90) fade(); else requestAnimationFrame(tick);
      };
      tick();
    } else if (source) loadSource(source.frame).then(fade, fade);
    else fade();
    return () => { off = true; };
  }, [choiceKey, source, photoId]);

  // Swatch textures for colours with no photograph of their own (experimental
  // previews, published colours): the same close-up, recoloured by the engine
  // from the locked photograph, so every swatch shows crochet, not a flat chip.
  const textured = [
    ...experimental.map((c) => ({ key: `exp:${c.key}`, colour: c, profiles: refs })),
    ...bag.colours.flatMap((c) => {
      const r = renderOf(c);
      return r.kind === "measured" && !framesForColour(bag, c.name).length
        ? [{ key: `real:${c.id}`, colour: { key: c.id, name: c.name, swatch: r.value, value: r.value, products: [bag.slug] } as PreviewColour, profiles: refs }]
        : [];
    }),
  ];
  const texturedKey = textured.map((t) => `${t.key}=${t.colour.value}`).join("|");
  useEffect(() => {
    if (!source || !textured.length) return;
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
      for (const t of textured) {
        const img = new ImageData(span, span);
        renderInto(img.data, rgba, mask, { bins, rank: src.analysis.rank }, buildLut(t.colour, t.profiles, src.analysis));
        ctx.putImageData(img, 0, 0);
        out[t.key] = canvas.toDataURL("image/webp", 0.9);
      }
      setSwatchTex(out);
    });
    return () => { off = true; };
    // `textured` derives from the bag and texturedKey; recomputed when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bag.slug, source?.frame, texturedKey]);

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
  // A strap or a chain, not both (client rule, 2026-09). Same as before.
  const pickStrap = (strapId: string | null) => setSelection((p) => ({ ...p, strapId, chainId: strapId ? null : p.chainId }));
  const pickChain = (chainId: string | null) => setSelection((p) => ({ ...p, chainId, strapId: chainId ? null : p.strapId }));

  function handleAdd(e: React.MouseEvent) {
    const now = e.timeStamp;
    if (now - addLock.current < 800) return; // one press, one bag
    addLock.current = now;
    const line: CartItem = {
      kind: "made_to_order",
      lineId: editingLine?.lineId ?? uid(),
      bagId: bag.id,
      colourId: selection.colourId,
      secondaryColourId: selection.secondaryColourId,
      sizeId: selection.sizeId,
      strapId: selection.strapId,
      handleId: selection.handleId,
      chainId: selection.chainId,
      addonIds: [...selection.addonIds],
      qty: editingLine?.qty ?? 1,
      unitPrice: price,
      snapshot: buildCartSnapshot(bag, selection),
    };
    const lineId = addOrUpdateLine(line, editingLine?.lineId ?? null);
    if (editingLine) {
      showToast("Cart updated.");
      router.push("/cart");
      return;
    }
    openCartDrawer(lineId);
  }

  const stageImage = (src: string, alt: string, key: string) => (
    <Image key={key} src={src} alt={alt} fill sizes={STAGE_SIZES} quality={90} priority className="at-photo" />
  );
  // Shown only until the first canvas draw: the locked photograph itself, in
  // exactly the canvas's placement. It is the SAME file the recolouring engine
  // loads (loadSource), so the photograph is downloaded once, not twice.
  const lockedPhoto = source ? (
    // eslint-disable-next-line @next/next/no-img-element -- the engine's own source file; next/image would fetch a second copy
    <img key="locked" src={sourceUrl(source.frame)} alt={`${bag.name} in ${source.colour}, photograph`} className="at-photo" fetchPriority="high" decoding="async" />
  ) : null;

  const opt = (o: { id: string; label: string; priceDelta: number; compatibleWith?: string[] }): PillOption => ({
    id: o.id, label: o.label, delta: o.priceDelta,
    disabled: !!o.compatibleWith && !o.compatibleWith.includes(selection.colourId),
  });
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
  const limited = bag.colours.filter((c) => renderOf(c).kind === "none");
  const limitText = (c: Bag["colours"][number]) => { const r = renderOf(c); return r.kind === "none" || r.kind === "photo" ? r.reason : ""; };
  const refused = experimental.filter((c) => tooLight(c.value));
  const NameTag = shop ? "h1" : "h2";

  // Shop: Rand's own photographs of the chosen colour, under the studio, so a
  // customer can always see the real bag in that colour (details included).
  const realPhotos = shop ? framesForColour(bag, realColour.name) : [];

  return (
    <>
    <div className="at" data-bag={bag.slug}>
      <div className="at-media">
        <div className="at-stage">
          <div className="at-set" aria-hidden="true" />
          <p className="at-word" aria-hidden="true">{bag.name}</p>
          <div className="at-frame" ref={frameRef} data-frame={photoFrame ? photoFrame.frameId : source?.frame} data-render={expColour ? "preview" : render.kind}>
            {photoFrame ? (
              stageImage(`/media/${photoFrame.frameId}-tile-2600.webp`, `${bag.name} in ${realColour.name}, photograph`, `photo-${photoFrame.frameId}`)
            ) : source && stageColour ? (
              <RecolourStage
                frame={source.frame}
                colour={stageColour}
                profiles={stageProfiles}
                fallback={lockedPhoto}
                alt={expColour
                  ? `Digital colour preview of the ${bag.name} in ${expColour.name}`
                  : identity
                    ? `${bag.name} in ${realColour.name}, photograph`
                    : `${bag.name} in ${realColour.name}, shown on the ${source.colour} photograph`}
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
          <NameTag className="at-name">{bag.name}</NameTag>
          <p className="at-price">{money(price)}</p>
          <p className="at-tag">Make it yours.</p>
          <p className="at-lead">Handmade to order{productionTime ? <><br />{productionTime}</> : null}</p>
        </div>

        <section className="at-colour" aria-labelledby="at-colour-h">
          <div className="at-group-head">
            <h3 id="at-colour-h" className="at-h">Colour</h3>
            <Info label={client ? "About these colours" : "About our colours"} open={aboutColours} onToggle={() => setAboutColours((v) => !v)} controls="at-about-colours" />
          </div>
          {aboutColours && shop ? (
            <p id="at-about-colours" className="at-note">
              Every colour is shown on one photograph of the {bag.name}{source ? ` (in ${source.colour})` : ""}, so you see the
              same bag each time and only the yarn changes. Each colour is matched to the real yarn it is crocheted in; the
              finished bag may differ slightly.
              {bag.colours.filter((c) => renderOf(c).kind === "photo").map((c) => ` ${c.name} is shown in its own photograph: it uses two yarns.`).join("")}
            </p>
          ) : aboutColours && client ? (
            <p id="at-about-colours" className="at-note">
              Every colour is shown on the same photograph of your {bag.name}: only the yarn changes. Collection colours are
              matched to your own photographs of each yarn. New colours are digital previews of how the bag could look, not
              photographs of finished bags.
              {limited.map((c) => ` ${c.name} isn’t shown here: it uses two yarns, which a photograph of one yarn can’t recreate faithfully.`).join("")}
              {refused.length ? ` ${refused.map((c) => c.name).join(", ")} ${refused.length > 1 ? "aren’t" : "isn’t"} available for the ${bag.name} yet: its photograph is too dark to show light colours faithfully.` : ""}
            </p>
          ) : aboutColours ? (
            <p id="at-about-colours" className="at-note">
              Every colour is shown on the same photograph of the {bag.name}{source ? ` (the ${source.colour} one)` : ""}: only the yarn changes.
              Real colours are recoloured to Rand&rsquo;s own photographed yarn of that colour (or, for a colour published from the
              colour workflow, its measured yarn colour). Preview colours are digital, for admin review, and cannot be ordered.
              {limited.map((c) => ` ${c.name} is crossed out: ${limitText(c)}.`).join("")}
              {refused.length ? ` ${refused.map((c) => c.name).join(", ")} ${refused.length > 1 ? "are" : "is"} crossed out: too light for this photograph.` : ""}
            </p>
          ) : null}

          {shop ? null : <p className="at-sub">{client ? "Collection colours" : "Real colours"}</p>}
          <div className={`at-swatches${shop ? " at-swatches-shop" : ""}`} role="group" aria-label={`${bag.name} colours`}>
            {bag.colours.map((c) => {
              const on = choice.kind === "real" && c.id === choice.colourId;
              const r = renderOf(c);
              const off = r.kind === "none";
              const tex = swatchTex[`real:${c.id}`];
              const style = framesForColour(bag, c.name).length
                ? photoChip(bag, c.name, realSwatch(c.name, refs, bag.slug, c.hex ?? null))
                : { background: c.hex ?? "#d8d8d8", backgroundImage: tex ? `url(${tex})` : undefined, backgroundSize: "cover" };
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`at-sw${on ? " is-on" : ""}${off ? " is-off" : ""}`}
                  aria-pressed={on}
                  disabled={off}
                  aria-label={off ? `${c.name}: ${r.reason}` : c.name}
                  title={off ? `${c.name}: ${r.reason}` : undefined}
                  onClick={() => pickReal(c.id)}
                >
                  <span className="at-dot" style={style} />
                  <span className="at-sw-name">{c.name}</span>
                </button>
              );
            })}
          </div>
          {experimental.length && source ? (
            <>
              {client ? (
                <>
                  <p className="at-sub">Explore new colours <span className="at-sub-dim">· Digital previews</span></p>
                  <p className="at-note at-note-intro">
                    These digital previews show how your bags could look in additional colours. Final colours can be confirmed
                    before adding them to the collection.
                  </p>
                </>
              ) : (
                <p className="at-sub">Preview colours <span className="at-sub-dim">· Admin review · Not for sale</span></p>
              )}
              <div className="at-swatches" role="group" aria-label={client ? "New colours, digital previews" : "Preview colours, digital, not for sale"}>
                {experimental.map((c) => {
                  const off = tooLight(c.value);
                  const on = choice.kind === "exp" && choice.key === c.key;
                  const tex = swatchTex[`exp:${c.key}`];
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={`at-sw is-exp${on ? " is-on" : ""}${off ? " is-off" : ""}`}
                      aria-pressed={on}
                      disabled={off}
                      aria-label={off ? `${c.name}: too light for this photograph` : `${c.name}, digital preview${client ? "" : ", not for sale"}`}
                      title={off ? `${c.name}: too light for this photograph` : undefined}
                      onClick={() => pickExp(c.key)}
                    >
                      <span className="at-dot" style={{ background: c.swatch, backgroundImage: tex ? `url(${tex})` : undefined, backgroundSize: "cover" }} />
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

        {shop ? (
          <div className="at-buy" ref={buyRef}>
            <button type="button" className="at-add" onClick={handleAdd}>
              <span>{editingLine ? "Save changes" : "Add to cart"}</span>
              <span className="at-add-price">{money(price)}</span>
            </button>
            <p className="at-buy-note">
              {photoFrame
                ? <>Pictured: the {bag.name} in {realColour.name}. </>
                : identity
                  ? <>Pictured: the {bag.name} in {realColour.name}. </>
                  : <>{realColour.name} yarn, shown on our {source?.colour} {bag.name} photograph. </>}
              100% cotton yarn, hand-crocheted. Spot clean, air dry.
            </p>
            <div className={`at-buybar${buyBelow ? " is-on" : ""}`} aria-hidden={!buyBelow}>
              <span className="at-buybar-txt"><span>{bag.name} · {realColour.name}</span><strong>{money(price)}</strong></span>
              <button type="button" className="at-add at-add-sm" onClick={handleAdd} tabIndex={buyBelow ? 0 : -1}>
                {editingLine ? "Save" : "Add to cart"}
              </button>
            </div>
          </div>
        ) : (
          <div className={`at-notice${expColour ? " is-preview" : ""}`} role="status">
            {expColour ? (
              <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path d="M2.5 14S7 6.5 14 6.5 25.5 14 25.5 14 21 21.5 14 21.5 2.5 14 2.5 14Z" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="14" cy="14" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="14" cy="14" r="1.6" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9 14.3l3.3 3.2L19.2 10.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
            <div>
              {expColour && client ? (
                <>
                  <p className="at-notice-h">Digital preview</p>
                  <p>A digital example of the {bag.name} in {expColour.name}, not a photograph of a finished bag. It can be confirmed before it&rsquo;s added to the collection.</p>
                </>
              ) : expColour ? (
                <>
                  <p className="at-notice-h">Preview only</p>
                  <p>This colour is a digital preview and is not available to order.</p>
                </>
              ) : client ? (
                <>
                  <p className="at-notice-h">In the collection</p>
                  <p>
                    {identity
                      ? <>Your photograph of the {bag.name} in {realColour.name}.</>
                      : source ? <>Shown on the {source.colour} photograph, matched to your {realColour.name} yarn.</> : null}
                  </p>
                </>
              ) : (
                <>
                  <p className="at-notice-h">{identity ? "Photographed colour" : "Confirmed colour"}</p>
                  <p>
                    {identity
                      ? <>Rand&rsquo;s photograph of the {bag.name} in {realColour.name}. </>
                      : render.kind === "measured" && source
                        ? <>Shown on the {source.colour} photograph, recoloured to its measured yarn colour {render.value}. </>
                        : source ? <>Shown on the {source.colour} photograph, recoloured to Rand&rsquo;s {realColour.name} yarn. </> : null}
                    <Link href={variantHref(bag.slug, realColour.name)} className="at-link">Order {realColour.name} on the shop</Link>
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    {realPhotos.length ? (
      <section className="at-photos" aria-label={`${bag.name} in ${realColour.name}, photographed`}>
        <h2 className="at-photos-h">Photographed in {realColour.name}</h2>
        <ul className="at-photos-row">
          {realPhotos.map((f) => (
            <li key={f.frameId}>
              <Image src={f.photo} alt={f.alt ?? altFor(bag, realColour.name)} width={900} height={Math.round(900 / f.ratio)}
                sizes="(max-width: 767px) 72vw, 30vw" loading="lazy" className="at-photo-img" />
            </li>
          ))}
        </ul>
      </section>
    ) : null}
    </>
  );
}
