import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts } from "./kit";

/*
 * CodeIt feed posts, premium pass. Same cream, yellow and coral, but built like a product ad:
 * soft light instead of flat colour, floating layered cards with deep soft shadows instead of
 * outlined boxes, one big headline, and a lot more air. 1080x1350 stills.
 */

const CORAL = "#ff7d59", YELLOW = "#fed340", CREAM = "#fff4e5", INK = "#16161d";
const H = "'Baloo 2'", B = "'Nunito'", M = "'JetBrains Mono'";

const Star: React.FC<{ x: number; y: number; s: number; trail?: number }> = ({ x, y, s, trail = 0 }) => (
  <>
    {trail > 0 && <div style={{ position: "absolute", left: x + s / 2 - 4, top: y - trail, width: 8, height: trail + s / 2, borderRadius: 4, background: "linear-gradient(180deg, rgba(254,211,64,0) 0%, rgba(254,211,64,0.55) 100%)" }} />}
    <svg width={s} height={s} viewBox="0 0 24 24" style={{ position: "absolute", left: x, top: y, filter: "drop-shadow(0 0 14px rgba(254,211,64,0.8))" }}><path d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6 5.6 21.1 7 14 1.7 9l7.2-.9z" fill={YELLOW} /></svg>
  </>
);

const Shell: React.FC<{ dark?: boolean; kicker: string; children: React.ReactNode }> = ({ dark, kicker, children }) => (
  <AbsoluteFill style={{ background: dark ? "#0f0f14" : CREAM, overflow: "hidden" }}>
    <Fonts />
    {/* soft light */}
    <div style={{ position: "absolute", right: -260, top: -260, width: 900, height: 900, borderRadius: 450, background: `radial-gradient(closest-side, ${dark ? "rgba(254,211,64,0.22)" : "rgba(254,211,64,0.75)"} 0%, rgba(254,211,64,0) 100%)` }} />
    <div style={{ position: "absolute", left: -320, bottom: -320, width: 1000, height: 1000, borderRadius: 500, background: `radial-gradient(closest-side, ${dark ? "rgba(255,125,89,0.28)" : "rgba(255,125,89,0.5)"} 0%, rgba(255,125,89,0) 100%)` }} />
    {/* top bar */}
    <Img src={staticFile("ads/codeit-logo.png")} style={{ position: "absolute", left: 64, top: 50, width: 170 }} />
    <div style={{ position: "absolute", right: 72, top: 86, fontFamily: B, fontWeight: 800, fontSize: 30, letterSpacing: 1, color: dark ? "rgba(255,255,255,0.7)" : "rgba(22,22,29,0.6)" }}>codeitlearn.com</div>
    <div style={{ position: "absolute", left: 72, top: 236, display: "flex", alignItems: "center", gap: 18, fontFamily: B, fontWeight: 900, fontSize: 26, letterSpacing: 7, color: CORAL }}><span style={{ width: 54, height: 5, borderRadius: 3, background: CORAL }} />{kicker}</div>
    {children}
  </AbsoluteFill>
);

/** A word with a soft yellow marker stroke behind it. */
const Mark: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark }) => (
  <span style={{ position: "relative", display: "inline-block", whiteSpace: "nowrap" }}>
    <span style={{ position: "absolute", left: -10, right: -10, bottom: 12, height: 42, borderRadius: 14, background: dark ? "rgba(254,211,64,0.32)" : YELLOW, transform: "rotate(-1.2deg)" }} />
    <span style={{ position: "relative", color: dark ? YELLOW : INK }}>{children}</span>
  </span>
);

export const LuxOneNumber: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <Shell dark={dark} kicker="HOW KIDS LEARN HERE">
    <div style={{ position: "absolute", left: 68, right: 60, top: 290, fontFamily: H, fontWeight: 800, fontSize: 124, lineHeight: 0.98, letterSpacing: -4, color: dark ? "#fff" : INK }}>
      Change<br /><Mark dark={dark}>one number.</Mark><br />See what breaks.
    </div>

    {/* code editor */}
    <div style={{ position: "absolute", left: 56, top: 740, width: 600, transform: "rotate(-4deg)", borderRadius: 44, background: "linear-gradient(160deg, #23232e 0%, #14141b 100%)", boxShadow: "0 60px 120px rgba(22,22,29,0.38), 0 18px 36px rgba(22,22,29,0.22), inset 0 1px 0 rgba(255,255,255,0.12)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "26px 34px 18px" }}>
        {["#ff6b5e", "#ffc24a", "#5ad07a"].map((c) => <span key={c} style={{ width: 20, height: 20, borderRadius: 10, background: c }} />)}
        <span style={{ marginLeft: 14, fontFamily: M, fontSize: 26, color: "#8b8b9c" }}>game.js</span>
      </div>
      <div style={{ padding: "6px 34px 40px", fontFamily: M, fontSize: 40, lineHeight: 1.6, color: "#ececf2" }}>
        <div><span style={{ color: CORAL }}>let</span> score = <span style={{ color: YELLOW }}>0</span></div>
        <div style={{ margin: "4px -20px", padding: "2px 20px", borderRadius: 18, background: "rgba(254,211,64,0.16)", boxShadow: "inset 0 0 0 2px rgba(254,211,64,0.45)" }}><span style={{ color: CORAL }}>let</span> fallSpeed = <span style={{ color: "#8b8b9c", textDecoration: "line-through" }}>2</span> <span style={{ color: YELLOW, fontWeight: 800 }}>9</span></div>
        <div><span style={{ color: CORAL }}>let</span> lives = <span style={{ color: YELLOW }}>3</span></div>
      </div>
    </div>

    {/* the game */}
    <div style={{ position: "absolute", right: 54, top: 700, width: 370, height: 480, transform: "rotate(5deg)", borderRadius: 54, background: "linear-gradient(180deg, #1c2550 0%, #40287a 100%)", boxShadow: "0 60px 120px rgba(22,22,29,0.42), 0 18px 36px rgba(22,22,29,0.24), inset 0 0 0 8px rgba(255,255,255,0.92)", overflow: "hidden" }}>
      <Star x={50} y={110} s={66} trail={100} /><Star x={220} y={180} s={86} trail={150} /><Star x={120} y={290} s={54} trail={110} /><Star x={270} y={350} s={46} trail={80} />
      <div style={{ position: "absolute", left: 115, bottom: 40, width: 140, height: 40, borderRadius: 20, background: CORAL, boxShadow: "0 0 30px rgba(255,125,89,0.7)" }} />
    </div>

    {/* the change, called out */}
    <div style={{ position: "absolute", left: 380, top: 1110, display: "flex", alignItems: "center", gap: 18, padding: "20px 34px", borderRadius: 60, background: "#fff", boxShadow: "0 30px 60px rgba(22,22,29,0.25)", fontFamily: H, fontWeight: 800, fontSize: 46, color: INK }}>
      <span style={{ fontFamily: M, fontSize: 36, color: "rgba(22,22,29,0.55)" }}>fallSpeed</span>2<span style={{ color: CORAL }}>→</span>9
    </div>

    <div style={{ position: "absolute", left: 72, right: 72, bottom: 56, fontFamily: B, fontWeight: 800, fontSize: 38, color: dark ? "rgba(255,255,255,0.78)" : "rgba(22,22,29,0.72)" }}>Make it. Play it. Change it.</div>
  </Shell>
);

export const LuxOneNumberDark: React.FC = () => <LuxOneNumber dark />;
