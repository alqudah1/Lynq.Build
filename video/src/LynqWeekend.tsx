import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/*
 * Two single-idea LYNQ reels in the "This is yours. This is ours." format.
 * LynqDetail: a detailer's before/after becomes a wipe the customer drags.
 * LynqSixWeeks: a contractor's "after" photo becomes the six weeks, played back.
 * Made-up companies, AI visuals, labelled.
 */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'";
const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const out = (x: number) => 1 - Math.pow(1 - x, 3);
const back = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const key = (s: number, K: [number, number][]) => { for (let i = 0; i < K.length - 1; i++) { const [a, va] = K[i], [b, vb] = K[i + 1]; if (s <= b) return va + (vb - va) * io(Math.max(0, (s - a) / (b - a))); } return K[K.length - 1][1]; };
const Cap: React.FC<{ a: number; b: number; y?: number; dark?: boolean; size?: number; children: React.ReactNode }> = ({ a, b, y = 1560, dark, size = 92, children }) => {
  const { s } = useT();
  if (s < a || s >= b) return null;
  return (
    <div style={{ position: "absolute", left: 40, right: 40, top: y, textAlign: "center", transform: `scale(${ramp(s, a, a + 0.14, 0.8, 1, out)})`, opacity: ramp(s, a, a + 0.08, 0, 1) }}>
      <div style={{ display: "inline-block", fontFamily: IS, fontSize: size, letterSpacing: -3.5, lineHeight: 1.02, padding: "18px 42px 22px", borderRadius: 30, background: dark ? "#0a0a0a" : LI, color: dark ? "#fff" : "#0a0a0a", border: dark ? "2px solid rgba(255,255,255,0.2)" : "none" }}>{children}</div>
    </div>
  );
};
const Frame: React.FC<{ label: string; light?: boolean }> = ({ label, light }) => (
  <>
    <div style={{ position: "absolute", left: 60, top: 84, fontFamily: IS, fontSize: 26, letterSpacing: 10, color: light ? "#111" : "#fff" }}>LYNQ</div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, textAlign: "center", fontFamily: IS, fontSize: 20, letterSpacing: 4, color: light ? "rgba(30,30,40,0.55)" : "rgba(255,255,255,0.5)" }}>{label}</div>
  </>
);
const Cta: React.FC<{ at: number; word: string }> = ({ at, word }) => {
  const { s } = useT();
  const p = ramp(s, at, at + 0.4, 0, 1, out);
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top: 1180, textAlign: "center", opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
      <div style={{ fontFamily: IS, fontSize: 96, color: "#fff", letterSpacing: -4, lineHeight: 1.02 }}>Comment <span style={{ color: LI }}>"{word}"</span>.<br />We'll design yours.</div>
      <div style={{ display: "inline-block", marginTop: 50, background: LI, color: "#0a0a0a", fontFamily: IS, fontSize: 42, padding: "24px 48px", borderRadius: 60 }}>Book a consultation · lynq.build/book</div>
    </div>
  );
};

