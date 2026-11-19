import React from "react";
import { AbsoluteFill } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ reel: sketch to reality. A homepage is pencilled on paper, a lime line wipes across and
 * the same layout becomes a finished site, then the first orders arrive. The bakery is made up.
 */
const LI = "#C7FF3D", BG = "#030303", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const SKETCH_DUR = 14;
const W = 820, H = 1120, X = 130, Y = 560;

const Stroke: React.FC<{ d: string; at: number; dur?: number; w?: number }> = ({ d, at, dur = 0.5, w = 5 }) => {
  const { s } = useT();
  const p = ramp(s, at, at + dur, 0, 1, (x) => x);
  return <path d={d} pathLength={1} fill="none" stroke="#2b2b2b" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1} strokeDashoffset={1 - p} opacity={p > 0 ? 0.85 : 0} />;
};

const Head: React.FC<{ a: string; b: string; at: number; out: number }> = ({ a, b, at, out }) => {
  const { s } = useT();
  if (s < at || s > out + 0.3) return null;
  const o = ramp(s, at, at + 0.3) * (1 - ramp(s, out, out + 0.3));
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: 250, textAlign: "center", opacity: o, transform: `translateY(${(1 - ramp(s, at, at + 0.3)) * 20}px)` }}>
      <div style={{ fontFamily: IL, fontSize: 76, letterSpacing: -3, lineHeight: 1.06, color: "#fff" }}>{a}</div>
      <div style={{ fontFamily: IL, fontSize: 76, letterSpacing: -3, lineHeight: 1.06, color: LI }}>{b}</div>
    </div>
  );
};

const Loaf: React.FC<{ c: string }> = ({ c }) => (
  <div style={{ width: 150, height: 96, borderRadius: "70px 70px 26px 26px", background: c, position: "relative", boxShadow: "inset 0 -14px 0 rgba(0,0,0,0.12)" }}>
    {[34, 70, 106].map((x) => <div key={x} style={{ position: "absolute", left: x, top: 16, width: 8, height: 34, borderRadius: 4, background: "rgba(255,255,255,0.55)", transform: "rotate(20deg)" }} />)}
  </div>
);

