import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts } from "./kit";

/**
 * Case 06 · Kids Coding, light: Kids Coding's warm cream with one short line
 * and one big, straight phone per frame. Real screenshots of the live site;
 * the homepage is cropped above its photo, so no child's face appears.
 */
const BG = "#fbf6ef", INK = "#1f2233", OR = "#e8954a", OR_T = "#c8742c", MU = "#8b8578", LINE = "#e7ddcf";
const SHOT_W = 780;
const q = (f: string) => `'${f}'`;

const Chrome: React.FC<{ n: number }> = ({ n }) => (
  <>
    <div style={{ position: "absolute", left: 80, top: 120, fontFamily: q("JetBrains Mono"), fontSize: 26, letterSpacing: 5, color: INK }}>LYNQ</div>
    <div style={{ position: "absolute", right: 80, top: 120, fontFamily: q("JetBrains Mono"), fontSize: 24, letterSpacing: 4, color: MU }}>CASE 06 · KIDS CODING · 0{n}/07</div>
    <div style={{ position: "absolute", left: 80, right: 80, bottom: 150, display: "flex", gap: 10 }}>{Array.from({ length: 7 }, (_, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < n ? OR : LINE }} />)}</div>
    <div style={{ position: "absolute", left: 80, bottom: 96, fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 4, color: MU }}>LYNQ.BUILD</div>
  </>
);

const Frame: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <AbsoluteFill style={{ overflow: "hidden", background: [
    "radial-gradient(700px 700px at 900px 1500px, rgba(232,149,74,0.30), rgba(232,149,74,0) 70%)",
    "radial-gradient(600px 600px at 100px 500px, rgba(255,214,170,0.45), rgba(255,214,170,0) 70%)",
    `linear-gradient(175deg, #fffaf3 0%, ${BG} 100%)`,
  ].join(", ") }}>
    <Fonts />
    {children}
    <Chrome n={n} />
  </AbsoluteFill>
);

/** One big straight phone; `ring` outlines a region of the screenshot (shot px). */
const Phone: React.FC<{ img: string; y?: number; w?: number; top: number; left?: number; ring?: { x: number; y: number; w: number; h: number } }> = ({ img, y = 0, w = 640, top, left, ring }) => {
  const sw = w - 30, k = sw / SHOT_W, h = w * 2.05;
  return (
    <div style={{ position: "absolute", left: left ?? (1080 - w) / 2, top, width: w, height: h, borderRadius: w * 0.15, background: "#16171f", boxShadow: "0 60px 110px rgba(80,50,20,0.28), 0 18px 40px rgba(80,50,20,0.18)" }}>
      <div style={{ position: "absolute", left: 15, top: 15, width: sw, height: h - 30, borderRadius: w * 0.13, overflow: "hidden", background: BG }}>
        <Img src={staticFile(`kc/${img}`)} style={{ position: "absolute", left: 0, top: -y * k, width: sw }} />
        {ring && <div style={{ position: "absolute", left: ring.x * k - 10, top: (ring.y - y) * k - 10, width: ring.w * k + 20, height: ring.h * k + 20, borderRadius: 22, border: `6px solid ${OR}`, boxShadow: "0 0 0 9999px rgba(31,34,51,0.10)" }} />}
      </div>
      <div style={{ position: "absolute", left: w / 2 - w * 0.14, top: 30, width: w * 0.28, height: w * 0.075, borderRadius: w * 0.04, background: "#16171f" }} />
    </div>
  );
};

const Title: React.FC<{ a: string; b?: string; top?: number; size?: number }> = ({ a, b, top = 280, size = 104 }) => (
  <div style={{ position: "absolute", left: 80, right: 80, top, fontFamily: q("Inter SemiBold"), fontSize: size, lineHeight: 1.02, letterSpacing: -4, color: INK }}>
    {a}{b && <><br /><span style={{ color: OR_T }}>{b}</span></>}
  </div>
);

const Fade: React.FC<{ from: number }> = ({ from }) => <div style={{ position: "absolute", left: 0, right: 0, top: from, bottom: 0, background: `linear-gradient(180deg, rgba(251,246,239,0) 0%, ${BG} 55%)` }} />;

export const KC1: React.FC = () => (
  <Frame n={1}>
    <Phone img="home-top.jpg" w={700} top={250} />
    <Fade from={1000} />
    <div style={{ position: "absolute", left: 80, top: 1290 }}>
      <div style={{ display: "inline-block", padding: "10px 24px", borderRadius: 30, background: OR, fontFamily: q("JetBrains Mono"), fontSize: 26, letterSpacing: 4, color: "#fff" }}>CASE 06</div>
      <div style={{ fontFamily: q("Inter SemiBold"), fontSize: 150, lineHeight: 0.95, letterSpacing: -6, color: INK, marginTop: 24 }}>Kids Coding</div>
      <div style={{ fontFamily: q("Inter Light"), fontSize: 46, color: "#5d5a52", marginTop: 20 }}>A STEM school, ages 5 to 17.</div>
    </div>
  </Frame>
);