/* ---------- Drag to detail ---------- */
export const DETAIL_DUR = 10.8;
export const LynqDetail: React.FC = () => {
  const { s } = useT();
  const merge = ramp(s, 2.35, 2.9, 0, 1, io);
  const wipe = key(s, [[0, 0], [4.4, 0.04], [5.3, 0.55], [5.55, 0.5], [6.3, 0.97], [20, 0.97]]);
  const gloss = Math.round(Math.max(0, Math.min(1, (wipe - 0.06) / 0.9)) * 100);
  const cta = s >= 7.7;
  const CW = 1340, CH = Math.round((CW * 1072) / 1920), CX = (1080 - CW) / 2, CY = 620;
  const tap = s >= 6.75 && s < 6.95;
  return (
    <AbsoluteFill style={{ background: s < 2.35 ? "#f2f2f4" : "#07090c", overflow: "hidden" }}>
      <Fonts />
      {s < 2.9 ? (
        <AbsoluteFill style={{ opacity: 1 - merge }}>
          <div style={{ position: "absolute", left: 70, top: 300, fontFamily: IL, fontSize: 34, color: "#555" }}>@every_detailer · 2h</div>
          {[0, 1].map((k) => (
            <div key={k} style={{ position: "absolute", left: 70 + k * 480, top: 380, width: 460, height: 620, overflow: "hidden", borderRadius: 14, transform: `translateX(${k === 0 ? merge * 240 : -merge * 240}px)` }}>
              <Img src={staticFile(k ? "niche/car-clean.jpg" : "niche/car-dirty.jpg")} style={{ position: "absolute", height: 620, left: -420 }} />
              <div style={{ position: "absolute", left: 16, top: 16, fontFamily: IS, fontSize: 26, letterSpacing: 3, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "8px 16px", borderRadius: 20 }}>{k ? "AFTER" : "BEFORE"}</div>
            </div>
          ))}
          <div style={{ position: "absolute", left: 70, top: 1030, fontFamily: IL, fontSize: 34, color: "#333" }}>Another one done. DM for prices.</div>
        </AbsoluteFill>
      ) : null}
      {s >= 2.35 && !cta ? (
        <AbsoluteFill style={{ opacity: merge }}>
          <div style={{ position: "absolute", left: 60, top: 190, fontFamily: IS, fontSize: 46, letterSpacing: 3, color: "#fff" }}>GLOSS<span style={{ color: "#5ad1ff" }}>WORKS</span></div>
          <div style={{ position: "absolute", right: 60, top: 180, fontFamily: IS, fontSize: 30, color: "#06131b", background: "#5ad1ff", padding: "14px 28px", borderRadius: 40, transform: `scale(${tap ? 0.9 : 1})` }}>{s >= 6.95 ? "Booked ✓" : "Book a detail"}</div>
          <div style={{ position: "absolute", left: 60, top: 330, fontFamily: IS, fontSize: 150, letterSpacing: -6, lineHeight: 0.92, color: "#fff" }}>{wipe < 0.9 ? "Drag." : "Clean."}</div>
          <div style={{ position: "absolute", right: 60, top: 350, textAlign: "right" }}><div style={{ fontFamily: IS, fontSize: 110, letterSpacing: -4, color: "#5ad1ff", lineHeight: 1 }}>{gloss}%</div><div style={{ fontFamily: IS, fontSize: 22, letterSpacing: 5, color: "rgba(255,255,255,0.7)" }}>GLOSS RESTORED</div></div>
          <div style={{ position: "absolute", left: CX, top: CY, width: CW, height: CH }}>
            <Img src={staticFile("niche/car-dirty.jpg")} style={{ position: "absolute", inset: 0, width: CW, height: CH }} />
            <Img src={staticFile("niche/car-clean.jpg")} style={{ position: "absolute", inset: 0, width: CW, height: CH, clipPath: `inset(0 ${CW - ((1080 * wipe - CX))}px 0 0)` }} />
          </div>
          <div style={{ position: "absolute", left: 1080 * wipe - 3, top: CY - 30, width: 6, height: CH + 60, background: "#fff", boxShadow: "0 0 50px 12px rgba(140,220,255,0.8)" }} />
          <div style={{ position: "absolute", left: 1080 * wipe - 62, top: CY + CH / 2 - 62, width: 124, height: 124, borderRadius: 62, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 40, color: "#06131b", letterSpacing: 6, boxShadow: "0 16px 50px rgba(0,0,0,0.6)", transform: `scale(${ramp(s, 2.9, 3.2, 0, 1, back)})` }}>‹›</div>
          {[["Wash and wax", "$89"], ["Full detail", "$219"], ["Ceramic coat", "$649"]].map(([n, p], k) => (
            <div key={n} style={{ position: "absolute", left: 60 + k * 325, top: 1420, width: 305, padding: "22px 24px", borderRadius: 26, background: "rgba(255,255,255,0.07)", border: `2px solid ${gloss > 30 + k * 30 ? "#5ad1ff" : "rgba(255,255,255,0.16)"}`, opacity: ramp(s, 3.0 + k * 0.12, 3.3 + k * 0.12, 0, 1) }}>
              <div style={{ fontFamily: IL, fontSize: 28, color: "rgba(255,255,255,0.8)" }}>{n}</div><div style={{ fontFamily: IS, fontSize: 54, color: "#fff", marginTop: 4 }}>{p}</div>
            </div>
          ))}
        </AbsoluteFill>
      ) : null}
      {cta ? (
        <AbsoluteFill>
          <div style={{ position: "absolute", left: -200, right: -200, top: 100, height: 1200, background: "radial-gradient(closest-side, rgba(199,255,61,0.18), transparent)" }} />
          <div style={{ position: "absolute", left: CX, top: 330, width: CW, height: CH }}><Img src={staticFile("niche/car-clean.jpg")} style={{ width: CW, height: CH }} /><div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#040405 0%,transparent 25%,transparent 70%,#040405 100%)" }} /></div>
          <Cta at={7.75} word="DETAIL" />
        </AbsoluteFill>
      ) : null}
      <Cap a={0.1} b={2.35} dark y={1240}>Every detailer<br />posts this.</Cap>
      <Cap a={2.5} b={4.35} y={1640} size={76}>Ours lets the customer do it.</Cap>
      <Cap a={6.65} b={7.7} y={1640} size={84}>Then they book.</Cap>
      <Frame label="CONCEPT SITE · MADE-UP COMPANY · AI PHOTOS" light={s < 2.35} />
    </AbsoluteFill>
  );
};

