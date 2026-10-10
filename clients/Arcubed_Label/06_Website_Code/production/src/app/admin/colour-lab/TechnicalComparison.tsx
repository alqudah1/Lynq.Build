"use client";

// The renderer's diagnostics, kept apart from the Colour Studio: source
// photographs (including evaluation-only ones), every test colour beside the
// original, and each real colourway predicted with its own reference left
// out, beside its real photograph. Render times per image.

import { useEffect, useRef, useState } from "react";
import type { Bag } from "@/lib/types";
import { loadSource } from "@/components/customizer/RecolourStage";
import { buildLut, renderInto, labToSrgb, srgbToLab, hexToRgb, type PreviewColour } from "@/lib/recolour/engine";
import { profilesFor } from "@/lib/recolour/data";
import { PREVIEW_COLOURS, PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";

const hex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

function Still({ slug, frame, colour, exclude }: { slug: string; frame: string; colour: PreviewColour | null; exclude?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    let off = false;
    loadSource(frame).then((src) => {
      const c = ref.current;
      if (off || !c) return;
      c.width = src.w; c.height = src.h;
      const img = new ImageData(src.w, src.h);
      const t0 = performance.now();
      if (colour) {
        const all = profilesFor(slug);
        const profiles = exclude ? all.filter((p) => !(p.colour === exclude && p.product === slug)) : all;
        renderInto(img.data, src.rgba, src.mask, src.analysis, buildLut(colour, profiles, src.analysis));
      } else {
        img.data.set(src.rgba);
      }
      c.getContext("2d")!.putImageData(img, 0, 0);
      setMs(performance.now() - t0);
    });
    return () => { off = true; };
  }, [slug, frame, colour, exclude]);
  return (
    <figure className="tc-still">
      <canvas ref={ref} className="tc-canvas" />
      <figcaption>
        <span>{colour ? colour.name : "Original photograph"}</span>
        <span className="tc-meta">{colour ? colour.value : ""}{colour && ms !== null ? ` · ${ms.toFixed(0)}ms` : ""}</span>
      </figcaption>
    </figure>
  );
}

export default function TechnicalComparison({ bag }: { bag: Bag }) {
  const sources = PREVIEW_SOURCES[bag.slug] ?? [];
  const [idx, setIdx] = useState(0);
  const source = sources[Math.min(idx, sources.length - 1)];
  const profiles = profilesFor(bag.slug);
  const colours = PREVIEW_COLOURS.filter((c) => c.products.includes(bag.slug));
  const usable = colours.filter((c) => source.maxLightness === undefined || srgbToLab(...hexToRgb(c.value))[0] <= source.maxLightness);
  const validation = profiles
    .filter((p) => p.product === bag.slug && p.colour !== source.colour && p.chromaShape)
    .map((p) => ({ profile: p, colour: { key: `real-${p.colour}`, name: `${p.colour} (predicted)`, swatch: "", value: hex(labToSrgb(p.midLab[0], p.midLab[1], p.midLab[2])), products: [bag.slug] } }));

  return (
    <div className="tc">
      <section className="tc-section">
        <h2 className="tc-h">Source photograph</h2>
        <div className="tc-tabs" role="group" aria-label="Source photograph">
          {sources.map((s, i) => (
            <button key={s.frame} type="button" aria-pressed={s === source} className={s === source ? "is-on" : ""} onClick={() => setIdx(i)}>
              {s.label}{s.evaluation ? " · evaluation" : ""}
            </button>
          ))}
        </div>
        <p className="tc-note">{source.note}</p>
        <dl className="tc-facts">
          <div><dt>Material references</dt><dd>{profiles.map((p) => `${p.product === bag.slug ? "" : p.product + " "}${p.colour}`).join(", ")}</dd></div>
          <div><dt>Lightness limit</dt><dd>{source.maxLightness !== undefined ? `L* ${source.maxLightness}` : "none"}</dd></div>
        </dl>
      </section>

      <section className="tc-section">
        <h2 className="tc-h">Original and recoloured · {source.label}</h2>
        <div className="tc-grid">
          <Still slug={bag.slug} frame={source.frame} colour={null} />
          {usable.map((c) => <Still key={`${source.frame}-${c.key}`} slug={bag.slug} frame={source.frame} colour={c} />)}
        </div>
        {usable.length < colours.length ? (
          <p className="tc-note">Refused for this photograph: {colours.filter((c) => !usable.includes(c)).map((c) => c.name).join(", ")}.</p>
        ) : null}
      </section>

      {validation.length ? (
        <section className="tc-section">
          <h2 className="tc-h">Checked against real photographs</h2>
          <p className="tc-note">
            Each real {bag.name} colourway predicted from the {source.label.toLowerCase()} using only its mid-tone, with
            its own reference left out, beside the real photograph.
          </p>
          <div className="tc-grid tc-pairs">
            {validation.map(({ profile, colour }) => (
              <div key={`${source.frame}-${colour.key}`} className="tc-pair">
                <Still slug={bag.slug} frame={source.frame} colour={colour} exclude={profile.colour} />
                <figure className="tc-still">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/media/${profile.frame}-cut-1200.webp`} alt={`Real photograph of the ${profile.colour} ${bag.name}`} className="tc-canvas" />
                  <figcaption><span>Real photograph</span><span className="tc-meta">{profile.colour}</span></figcaption>
                </figure>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
