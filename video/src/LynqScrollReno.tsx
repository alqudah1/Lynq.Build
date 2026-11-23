import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/*
 * "Scroll to renovate": screen recording of a concept site (made-up company, AI visuals,
 * labelled on screen) where scrolling rebuilds a kitchen. The camera pushes into the screen
 * and follows the work, then pulls back for the quote panel.
 */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const SCROLLRENO_DUR = 17.5;
const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
// time, scale, focus x (0..1 of screen), focus y
const CAM: [number, number, number, number][] = [[0, 1, 0.5, 0.5], [1.3, 1, 0.5, 0.5], [2.6, 1.75, 0.42, 0.42], [4.4, 1.75, 0.4, 0.62], [5.4, 1.5, 0.5, 0.55], [6.8, 1.5, 0.5, 0.55], [8.0, 1.8, 0.56, 0.6], [9.6, 1.8, 0.52, 0.6], [10.6, 1.3, 0.5, 0.45], [11.6, 1.3, 0.5, 0.45], [13.0, 1, 0.5, 0.5], [17.5, 1, 0.5, 0.5]];
const cam = (s: number, j: number) => {
  for (let i = 0; i < CAM.length - 1; i++) { const a = CAM[i], b = CAM[i + 1]; if (s <= b[0]) return a[j] + (b[j] - a[j]) * io(Math.max(0, (s - a[0]) / (b[0] - a[0]))); }
  return CAM[CAM.length - 1][j];
};
export const LynqScrollReno: React.FC = () => {
  const { s } = useT();
  const W = 1040, H = Math.round((W * 9) / 16), TOP = 668;
  const pop = ramp(s, 0, 0.5, 0, 1);
  const z = cam(s, 1), fx = cam(s, 2), fy = cam(s, 3);
  const zk = Math.min(1, (z - 1) / 0.3);
  const head = pop * (1 - zk);
  const cta = ramp(s, 13.6, 14.2, 0, 1);
  return (
    <AbsoluteFill style={{ background: "#040405", overflow: "hidden" }}>
      <Fonts />
      <div style={{ position: "absolute", left: -300, right: -300, top: 420, height: 1100, background: "radial-gradient(closest-side, rgba(199,255,61,0.16), transparent)" }} />
      <div style={{ position: "absolute", left: (1080 - W) / 2, top: TOP, width: W, height: H, transform: `translate(${(0.5 - fx) * W * z}px, ${(0.5 - fy) * H * z}px) scale(${(0.94 + pop * 0.06) * z})`, opacity: pop }}>
        <div style={{ width: W, height: H, borderRadius: 26 / z, overflow: "hidden", border: "2px solid rgba(255,255,255,0.2)", boxShadow: "0 50px 140px rgba(0,0,0,0.9), 0 0 110px rgba(199,255,61,0.16)" }}>
          <OffthreadVideo src={staticFile("niche/reno-screen.mp4")} muted style={{ width: W, height: H }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 560, background: "linear-gradient(180deg,#040405 55%,transparent)", opacity: 1 - zk * 0.4 }} />
      <div style={{ position: "absolute", left: 60, right: 60, top: 250, textAlign: "center", opacity: head, transform: `translateY(${-zk * 40}px)` }}>
        <div style={{ fontFamily: IL, fontSize: 50, color: "rgba(255,255,255,0.8)" }}>A contractor's website where</div>
        <div style={{ fontFamily: IS, fontSize: 84, color: "#fff", letterSpacing: -3, lineHeight: 1.05, marginTop: 10 }}>you scroll and the<br /><span style={{ color: LI }}>kitchen rebuilds itself.</span></div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center", fontFamily: IS, fontSize: 22, letterSpacing: 4, color: "rgba(255,255,255,0.5)" }}>CONCEPT SITE · MADE-UP COMPANY · AI VISUALS</div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 1400, textAlign: "center", opacity: cta, transform: `translateY(${(1 - cta) * 30}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 70, color: "#fff", letterSpacing: -2 }}>Comment your business.</div>
        <div style={{ fontFamily: IL, fontSize: 50, color: "rgba(255,255,255,0.85)", marginTop: 12 }}>We'll design yours next.</div>
        <div style={{ display: "inline-block", marginTop: 44, background: LI, color: "#0a0a0a", fontFamily: IS, fontSize: 40, padding: "22px 44px", borderRadius: 60 }}>Book a consultation · lynq.build/book</div>
      </div>
    </AbsoluteFill>
  );
};
