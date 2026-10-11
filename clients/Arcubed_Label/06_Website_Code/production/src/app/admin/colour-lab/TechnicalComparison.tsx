"use client";

// The renderer's diagnostics, kept apart from the Atelier studio: source
// photographs (including evaluation-only ones), every test colour beside the
// original, every confirmed colourway exactly as the Atelier shows it on the
// locked photograph beside Rand's real photograph of that colour (with the
// measured difference), and each colourway predicted with its own reference
// left out. Render times per image.

import { useEffect, useRef, useState } from "react";
import type { Bag } from "@/lib/types";
import { loadSource } from "@/components/customizer/RecolourStage";
import { buildLut, renderInto, labToSrgb, srgbToLab, hexToRgb, type PreviewColour, type YarnProfile } from "@/lib/recolour/engine";
import { profilesFor } from "@/lib/recolour/data";
import { PREVIEW_COLOURS, PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";

const hex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

/** Mid-tone difference (ΔE76, 40th-60th percentile of the yarn's
 *  lightness) and mean lightness-curve error (L*, 33 quantiles) between the
 *  rendered yarn and a real yarn's measured profile. */
function measure(px: Uint8ClampedArray, mask: Uint8ClampedArray, target: YarnProfile): { dE: number; curve: number } {
  const Ls: number[] = [], As: number[] = [], Bs: number[] = [];
  for (let p = 0; p < mask.length; p += 3) if (mask[p] === 255) {
    const [L, a, b] = srgbToLab(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]); Ls.push(L); As.push(a); Bs.push(b);
  }
  const ord = Ls.map((_, i) => i).sort((x, y) => Ls[x] - Ls[y]);
  const q = target.quantiles.map((_, k) => Ls[ord[Math.min(ord.length - 1, Math.floor(((k + 0.5) / target.quantiles.length) * ord.length))]]);
  const curve = q.reduce((sum, v, k) => sum + Math.abs(v - target.quantiles[k]), 0) / q.length;
  const mid = ord.slice(Math.floor(ord.length * 0.4), Math.floor(ord.length * 0.6));
  const avg = (arr: number[]) => mid.reduce((sum, i) => sum + arr[i], 0) / mid.length;
  return { dE: Math.hypot(avg(Ls) - target.midLab[0], avg(As) - target.midLab[1], avg(Bs) - target.midLab[2]), curve };
}

function Still({ slug, frame, colour, exclude, only, target }: {
  slug: string; frame: string; colour: PreviewColour | null; exclude?: string;
  /** Render with exactly this reference (a confirmed colour, as the Atelier does). */
  only?: YarnProfile;
  /** Measure the result against this real yarn. */
  target?: YarnProfile;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [m, setM] = useState<{ dE: number; curve: number } | null>(null);
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
        const profiles = only ? [only] : exclude ? all.filter((p) => !(p.colour === exclude && p.product === slug)) : all;
        renderInto(img.data, src.rgba, src.mask, src.analysis, buildLut(colour, profiles, src.analysis));
      } else {
        img.data.set(src.rgba);
      }
      c.getContext("2d")!.putImageData(img, 0, 0);
      setMs(performance.now() - t0);
      if (target) setM(measure(img.data, src.mask, target));
    });
    return () => { off = true; };
  }, [slug, frame, colour, exclude, only, target]);
  return (
    <figure className="tc-still">
      <canvas ref={ref} className="tc-canvas" />
      <figcaption>
        <span>{colour ? colour.name : "Original photograph"}</span>
        <span className="tc-meta">
          {m ? `ΔE ${m.dE.toFixed(1)} · curve ${m.curve.toFixed(1)} L*` : colour ? colour.value : ""}
          {colour && ms !== null ? ` · ${ms.toFixed(0)}ms` : ""}
        </span>
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
  // Every confirmed colourway as the Atelier shows it on this photograph.
  const shown = bag.colours.map((c) => {
    const p = profiles.find((r) => r.product === bag.slug && r.colour === c.name);
    const limit = c.name.includes("&") ? "Two-tone: not produced from a one-yarn photograph" : !p ? "No photographed yarn reference" : null;
    return { name: c.name, profile: p, limit, own: c.name === source.colour };
  });
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

      <section className="tc-section">
        <h2 className="tc-h">Confirmed colours on this photograph · against Rand&rsquo;s photographs</h2>
        <p className="tc-note">
          Exactly what the Atelier shows for each confirmed {bag.name} colourway: the {source.label.toLowerCase()} recoloured
          with that colour&rsquo;s own photographed yarn, beside Rand&rsquo;s photograph of it. ΔE is the mid-tone difference
          between the rendered yarn and the real yarn, the curve error the mean lightness difference from shadow to highlight.
          Texture, light and sheen come from this photograph, so compare them by eye.
        </p>
        <div className="tc-grid tc-pairs">
          {shown.map(({ name, profile, limit, own }) => (
            <div key={`${source.frame}-shown-${name}`} className="tc-pair">
              {limit || !profile ? (
                <figure className="tc-still tc-limit"><figcaption><span>{name}</span><span className="tc-meta">{limit}</span></figcaption></figure>
              ) : own ? (
                <Still slug={bag.slug} frame={source.frame} colour={null} />
              ) : (
                <Still slug={bag.slug} frame={source.frame} only={profile} target={profile}
                  colour={{ key: `shown-${name}`, name, swatch: "", value: hex(labToSrgb(profile.midLab[0], profile.midLab[1], profile.midLab[2])), products: [bag.slug] }} />
              )}
              {profile ? (
                <figure className="tc-still">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/media/${profile.frame}-cut-1200.webp`} alt={`Real photograph of the ${name} ${bag.name}`} className="tc-canvas" />
                  <figcaption><span>Real photograph</span><span className="tc-meta">{name}</span></figcaption>
                </figure>
              ) : <div />}
            </div>
          ))}
        </div>
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
                <Still slug={bag.slug} frame={source.frame} colour={colour} exclude={profile.colour} target={profile} />
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