export const KC2: React.FC = () => (
  <Frame n={2}>
    <div style={{ position: "absolute", left: 80, right: 80, top: 330, fontFamily: q("JetBrains Mono"), fontSize: 28, letterSpacing: 5, color: OR_T }}>THE BRIEF</div>
    <Title a="Five programs." b="Where do we start?" top={400} size={104} />
    <div style={{ position: "absolute", left: 80, right: 80, top: 860, display: "flex", flexWrap: "wrap", gap: 22 }}>
      {["After-school", "Weekly classes", "Camps", "Online", "Workshops"].map((p, i) => (
        <div key={p} style={{ padding: "30px 44px", borderRadius: 60, background: i === 2 ? OR : "#fff", color: i === 2 ? "#fff" : INK, fontFamily: q("Inter SemiBold"), fontSize: 50, boxShadow: "0 18px 40px rgba(80,50,20,0.10)" }}>{p}</div>
      ))}
    </div>
    <div style={{ position: "absolute", left: 80, right: 80, top: 1330, fontFamily: q("Inter Light"), fontSize: 50, lineHeight: 1.3, color: "#5d5a52" }}>Every parent asks the same question first.</div>
  </Frame>
);

export const KC3: React.FC = () => (
  <Frame n={3}>
    <Title a="Three answers." b="One starting point." />
    <Phone img="finder.jpg" y={0} w={580} top={540} ring={{ x: 0, y: 430, w: 600, h: 330 }} />
  </Frame>
);

export const KC4: React.FC = () => (
  <Frame n={4}>
    <Title a="The whole year" b="on one page." />
    <Phone img="timeline.jpg" y={0} w={580} top={540} ring={{ x: 30, y: 105, w: 690, h: 395 }} />
  </Frame>
);

export const KC5: React.FC = () => (
  <Frame n={5}>
    <Title a="Pick the dates." b="Enroll & Pay." />
    <Phone img="camps.jpg" y={60} w={580} top={540} ring={{ x: 30, y: 172, w: 640, h: 268 }} />
  </Frame>
);

export const KC6: React.FC = () => (
  <Frame n={6}>
    <Title a="What we built" />
    <div style={{ position: "absolute", left: 80, right: 80, top: 420 }}>
      {[["Program finder", "3 questions"], ["Term timeline", "the whole year"], ["Camps", "dates, then Enroll & Pay"], ["Online classes", "live, from home"]].map(([a, b], i) => (
        <div key={a} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "40px 0", borderBottom: `2px solid ${LINE}` }}>
          <span style={{ fontFamily: q("Inter SemiBold"), fontSize: 64, letterSpacing: -2, color: INK }}><span style={{ color: OR_T, fontFamily: q("JetBrains Mono"), fontSize: 34, marginRight: 26 }}>0{i + 1}</span>{a}</span>
          <span style={{ fontFamily: q("Inter Light"), fontSize: 38, color: MU }}>{b}</span>
        </div>
      ))}
    </div>
    <div style={{ position: "absolute", left: 80, right: 80, top: 1150, padding: "44px 50px", borderRadius: 40, background: "#fff", boxShadow: "0 24px 60px rgba(80,50,20,0.12)" }}>
      <div style={{ fontFamily: q("Inter SemiBold"), fontSize: 58, letterSpacing: -2, color: INK }}>Plus workshops.</div>
      <div style={{ fontFamily: q("Inter Light"), fontSize: 44, color: "#5d5a52", marginTop: 12 }}>Run and maintained by LYNQ.</div>
    </div>
  </Frame>
);

export const KC7: React.FC = () => (
  <Frame n={7}>
    <Title a="Parents find it." b="Then they enroll." />
    <Phone img="camps.jpg" y={0} w={560} top={560} />
    <Fade from={1150} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 1450, textAlign: "center" }}>
      <div style={{ display: "inline-block", padding: "30px 72px", borderRadius: 70, background: INK, fontFamily: q("Inter SemiBold"), fontSize: 52, color: "#fff" }}>DM AUDIT</div>
      <div style={{ fontFamily: q("Inter Light"), fontSize: 38, color: "#5d5a52", marginTop: 26 }}>Want yours to work like this?</div>
    </div>
  </Frame>
);
