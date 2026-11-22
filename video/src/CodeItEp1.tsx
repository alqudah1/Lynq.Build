import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";
import { Pip } from "./pip-kit";

/*
 * "Adam Builds It", episode 1: "My game ate it". Five stills of the cast (Mr. Sam, Adam,
 * Pip, Mom), one coding idea, a joke to end on. Made-up story, AI art, labelled on screen.
 */
const CREAM = "#fff4e5", INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340";
const B = "'Baloo 2'", N = "'Nunito'";
export const EP1_DUR = 35;
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
  const pill = useSpringAt(END + 4.5, { damping: 12, stiffness: 180 });
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
      {/* the fix, shown as the one line that changed */}
      {s >= 17.5 && s < 20.2 ? (() => {
        const p = ramp(s, 17.5, 17.8) * (1 - ramp(s, 19.9, 20.2));
        const sw = ramp(s, 18.3, 18.55);
        return (
          <div style={{ position: "absolute", left: 90, right: 90, top: 1500, padding: "26px 34px", borderRadius: 28, background: "#16161d", border: `6px solid ${YELLOW}`, boxShadow: "0 12px 0 rgba(0,0,0,0.35)", opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
            <div style={{ fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 4, color: YELLOW }}>LINE 4</div>
            <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 58, color: "#fff", marginTop: 6, whiteSpace: "nowrap" }}>
              monster.eat(<span style={{ color: sw < 0.5 ? "#ff6b6b" : "#7ee787", textDecoration: sw > 0 && sw < 0.5 ? "line-through" : "none" }}>{sw < 0.5 ? "everything" : "stars"}</span>)
            </div>
          </div>
        );
      })() : null}
      {/* ending: the game monster bites the end card, Pip calls the bug, it spits the corner back */}
      {s >= END ? (() => {
        const rise = ramp(s, END + 0.9, END + 1.3, 0, 1, (x) => 1 - Math.pow(1 - x, 3));
        const bitten = s >= END + 1.75 && s < END + 3.5;
        const chew = bitten ? Math.sin((s - END) * 22) * 0.5 + 0.5 : 0;
        const pipIn = ramp(s, END + 2.3, END + 2.6, 0, 1, (x) => 1 - Math.pow(1 - x, 3));
        const spit = ramp(s, END + 3.5, END + 3.75);
        const shy = ramp(s, END + 3.6, END + 4.1);
        const MX = 700, MY = 1430 + (1 - rise) * 700 + shy * 190;
        return (
          <AbsoluteFill style={{ background: YELLOW, opacity: Math.min(1, e * 1.6) }}>
            <div style={{ position: "absolute", left: 60, right: 60, top: 300, height: 1180, borderRadius: 70, background: CREAM, border: `8px solid ${INK}`, boxShadow: `0 16px 0 ${INK}`, transform: `scale(${0.92 + e * 0.08}) rotate(${bitten ? Math.sin((s - END) * 30) * 0.6 : 0}deg)`, overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center" }}>
                <div style={{ fontFamily: B, fontWeight: 800, fontSize: 60, color: CORAL }}>CodeIt</div>
                <div style={{ fontFamily: B, fontWeight: 800, fontSize: 96, lineHeight: 1.02, letterSpacing: -2, color: INK, marginTop: 40 }}>Some kids<br />play the game.</div>
                <div style={{ fontFamily: B, fontWeight: 800, fontSize: 132, lineHeight: 1.0, letterSpacing: -3, color: CORAL, marginTop: 34, opacity: ramp(s, END + 3.9, END + 4.15), transform: `scale(${0.8 + ramp(s, END + 3.9, END + 4.2, 0, 0.2, (x) => 1 - Math.pow(1 - x, 3))})` }}>Your kid<br />built it.</div>
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 150, textAlign: "center" }}>
                <div style={{ display: "inline-block", padding: "20px 50px", borderRadius: 60, background: YELLOW, border: `7px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 46, color: INK, transform: `scale(${pill})` }}>Free to start · codeitlearn.com</div>
              </div>
              {/* the bite */}
              {bitten ? <>
                <div style={{ position: "absolute", right: -70, bottom: -70, width: 300, height: 300, borderRadius: 150, background: YELLOW, border: `8px solid ${INK}` }} />
                <div style={{ position: "absolute", right: 170, bottom: -50, width: 150, height: 150, borderRadius: 75, background: YELLOW, border: `8px solid ${INK}` }} />
                <div style={{ position: "absolute", right: -50, bottom: 180, width: 140, height: 140, borderRadius: 70, background: YELLOW, border: `8px solid ${INK}` }} />
              </> : null}
            </div>
            {/* the monster */}
            <div style={{ position: "absolute", left: MX, top: MY, width: 360, height: 420, transform: `rotate(${-8 + chew * 5}deg)` }}>
              <div style={{ position: "absolute", left: 60, top: -26, width: 44, height: 70, borderRadius: "50% 50% 10% 10%", background: "#6d3fd6", border: `7px solid ${INK}`, transform: "rotate(-18deg)" }} />
              <div style={{ position: "absolute", right: 60, top: -26, width: 44, height: 70, borderRadius: "50% 50% 10% 10%", background: "#6d3fd6", border: `7px solid ${INK}`, transform: "rotate(18deg)" }} />
              <div style={{ position: "absolute", inset: 0, borderRadius: "48% 48% 40% 40%", background: "#9b6bff", border: `8px solid ${INK}` }} />
              {[[50, 250, 34], [280, 210, 26], [250, 320, 30]].map(([x, y, r], k) => <div key={k} style={{ position: "absolute", left: x, top: y, width: r, height: r, borderRadius: r, background: "#7c4be6" }} />)}
              {[90, 210].map((x) => (
                <div key={x} style={{ position: "absolute", left: x, top: 70, width: 74, height: 84, borderRadius: 40, background: "#fff", border: `7px solid ${INK}` }}>
                  <div style={{ position: "absolute", left: 14 + (pipIn > 0.5 ? -8 : 6), top: 22 + (shy > 0 ? 14 : 0), width: 32, height: 32, borderRadius: 16, background: INK }} />
                </div>
              ))}
              <div style={{ position: "absolute", left: 80, top: 180, width: 200, height: bitten ? 40 + chew * 60 : shy > 0 ? 26 : 70, borderRadius: bitten ? 40 : "20px 20px 70px 70px", background: "#3a1140", border: `7px solid ${INK}`, overflow: "hidden" }}>
                {[18, 68, 118, 162].map((x) => <div key={x} style={{ position: "absolute", left: x, top: -4, width: 26, height: 24, background: "#fff", borderRadius: "0 0 10px 10px" }} />)}
              </div>
            </div>
            {/* crumbs / the corner flying back */}
            {s >= END + 1.75 && s < END + 2.4 ? [0, 1, 2, 3, 4].map((k) => { const u = ramp(s, END + 1.75, END + 2.4); return <div key={k} style={{ position: "absolute", left: 860 - k * 46 - u * (40 + k * 30), top: 1400 - u * (120 + k * 40) + u * u * 260, width: 26, height: 26, borderRadius: 8, background: CREAM, border: `5px solid ${INK}`, transform: `rotate(${u * 300 + k * 40}deg)`, opacity: 1 - u }} />; }) : null}
            {spit > 0 && spit < 1 ? <div style={{ position: "absolute", left: 800 + spit * 80, top: 1560 - spit * 140, fontFamily: B, fontWeight: 800, fontSize: 70, color: INK, opacity: 1 - spit }}>ptoo!</div> : null}
            {/* Pip calls it */}
            {pipIn > 0 ? <>
              <Pip pose="cheer" x={230} y={1560 + (1 - pipIn) * 500} size={300} bounce={Math.abs(Math.sin((s - END) * 9)) * 16} />
              {s >= END + 2.6 && s < END + 3.8 ? <div style={{ position: "absolute", left: 300, top: 1370, padding: "16px 34px", borderRadius: 36, background: "#fff", border: `7px solid ${INK}`, boxShadow: `0 8px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 70, color: INK, transform: `rotate(-4deg) scale(${ramp(s, END + 2.6, END + 2.8, 0.6, 1)})` }}>Line four!</div> : null}
            </> : null}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: "rgba(22,22,29,0.6)" }}>MADE-UP STORY · AI ART</div>
          </AbsoluteFill>
        );
      })() : null}
      {SC.slice(1).map(([n, a]) => <Sfx key={n} at={a} src="whoosh.wav" volume={0.25} />)}
      <Sfx at={17.7} src="ding.wav" volume={0.5} />
      <Sfx at={END} src="pop.wav" volume={0.4} />
      <Sfx at={END + 1.75} src="crash.wav" volume={0.35} />
      <Sfx at={END + 3.5} src="pop.wav" volume={0.5} />
      <Sfx at={END + 3.9} src="ding.wav" volume={0.5} />
    </AbsoluteFill>
  );
};
