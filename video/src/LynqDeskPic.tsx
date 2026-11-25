import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts } from "./kit";

/* Feed picture: one concept site on the desk monitor with one line. Made-up company, labelled. */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'";
const M3 = "matrix3d(0.74122820,0.24767420,0,0.00028891,0.03620652,0.79361343,0,0.00002115,0,0,1,0,106.171875,559.6875,0,1)";
export const LynqDeskPicMenu: React.FC = () => {
  const z = 1.32;
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <Fonts />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1935, transformOrigin: "0 0", transform: `translate(${540 - 552 * z}px, ${800 - 960 * z}px) scale(${z})` }}>
        <Img src={staticFile("niche/desk.jpg")} style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1935 }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: M3, overflow: "hidden" }}>
          <Img src={staticFile("niche/menu-still.jpg")} style={{ width: 1920, height: 1080 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(255,255,255,0.10), transparent 35%, transparent 70%, rgba(255,190,120,0.08))" }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 470, background: "linear-gradient(180deg, rgba(0,0,0,0.9) 30%, transparent)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 330, background: "linear-gradient(0deg, rgba(0,0,0,0.92) 35%, transparent)" }} />
      <div style={{ position: "absolute", left: 64, top: 64, fontFamily: IS, fontSize: 26, letterSpacing: 10, color: "#fff" }}>LYNQ</div>
      <div style={{ position: "absolute", left: 64, right: 64, top: 124 }}>
        <div style={{ fontFamily: IS, fontSize: 86, letterSpacing: -3.5, lineHeight: 1.02, color: "#fff" }}>Your menu is a PDF.<br /><span style={{ color: LI }}>This one spins.</span></div>
      </div>
      <div style={{ position: "absolute", left: 64, right: 64, bottom: 64, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontFamily: IL, fontSize: 38, color: "#fff" }}>A restaurant site we designed as a concept.</div>
          <div style={{ fontFamily: IS, fontSize: 20, letterSpacing: 4, color: "rgba(255,255,255,0.5)", marginTop: 14 }}>MADE-UP RESTAURANT · AI FOOD PHOTOS</div>
        </div>
        <div style={{ fontFamily: IS, fontSize: 30, color: "#0a0a0a", background: LI, padding: "16px 28px", borderRadius: 40, whiteSpace: "nowrap" }}>lynq.build/book</div>
      </div>
    </AbsoluteFill>
  );
};
