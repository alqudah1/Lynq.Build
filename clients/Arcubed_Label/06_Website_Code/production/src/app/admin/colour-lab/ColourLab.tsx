"use client";

import { useEffect, useRef, useState } from "react";
import type { Bag } from "@/lib/types";
import Customizer from "@/components/customizer/Customizer";
import { loadSource } from "@/components/customizer/RecolourStage";
import { buildLut, renderInto, labToSrgb, srgbToLab, hexToRgb, type PreviewColour } from "@/lib/recolour/engine";
import { profilesFor } from "@/lib/recolour/data";
import { PREVIEW_COLOURS, PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";
import type { ApprovedPreview } from "@/lib/colour-previews";

const hex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

/** One recoloured frame drawn into its own canvas, with its render time. */
function Still({ slug, frame, colour, exclude }: { slug: string; frame: string; colour: PreviewColour | null; exclude?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    let off = false;
    loadSource(frame).then((src) => {
      const c = ref.current;
      if (off || !c) return;
      c.width = src.w; c.height = src.h;
      const ctx = c.getContext("2d")!;
      const img = new ImageData(src.w, src.h);
      const t0 = performance.now();
      if (colour) {
        const all = profilesFor(slug);
        const profiles = exclude ? all.filter((p) => !(p.colour === exclude && p.product === slug)) : all;
        renderInto(img.data, src.rgba, src.mask, src.analysis, buildLut(colour, profiles, src.analysis));
      } else {
        img.data.set(src.rgba);
      }
      ctx.putImageData(img, 0, 0);
      setMs(performance.now() - t0);
    });
    return () => { off = true; };
  }, [slug, frame, colour, exclude]);
  return (
    <figure className="cl-still">
      <canvas ref={ref} className="cl-canvas" />
      <figcaption>
        {colour ? `${colour.name} ${colour.value}` : "Original photograph"}
        {colour && ms !== null ? <span className="cl-ms"> · {ms.toFixed(0)}ms</span> : null}
      </figcaption>
    </figure>
  );
}

