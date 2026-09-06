// Four-product side-by-side elevation, generated from the SAME geometry
// functions the 3D viewer uses, so the drawing can never drift from the model.
// DEV ONLY (parent route 404s in production).
//
// Scale honesty: no real-world dimension is known for any Arcubed bag, so the
// four are normalized to equal BODY WIDTH. Shape is comparable; size
// deliberately is not, and the banner says so.

import { BLOCKOUTS, EVIDENCE_LABEL, productionBlockers, type EvidenceGrade } from "@/lib/three/blockouts/evidence";
import { profileToSvgPath, handleToSvgPath } from "@/lib/three/blockouts/geometry";

const W = 210;
const GRADE_COLOR: Record<EvidenceGrade, string> = {
  CONFIRMED_FROM_PHOTOS: "#143562",
  CONFIRMED_FROM_VIDEO: "#143562",
  CONFIRMED_BY_RAND: "#143562",
  APPROXIMATION_FOR_BLOCKOUT: "#b07d2b",
  UNRESOLVED: "#a33",
};

export default function Comparison() {
  const specs = Object.values(BLOCKOUTS);
  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Four-product comparison</h2>
      <p style={{ margin: "0 0 4px", fontSize: 13, color: "#a33", fontWeight: 600 }}>
        RELATIVE PRODUCT SCALE NOT CONFIRMED — normalized to equal body width, so shape is
        comparable and size is not.
      </p>
      <p style={{ margin: "0 0 18px", fontSize: 12, color: "#6f665e" }}>
        navy = confirmed from photos · amber = approximation for blockout · red = unresolved
      </p>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${specs.length}, minmax(0,1fr))`, gap: 16 }}>
        {specs.map((s) => {
          const rise = s.handle.style.value === "arch" ? s.handle.rise.value + s.handle.thickness.value : 0;
          const fringeH = s.fringe
            ? s.heightRatio.value / (1 - s.fringe.lengthRatio.value) - s.heightRatio.value
            : 0;
          const top = -(s.heightRatio.value + rise) * W - 14;
          const bottom = fringeH * W + 14;
          const stroke = GRADE_COLOR[s.heightRatio.grade];
          const handle = handleToSvgPath(s, W);
          const blockers = productionBlockers(s);
          return (
            <figure key={s.key} style={{ margin: 0 }}>
              <svg viewBox={`${-W * 0.62} ${top} ${W * 1.24} ${bottom - top}`} width="100%" role="img"
                   aria-label={`${s.label} blockout front elevation`}>
                <line x1={-W * 0.55} y1={0} x2={W * 0.55} y2={0} stroke="#d8cfc4" strokeDasharray="4 4" strokeWidth={1} />
                {s.fringe ? (
                  <rect x={(-s.bottomWidth.value / 2) * W} y={0} width={s.bottomWidth.value * W} height={fringeH * W}
                        fill="none" stroke="#a33" strokeWidth={1.4} strokeDasharray="6 5" />
                ) : null}
                <path d={profileToSvgPath(s, W)} fillRule="evenodd" fill="#143562" fillOpacity={0.09}
                      stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" />
                {handle ? (
                  <path d={handle} fill="none" stroke={stroke} strokeWidth={s.handle.thickness.value * W * 2} strokeLinecap="round" />
                ) : null}
              </svg>
              <figcaption style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <strong style={{ fontSize: 14 }}>{s.label}</strong>
                <Row k="body W:H" v={`${(1 / s.heightRatio.value).toFixed(2)} : 1`} g={s.heightRatio.grade} />
                <Row k="grip" v={s.handle.style.value} g={s.handle.style.grade} />
                <Row
                  k="opening depth"
                  v={s.handle.style.value === "none" ? "n/a" : `${Math.round((s.handle.style.value === "arch" ? s.handle.rise.value : s.handle.bandHeight.value) * 100)}% of height`}
                  g={s.handle.style.value === "arch" ? s.handle.rise.grade : s.handle.bandHeight.grade}
                />
                <Row k="depth" v={s.depthRatio.grade === "UNRESOLVED" ? "UNRESOLVED" : `~${s.depthRatio.value}w`} g={s.depthRatio.grade} />
                {s.fringe ? <Row k="fringe" v="structural, layout UNRESOLVED" g="UNRESOLVED" /> : null}
                <div style={{ marginTop: 6, color: blockers.length ? "#a33" : "#143562", fontWeight: 600 }}>
                  {blockers.length} blocker{blockers.length === 1 ? "" : "s"} · {s.frames.value.length} source frame
                  {s.frames.value.length === 1 ? "" : "s"}
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

function Row({ k, v, g }: { k: string; v: string; g: EvidenceGrade }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }} title={EVIDENCE_LABEL[g]}>
      <span style={{ color: "#6f665e" }}>{k}</span>
      <span style={{ color: GRADE_COLOR[g], textAlign: "right" }}>{v}</span>
    </div>
  );
}
