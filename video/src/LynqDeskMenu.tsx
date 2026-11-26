import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, staticFile, useVideoConfig } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/* One concept site on the desk monitor: the restaurant menu you spin. Made-up restaurant, labelled. */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const DESKMENU_DUR = 11.5;
const M3 = "matrix3d(0.74122820,0.24767420,0,0.00028891,0.03620652,0.79361343,0,0.00002115,0,0,1,0,106.171875,559.6875,0,1)";
const SHOTS: [number, number, number, number, number][] = [[0, 1.7, 1.05, 540, 975], [1.7, 4.4, 1.5, 556, 940], [4.4, 6.4, 2.1, 660, 930], [6.4, 8.2, 1.7, 500, 960], [8.2, 11.5, 1.12, 548, 990]];
export const LynqDeskMenu: React.FC = () => {
  const { s } = useT();
  const { fps } = useVideoConfig();
  const sh = SHOTS.find((x) => s >= x[0] && s < x[1]) ?? SHOTS[SHOTS.length - 1];
  const k = (s - sh[0]) / (sh[1] - sh[0]);
  const z = sh[2] * (1 + 0.05 * k);
  const dx = Math.sin(s * 1.3) * 7 + Math.sin(s * 2.9) * 3, dy = Math.cos(s * 1.1) * 6 + Math.sin(s * 3.3) * 2;
  const end = ramp(s, 8.3, 8.8, 0, 1);
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <Fonts />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1935, transformOrigin: "0 0", transform: `translate(${540 - sh[3] * z + dx}px, ${960 - sh[4] * z + dy}px) scale(${z}) rotate(${Math.sin(s * 0.9) * 0.25}deg)` }}>
        <Img src={staticFile("niche/desk.jpg")} style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1935 }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: M3, overflow: "hidden", background: "#0b0b0b" }}>
          <Img src={staticFile("niche/menu-still.jpg")} style={{ width: 1920, height: 1080 }} />
          <Sequence from={Math.round(1.7 * fps)} durationInFrames={Math.round(6.2 * fps)} layout="none"><OffthreadVideo src={staticFile("niche/menu-screen.mp4")} muted startFrom={9} style={{ width: 1920, height: 1080, position: "absolute", left: 0, top: 0 }} /></Sequence>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(255,255,255,0.10), transparent 35%, transparent 70%, rgba(255,190,120,0.08))" }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 560, background: "linear-gradient(180deg, rgba(0,0,0,0.82), transparent)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 680, background: "linear-gradient(0deg, rgba(0,0,0,0.88), transparent)" }} />
      <div style={{ position: "absolute", left: 60, right: 60, top: 220, textAlign: "center" }}>
        <div style={{ fontFamily: IS, fontSize: 92, color: "#fff", letterSpacing: -3.5, lineHeight: 1.02, opacity: ramp(s, 0, 0.25, 0, 1) }}>Your menu is a PDF.</div>
        <div style={{ fontFamily: IS, fontSize: 92, color: LI, letterSpacing: -3.5, lineHeight: 1.02, marginTop: 6, opacity: ramp(s, 1.9, 2.15, 0, 1), transform: `scale(${ramp(s, 1.9, 2.2, 0.9, 1)})` }}>Ours spins.</div>
      </div>
      {s >= 4.2 && s < 8.2 ? <div style={{ position: "absolute", left: 0, right: 0, top: 1470, textAlign: "center", opacity: ramp(s, 4.2, 4.5, 0, 1) }}><div style={{ display: "inline-block", fontFamily: IL, fontSize: 44, color: "#fff", background: "rgba(0,0,0,0.55)", padding: "16px 30px", borderRadius: 18 }}>Every dish rolls in with its price.</div></div> : null}
      <div style={{ position: "absolute", left: 60, right: 60, top: 1330, textAlign: "center", opacity: end, transform: `translateY(${(1 - end) * 30}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 76, color: "#fff", letterSpacing: -2.5, lineHeight: 1.05 }}>Comment <span style={{ color: LI }}>"MENU"</span>.<br />We'll design yours.</div>
        <div style={{ display: "inline-block", marginTop: 40, background: LI, color: "#0a0a0a", fontFamily: IS, fontSize: 40, padding: "22px 44px", borderRadius: 60 }}>Book a consultation · lynq.build/book</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center", fontFamily: IS, fontSize: 21, letterSpacing: 4, color: "rgba(255,255,255,0.55)" }}>CONCEPT SITE · MADE-UP RESTAURANT · AI VISUALS</div>
    </AbsoluteFill>
  );
};
