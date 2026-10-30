import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts } from "./kit";

/**
 * Case 06 · Kids Coding: seven highlight frames in Kids Coding's own colours
 * (navy, cream, orange) inside LYNQ's frame. Real screenshots of the live site,
 * no children's faces (the homepage is cropped above its photo).
 */
const NAVY = "#1c1f30", NAVY2 = "#262a40", CREAM = "#fbf6ef", OR = "#e8954a", OR2 = "#f2a65f", WH = "#ffffff", MU = "#9ea2b8", LI = "#c7ff3d";
const SHOT_W = 780;
const q = (f: string) => `'${f}'`;

const Chrome: React.FC<{ n: number }> = ({ n }) => (
  <>
    <div style={{ position: "absolute", left: 80, top: 120, fontFamily: q("JetBrains Mono"), fontSize: 26, letterSpacing: 5, color: WH }}>LYNQ</div>
    <div style={{ position: "absolute", right: 80, top: 120, fontFamily: q("JetBrains Mono"), fontSize: 24, letterSpacing: 4, color: MU }}>CASE 06 · KIDS CODING · 0{n} / 07</div>
    <div style={{ position: "absolute", left: 80, right: 80, bottom: 150, display: "flex", gap: 10 }}>{Array.from({ length: 7 }, (_, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < n ? OR : "rgba(255,255,255,0.14)" }} />)}</div>
    <div style={{ position: "absolute", left: 80, bottom: 96, fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 4, color: MU }}>LYNQ.BUILD</div>
    <div style={{ position: "absolute", right: 80, bottom: 96, fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 4, color: MU }}>WEBSITES · SYSTEMS · AUTOMATION</div>
  </>
);

const Back: React.FC<{ glowX?: number; glowY?: number }> = ({ glowX = 760, glowY = 1150 }) => (
  <AbsoluteFill style={{ background: [
    `radial-gradient(700px 700px at ${glowX}px ${glowY}px, rgba(232,149,74,0.42), rgba(232,149,74,0) 70%)`,
    `radial-gradient(600px 600px at 120px 300px, rgba(120,130,200,0.18), rgba(120,130,200,0) 70%)`,
    `linear-gradient(170deg, ${NAVY2} 0%, ${NAVY} 60%, #14162a 100%)`,
  ].join(", ") }}>
    <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
  </AbsoluteFill>
);

/** A phone showing a real screenshot from `y` (px in the 780-wide shot). */
const Phone: React.FC<{ img: string; y?: number; w: number; style?: React.CSSProperties }> = ({ img, y = 0, w, style }) => {
  const sw = w - 28, k = sw / SHOT_W, h = w * 2.05;
  return (
    <div style={{ position: "absolute", width: w, height: h, borderRadius: w * 0.15, background: "#0d0e16", boxShadow: "0 70px 120px rgba(5,6,15,0.65), 0 0 0 2px #3a3e58 inset", ...style }}>
      <div style={{ position: "absolute", left: 14, top: 14, width: sw, height: h - 28, borderRadius: w * 0.13, overflow: "hidden", background: CREAM }}>
        <Img src={staticFile(`kc/${img}`)} style={{ position: "absolute", left: 0, top: -y * k, width: sw }} />
      </div>
      <div style={{ position: "absolute", left: w / 2 - w * 0.14, top: 28, width: w * 0.28, height: w * 0.075, borderRadius: w * 0.04, background: "#0d0e16" }} />
    </div>
  );
};

/** A crop of a screenshot, lifted out of the phone and enlarged, with an orange ring. */
const Callout: React.FC<{ img: string; x: number; y: number; w: number; h: number; scale: number; style?: React.CSSProperties; ring?: boolean }> = ({ img, x, y, w, h, scale, style, ring = true }) => (
  <div style={{ position: "absolute", width: w * scale, height: h * scale, borderRadius: 34, overflow: "hidden", background: CREAM, boxShadow: `0 50px 90px rgba(5,6,15,0.55)${ring ? `, 0 0 0 5px ${OR}` : ""}`, ...style }}>
    <Img src={staticFile(`kc/${img}`)} style={{ position: "absolute", left: -x * scale, top: -y * scale, width: SHOT_W * scale }} />
  </div>
);

const Step: React.FC<{ n: string; label: string }> = ({ n, label }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 16, padding: "14px 26px", borderRadius: 40, background: "rgba(232,149,74,0.16)", fontFamily: q("JetBrains Mono"), fontSize: 26, letterSpacing: 4, color: OR2 }}>
    <span style={{ width: 14, height: 14, borderRadius: 7, background: OR }} />{n} · {label.toUpperCase()}
  </div>
);

