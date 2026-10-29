import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, staticFile } from "remotion";
import { Fonts, Layer, Sfx, Words, ramp, useSpringAt, useT } from "./kit";

const BK = "#0b0b0c", WH = "#ffffff", LI = "#c7ff3d", MU = "#8a8a8f";
const MONO = "JetBrains Mono";

type Shot = { src: string; from: number; to: number };

/** A phone with a real full-page screenshot scrolling inside it. */
const Phone: React.FC<{ shot: Shot; t: number; w?: number; style?: React.CSSProperties }> = ({ shot, t, w = 660, style }) => {
  const h = w * 2.08;
  const screenW = w - 36;
  const scale = screenW / 780;
  const y = shot.from + (shot.to - shot.from) * t;
  return (
    <div style={{ position: "absolute", width: w, height: h, borderRadius: w * 0.14, background: "#161618", boxShadow: "0 60px 120px rgba(0,0,0,0.65), inset 0 0 0 3px #2e2e33", ...style }}>
      <div style={{ position: "absolute", left: 18, top: 18, width: screenW, height: h - 36, borderRadius: w * 0.12, overflow: "hidden", background: "#fff" }}>
        <Img src={staticFile(shot.src)} style={{ position: "absolute", left: 0, top: -y * scale, width: screenW }} />
      </div>
      <div style={{ position: "absolute", left: w / 2 - 70, top: 34, width: 140, height: 38, borderRadius: 19, background: "#050506" }} />
    </div>
  );
};

const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; color?: string }> = ({ children, style, color = MU }) => (
  <div style={{ fontFamily: MONO, fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color, ...style }}>{children}</div>
);

const Chip: React.FC<{ text: string; at: number; lime?: boolean; style?: React.CSSProperties }> = ({ text, at, lime, style }) => {
  const p = useSpringAt(at);
  return (
    <div style={{ position: "absolute", padding: "18px 30px", borderRadius: 40, border: `2px solid ${lime ? LI : "#3a3a40"}`, background: lime ? LI : "rgba(20,20,22,0.85)", color: lime ? BK : WH, fontFamily: MONO, fontSize: 28, letterSpacing: 4, opacity: p, transform: `translateY(${(1 - p) * 30}px)`, ...style }}>{text}</div>
  );
};