export const LynqSketch: React.FC = () => {
  const { s } = useT();
  const card = useSpringAt(0.05, { damping: 14, stiffness: 170 });
  const wipe = ramp(s, 3.6, 4.7, 0, 1);
  const live = useSpringAt(5.0, { damping: 11, stiffness: 200 });
  const end = ramp(s, 11.0, 11.5);
  const tilt = (1 - wipe) * -3;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <div style={{ position: "absolute", left: 540 - 800, top: 1100 - 800, width: 1600, height: 1600, borderRadius: 800, background: "radial-gradient(closest-side, rgba(199,255,61,0.12) 0%, rgba(0,0,0,0) 100%)", opacity: wipe * (1 - end) }} />
      <Head a="You've had this idea" b="for a year." at={0.1} out={3.3} />
      <Head a="Here it is." b="Open for business." at={3.8} out={7.2} />
      <Head a="First orders" b="before lunch." at={7.5} out={10.7} />

      <div style={{ position: "absolute", left: X, top: Y + (1 - card) * 200, width: W, height: H, opacity: Math.min(1, card * 1.4) * (1 - end), transform: `rotate(${tilt}deg) scale(${1 - end * 0.1})`, borderRadius: 34, overflow: "hidden", boxShadow: "0 60px 140px rgba(0,0,0,0.8)" }}>
        {/* the sketch on paper */}
        <div style={{ position: "absolute", inset: 0, background: "#efe6d2" }}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            <Stroke at={0.3} d="M60 92 C 64 70, 104 68, 108 92 C 110 116, 62 118, 60 92" />
            <Stroke at={0.5} d="M150 96 C 220 90, 260 98, 330 92" />
            <Stroke at={0.6} d="M560 94 L 630 92 M 660 95 L 730 93" dur={0.3} />
            <Stroke at={0.9} d="M62 180 L 756 174 L 760 520 L 58 526 Z" dur={0.7} />
            <Stroke at={1.4} d="M62 180 L 760 520 M 756 174 L 58 526" dur={0.5} w={3} />
            <Stroke at={1.8} d="M64 600 C 200 588, 420 606, 640 594" />
            <Stroke at={2.0} d="M64 660 C 180 652, 320 666, 470 656" />
            <Stroke at={2.2} d="M70 740 C 66 716, 300 712, 306 738 C 310 800, 68 804, 70 740" dur={0.5} />
            <Stroke at={2.5} d="M60 880 L 270 876 L 272 1050 L 58 1054 Z M 304 878 L 514 876 L 516 1052 L 302 1054 Z M 548 880 L 758 876 L 760 1050 L 546 1054 Z" dur={0.8} />
          </svg>
          <div style={{ position: "absolute", left: 330, top: 760, fontFamily: IL, fontSize: 30, color: "#555", transform: "rotate(-4deg)", opacity: ramp(s, 2.6, 3.0) }}>order button here?</div>
        </div>
        {/* the finished site, revealed left to right */}
        <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`, background: "#fffaf1" }}>
          <div style={{ height: 150, display: "flex", alignItems: "center", padding: "0 56px", gap: 18 }}>
            <div style={{ width: 54, height: 54, borderRadius: 27, background: "#c8742c" }} />
            <div style={{ fontFamily: IS, fontSize: 34, color: "#2a1a0e" }}>Hearth & Rye</div>
            <div style={{ marginLeft: "auto", fontFamily: IL, fontSize: 24, color: "#6b5a4a", display: "flex", gap: 30 }}><span>Menu</span><span>Visit</span></div>
          </div>
          <div style={{ margin: "0 56px", height: 350, borderRadius: 28, background: "linear-gradient(135deg,#f6c98a,#e39a4e)", display: "flex", alignItems: "center", justifyContent: "center", gap: 26 }}>
            <Loaf c="#b9652a" /><div style={{ transform: "translateY(26px) scale(1.25)" }}><Loaf c="#c9772f" /></div><Loaf c="#a85a22" />
          </div>
          <div style={{ padding: "50px 56px 0" }}>
            <div style={{ fontFamily: IS, fontSize: 60, letterSpacing: -2, lineHeight: 1.05, color: "#2a1a0e" }}>Fresh bread,<br />every morning.</div>
            <div style={{ display: "inline-block", marginTop: 30, padding: "20px 44px", borderRadius: 50, background: "#2a1a0e", fontFamily: IS, fontSize: 30, color: "#fffaf1", transform: `scale(${1 + (s > 5.6 && s < 5.9 ? -0.06 : 0)})` }}>Order ahead</div>
          </div>
          <div style={{ position: "absolute", left: 56, right: 56, top: 880, display: "flex", gap: 30 }}>
            {[["Sourdough", "#b9652a"], ["Rye", "#8a4b1e"], ["Brioche", "#e0a04e"]].map(([n, c]) => (
              <div key={n} style={{ flex: 1, height: 176, borderRadius: 22, background: "#fff", boxShadow: "0 8px 30px rgba(42,26,14,0.10)", padding: 18 }}>
                <div style={{ height: 88, borderRadius: 14, background: c, opacity: 0.85 }} />
                <div style={{ fontFamily: IS, fontSize: 24, color: "#2a1a0e", marginTop: 12 }}>{n}</div>
              </div>
            ))}
          </div>
        </div>
        {/* the wipe line */}
        {wipe > 0 && wipe < 1 ? <div style={{ position: "absolute", left: wipe * W - 5, top: 0, width: 10, height: H, background: LI, boxShadow: `0 0 50px ${LI}` }} /> : null}
      </div>

      {/* live badge */}
      {s >= 5.0 ? <div style={{ position: "absolute", left: X + W - 190, top: Y - 34, padding: "12px 26px", borderRadius: 40, background: LI, fontFamily: IS, fontSize: 26, letterSpacing: 3, color: "#0b0d0a", transform: `scale(${live}) rotate(4deg)`, opacity: 1 - end }}>● LIVE</div> : null}
      {/* orders */}
      {[["2 sourdough · pickup 8:30", 7.6], ["Brioche box · pickup 9:00", 8.5], ["Rye + 4 buns · pickup 11:15", 9.4]].map(([t, at], i) => {
        const p = ramp(s, at as number, (at as number) + 0.35);
        if (s < (at as number)) return null;
        return (
          <div key={t as string} style={{ position: "absolute", left: 70, right: 70, top: 1250 + i * 136, borderRadius: 30, background: "rgba(20,21,22,0.94)", border: "1px solid rgba(199,255,61,0.5)", padding: "24px 30px", display: "flex", alignItems: "center", gap: 24, opacity: p * (1 - end), transform: `translateX(${(1 - p) * 140}px)`, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
            <div style={{ width: 66, height: 66, borderRadius: 33, background: LI, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 26, height: 14, borderLeft: "6px solid #0b0d0a", borderBottom: "6px solid #0b0d0a", transform: "rotate(-45deg)", marginTop: -6 }} /></div>
            <div><div style={{ fontFamily: IS, fontSize: 34, color: "#fff" }}>New order</div><div style={{ fontFamily: IL, fontSize: 28, color: "rgba(255,255,255,0.7)" }}>{t}</div></div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 1760, textAlign: "center", fontFamily: IS, fontSize: 19, letterSpacing: 5, color: "rgba(255,255,255,0.34)", opacity: 1 - end }}>THE BAKERY IS MADE UP</div>

      <AbsoluteFill style={{ opacity: end, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "0 90px", transform: `translateY(${(1 - end) * 30}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 84, lineHeight: 1.06, letterSpacing: -4, color: "#fff" }}>Bring the sketch.</div>
          <div style={{ fontFamily: IL, fontSize: 84, lineHeight: 1.06, letterSpacing: -4, color: LI, marginTop: 20 }}>We build the rest.</div>
          <div style={{ display: "inline-block", marginTop: 70, padding: "24px 50px", borderRadius: 60, background: LI, fontFamily: IS, fontSize: 38, color: "#0b0d0a" }}>Book a consultation</div>
          <div style={{ marginTop: 22, fontFamily: IL, fontSize: 32, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>lynq.build/book</div>
        </div>
      </AbsoluteFill>

      <Sfx at={3.6} src="whoosh.wav" volume={0.5} />
      <Sfx at={5.0} src="ding.wav" volume={0.5} />
      {[7.6, 8.5, 9.4].map((t) => <Sfx key={t} at={t} src="pop.wav" volume={0.45} />)}
      <Sfx at={11.0} src="whoosh.wav" volume={0.35} />
    </AbsoluteFill>
  );
};
