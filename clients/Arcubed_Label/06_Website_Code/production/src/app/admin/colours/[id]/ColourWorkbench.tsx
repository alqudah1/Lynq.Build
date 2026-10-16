"use client";

// One colour, step by step: photograph → measure → calibrate → check on each
// bag → choose bags → review → supplier → publish. Every picture here is drawn
// in the browser by the same engine the shop uses, from the same locked
// photograph of each bag, so what is approved is exactly what customers see.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BagInfo, Calibration, Candidate, CatalogueEntry, Measurement } from "@/lib/colour-workflow";
import RecolourStage from "@/components/customizer/RecolourStage";
import { profilesFor } from "@/lib/recolour/data";
import { hexToRgb, labToSrgb, srgbToLab } from "@/lib/recolour/engine";
import { PREVIEW_SOURCES } from "@/lib/recolour/preview-colours";
import * as act from "../actions";

const toHex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
const STATUS: Record<Candidate["status"], string> = { draft: "Draft", in_review: "In review", approved: "Approved", rejected: "Rejected" };

/** Measured yarn colour + calibration -> the colour customers will see. */
function calibrate(lab: [number, number, number], c: Calibration): string {
  const [L, a, b] = lab;
  const C = Math.hypot(a, b) * c.chroma, h = Math.atan2(b, a) + (c.hue * Math.PI) / 180;
  return toHex(labToSrgb(Math.min(98, Math.max(2, L + c.dL)), C * Math.cos(h), C * Math.sin(h)));
}

/** The yarn's mid-tone in a region: the 40th–60th percentile of lightness,
 *  averaged (the same definition as the photographed yarns' mid-tones), so
 *  shadows between stitches and glints do not pull the colour. */
function measure(img: HTMLImageElement, r: { x: number; y: number; w: number; h: number }): { lab: [number, number, number]; pixels: number } {
  const c = document.createElement("canvas");
  const sw = Math.max(1, Math.round(r.w * img.naturalWidth)), sh = Math.max(1, Math.round(r.h * img.naturalHeight));
  c.width = sw; c.height = sh;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, r.x * img.naturalWidth, r.y * img.naturalHeight, sw, sh, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;
  const px: [number, number, number][] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 250) px.push(srgbToLab(d[i], d[i + 1], d[i + 2]));
  px.sort((p, q) => p[0] - q[0]);
  const mid = px.slice(Math.floor(px.length * 0.4), Math.max(Math.floor(px.length * 0.4) + 1, Math.floor(px.length * 0.6)));
  const avg = (k: number) => mid.reduce((s, p) => s + p[k], 0) / mid.length;
  return { lab: [avg(0), avg(1), avg(2)].map((v) => Math.round(v * 100) / 100) as [number, number, number], pixels: px.length };
}

/** Resize in the browser to at most 1000px and encode: WebP where the
 *  browser can (Chrome), otherwise JPEG (Safari, including iPhone, cannot
 *  encode WebP from a canvas). */
function toWebp(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const s = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const type = c.toDataURL("image/webp", 0.5).startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
      let q = 0.86, out = c.toDataURL(type, q);
      while (out.length > 650000 && q > 0.4) { q -= 0.1; out = c.toDataURL(type, q); }
      if (!out.startsWith(`data:${type}`)) reject(new Error("This browser could not prepare the photograph."));
      else resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a photograph this browser can open.")); };
    img.src = url;
  });
}

function refusal(bag: BagInfo, material: string, hex: string | null): string | null {
  if (bag.material !== material) return `different yarn (${bag.material?.replace("-", " ") ?? "unknown"})`;
  if (hex && bag.maxLightness !== null && srgbToLab(...hexToRgb(hex))[0] > bag.maxLightness) return `too light for its photograph (limit L* ${bag.maxLightness})`;
  return null;
}

