import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, useVideoConfig } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/*
 * "The monster got out", day 3 in soft 3D: the monster eats the Run button, Pip gives up the chase,
 * and line 4 is put to the viewer. AI-generated animation and voice; made-up story, labelled.
 */
const INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340";
const B = "'Baloo 2'", N = "'Nunito'", MONO = "'JetBrains Mono'";
export const RUN3D_DUR = 12.6;
const back = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const T2 = 4.6, T3 = 8.0;
const Say: React.FC<{ a: number; b: number; top?: number; size?: number; who?: boolean; children: React.ReactNode }> = ({ a, b, top = 230, size = 88, who = true, children }) => {
  const { s } = useT();
  if (s < a || s > b + 0.15) return null;
  const p = ramp(s, a, a + 0.16, 0, 1, back) * (1 - ramp(s, b, b + 0.15));
  return (
    <div style={{ position: "absolute", left: 50, right: 50, top, textAlign: "center", opacity: Math.min(1, p * 1.5), transform: `scale(${0.7 + p * 0.3}) rotate(${(1 - p) * -4}deg)` }}>
      <div style={{ display: "inline-block", position: "relative", padding: "24px 46px 20px", borderRadius: 46, background: "#fff", border: `8px solid ${INK}`, boxShadow: `0 12px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: size, lineHeight: 1.02, color: INK }}>
        {who ? <div style={{ position: "absolute", left: 34, top: -32, padding: "2px 20px", borderRadius: 14, background: "#ff8a1f", border: `5px solid ${INK}`, fontFamily: N, fontWeight: 900, fontSize: 28, letterSpacing: 3, color: "#fff" }}>PIP</div> : null}
        {children}
      </div>
    </div>
  );
};
export const CodeItRun3D: React.FC = () => {
  const { s } = useT();
  const { fps } = useVideoConfig();
  const seq = (from: number, dur: number) => ({ from: Math.round(from * fps), durationInFrames: Math.round(dur * fps) });
  const fill: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: 1080, height: 1920, objectFit: "cover" };
  const k3 = ramp(s, T3, RUN3D_DUR, 0, 1);
  const pulse = 0.5 + 0.5 * Math.sin(s * 9);
  const opts = ["stars", "nothing", "homework"];
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <Fonts />
      <Sequence {...seq(0, T2)} layout="none"><OffthreadVideo src={staticFile("c3d/bite.mp4")} muted playbackRate={1.07} style={fill} /></Sequence>
      <Sequence {...seq(T2, T3 - T2)} layout="none"><OffthreadVideo src={staticFile("c3d/chase.mp4")} muted playbackRate={1.45} style={fill} /></Sequence>
      {s >= T3 ? <Img src={staticFile("c3d/laptop.jpg")} style={{ position: "absolute", left: 0, top: -8, width: 1080, height: 1935, transformOrigin: "62% 44%", transform: `scale(${1.02 + k3 * 0.22})` }} /> : null}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 420, background: "linear-gradient(180deg, rgba(0,0,0,0.45), transparent)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: s >= T3 ? 900 : 300, background: `linear-gradient(0deg, rgba(10,10,20,${s >= T3 ? 0.9 : 0.55}), transparent)` }} />
      {s < T2 ? <div style={{ position: "absolute", left: 0, right: 0, top: 110, textAlign: "center" }}><div style={{ display: "inline-block", fontFamily: N, fontWeight: 900, fontSize: 30, letterSpacing: 7, color: "#fff", background: CORAL, padding: "8px 26px", borderRadius: 30, border: `5px solid ${INK}` }}>DAY 3 · STILL LOOSE</div></div> : null}
      <Say a={0.7} b={3.4}>Not the<br />Run button!</Say>
      <Say a={6.3} b={7.85} top={200}>I can't catch it.</Say>
      {s >= T3 ? (
        <>
          <div style={{ position: "absolute", left: 50, right: 50, top: 150, textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: 92, lineHeight: 0.98, letterSpacing: -2, color: "#fff", textShadow: "0 6px 30px rgba(0,0,0,0.7)", transform: `scale(${ramp(s, T3 + 0.1, T3 + 0.35, 0.7, 1, back)})`, opacity: ramp(s, T3 + 0.1, T3 + 0.2) }}>It only stops if<br />someone <span style={{ color: YELLOW }}>fixes line 4.</span></div>
          <div style={{ position: "absolute", left: 50, right: 50, top: 1210, padding: "26px 34px 30px", borderRadius: 40, background: INK, border: "5px solid rgba(255,255,255,0.25)", transform: `translateY(${(1 - ramp(s, T3 + 0.5, T3 + 0.85, 0, 1, back)) * 800}px)` }}>
            <div style={{ fontFamily: N, fontWeight: 900, fontSize: 26, letterSpacing: 5, color: YELLOW }}>LINE 4</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 52, color: "#fff", marginTop: 6, whiteSpace: "pre" }}>monster.eat(<span style={{ color: "#ff6b6b", background: `rgba(255,107,107,${0.15 + pulse * 0.25})`, borderRadius: 10, padding: "0 6px" }}>{s < 10.4 ? "everything" : " ? "}</span>)</div>
          </div>
          <div style={{ position: "absolute", left: 40, right: 40, top: 1420, display: "flex", justifyContent: "center", gap: 18 }}>
            {opts.map((o, k) => { const p = ramp(s, 10.4 + k * 0.14, 10.65 + k * 0.14, 0, 1, back); return <div key={o} style={{ padding: "16px 28px", borderRadius: 34, background: "#fff", border: `7px solid ${INK}`, boxShadow: `0 9px 0 ${INK}`, fontFamily: MONO, fontWeight: 700, fontSize: 40, color: INK, transform: `scale(${p}) rotate(${(k - 1) * 4 + Math.sin(s * 3 + k) * 2}deg)`, opacity: Math.min(1, p * 2) }}>{o}?</div>; })}
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1570, textAlign: "center", opacity: ramp(s, 10.9, 11.05), transform: `scale(${ramp(s, 10.9, 11.2, 0.6, 1, back)})` }}>
            <div style={{ display: "inline-block", padding: "18px 56px", borderRadius: 60, background: YELLOW, border: `8px solid ${INK}`, boxShadow: `0 12px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 72, color: INK }}>Comment the fix</div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1740, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 34, color: "#fff", opacity: ramp(s, 11.5, 11.8) }}>Free to start · codeitlearn.com</div>
        </>
      ) : null}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 22, letterSpacing: 5, color: "rgba(255,255,255,0.8)" }}>MADE-UP STORY · AI ANIMATION AND VOICE</div>
      {([[4.87, 6.23, 0.75], [6.57, 7.76, 6.35], [8.26, 10.61, 8.15], [10.93, 11.9, 10.95]] as [number, number, number][]).map(([a, b, at]) => (
        <Sequence key={at} from={Math.round(at * fps)} durationInFrames={Math.round((b - a) * fps)} layout="none"><Audio src={staticFile("vo/monster-pip.mp3")} startFrom={Math.round(a * fps)} endAt={Math.round(b * fps)} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};
