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

/* ── Three stronger directions for the same post ── */

const O = "'Outfit Bold'", OR = "'Outfit Regular'";

/** 1. Photo hero: the kid, the lamp, the game on screen. Type sits in the dark of the room. */
export const LuxPhoto: React.FC = () => (
  <AbsoluteFill style={{ background: "#0d0d12", overflow: "hidden" }}>
    <Fonts />
    <Img src={staticFile("ads/codeit-student.jpg")} style={{ position: "absolute", left: 0, top: -330, width: 1080, height: 1920, filter: "saturate(1.08) contrast(1.04)" }} />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(8,8,12,0.92) 0%, rgba(8,8,12,0.7) 28%, rgba(8,8,12,0) 46%, rgba(8,8,12,0) 66%, rgba(8,8,12,0.92) 100%)" }} />
    <Img src={staticFile("ads/codeit-logo.png")} style={{ position: "absolute", left: 60, top: 48, width: 160 }} />
    <div style={{ position: "absolute", right: 70, top: 84, fontFamily: OR, fontSize: 28, letterSpacing: 1, color: "rgba(255,255,255,0.75)" }}>codeitlearn.com</div>
    <div style={{ position: "absolute", left: 66, right: 60, top: 200, fontFamily: O, fontSize: 108, lineHeight: 0.98, letterSpacing: -4, color: "#fff", textShadow: "0 4px 40px rgba(0,0,0,0.5)" }}>
      He changed<br /><span style={{ color: YELLOW }}>one number.</span>
    </div>
    <div style={{ position: "absolute", left: 70, top: 424, fontFamily: OR, fontSize: 42, lineHeight: 1.2, color: "rgba(255,255,255,0.85)" }}>Now he won't stop.</div>
    {/* glass callout by the screen */}
    <div style={{ position: "absolute", left: 610, top: 880, display: "flex", alignItems: "center", gap: 16, padding: "18px 30px", borderRadius: 50, background: "rgba(255,255,255,0.16)", border: "2px solid rgba(255,255,255,0.45)", backdropFilter: "blur(18px)", boxShadow: "0 24px 50px rgba(0,0,0,0.45)", fontFamily: O, fontSize: 42, color: "#fff" }}>
      <span style={{ fontFamily: M, fontSize: 32, color: "rgba(255,255,255,0.8)" }}>fallSpeed</span>2<span style={{ color: YELLOW }}>→</span>9
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, bottom: 96, fontFamily: O, fontSize: 54, lineHeight: 1.08, letterSpacing: -1, color: "#fff" }}>Make it. Play it. Change it.</div>
    <div style={{ position: "absolute", left: 70, bottom: 50, fontFamily: OR, fontSize: 24, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>FREE TO START · AI-MADE IMAGE</div>
  </AbsoluteFill>
);

/** 2. Minimal: the change itself is the picture. */
export const LuxNumbers: React.FC = () => (
  <AbsoluteFill style={{ background: CREAM, overflow: "hidden" }}>
    <Fonts />
    <div style={{ position: "absolute", right: -300, top: -300, width: 1000, height: 1000, borderRadius: 500, background: "radial-gradient(closest-side, rgba(254,211,64,0.7) 0%, rgba(254,211,64,0) 100%)" }} />
    <Img src={staticFile("ads/codeit-logo.png")} style={{ position: "absolute", left: 60, top: 48, width: 160 }} />
    <div style={{ position: "absolute", right: 70, top: 84, fontFamily: OR, fontSize: 28, letterSpacing: 1, color: "rgba(22,22,29,0.6)" }}>codeitlearn.com</div>
    <div style={{ position: "absolute", left: 70, top: 250, fontFamily: M, fontSize: 40, color: "rgba(22,22,29,0.55)" }}><span style={{ color: CORAL }}>let</span> fallSpeed =</div>
    <div style={{ position: "absolute", left: 50, right: 50, top: 290, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: O, lineHeight: 1 }}>
      <span style={{ fontSize: 520, letterSpacing: -20, color: "rgba(22,22,29,0.16)" }}>2</span>
      <span style={{ fontSize: 150, color: CORAL }}>→</span>
      <span style={{ fontSize: 620, letterSpacing: -20, background: `linear-gradient(160deg, ${YELLOW} 0%, ${CORAL} 80%)`, WebkitBackgroundClip: "text", color: "transparent", filter: "drop-shadow(0 30px 40px rgba(255,125,89,0.35))" }}>9</span>
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 900, fontFamily: O, fontSize: 104, lineHeight: 0.98, letterSpacing: -3, color: INK }}>One number.<br />Whole new game.</div>
    <div style={{ position: "absolute", left: 70, right: 70, bottom: 64, fontFamily: OR, fontSize: 38, color: "rgba(22,22,29,0.7)" }}>Kids learn to code by changing real code and seeing what happens.</div>
  </AbsoluteFill>
);