export default function ColourWorkbench({ candidate: c, bags, materialName, live }: {
  candidate: Candidate; bags: BagInfo[]; refusals: Record<string, string | null>; materialName: string;
  live: (CatalogueEntry & { bagName: string })[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<act.Result>, done: string) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });

  // 1. reference photograph + measurement
  const [image, setImage] = useState<string | null>(c.referenceImage);
  const [region, setRegion] = useState(() => c.measurement ? { x: c.measurement.x, y: c.measurement.y, w: c.measurement.w, h: c.measurement.h } : { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
  const [measured, setMeasured] = useState<Measurement | null>(c.measurement);
  const [cal, setCal] = useState<Calibration>(c.calibration);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x0: number; y0: number } | null>(null);
  const imageDirty = image !== c.referenceImage || (measured && c.measurement && (measured.x !== c.measurement.x || measured.y !== c.measurement.y || measured.w !== c.measurement.w)) || (measured && !c.measurement);

  const doMeasure = () => {
    const img = imgRef.current;
    if (!img || !img.complete || !img.naturalWidth) return;
    const m = measure(img, region);
    if (m.pixels < 50) { setMsg({ ok: false, text: "Choose a larger area of yarn." }); return; }
    setMeasured({ ...region, ...m });
    setCal({ dL: 0, chroma: 1, hue: 0 });
  };

  const pointer = (e: React.PointerEvent, phase: "down" | "move" | "up") => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), fy = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    if (phase === "down") { dragRef.current = { x0: fx, y0: fy }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); return; }
    if (!dragRef.current) return;
    const { x0, y0 } = dragRef.current;
    const r = { x: Math.min(x0, fx), y: Math.min(y0, fy), w: Math.max(0.03, Math.abs(fx - x0)), h: Math.max(0.03, Math.abs(fy - y0)) };
    setRegion(r);
    if (phase === "up") { dragRef.current = null; setTimeout(doMeasure, 0); }
  };

  // 2. calibration (state declared above, with the measurement it resets)
  const lab = measured?.lab ?? null;
  const measuredHex = lab ? calibrate(lab, { dL: 0, chroma: 1, hue: 0 }) : c.measuredHex;
  const hex = lab ? calibrate(lab, cal) : c.hex;
  const calDirty = hex !== c.hex;

  // 4. bags
  const [chosen, setChosen] = useState<string[]>(c.bags);
  const bagsDirty = chosen.slice().sort().join() !== c.bags.slice().sort().join();

  const [approver, setApprover] = useState("");
  const [note, setNote] = useState("");
  const [supplier, setSupplier] = useState(c.supplierConfirmed);
  const [supplierNote, setSupplierNote] = useState(c.supplierNote ?? "");

  const saveAll = () => run(async () => {
    if (image && measured && measuredHex && (image !== c.referenceImage || imageDirty)) {
      const r = await act.saveReference(c.id, image, measured, measuredHex);
      if (!r.ok) return r;
    }
    if (hex && calDirty) {
      const r = await act.saveCalibration(c.id, cal, hex);
      if (!r.ok) return r;
    }
    return { ok: true } as act.Result;
  }, "Saved. Any approval was withdrawn: the colour needs reviewing again.");

  const eligible = bags.filter((b) => !refusal(b, c.material, hex));
  const canPublish = c.status === "approved" && c.supplierConfirmed && c.bags.length > 0 && !calDirty && !bagsDirty;
  const unsaved = Boolean(imageDirty || calDirty);

  return (
    <div className="cw">
      <header className="cw-head">
        <span className="cw-chip cw-chip-lg" style={{ background: hex ?? "#eee" }} aria-hidden="true" />
        <div>
          <p className="adm-kicker">{materialName}</p>
          <h1 className="adm-title">{c.name}</h1>
          <p className="cw-badges">
            <span className={`cw-status cw-s-${c.status}`}>{STATUS[c.status]}</span>
            <span className={`cw-status ${c.publishedColourId ? "cw-s-live" : "cw-s-off"}`}>{c.publishedColourId ? "Published" : "Not for sale"}</span>
            {c.supplierConfirmed ? <span className="cw-status cw-s-approved">Supplier confirmed</span> : null}
          </p>
        </div>
      </header>
      {msg ? <p className={msg.ok ? "cw-ok" : "adm-error"} role="status">{msg.text}</p> : null}

      <section className="cw-step">
        <h2 className="cw-h2"><span>1</span> Yarn photograph</h2>
        <p className="adm-note">Upload Rand&rsquo;s photograph of the yarn in daylight or under the studio lights. Then drag a box over an even area of yarn (no labels, no shadows): that area is measured.</p>
        <label className="cw-upload">
          <input type="file" accept="image/*" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { setImage(await toWebp(f)); setMeasured(null); setMsg(null); } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not read the photograph." }); }
          }} />
          <span className="cw-btn cw-btn-ghost">{image ? "Replace photograph" : "Upload photograph"}</span>
        </label>
        {image ? (
          <div className="cw-ref">
            <div className="cw-ref-img" onPointerDown={(e) => pointer(e, "down")} onPointerMove={(e) => pointer(e, "move")} onPointerUp={(e) => pointer(e, "up")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the admin's own upload */}
              <img ref={imgRef} src={image} alt={`Yarn photograph for ${c.name}`} draggable={false} onLoad={() => { if (!measured) doMeasure(); }} />
              <span className="cw-region" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }} />
            </div>
            <div className="cw-measure">
              <p className="adm-h">Measured yarn colour</p>
              <span className="cw-chip cw-chip-xl" style={{ background: measuredHex ?? "#eee" }} />
              <p className="cw-mono">{measuredHex ?? "—"}{lab ? ` · L* ${lab[0].toFixed(1)}` : ""}</p>
              {measured ? <p className="cw-small">{measured.pixels.toLocaleString()} pixels measured</p> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="cw-step">
        <h2 className="cw-h2"><span>2</span> Calibrate</h2>
        <p className="adm-note">Only if the measured colour does not match the yarn in your hand (a photograph can come out a little dark or warm). Compare against the real yarn.</p>
        <div className="cw-cal">
          <label>Lightness <input type="range" min={-20} max={20} step={0.5} value={cal.dL} disabled={!lab} onChange={(e) => setCal({ ...cal, dL: +e.target.value })} /> <output>{cal.dL > 0 ? "+" : ""}{cal.dL}</output></label>
          <label>Colour strength <input type="range" min={0.5} max={1.5} step={0.02} value={cal.chroma} disabled={!lab} onChange={(e) => setCal({ ...cal, chroma: +e.target.value })} /> <output>×{cal.chroma.toFixed(2)}</output></label>
          <label>Hue <input type="range" min={-20} max={20} step={0.5} value={cal.hue} disabled={!lab} onChange={(e) => setCal({ ...cal, hue: +e.target.value })} /> <output>{cal.hue > 0 ? "+" : ""}{cal.hue}°</output></label>
          <div className="cw-cal-out"><span className="cw-chip cw-chip-xl" style={{ background: hex ?? "#eee" }} /><p className="cw-mono">{hex ?? "—"}</p></div>
        </div>
        <button type="button" className="cw-btn" disabled={pending || !unsaved || !image || !measured} onClick={saveAll}>Save photograph and colour</button>
        {unsaved ? <p className="cw-small">Unsaved changes. Saving withdraws any approval.</p> : null}
      </section>

      <section className="cw-step">
        <h2 className="cw-h2"><span>3</span> On each bag</h2>
        <p className="adm-note">Exactly what customers will see: each bag&rsquo;s photograph, recoloured to this yarn. Compare with the yarn photograph above.</p>
        <div className="cw-previews">
          {bags.map((b) => {
            const why = refusal(b, c.material, hex);
            const src = (PREVIEW_SOURCES[b.slug] ?? []).find((s) => s.locked);
            return (
              <figure key={b.slug} className={`cw-prev${why ? " is-off" : ""}`}>
                <div className="cw-prev-stage">
                  {!why && hex && src ? (
                    <RecolourStage frame={src.frame} profiles={profilesFor(b.slug)} fallback={null} alt={`${b.name} in ${c.name}`}
                      colour={{ key: `cand-${c.id}-${hex}`, name: c.name, swatch: hex, value: hex, products: [b.slug] }} />
                  ) : <p className="cw-small">{why ?? "Measure the yarn first."}</p>}
                </div>
                <figcaption>{b.name}{why ? ` · not offered: ${why}` : ""}</figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      <section className="cw-step">
        <h2 className="cw-h2"><span>4</span> Bags</h2>
        <div className="cw-checks">
          {bags.map((b) => {
            const why = refusal(b, c.material, hex);
            return (
              <label key={b.slug} className={why ? "is-off" : ""}>
                <input type="checkbox" disabled={!!why} checked={chosen.includes(b.slug)} onChange={(e) => setChosen(e.target.checked ? [...chosen, b.slug] : chosen.filter((s) => s !== b.slug))} />
                {b.name}{why ? <span className="cw-small"> · {why}</span> : null}
              </label>
            );
          })}
        </div>
        <button type="button" className="cw-btn" disabled={pending || !bagsDirty} onClick={() => run(() => act.saveBags(c.id, chosen.filter((s) => eligible.some((b) => b.slug === s))), "Bags saved.")}>Save bags</button>
      </section>

      <section className="cw-step">
        <h2 className="cw-h2"><span>5</span> Review</h2>
        {c.reviewNote ? <p className="cw-quote">{c.reviewNote}</p> : null}
        {c.status === "draft" || c.status === "rejected" ? (
          <button type="button" className="cw-btn" disabled={pending || unsaved || !c.hex} onClick={() => run(() => act.submitForReview(c.id), "Submitted for review.")}>Submit for review</button>
        ) : null}
        {c.status === "in_review" || c.status === "approved" ? (
          <div className="cw-review">
            {c.status === "in_review" ? (
              <>
                <label className="cw-field"><span>Approved by</span><input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Rand" maxLength={60} /></label>
                <label className="cw-field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
                <div className="cw-row-btns">
                  <button type="button" className="cw-btn" disabled={pending || !approver.trim()} onClick={() => run(() => act.approveColour(c.id, approver, note), "Approved. Not for sale until published.")}>Approve</button>
                  <button type="button" className="cw-btn cw-btn-ghost" disabled={pending} onClick={() => run(() => act.rejectColour(c.id, note || "Rejected in review."), "Rejected.")}>Reject</button>
                </div>
              </>
            ) : (
              <>
                <p className="adm-note">Approved by {c.approvedBy} on {c.approvedAt ? new Date(c.approvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}.</p>
                <button type="button" className="cw-btn cw-btn-ghost" disabled={pending} onClick={() => run(() => act.rejectColour(c.id, "Approval withdrawn."), "Approval withdrawn.")}>Withdraw approval</button>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="cw-step">
        <h2 className="cw-h2"><span>6</span> Supplier</h2>
        <label className="cw-check"><input type="checkbox" checked={supplier} onChange={(e) => setSupplier(e.target.checked)} /> Rand has confirmed her supplier can provide this yarn</label>
        <label className="cw-field"><span>Supplier note (optional)</span><input value={supplierNote} onChange={(e) => setSupplierNote(e.target.value)} maxLength={300} placeholder="Supplier, yarn code, minimum order…" /></label>
        <button type="button" className="cw-btn cw-btn-ghost" disabled={pending || (supplier === c.supplierConfirmed && supplierNote === (c.supplierNote ?? ""))} onClick={() => run(() => act.setSupplierConfirmed(c.id, supplier, supplierNote), "Supplier details saved.")}>Save</button>
      </section>

      <section className="cw-step cw-publish">
        <h2 className="cw-h2"><span>7</span> Publish</h2>
        {live.length ? (
          <>
            <p className="adm-note">On the shop since {c.publishedAt ? new Date(c.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}:</p>
            <ul className="cw-live">{live.map((e) => <li key={e.productId}>{e.bagName}: {e.active ? "on sale" : "off (turn it on under Colours on sale)"}</li>)}</ul>
          </>
        ) : null}
        <p className="adm-note">
          {canPublish
            ? `Publishing puts ${c.name} on sale on the ${c.bags.map((s) => bags.find((b) => b.slug === s)?.name).join(" and ")} at each bag's normal price.`
            : "Publishing needs: approved, supplier confirmed, at least one bag saved, and no unsaved changes."}
        </p>
        <button type="button" className="cw-btn cw-btn-strong" disabled={pending || !canPublish} onClick={() => {
          if (window.confirm(`Put ${c.name} on sale now? Customers will be able to order it.`)) run(() => act.publishColour(c.id), `${c.name} is on sale.`);
        }}>{c.publishedColourId ? "Publish update" : "Publish to the shop"}</button>
        {!c.publishedColourId ? (
          <p><button type="button" className="cw-link-danger" disabled={pending} onClick={() => { if (window.confirm(`Delete ${c.name}? This cannot be undone.`)) start(async () => { await act.deleteColour(c.id); }); }}>Delete this colour</button></p>
        ) : null}
      </section>
    </div>
  );
}