export const LynqHouseDeals: React.FC = () => {
  const { s } = useT();
  const enter = useSpringAt(0.5, { damping: 16, stiffness: 120 });
  // Scene windows.
  const A = s < 5, B = s >= 5 && s < 8.4, C = s >= 8.4 && s < 11.8, D = s >= 11.8 && s < 14.4, E = s >= 14.4;
  const shotA: Shot = { src: "shots/hd-home.jpg", from: 0, to: 760 };
  const shotB: Shot = { src: "shots/hd-sell.jpg", from: 2120, to: 3900 };
  const shotC: Shot = { src: "shots/hd-investors.jpg", from: 0, to: 1500 };
  const swapB = useSpringAt(5, { damping: 18, stiffness: 140 });
  const swapC = useSpringAt(8.4, { damping: 18, stiffness: 140 });
  const split = useSpringAt(11.8, { damping: 18, stiffness: 120 });
  const end = useSpringAt(14.4, { damping: 20, stiffness: 120 });
  const tilt = (k: number) => `perspective(2200px) rotateX(${8 - k * 4}deg) rotateY(${-14 + k * 8}deg) rotateZ(${-3 + k * 2}deg)`;
  const progress = Math.min(1, s / 17);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 25% 15%, #1d1d21 0%, ${BK} 60%)` }}>
      <Fonts />
      {/* Top line: one thing to read at a time */}
      <Layer style={{ padding: "240px 90px 0" }}>
        {s < 2.6 && <Words text="One business." at={0.05} size={112} color={WH} font="Inter Light" weight={300} out={2.3} letterSpacing={-3} />}
        {s < 2.6 && <Words text="Two audiences." at={0.45} size={112} color={LI} font="Inter Light" weight={300} out={2.3} letterSpacing={-3} />}
        {s >= 2.4 && A && <Words text="Owners sell without listing it." at={2.5} size={78} color={WH} font="Inter Light" weight={300} accent={LI} accentWords={["without"]} out={4.7} letterSpacing={-2} />}
        {B && <Words text="Four steps. Owners decide at each one." at={5.15} size={78} color={WH} font="Inter Light" weight={300} accent={LI} accentWords={["decide"]} out={8.1} letterSpacing={-2} />}
        {C && <Words text="Investors get their own list." at={8.55} size={78} color={WH} font="Inter Light" weight={300} accent={LI} accentWords={["own"]} out={11.5} letterSpacing={-2} />}
        {D && <Words text="One site." at={11.9} size={112} color={WH} font="Inter Light" weight={300} letterSpacing={-3} />}
        {D && <Words text="Both sides served." at={12.3} size={112} color={LI} font="Inter Light" weight={300} letterSpacing={-3} />}
      </Layer>

      {A && <Phone shot={shotA} t={ramp(s, 1.8, 4.9)} w={520} style={{ left: 280, top: 620 + (1 - enter) * 1400, transform: tilt(ramp(s, 0.5, 4.9)) }} />}
      {A && s > 2.4 && <Chip text="For owners" at={2.5} style={{ left: 150, top: 600 }} />}

      {B && <Phone shot={shotB} t={ramp(s, 5.2, 8.3)} w={520} style={{ left: 280 + (1 - swapB) * 1200, top: 620, transform: tilt(0.6) }} />}
      {B && <Chip text="How selling works" at={5.2} style={{ left: 150, top: 600 }} />}

      {C && <Phone shot={shotC} t={ramp(s, 8.6, 11.7)} w={520} style={{ left: 280 - (1 - swapC) * 1200, top: 620, transform: "perspective(2200px) rotateX(6deg) rotateY(12deg) rotateZ(2deg)" }} />}
      {C && <Chip text="For investors" lime at={8.6} style={{ left: 150, top: 600 }} />}

      {D && (
        <>
          <Phone shot={{ ...shotA, from: 0, to: 0 }} t={0} w={410} style={{ left: 100, top: 660 + (1 - split) * 900, transform: "perspective(2000px) rotateY(16deg) rotateZ(-3deg)" }} />
          <Phone shot={{ ...shotC, from: 0, to: 0 }} t={0} w={410} style={{ left: 570, top: 700 + (1 - split) * 1100, transform: "perspective(2000px) rotateY(-16deg) rotateZ(3deg)" }} />
        </>
      )}

      {/* End card */}
      {E && (
        <Layer style={{ padding: "600px 90px 0", opacity: end }}>
          <Words text="Two kinds of customer?" at={14.5} size={92} color={WH} font="Inter Light" weight={300} letterSpacing={-2} />
          <div style={{ height: 50 }} />
          <Words text="Comment TWO." at={15.1} size={150} color={LI} font="Inter SemiBold" weight={600} letterSpacing={-4} />
          <div style={{ height: 70 }} />
          <Words text="We'll show you where most sites mix them up." at={15.7} size={46} color={MU} font="Inter Light" weight={300} every={0.04} />
        </Layer>
      )}

      {/* Frame chrome */}
      <Label style={{ position: "absolute", left: 90, top: 120 }} color={WH}>LYNQ</Label>
      <Label style={{ position: "absolute", right: 90, top: 120 }}>Case 05 · House Deals Direct</Label>
      <div style={{ position: "absolute", left: 90, right: 90, bottom: 170, height: 2, background: "#2a2a2e" }}>
        <div style={{ width: `${progress * 100}%`, height: 2, background: LI }} />
      </div>
      <Label style={{ position: "absolute", left: 90, bottom: 110 }}>lynq.build</Label>
      <Label style={{ position: "absolute", right: 90, bottom: 110 }}>Built by LYNQ</Label>

      <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={(f) => interpolate(f, [0, 15, 480, 510], [0, 0.35, 0.35, 0], { extrapolateRight: "clamp" })} />
      <Sfx at={0.05} src="thump.wav" />
      <Sfx at={0.5} src="whoosh.wav" volume={0.7} />
      <Sfx at={5.0} src="whoosh.wav" volume={0.7} />
      <Sfx at={8.4} src="whoosh.wav" volume={0.7} />
      <Sfx at={11.8} src="thump.wav" volume={0.7} />
      <Sfx at={15.1} src="ding.wav" volume={0.6} />
    </AbsoluteFill>
  );
};