/** 3. The control: one big dial, the game reacting behind it. */
export const LuxDial: React.FC = () => (
  <AbsoluteFill style={{ background: "linear-gradient(180deg, #1c2550 0%, #40287a 100%)", overflow: "hidden" }}>
    <Fonts />
    <div style={{ position: "absolute", left: -200, top: 300, width: 900, height: 900, borderRadius: 450, background: "radial-gradient(closest-side, rgba(255,125,89,0.35) 0%, rgba(255,125,89,0) 100%)" }} />
    <Star x={120} y={560} s={90} trail={110} /><Star x={760} y={520} s={130} trail={80} /><Star x={470} y={640} s={70} trail={150} /><Star x={920} y={700} s={56} trail={160} /><Star x={290} y={730} s={48} trail={200} />
    <Img src={staticFile("ads/codeit-logo.png")} style={{ position: "absolute", left: 60, top: 48, width: 160 }} />
    <div style={{ position: "absolute", right: 70, top: 84, fontFamily: OR, fontSize: 28, letterSpacing: 1, color: "rgba(255,255,255,0.75)" }}>codeitlearn.com</div>
    <div style={{ position: "absolute", left: 66, right: 60, top: 190, fontFamily: O, fontSize: 112, lineHeight: 0.98, letterSpacing: -3, color: "#fff" }}>Too easy?<br /><span style={{ color: YELLOW }}>Change the code.</span></div>
    {/* slider card */}
    <div style={{ position: "absolute", left: 70, right: 70, top: 830, padding: "44px 50px 50px", borderRadius: 56, background: "rgba(255,255,255,0.96)", boxShadow: "0 60px 120px rgba(8,8,30,0.55), 0 18px 36px rgba(8,8,30,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: M, fontSize: 44, color: INK }}><span style={{ color: CORAL }}>let</span> fallSpeed</span>
        <span style={{ fontFamily: O, fontSize: 120, lineHeight: 1, color: INK }}>9</span>
      </div>
      <div style={{ position: "relative", marginTop: 26, height: 28, borderRadius: 14, background: "#ece7df" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "86%", borderRadius: 14, background: `linear-gradient(90deg, ${YELLOW}, ${CORAL})` }} />
        <div style={{ position: "absolute", left: "86%", top: -26, width: 80, height: 80, marginLeft: -40, borderRadius: 40, background: "#fff", border: `8px solid ${CORAL}`, boxShadow: "0 14px 30px rgba(255,125,89,0.5)" }} />
      </div>
      <div style={{ marginTop: 34, display: "flex", justifyContent: "space-between", fontFamily: OR, fontSize: 30, color: "rgba(22,22,29,0.55)" }}><span>slow</span><span>chaos</span></div>
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, bottom: 60, fontFamily: OR, fontSize: 38, color: "rgba(255,255,255,0.8)" }}>Make it. Play it. Change it.</div>
  </AbsoluteFill>
);

/* ── 3D set: a custom toy-like render per post, one headline in the clear space above it ── */

const Post3D: React.FC<{ img: string; l1: string; l2: string; sub: string; ink: string; accent: string; muted: string; size?: number; chip?: boolean }> = ({ img, l1, l2, sub, ink, accent, muted, size = 112, chip }) => (
  <AbsoluteFill style={{ overflow: "hidden" }}>
    <Fonts />
    <Img src={staticFile(`c3d/${img}.jpg`)} style={{ position: "absolute", left: -4, top: 0, width: 1088, height: 1350, objectFit: "cover" }} />
    {chip && <div style={{ position: "absolute", left: 44, top: 36, width: 182, height: 128, borderRadius: 34, background: CREAM }} />}
    <Img src={staticFile("ads/codeit-logo.png")} style={{ position: "absolute", left: 60, top: 48, width: 150 }} />
    <div style={{ position: "absolute", right: 70, top: 82, fontFamily: OR, fontSize: 28, letterSpacing: 1, color: muted }}>codeitlearn.com</div>
    <div style={{ position: "absolute", left: 66, right: 60, top: 200, fontFamily: O, fontSize: size, lineHeight: 0.98, letterSpacing: -size / 30, whiteSpace: "nowrap", color: ink }}>{l1}<br /><span style={{ color: accent }}>{l2}</span></div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 200 + size * 1.96 + 30, fontFamily: OR, fontSize: 40, lineHeight: 1.2, color: muted }}>{sub}</div>
  </AbsoluteFill>
);

export const D3Dial: React.FC = () => <Post3D img="dial" l1="Change one number." l2="See what breaks." sub="That's how kids learn what code does." ink={INK} accent="#f0562d" muted="rgba(22,22,29,0.62)" size={100} />;
export const D3Trophy: React.FC = () => <Post3D img="trophy" l1="Screen time" l2="you'll brag about." sub="They build the game. Then explain how it works." ink={INK} accent="#e2481f" muted="rgba(22,22,29,0.66)" size={108} />;
export const D3Controller: React.FC = () => <Post3D img="controller" l1="They don't just play it." l2="They built it." sub="Real games, made of code they can open." ink="#fff" accent={YELLOW} muted="rgba(255,255,255,0.9)" size={84} chip />;
export const D3Snake: React.FC = () => <Post3D img="snake" l1="31 Python lessons." l2="One step at a time." sub="In the browser. Nothing to install." ink={INK} accent="#f0562d" muted="rgba(22,22,29,0.62)" size={104} />;
export const D3Dinner: React.FC = () => <Post3D img="dinner" l1="“5 more minutes.”" l2="The good kind." sub="When they'd rather fix their game than stop." ink="#fff" accent={YELLOW} muted="rgba(255,255,255,0.8)" size={104} />;