/* ---------- The six weeks ---------- */
export const SIXWEEKS_DUR = 14.4;
export const LynqSixWeeks: React.FC = () => {
  const { s } = useT();
  const NF = 62;
  const prog = s < 2.5 ? 1 : key(s, [[2.5, 0], [4.6, 0], [9.0, 1], [20, 1]]);
  const f = Math.min(NF, Math.max(1, Math.round(1 + prog * (NF - 1))));
  const wk = Math.round(prog * 6);
  const cta = s >= 11.5;
  const WORDS: [number, number, string][] = [[4.7, 5.5, "Demolition."], [5.5, 6.3, "Floors."], [6.3, 7.1, "Cabinets."], [7.1, 7.8, "Stone."], [7.8, 9.1, "Lights."]];
  const flash = s >= 2.5 && s < 2.75 ? 1 - (s - 2.5) / 0.25 : 0;
  return (
    <AbsoluteFill style={{ background: "#040405", overflow: "hidden" }}>
      <Fonts />
      {!cta ? (
        <>
          <Img src={staticFile(`niche/rf/${String(f).padStart(3, "0")}.jpg`)} style={{ position: "absolute", top: 0, height: 1920, left: "50%", transform: `translateX(-50%) scale(${1.02 + (s < 2.5 ? s * 0.012 : 0)})` }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.6), transparent 26%, transparent 58%, rgba(0,0,0,0.85))" }} />
          {s < 2.5 ? <div style={{ position: "absolute", right: 60, top: 190, fontFamily: IS, fontSize: 30, letterSpacing: 4, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "10px 22px", borderRadius: 24 }}>AFTER</div> : null}
          {s >= 2.5 ? (
            <>
              <div style={{ position: "absolute", left: 60, top: 180 }}><div style={{ fontFamily: IS, fontSize: 24, letterSpacing: 8, color: "rgba(255,255,255,0.8)" }}>WEEK</div><div style={{ fontFamily: IS, fontSize: 260, letterSpacing: -12, lineHeight: 0.86, color: "#fff" }}>{wk}<span style={{ fontSize: 70, letterSpacing: -2, color: "rgba(255,255,255,0.6)" }}> of 6</span></div></div>
              <div style={{ position: "absolute", left: 60, right: 60, top: 1790, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.22)" }}><div style={{ width: `${prog * 100}%`, height: "100%", borderRadius: 4, background: LI }} /><div style={{ position: "absolute", left: `${prog * 100}%`, top: -14, width: 36, height: 36, marginLeft: -18, borderRadius: 18, background: LI, boxShadow: "0 0 30px rgba(199,255,61,0.7)" }} /></div>
            </>
          ) : null}
          {WORDS.map(([a, b, w]) => s >= a && s < b ? <div key={w} style={{ position: "absolute", left: 60, right: 60, top: 1500, fontFamily: IS, fontSize: 150, letterSpacing: -6, color: "#fff", textShadow: "0 10px 50px rgba(0,0,0,0.8)", transform: `translateY(${(1 - ramp(s, a, a + 0.12, 0, 1, out)) * 40}px)`, opacity: ramp(s, a, a + 0.06, 0, 1) }}>{w}</div> : null)}
          {s >= 9.1 ? <div style={{ position: "absolute", left: 60, right: 60, top: 1380, opacity: ramp(s, 9.1, 9.3, 0, 1), transform: `scale(${ramp(s, 9.1, 9.4, 0.85, 1, back)})`, transformOrigin: "0 100%" }}><div style={{ fontFamily: IS, fontSize: 190, letterSpacing: -8, lineHeight: 0.9, color: LI, textShadow: "0 10px 50px rgba(0,0,0,0.8)" }}>$48,500</div><div style={{ fontFamily: IS, fontSize: 60, letterSpacing: -2, color: "#fff", marginTop: 10, textShadow: "0 6px 30px rgba(0,0,0,0.8)" }}>Fixed. The whole way down.</div></div> : null}
          <AbsoluteFill style={{ background: "#fff", opacity: flash * 0.7 }} />
        </>
      ) : (
        <AbsoluteFill>
          <Img src={staticFile("niche/rf/062.jpg")} style={{ position: "absolute", top: 0, height: 1100, left: "50%", transform: "translateX(-50%)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1110, background: "linear-gradient(180deg,rgba(4,4,5,0.5) 0%,transparent 40%,#040405 100%)" }} />
          <Cta at={11.55} word="BUILD" />
        </AbsoluteFill>
      )}
      <Cap a={0.1} b={2.5} dark y={1500} size={84}>Every contractor<br />shows you this.</Cap>
      <Cap a={2.6} b={4.6} y={1560} size={80}>Ours shows the six weeks.</Cap>
      <Frame label="CONCEPT SITE · MADE-UP COMPANY · AI VISUALS" />
    </AbsoluteFill>
  );
};
