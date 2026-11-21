import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * "Adam Builds It", episode 1: "My game ate it". Five stills of the cast (Mr. Sam, Adam,
 * Pip, Mom), one coding idea, a joke to end on. Made-up story, AI art, labelled on screen.
 */
const CREAM = "#fff4e5", INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340";
const B = "'Baloo 2'", N = "'Nunito'";
export const EP1_DUR = 32;
// [scene, start, end, zoom from, zoom to, pan x from, pan x to, pan y from, pan y to]
const SC: [number, number, number, number, number, number, number, number, number][] = [
  [1, 0, 5.2, 1.0, 1.1, 0, -20, 0, -30],
  [2, 5.2, 10.2, 1.12, 1.0, -30, 0, -40, 0],
  [3, 10.2, 17.2, 1.0, 1.12, 0, 20, 0, -50],
  [4, 17.2, 24.2, 1.1, 1.0, 20, 0, -40, 0],
  [5, 24.2, 28.4, 1.0, 1.1, 0, -10, 0, -30],
];
// [who, line, start, end, colour, side]
const LINES: [string, string, number, number, string, "l" | "r"][] = [
  ["MR. SAM", "Adam. Homework?", 0.4, 2.5, "#5fae8a", "l"],
  ["ADAM", "My game ate it.", 2.7, 5.1, CORAL, "r"],
  ["MR. SAM", "Your game. Ate it.", 5.6, 7.9, "#5fae8a", "l"],
  ["ADAM", "See? Gone.", 8.1, 10.1, CORAL, "r"],
  ["PIP", "Line four. You told it to eat everything.", 10.7, 14.1, "#ff8a1f", "l"],
  ["ADAM", "Oh. Just the stars.", 14.4, 17.1, CORAL, "r"],
  ["ADAM", "Fixed it.", 17.7, 19.8, CORAL, "r"],
  ["MR. SAM", "Can it eat my marking?", 20.3, 24.1, "#5fae8a", "l"],
  ["MOM", "Wait. You built that?", 24.8, 28.2, "#3d5a9e", "l"],
];
const END = 28.4;

export const CodeItEp1: React.FC = () => {
  const { s } = useT();
  const e = useSpringAt(END + 0.1, { damping: 14, stiffness: 150 });
  const pill = useSpringAt(END + 0.9, { damping: 12, stiffness: 180 });
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      {SC.map(([n, a, b, z0, z1, x0, x1, y0, y1]) => {
        if (s < a - 0.05 || s > b + 0.35) return null;
        const u = ramp(s, a, b, 0, 1, (x) => x);
        const o = ramp(s, a - 0.05, a + 0.3) ;
        return (
          <AbsoluteFill key={n} style={{ opacity: n === 1 ? 1 : o, overflow: "hidden" }}>
            <Img src={staticFile(`ep1/s${n}.jpg`)} style={{ width: 1080, height: 1935, objectFit: "cover", transform: `translate(${x0 + (x1 - x0) * u}px, ${y0 + (y1 - y0) * u}px) scale(${z0 + (z1 - z0) * u})`, transformOrigin: "50% 60%" }} />
          </AbsoluteFill>
        );
      })}
      {/* series tag */}
      {s < END ? (
        <div style={{ position: "absolute", left: 50, top: 70, display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ padding: "8px 22px", borderRadius: 30, background: YELLOW, border: `5px solid ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 30, color: INK }}>ADAM BUILDS IT</div>
          <div style={{ padding: "8px 18px", borderRadius: 30, background: "#fff", border: `5px solid ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 30, color: INK }}>EP 1</div>
        </div>
      ) : null}
      {/* speech bubbles */}
      {LINES.map(([who, line, a, b, col, side], k) => {
        if (s < a || s > b + 0.2) return null;
        const p = ramp(s, a, a + 0.22) * (1 - ramp(s, b, b + 0.2));
        const big = line.length <= 20;
        return (
          <div key={k} style={{ position: "absolute", left: side === "l" ? 50 : undefined, right: side === "r" ? 50 : undefined, top: 170, maxWidth: 900, opacity: p, transform: `translateY(${(1 - p) * 26}px) scale(${0.92 + p * 0.08})`, transformOrigin: side === "l" ? "0% 100%" : "100% 100%" }}>
            <div style={{ display: "inline-block", padding: "4px 20px", borderRadius: 16, background: col, border: `5px solid ${INK}`, fontFamily: N, fontWeight: 900, fontSize: 28, letterSpacing: 3, color: "#fff", marginBottom: -10, marginLeft: side === "l" ? 26 : 0, marginRight: side === "r" ? 26 : 0, position: "relative", zIndex: 2, float: side === "r" ? "right" : "none" }}>{who}</div>
            <div style={{ clear: "both", padding: "26px 38px 22px", borderRadius: 40, background: "#fff", border: `7px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: big ? 84 : 64, lineHeight: 1.05, letterSpacing: -1, color: INK }}>{line}</div>
          </div>
        );
      })}
      {s < END ? <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.55)" }}>MADE-UP STORY · AI ART</div> : null}
      {/* end card */}
      {s >= END ? (
        <AbsoluteFill style={{ background: CREAM, opacity: Math.min(1, e * 1.6) }}>
          <div style={{ position: "absolute", left: -220, top: -220, width: 760, height: 760, borderRadius: 380, background: "rgba(254,211,64,0.45)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 560, textAlign: "center", transform: `scale(${0.9 + e * 0.1})` }}>
            <div style={{ fontFamily: B, fontWeight: 800, fontSize: 64, color: CORAL }}>CodeIt</div>
            <div style={{ fontFamily: B, fontWeight: 800, fontSize: 124, lineHeight: 1.0, letterSpacing: -3, color: INK, marginTop: 20 }}>Screen time</div>
            <div style={{ fontFamily: B, fontWeight: 800, fontSize: 124, lineHeight: 1.0, letterSpacing: -3, color: CORAL }}>you'll brag about.</div>
            <div style={{ display: "inline-block", marginTop: 70, padding: "22px 54px", borderRadius: 60, background: YELLOW, border: `7px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 50, color: INK, transform: `scale(${pill})` }}>Free to start · codeitlearn.com</div>
            <div style={{ marginTop: 60, fontFamily: N, fontWeight: 900, fontSize: 30, letterSpacing: 4, color: "rgba(22,22,29,0.55)" }}>EPISODE 2 NEXT WEEK</div>
          </div>
        </AbsoluteFill>
      ) : null}
      {SC.slice(1).map(([n, a]) => <Sfx key={n} at={a} src="whoosh.wav" volume={0.25} />)}
      <Sfx at={17.7} src="ding.wav" volume={0.5} />
      <Sfx at={END} src="pop.wav" volume={0.4} />
    </AbsoluteFill>
  );
};
