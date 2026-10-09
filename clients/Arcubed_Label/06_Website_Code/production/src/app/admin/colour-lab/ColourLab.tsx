"use client";

import { useEffect, useRef, useState } from "react";
import type { Bag } from "@/lib/types";
import Customizer from "@/components/customizer/Customizer";
import { loadSource } from "@/components/customizer/RecolourStage";
import { buildLut, renderInto, labToSrgb, type PreviewColour } from "@/lib/recolour/engine";
import { PROFILES } from "@/lib/recolour/data";
import { PREVIEW_COLOURS, PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";

const hex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

/** One recoloured frame drawn into its own canvas, with its render time. */
function Still({ frame, colour, exclude }: { frame: string; colour: PreviewColour | null; exclude?: string }) {
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
        const profiles = exclude ? PROFILES.nova.filter((p) => p.colour !== exclude) : PROFILES.nova;
        renderInto(img.data, src.rgba, src.mask, src.analysis, buildLut(colour, profiles, src.analysis));
      } else {
        img.data.set(src.rgba);
      }
      ctx.putImageData(img, 0, 0);
      setMs(performance.now() - t0);
    });
    return () => { off = true; };
  }, [frame, colour, exclude]);
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

export default function ColourLab({ bag, productionTimeLabel }: { bag: Bag; productionTimeLabel: string | null }) {
  const sources = PREVIEW_SOURCES.nova;
  const [sourceIdx, setSourceIdx] = useState(0);
  const source = sources[sourceIdx];
  const colours = PREVIEW_COLOURS.filter((c) => c.products.includes("nova"));
  // Real colourways predicted from the source WITHOUT their own profile
  // (leave-one-out), shown beside their real photographs.
  const validation = PROFILES.nova
    .filter((p) => p.colour !== source.colour && p.chromaShape)
    .map((p) => ({ profile: p, colour: { key: `real-${p.colour}`, name: `${p.colour} (predicted)`, swatch: "", value: hex(labToSrgb(p.midLab[0], p.midLab[1], p.midLab[2])), products: ["nova"] } }));

  return (
    <div className="cl">
      <header className="cl-head">
        <p className="adm-kicker">Arcubed · admin only</p>
        <h1 className="adm-title">Colour lab</h1>
        <p className="cl-lede">
          Prototype. The preview colours below are not Arcubed colours and are not for sale: they recolour an
          authentic photograph in this browser to test the renderer. Nothing here appears on the storefront.
        </p>
        <div className="cl-sources" role="group" aria-label="Source photograph">
          {sources.map((s, i) => (
            <button key={s.frame} type="button" aria-pressed={i === sourceIdx} className={i === sourceIdx ? "is-on" : ""} onClick={() => setSourceIdx(i)}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="cl-note">{source.note}</p>
      </header>

      <Customizer
        bag={bag}
        editingLine={null}
        productionTimeLabel={productionTimeLabel}
        preview={{ colours, frame: source.frame, profiles: PROFILES.nova, sourceColour: source.colour }}
      />

      <section className="cl-section">
        <h2 className="cl-h2">Before and after · {source.label}</h2>
        <div className="cl-grid">
          <Still frame={source.frame} colour={null} />
          {colours.map((c) => <Still key={c.key} frame={source.frame} colour={c} />)}
        </div>
      </section>

      <section className="cl-section">
        <h2 className="cl-h2">Checked against real photographs</h2>
        <p className="cl-note">
          Each real colourway predicted from the {source.label.toLowerCase()} using only its mid-tone colour, with
          its own profile left out, beside the real photograph of that colourway.
        </p>
        <div className="cl-grid cl-pairs">
          {validation.map(({ profile, colour }) => (
            <div key={colour.key} className="cl-pair">
              <Still frame={source.frame} colour={colour} exclude={profile.colour} />
              <figure className="cl-still">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/media/${profile.frame}-cut-1200.webp`} alt={`Real photograph of the ${profile.colour} Nova`} className="cl-canvas" />
                <figcaption>Real photograph · {profile.colour}</figcaption>
              </figure>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