const Head: React.FC<{ lines: string[]; accent?: string; size?: number; style?: React.CSSProperties }> = ({ lines, accent, size = 104, style }) => (
  <div style={{ fontFamily: q("Inter Light"), fontSize: size, lineHeight: 1.04, letterSpacing: -3, color: WH, ...style }}>
    {lines.map((l, i) => {
      if (!accent || !l.includes(accent)) return <div key={i}>{l}</div>;
      const at = l.indexOf(accent);
      return <div key={i}>{l.slice(0, at)}<span style={{ color: OR2, fontFamily: q("Inter SemiBold") }}>{accent}</span>{l.slice(at + accent.length)}</div>;
    })}
  </div>
);

const Detail: React.FC<{ text: string; style?: React.CSSProperties }> = ({ text, style }) => <div style={{ fontFamily: q("Inter Light"), fontSize: 40, lineHeight: 1.35, color: "#c9ccdb", ...style }}>{text}</div>;

const Frame: React.FC<{ n: number; children: React.ReactNode; glowX?: number; glowY?: number }> = ({ n, children, glowX, glowY }) => (
  <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
    <Fonts />
    <Back glowX={glowX} glowY={glowY} />
    {children}
    <Chrome n={n} />
  </AbsoluteFill>
);

export const KC1: React.FC = () => (
  <Frame n={1} glowX={700} glowY={760}>
    <Phone img="home-top.jpg" w={620} style={{ left: 330, top: 300, transform: "perspective(2400px) rotateY(-16deg) rotateX(6deg) rotateZ(4deg)" }} />
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 900, background: `linear-gradient(180deg, rgba(28,31,48,0) 0%, ${NAVY} 42%)` }} />
    <div style={{ position: "absolute", left: 80, top: 1190 }}>
      <div style={{ display: "inline-block", padding: "10px 24px", borderRadius: 30, border: `2px solid ${OR}`, fontFamily: q("JetBrains Mono"), fontSize: 26, letterSpacing: 4, color: OR2 }}>CASE 06</div>
      <div style={{ fontFamily: q("Inter SemiBold"), fontSize: 170, lineHeight: 0.95, letterSpacing: -7, color: WH, marginTop: 30 }}>Kids<br />Coding</div>
      <div style={{ fontFamily: q("Inter Light"), fontSize: 46, color: "#c9ccdb", marginTop: 26 }}>A STEM school for ages 5 to 17.</div>
    </div>
  </Frame>
);

const PROGRAMS: [string, string][] = [["After-school", "Mon to Fri"], ["Weekly classes", "Every term"], ["Camps", "Breaks and summer"], ["Online", "Live, from home"], ["Workshops", "One day, one project"]];

export const KC2: React.FC = () => (
  <Frame n={2} glowX={540} glowY={1250}>
    <div style={{ position: "absolute", left: 80, top: 300 }}>
      <Step n="00" label="The brief" />
      <Head lines={["Five programs.", "One question from", "every parent:"]} size={92} style={{ marginTop: 40 }} />
      <Head lines={["where do we start?"]} accent="start?" size={92} />
    </div>
    <div style={{ position: "absolute", left: 80, right: 80, top: 1000 }}>
      {PROGRAMS.map(([name, sub], i) => (
        <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 40px", height: 108, marginTop: i ? 16 : 0, borderRadius: 30, background: i === 0 ? CREAM : "rgba(251,246,239,0.08)", border: i === 0 ? "none" : "1px solid rgba(255,255,255,0.12)", transform: `translateX(${i * 18}px)` }}>
          <span style={{ fontFamily: q("Inter SemiBold"), fontSize: 46, color: i === 0 ? NAVY : WH }}>{name}</span>
          <span style={{ fontFamily: q("Inter Light"), fontSize: 32, color: i === 0 ? "#7a6a58" : MU }}>{sub}</span>
        </div>
      ))}
    </div>
  </Frame>
);

/** A step frame: headline top, phone right, enlarged callout overlapping on the left. */
const StepFrame: React.FC<{ n: number; step: string; label: string; lines: string[]; accent: string; detail: string; img: string; y?: number; call: { x: number; y: number; w: number; h: number; scale: number; top: number }; second?: { img: string; y?: number } }> = ({ n, step, label, lines, accent, detail, img, y, call, second }) => (
  <Frame n={n} glowX={760} glowY={1200}>
    <div style={{ position: "absolute", left: 80, right: 80, top: 290 }}>
      <Step n={step} label={label} />
      <Head lines={lines} accent={accent} size={98} style={{ marginTop: 36 }} />
      <Detail text={detail} style={{ marginTop: 30, maxWidth: 900 }} />
    </div>
    {second && <Phone img={second.img} y={second.y} w={430} style={{ left: 40, top: 900, transform: "perspective(2200px) rotateY(18deg) rotateZ(-5deg)", opacity: 0.95 }} />}
    <Phone img={img} y={y} w={460} style={{ left: 540, top: 800, transform: "perspective(2200px) rotateY(-14deg) rotateZ(3deg)" }} />
    <Callout img={img} {...call} style={{ left: 60, top: call.top, transform: "rotate(-2deg)" }} />
  </Frame>
);

