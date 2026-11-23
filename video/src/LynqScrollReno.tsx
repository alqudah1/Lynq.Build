import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/*
 * "Scroll to renovate": screen recording of a concept site (made-up company, AI visuals,
 * labelled on screen) where scrolling rebuilds a kitchen. One interaction, one headline.
 */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const SCROLLRENO_DUR = 16.5;
export const LynqScrollReno: React.FC = () => {
  const { s } = useT();
  const W = 1040, H = Math.round((W * 9) / 16);
  const pop = ramp(s, 0, 0.5, 0, 1);
  const cta = ramp(s, 12.6, 13.2, 0, 1);
  return (
    <AbsoluteFill style={{ background: "#040405", overflow: "hidden" }}>
      <Fonts />
      <div style={{ position: "absolute", left: -300, right: -300, top: 420, height: 1100, background: "radial-gradient(closest-side, rgba(199,255,61,0.16), transparent)" }} />
      <div style={{ position: "absolute", left: 60, right: 60, top: 250, textAlign: "center", opacity: pop }}>
        <div style={{ fontFamily: IL, fontSize: 50, color: "rgba(255,255,255,0.8)" }}>A contractor's website where</div>
        <div style={{ fontFamily: IS, fontSize: 84, color: "#fff", letterSpacing: -3, lineHeight: 1.05, marginTop: 10 }}>you scroll and the<br /><span style={{ color: LI }}>kitchen rebuilds itself.</span></div>
      </div>
      <div style={{ position: "absolute", left: (1080 - W) / 2, top: 660, width: W, height: H, borderRadius: 26, overflow: "hidden", border: "2px solid rgba(255,255,255,0.2)", boxShadow: "0 50px 140px rgba(0,0,0,0.9), 0 0 110px rgba(199,255,61,0.16)", transform: `scale(${0.94 + pop * 0.06})`, opacity: pop }}>
        <OffthreadVideo src={staticFile("niche/reno-screen.mp4")} muted style={{ width: W, height: H }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 660 + H + 26, textAlign: "center", fontFamily: IS, fontSize: 22, letterSpacing: 4, color: "rgba(255,255,255,0.45)" }}>CONCEPT SITE · MADE-UP COMPANY · AI VISUALS</div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 1400, textAlign: "center", opacity: cta, transform: `translateY(${(1 - cta) * 30}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 70, color: "#fff", letterSpacing: -2 }}>Comment your business.</div>
        <div style={{ fontFamily: IL, fontSize: 50, color: "rgba(255,255,255,0.85)", marginTop: 12 }}>We'll design yours next.</div>
        <div style={{ display: "inline-block", marginTop: 44, background: LI, color: "#0a0a0a", fontFamily: IS, fontSize: 40, padding: "22px 44px", borderRadius: 60 }}>Book a consultation · lynq.build/book</div>
      </div>
    </AbsoluteFill>
  );
};