export default function ColourLab({ bags, productionTimeLabel }: { bags: Bag[]; productionTimeLabel: string | null }) {
  const [bagIdx, setBagIdx] = useState(0);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [mode, setMode] = useState<"preview" | "storefront">("preview");
  const bag = bags[bagIdx];
  const sources = PREVIEW_SOURCES[bag.slug] ?? [];
  const source = sources[Math.min(sourceIdx, sources.length - 1)];
  const profiles = profilesFor(bag.slug);
  const colours = PREVIEW_COLOURS.filter((c) => c.products.includes(bag.slug));
  const usable = colours.filter((c) => source.maxLightness === undefined || srgbToLab(...hexToRgb(c.value))[0] <= source.maxLightness);

  // Each real colourway of THIS bag predicted from the source with its own
  // reference left out, beside its real photograph.
  const validation = profiles
    .filter((p) => p.product === bag.slug && p.colour !== source.colour && p.chromaShape)
    .map((p) => ({ profile: p, colour: { key: `real-${p.colour}`, name: `${p.colour} (predicted)`, swatch: "", value: hex(labToSrgb(p.midLab[0], p.midLab[1], p.midLab[2])), products: [bag.slug] } }));

  // STOREFRONT SIMULATION: what a customer would see if a usable preview
  // colour were a confirmed, purchasable colour with an approved
  // preview. Client-side only — nothing is saved, and ordering is refused.
  // A colour this bag does NOT already have: a real photograph always wins,
  // so simulating Red on Mini Luna (photographed in Red) would show the photo.
  const sim = usable.find((c) => !bag.colours.some((bc) => bc.name.toLowerCase() === c.name.toLowerCase()));
  const simulated = sim
    ? {
        bag: { ...bag, colours: [...bag.colours, { ...bag.colours[0], id: `lab-sim-${sim.key}`, name: sim.name, hex: sim.swatch, isTwoTone: false }] },
        approved: {
          [bag.slug]: { [sim.name]: { value: sim.value, frame: source.frame, sourceColour: source.colour, approvedBy: "simulation", approvedOn: "—" } },
        } as Record<string, Record<string, ApprovedPreview>>,
        colourId: `lab-sim-${sim.key}`,
        name: sim.name,
        key: sim.key,
      }
    : null;

  return (
    <div className="cl">
      <header className="cl-head">
        <p className="adm-kicker">Arcubed · admin only</p>
        <h1 className="adm-title">Colour lab</h1>
        <p className="cl-lede">
          Prototype. The preview colours are not Arcubed colours and are not for sale: they recolour an authentic
          photograph in this browser to test the renderer. Nothing here appears on the storefront.
        </p>
        <div className="cl-sources" role="group" aria-label="Bag">
          {bags.map((b, i) => (
            <button key={b.slug} type="button" aria-pressed={i === bagIdx} className={i === bagIdx ? "is-on" : ""} onClick={() => { setBagIdx(i); setSourceIdx(0); }}>
              {b.name}
            </button>
          ))}
        </div>
        <div className="cl-sources" role="group" aria-label="Source photograph">
          {sources.map((s, i) => (
            <button key={s.frame} type="button" aria-pressed={s === source} className={s === source ? "is-on" : ""} onClick={() => setSourceIdx(i)}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="cl-note">{source.note}</p>
        <div className="cl-sources" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "preview"} className={mode === "preview" ? "is-on" : ""} onClick={() => setMode("preview")}>Preview colours (unapproved)</button>
          <button type="button" aria-pressed={mode === "storefront"} className={mode === "storefront" ? "is-on" : ""} onClick={() => setMode("storefront")} disabled={!simulated}>Storefront simulation</button>
        </div>
        {mode === "storefront" && simulated ? (
          <p className="cl-note">
            As a customer would see it if <strong>{simulated.name}</strong> were a confirmed {bag.name} colour with an approved
            preview. Simulated in this browser only; ordering is refused here.
          </p>
        ) : null}
      </header>

      {mode === "preview" || !simulated ? (
        <Customizer
          key={`p-${bag.slug}-${source.frame}`}
          bag={bag}
          editingLine={null}
          productionTimeLabel={productionTimeLabel}
          preview={{ colours, frame: source.frame, profiles, sourceColour: source.colour, maxLightness: source.maxLightness }}
        />
      ) : (
        <Customizer
          key={`s-${bag.slug}-${source.frame}-${simulated.key}`}
          bag={simulated.bag}
          initialColourId={simulated.colourId}
          editingLine={null}
          productionTimeLabel={productionTimeLabel}
          approved={simulated.approved}
          orderBlockedReason="This is a simulation in the colour lab; nothing can be ordered here."
        />
      )}

      <section className="cl-section">
        <h2 className="cl-h2">Before and after · {bag.name} · {source.label}</h2>
        <div className="cl-grid">
          <Still slug={bag.slug} frame={source.frame} colour={null} />
          {usable.map((c) => <Still key={`${bag.slug}-${source.frame}-${c.key}`} slug={bag.slug} frame={source.frame} colour={c} />)}
        </div>
        {usable.length < colours.length ? (
          <p className="cl-note">Not shown, no reliable preview from this photograph: {colours.filter((c) => !usable.includes(c)).map((c) => c.name).join(", ")}.</p>
        ) : null}
      </section>

      {validation.length ? (
        <section className="cl-section">
          <h2 className="cl-h2">Checked against real photographs</h2>
          <p className="cl-note">
            Each real {bag.name} colourway predicted from the {source.label.toLowerCase()} using only its mid-tone
            colour, with its own reference left out, beside the real photograph of that colourway.
          </p>
          <div className="cl-grid cl-pairs">
            {validation.map(({ profile, colour }) => (
              <div key={`${bag.slug}-${source.frame}-${colour.key}`} className="cl-pair">
                <Still slug={bag.slug} frame={source.frame} colour={colour} exclude={profile.colour} />
                <figure className="cl-still">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/media/${profile.frame}-cut-1200.webp`} alt={`Real photograph of the ${profile.colour} ${bag.name}`} className="cl-canvas" />
                  <figcaption>Real photograph · {profile.colour}</figcaption>
                </figure>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