export const KC3: React.FC = () => <StepFrame n={3} step="01" label="Start here" lines={["Three answers,", "one starting point."]} accent="one starting point." detail="Parents pick their child's age and interests, and the site shows where to begin." img="finder.jpg" call={{ x: 20, y: 430, w: 640, h: 380, scale: 1.08, top: 1180 }} />;
export const KC4: React.FC = () => <StepFrame n={4} step="02" label="Plan the year" lines={["Every term", "on one page."]} accent="one page." detail="Terms, breaks and camps in order, each with its dates and the next step." img="timeline.jpg" call={{ x: 40, y: 105, w: 640, h: 400, scale: 1.05, top: 1160 }} />;
export const KC5: React.FC = () => <StepFrame n={5} step="03" label="Enroll" lines={["Dates, then", "Enroll & Pay."]} accent="Enroll & Pay." detail="Every camp and class has its own Enroll & Pay button, right next to its dates." img="camps.jpg" call={{ x: 30, y: 172, w: 640, h: 268, scale: 1.08, top: 1220 }} />;

const BUILT: { img: string; y?: number; label: string; sub: string }[] = [
  { img: "finder.jpg", y: 60, label: "Program finder", sub: "Three questions" },
  { img: "timeline.jpg", y: 40, label: "Term timeline", sub: "The whole year" },
  { img: "camps.jpg", y: 60, label: "Camps", sub: "Dates, Enroll & Pay" },
  { img: "online.jpg", y: 0, label: "Online", sub: "Live classes" },
];

export const KC6: React.FC = () => (
  <Frame n={6} glowX={540} glowY={1100}>
    <div style={{ position: "absolute", left: 80, top: 290 }}>
      <Step n="04" label="What we built" />
      <Head lines={["Five ways in."]} size={110} style={{ marginTop: 36 }} />
    </div>
    <div style={{ position: "absolute", left: 80, right: 80, top: 600, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
      {BUILT.map((b) => (
        <div key={b.label} style={{ borderRadius: 34, overflow: "hidden", background: "rgba(251,246,239,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
          <div style={{ position: "relative", height: 330, overflow: "hidden", background: CREAM }}>
            <Img src={staticFile(`kc/${b.img}`)} style={{ position: "absolute", left: 0, top: -(b.y ?? 0) * (446 / SHOT_W), width: 446 }} />
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90, background: "linear-gradient(180deg, rgba(251,246,239,0), rgba(251,246,239,1))" }} />
          </div>
          <div style={{ padding: "22px 28px 26px" }}>
            <div style={{ fontFamily: q("Inter SemiBold"), fontSize: 38, color: WH }}>{b.label}</div>
            <div style={{ fontFamily: q("Inter Light"), fontSize: 30, color: MU, marginTop: 4 }}>{b.sub}</div>
          </div>
        </div>
      ))}
    </div>
    <div style={{ position: "absolute", left: 80, top: 1665, fontFamily: q("Inter Light"), fontSize: 38, color: OR2 }}>Plus workshops. Run and maintained by LYNQ.</div>
  </Frame>
);

export const KC7: React.FC = () => (
  <Frame n={7} glowX={540} glowY={1000}>
    <Phone img="online.jpg" w={440} style={{ left: 90, top: 330, transform: "perspective(2200px) rotateY(16deg) rotateZ(-6deg)" }} />
    <Phone img="camps.jpg" w={440} style={{ left: 550, top: 290, transform: "perspective(2200px) rotateY(-16deg) rotateZ(6deg)" }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 820, height: 500, background: `linear-gradient(180deg, rgba(28,31,48,0) 0%, ${NAVY} 60%)` }} />
    <div style={{ position: "absolute", left: 80, top: 1160 }}>
      <Step n="05" label="The result" />
      <Head lines={["Parents find it.", "Then they enroll."]} accent="enroll." size={104} style={{ marginTop: 34 }} />
      <div style={{ display: "inline-block", marginTop: 46, padding: "26px 56px", borderRadius: 60, background: LI, fontFamily: q("Inter SemiBold"), fontSize: 46, color: "#0b0b0c" }}>DM AUDIT</div>
      <div style={{ fontFamily: q("Inter Light"), fontSize: 34, color: MU, marginTop: 24 }}>Want yours to work like this? Send us a message.</div>
    </div>
  </Frame>
);
