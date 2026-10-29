import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile } from "remotion";
import { Fonts, Layer, Sfx, Words, ramp, useSpringAt, useT } from "./kit";

const BK = "#0b0b0c", WH = "#ffffff", LI = "#c7ff3d", MU = "#8a8a8f";

/** A generic local-business site on a phone (not a real client): only the main button differs. */
const MockPhone: React.FC<{ label: string; button: string; w: number; style?: React.CSSProperties; tapped?: number }> = ({ label, button, w, style, tapped = 0 }) => {
  const h = w * 2.06;
  const bar = (wd: number, mt = 18) => <div style={{ width: wd, height: 18, borderRadius: 9, background: "#e7e7ea", marginTop: mt }} />;
  return (
    <div style={{ position: "absolute", width: w, height: h, borderRadius: w * 0.14, background: "#161618", boxShadow: "0 60px 120px rgba(0,0,0,0.65), inset 0 0 0 3px #2e2e33", ...style }}>
      <div style={{ position: "absolute", left: 16, top: 16, right: 16, bottom: 16, borderRadius: w * 0.12, overflow: "hidden", background: "#fbfbfb", padding: "90px 34px 0" }}>
        <div style={{ fontFamily: "'Inter SemiBold'", fontSize: 34, color: "#111" }}>Your business</div>
        {bar(w * 0.55)}{bar(w * 0.42, 12)}
        <div style={{ height: w * 0.42, borderRadius: 22, background: "linear-gradient(135deg,#d9dadf,#c6c7cd)", marginTop: 30 }} />
        <div style={{ marginTop: 34, padding: "30px 0", borderRadius: 60, textAlign: "center", fontFamily: "'Inter SemiBold'", fontSize: Math.min(36, Math.floor((w - 120) / (0.55 * button.length))), background: tapped > 0.5 ? LI : "#111", color: tapped > 0.5 ? BK : WH, transform: `scale(${1 - tapped * 0.05})` }}>{button}</div>
        {bar(w * 0.6, 34)}{bar(w * 0.5, 12)}{bar(w * 0.56, 12)}
      </div>
      <div style={{ position: "absolute", left: w / 2 - 60, top: 30, width: 120, height: 34, borderRadius: 17, background: "#050506" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: -150, textAlign: "center", fontFamily: "'Inter Light'", fontSize: 130, color: tapped > 0.5 ? LI : WH }}>{label}</div>
    </div>
  );
};

export const LynqAB: React.FC = () => {
  const { s } = useT();
  const phones = useSpringAt(1.7, { damping: 16, stiffness: 120 });
  const tapA = s > 5.6 && s < 6.6 ? 1 : 0;
  const tapB = s > 7.0 && s < 8.0 ? 1 : 0;
  const count = s >= 9.0 && s < 11.4 ? 3 - Math.floor((s - 9.0) / 0.8) : null;
  const end = useSpringAt(11.4, { damping: 18, stiffness: 120 });
  const progress = Math.min(1, s / 14);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 25% 15%, #1d1d21 0%, ${BK} 60%)` }}>
      <Fonts />
      <Layer style={{ padding: "240px 90px 0" }}>
        {s < 5.2 && <Words text="Two buttons." at={0.05} size={116} color={WH} font="Inter Light" weight={300} out={4.9} letterSpacing={-3} />}
        {s < 5.2 && <Words text="One gets the call." at={0.5} size={116} color={MU} font="Inter Light" weight={300} out={4.9} letterSpacing={-3} />}
        {s >= 5.2 && s < 6.9 && <Words text="A says Contact us." at={5.3} size={84} color={WH} font="Inter Light" weight={300} out={6.7} letterSpacing={-2} />}
        {s >= 6.8 && s < 8.9 && <Words text="B says Call now, we answer." at={6.9} size={84} color={WH} font="Inter Light" weight={300} out={8.7} letterSpacing={-2} />}
        {s >= 8.8 && s < 11.4 && <Words text="Which would you tap?" at={8.9} size={96} color={WH} font="Inter Light" weight={300} letterSpacing={-2} />}
      </Layer>
      {s < 11.6 && (
        <div style={{ opacity: 1 - ramp(s, 11.2, 11.6) }}>
          <MockPhone label="A" button="Contact us" w={430} tapped={tapA} style={{ left: 80, top: 600 + (1 - phones) * 1200, transform: "perspective(2000px) rotateY(14deg) rotateZ(-2deg)" }} />
          <MockPhone label="B" button="Call now, we answer" w={430} tapped={tapB} style={{ left: 570, top: 640 + (1 - phones) * 1400, transform: "perspective(2000px) rotateY(-14deg) rotateZ(2deg)" }} />
        </div>
      )}
      {count !== null && count > 0 && <div style={{ position: "absolute", left: 0, right: 0, top: 1480, textAlign: "center", fontFamily: "'Inter SemiBold'", fontSize: 150, color: LI, opacity: 1 - ((s - 9.0) % 0.8) / 0.8 }}>{count}</div>}
      {s >= 11.4 && (
        <Layer style={{ padding: "640px 90px 0", opacity: end }}>
          <Words text="Comment" at={11.4} size={150} color={WH} font="Inter Light" weight={300} letterSpacing={-4} />
          <Words text="A or B." at={11.7} size={190} color={LI} font="Inter SemiBold" weight={600} letterSpacing={-6} />
          <div style={{ height: 60 }} />
          <Words text="The answer is in tomorrow's story." at={12.2} size={50} color={MU} font="Inter Light" weight={300} every={0.05} />
        </Layer>
      )}
      <div style={{ position: "absolute", left: 90, top: 120, fontFamily: "'JetBrains Mono'", fontSize: 26, letterSpacing: 4, color: WH }}>LYNQ</div>
      <div style={{ position: "absolute", right: 90, top: 120, fontFamily: "'JetBrains Mono'", fontSize: 26, letterSpacing: 4, color: MU }}>A OR B · FIX THIS</div>
      <div style={{ position: "absolute", left: 90, right: 90, bottom: 170, height: 2, background: "#2a2a2e" }}><div style={{ width: `${progress * 100}%`, height: 2, background: LI }} /></div>
      <div style={{ position: "absolute", left: 90, bottom: 110, fontFamily: "'JetBrains Mono'", fontSize: 26, letterSpacing: 4, color: MU }}>LYNQ.BUILD</div>
      <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={(f) => interpolate(f, [0, 15, 390, 420], [0, 0.35, 0.35, 0], { extrapolateRight: "clamp" })} />
      <Sfx at={0.05} src="thump.wav" />
      <Sfx at={1.7} src="whoosh.wav" volume={0.7} />
      <Sfx at={5.6} src="click.wav" />
      <Sfx at={7.0} src="click.wav" />
      {[9.0, 9.8, 10.6].map((t) => <Sfx key={t} at={t} src="pop.wav" volume={0.5} />)}
      <Sfx at={11.4} src="thump.wav" />
      <Sfx at={11.7} src="ding.wav" volume={0.6} />
    </AbsoluteFill>
  );
};
