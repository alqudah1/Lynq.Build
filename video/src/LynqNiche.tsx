import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, ramp, useSpringAt, useT } from "./kit";

/*
 * Niche series, episode 1: barbers. One concept site (a made-up shop, labelled from the first
 * frame) scrolls inside a phone while short lines call out what the page does for the owner.
 */
const LI = "#C7FF3D", BG = "#040405", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const NICHE_DUR = 22;
const PW = 620, PH = 1271, SH = 2000; // phone inner size, strip height at 620 wide = 4459*620/900
const STRIP = Math.round((5951 * PW) / 1080);
const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const NOTES: [number, number, string, string][] = [
  [4.4, 7.6, "Next open chair", "The first thing they see."],
  [8.2, 11.0, "Prices up front", "No more \"how much?\" texts."],
  [11.6, 14.4, "Pick your barber", "Each one shows his next slot."],
  [14.9, 17.4, "Booked in two taps", "Even when you're closed."],
];

export const LynqNiche: React.FC = () => {
  const { s } = useT();
  const hookOut = ramp(s, 2.9, 3.5, 0, 1);
  const phoneIn = useSpringAt(2.9, { damping: 18, stiffness: 90 });
  const maxY = STRIP - PH;
  const stops: [number, number][] = [[3.6, 0], [5.2, 0.2], [7.9, 0.2], [9.2, 0.49], [11.2, 0.49], [12.6, 0.8], [14.6, 0.8], [16.0, 1], [17.6, 1]];
  let y = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, va] = stops[i], [b, vb] = stops[i + 1];
    if (s >= a) y = va + (vb - va) * io(Math.min(1, (s - a) / (b - a)));
  }
  const end = ramp(s, 17.7, 18.4, 0, 1);
  const tap = s > 6.3 && s < 7.2 ? Math.sin(((s - 6.3) / 0.9) * Math.PI) : 0;
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      <Fonts />
      <div style={{ position: "absolute", left: -200, right: -200, top: 500, height: 1100, background: "radial-gradient(closest-side, rgba(199,255,61,0.13), transparent)", opacity: phoneIn * (1 - end) }} />
      {/* hook */}
      <div style={{ position: "absolute", left: 70, right: 70, top: 560, opacity: 1 - hookOut, transform: `translateY(${-hookOut * 120}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 190, color: LI, letterSpacing: -8, lineHeight: 0.95, opacity: ramp(s, 0.05, 0.3, 0, 1), transform: `translateY(${(1 - ramp(s, 0.05, 0.4, 0, 1)) * 40}px)` }}>Barbers.</div>
        <div style={{ fontFamily: IL, fontSize: 74, color: "#fff", lineHeight: 1.12, marginTop: 36, opacity: ramp(s, 0.9, 1.3, 0, 1) }}>This is the website<br />your chair deserves.</div>
      </div>
      {/* label */}
      <div style={{ position: "absolute", top: 70, left: 0, right: 0, textAlign: "center", fontFamily: IS, fontSize: 24, letterSpacing: 5, color: "rgba(255,255,255,0.5)" }}>CONCEPT SITE · MADE-UP SHOP</div>
      {/* phone */}
      <div style={{ position: "absolute", left: (1080 - PW - 28) / 2, top: 150 + (1 - phoneIn) * 1900, width: PW + 28, height: PH + 28, borderRadius: 78, background: "#111", border: "2px solid rgba(255,255,255,0.18)", boxShadow: "0 60px 160px rgba(0,0,0,0.8), 0 0 120px rgba(199,255,61,0.10)", padding: 14, opacity: 1 - end, transform: `scale(${1 - end * 0.12}) rotate(${(1 - phoneIn) * 8}deg)` }}>
        <div style={{ width: PW, height: PH, borderRadius: 64, overflow: "hidden", position: "relative", background: "#f3ecdf" }}>
          <Img src={staticFile("niche/barber.jpg")} style={{ position: "absolute", left: 0, top: -y * maxY, width: PW, height: STRIP, maxWidth: "none" }} />
          <div style={{ position: "absolute", left: PW / 2 - 70, top: 14, width: 140, height: 36, borderRadius: 18, background: "#000" }} />
          {tap > 0 && <div style={{ position: "absolute", left: 300, top: 690, width: 90, height: 90, marginLeft: -45, borderRadius: 45, background: "rgba(255,255,255,0.55)", border: "3px solid #fff", transform: `scale(${0.6 + tap * 0.5})`, opacity: tap }} />}
        </div>
      </div>
      {/* callouts */}
      {NOTES.map(([a, b, t, sub], i) => {
        if (s < a || s > b + 0.3) return null;
        const p = ramp(s, a, a + 0.35, 0, 1) * (1 - ramp(s, b, b + 0.3, 0, 1));
        return (
          <div key={i} style={{ position: "absolute", left: 60, right: 60, top: 1490, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
            <div style={{ background: "rgba(8,8,10,0.92)", border: "2px solid rgba(199,255,61,0.5)", borderRadius: 40, padding: "30px 40px", boxShadow: "0 30px 80px rgba(0,0,0,0.7)" }}>
              <div style={{ fontFamily: IS, fontSize: 62, color: LI, letterSpacing: -1.5 }}>{t}</div>
              <div style={{ fontFamily: IL, fontSize: 40, color: "#fff", marginTop: 8 }}>{sub}</div>
            </div>
          </div>
        );
      })}
      {/* end */}
      <div style={{ position: "absolute", left: 70, right: 70, top: 600, opacity: end, transform: `translateY(${(1 - end) * 40}px)` }}>
        <div style={{ fontFamily: IL, fontSize: 70, color: "#fff", lineHeight: 1.15 }}>Not a barber?</div>
        <div style={{ fontFamily: IS, fontSize: 104, color: LI, letterSpacing: -4, lineHeight: 1.02, marginTop: 20 }}>Comment your<br />business.</div>
        <div style={{ fontFamily: IL, fontSize: 56, color: "#fff", marginTop: 30, opacity: ramp(s, 19.0, 19.5, 0, 1) }}>We'll design yours next.</div>
        <div style={{ display: "inline-block", marginTop: 70, background: LI, color: "#0a0a0a", fontFamily: IS, fontSize: 44, padding: "26px 48px", borderRadius: 60, opacity: ramp(s, 19.8, 20.3, 0, 1) }}>Book a consultation</div>
        <div style={{ fontFamily: IL, fontSize: 38, color: "rgba(255,255,255,0.7)", marginTop: 26, opacity: ramp(s, 19.8, 20.3, 0, 1) }}>lynq.build/book</div>
      </div>
    </AbsoluteFill>
  );
};
