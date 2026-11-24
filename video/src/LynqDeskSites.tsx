import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, staticFile, useVideoConfig } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/*
 * Three concept sites shown on a desk monitor, cut fast, one interaction each:
 * scroll to renovate, spin the menu, drag to detail. Made-up companies, AI visuals, labelled.
 */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const DESKSITES_DUR = 20.5;
const M3 = "matrix3d(0.74122820,0.24767420,0,0.00028891,0.03620652,0.79361343,0,0.00002115,0,0,1,0,106.171875,559.6875,0,1)";
// start, end, zoom, focus x, focus y (scene is 1080 x 1935)
const SHOTS: [number, number, number, number, number][] = [
  [0, 1.5, 1.02, 540, 975], [1.5, 4.6, 1.5, 556, 940], [4.6, 7.6, 2.05, 610, 1010],
  [7.6, 10.2, 1.5, 556, 940], [10.2, 12.6, 1.95, 650, 900],
  [12.6, 15.2, 1.5, 556, 940], [15.2, 17.6, 1.9, 560, 990], [17.6, 20.5, 1.12, 548, 990],
];
const LABELS: [number, number, string, string][] = [
  [1.5, 7.6, "scroll to renovate", "for renovation contractors"],
  [7.6, 12.6, "spin the menu", "for restaurants"],
  [12.6, 17.6, "drag to detail", "for car detailers"],
];
export const LynqDeskSites: React.FC = () => {
  const { s } = useT();
  const { fps } = useVideoConfig();
  const sh = SHOTS.find((x) => s >= x[0] && s < x[1]) ?? SHOTS[SHOTS.length - 1];
  const k = (s - sh[0]) / (sh[1] - sh[0]);
  const z = sh[2] * (1 + 0.05 * k);
  const dx = Math.sin(s * 1.3) * 7 + Math.sin(s * 2.9) * 3, dy = Math.cos(s * 1.1) * 6 + Math.sin(s * 3.3) * 2;
  const rot = Math.sin(s * 0.9) * 0.25;
  const seq = (from: number, dur: number) => ({ from: Math.round(from * fps), durationInFrames: Math.round(dur * fps) });
  const vs: React.CSSProperties = { width: 1920, height: 1080 };
  const end = ramp(s, 17.8, 18.4, 0, 1);
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <Fonts />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1935, transformOrigin: "0 0", transform: `translate(${540 - sh[3] * z + dx}px, ${960 - sh[4] * z + dy}px) scale(${z}) rotate(${rot}deg)` }}>
        <Img src={staticFile("niche/desk.jpg")} style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1935 }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: M3, overflow: "hidden", background: "#0b0b0b", filter: "brightness(1.04) contrast(0.97)" }}>
          <Img src={staticFile("niche/reno-hero.jpg")} style={vs} />
          <Sequence {...seq(1.5, 6.1)} layout="none"><OffthreadVideo src={staticFile("niche/reno-screen.mp4")} muted startFrom={36} playbackRate={2} style={{ ...vs, position: "absolute", left: 0, top: 0 }} /></Sequence>
          <Sequence {...seq(7.6, 5)} layout="none"><OffthreadVideo src={staticFile("niche/menu-screen.mp4")} muted startFrom={12} playbackRate={1.2} style={{ ...vs, position: "absolute", left: 0, top: 0 }} /></Sequence>
          <Sequence {...seq(12.6, 5)} layout="none"><OffthreadVideo src={staticFile("niche/car-screen.mp4")} muted startFrom={9} playbackRate={1.2} style={{ ...vs, position: "absolute", left: 0, top: 0 }} /></Sequence>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(255,255,255,0.10), transparent 35%, transparent 70%, rgba(255,190,120,0.08))" }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 520, background: "linear-gradient(180deg, rgba(0,0,0,0.78), transparent)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 620, background: "linear-gradient(0deg, rgba(0,0,0,0.85), transparent)" }} />
      {s < 1.5 && (
        <div style={{ position: "absolute", left: 60, right: 60, top: 230, textAlign: "center", opacity: ramp(s, 0, 0.25, 0, 1) }}>
          <div style={{ fontFamily: IS, fontSize: 82, color: "#fff", letterSpacing: -3, lineHeight: 1.05 }}>3 websites your<br />competitors <span style={{ color: LI }}>don't have.</span></div>
        </div>
      )}
      {LABELS.map(([a, b, t, sub], i) => s >= a && s < b ? (
        <div key={i} style={{ position: "absolute", left: 0, right: 0, top: 230, textAlign: "center", opacity: ramp(s, a, a + 0.2, 0, 1) }}>
          <div style={{ fontFamily: IS, fontSize: 68, color: "#fff", letterSpacing: -2 }}>{t}</div>
          <div style={{ fontFamily: IL, fontSize: 36, color: "rgba(255,255,255,0.85)", marginTop: 6 }}>{sub}</div>
        </div>
      ) : null)}
      {s >= 1.5 && s < 17.6 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 1500, textAlign: "center" }}>
          <div style={{ display: "inline-block", fontFamily: IS, fontSize: 40, color: "#fff", background: "rgba(0,0,0,0.55)", padding: "16px 30px", borderRadius: 18 }}>comment <span style={{ color: LI }}>"SITE"</span> and we'll design yours</div>
        </div>
      )}
      <div style={{ position: "absolute", left: 60, right: 60, top: 1320, textAlign: "center", opacity: end, transform: `translateY(${(1 - end) * 30}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 76, color: "#fff", letterSpacing: -2.5, lineHeight: 1.05 }}>Comment <span style={{ color: LI }}>"SITE"</span>.<br />We'll design yours.</div>
        <div style={{ display: "inline-block", marginTop: 40, background: LI, color: "#0a0a0a", fontFamily: IS, fontSize: 40, padding: "22px 44px", borderRadius: 60 }}>Book a consultation · lynq.build/book</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center", fontFamily: IS, fontSize: 21, letterSpacing: 4, color: "rgba(255,255,255,0.55)" }}>CONCEPT SITES · MADE-UP COMPANIES · AI VISUALS</div>
    </AbsoluteFill>
  );
};
