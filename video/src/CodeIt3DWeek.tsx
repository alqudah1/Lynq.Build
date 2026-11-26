import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, useVideoConfig } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/*
 * "The monster got out" in soft 3D: Friday (the fix), Saturday (the week in 15 seconds), Sunday (it sleeps).
 * AI-generated animation and voice; made-up story, labelled on every frame.
 */
const INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340", CREAM = "#fff4e5";
const B = "'Baloo 2'", N = "'Nunito'", MONO = "'JetBrains Mono'";
const back = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
type Clip = { src: string; from: number; dur: number; start?: number; rate?: number };
type Line = [number, number, number]; // slice a, slice b, at
const fill: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: 1080, height: 1920, objectFit: "cover" };

const Say: React.FC<{ a: number; b: number; top?: number; size?: number; who?: string | null; children: React.ReactNode }> = ({ a, b, top = 210, size = 84, who = "PIP", children }) => {
  const { s } = useT();
  if (s < a || s > b + 0.15) return null;
  const p = ramp(s, a, a + 0.16, 0, 1, back) * (1 - ramp(s, b, b + 0.15));
  return (
    <div style={{ position: "absolute", left: 50, right: 50, top, textAlign: "center", opacity: Math.min(1, p * 1.5), transform: `scale(${0.7 + p * 0.3}) rotate(${(1 - p) * -4}deg)` }}>
      <div style={{ display: "inline-block", position: "relative", padding: "24px 46px 20px", borderRadius: 46, background: "#fff", border: `8px solid ${INK}`, boxShadow: `0 12px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: size, lineHeight: 1.02, color: INK }}>
        {who ? <div style={{ position: "absolute", left: 34, top: -32, padding: "2px 20px", borderRadius: 14, background: "#ff8a1f", border: `5px solid ${INK}`, fontFamily: N, fontWeight: 900, fontSize: 28, letterSpacing: 3, color: "#fff" }}>{who}</div> : null}
        {children}
      </div>
    </div>
  );
};
const Clips: React.FC<{ clips: Clip[] }> = ({ clips }) => {
  const { fps } = useVideoConfig();
  return <>{clips.map((c) => <Sequence key={c.src + c.from} from={Math.round(c.from * fps)} durationInFrames={Math.round(c.dur * fps)} layout="none"><OffthreadVideo src={staticFile(`c3d/${c.src}.mp4`)} muted startFrom={Math.round((c.start ?? 0) * 24)} playbackRate={c.rate ?? 1} style={fill} /></Sequence>)}</>;
};
const Vo: React.FC<{ file: string; lines: Line[] }> = ({ file, lines }) => {
  const { fps } = useVideoConfig();
  return <>{lines.map(([a, b, at]) => <Sequence key={at} from={Math.round(at * fps)} durationInFrames={Math.round((b - a) * fps)} layout="none"><Audio src={staticFile(`vo/${file}`)} startFrom={Math.round(a * fps)} endAt={Math.round(b * fps)} /></Sequence>)}</>;
};
const Shade: React.FC = () => (<><div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 420, background: "linear-gradient(180deg, rgba(0,0,0,0.45), transparent)" }} /><div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 320, background: "linear-gradient(0deg, rgba(10,10,20,0.6), transparent)" }} /></>);
const Label: React.FC<{ dark?: boolean }> = ({ dark }) => <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 22, letterSpacing: 5, color: dark ? "rgba(22,22,29,0.6)" : "rgba(255,255,255,0.8)" }}>MADE-UP STORY · AI ANIMATION AND VOICE</div>;
const Code: React.FC<{ a: number; typeAt: number; top?: number }> = ({ a, typeAt, top = 1330 }) => {
  const { s } = useT();
  const OLD = "everything", NEW = "stars";
  const del = Math.round(ramp(s, typeAt, typeAt + 0.7, 0, OLD.length, (x) => x)), typ = Math.round(ramp(s, typeAt + 0.85, typeAt + 1.4, 0, NEW.length, (x) => x));
  const word = s < typeAt + 0.85 ? OLD.slice(0, OLD.length - del) : NEW.slice(0, typ);
  return (
    <div style={{ position: "absolute", left: 50, right: 50, top, padding: "26px 34px 30px", borderRadius: 40, background: INK, border: "5px solid rgba(255,255,255,0.25)", transform: `translateY(${(1 - ramp(s, a, a + 0.35, 0, 1, back)) * 800}px)` }}>
      <div style={{ fontFamily: N, fontWeight: 900, fontSize: 26, letterSpacing: 5, color: YELLOW }}>LINE 4</div>
      <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 52, color: "#fff", marginTop: 6, whiteSpace: "pre" }}>monster.eat(<span style={{ color: s < typeAt + 0.85 ? "#ff6b6b" : "#7ee787" }}>{word}</span><span style={{ color: YELLOW, opacity: Math.sin(s * 14) > 0 ? 1 : 0 }}>|</span>)</div>
    </div>
  );
};
const EndCard: React.FC<{ at: number; second: number }> = ({ at, second }) => {
  const { s } = useT();
  if (s < at) return null;
  const e = ramp(s, at, at + 0.4);
  return (
    <AbsoluteFill style={{ opacity: e }}>
      <Img src={staticFile("c3d/stars.jpg")} style={{ position: "absolute", left: 0, top: -8, width: 1080, height: 1935, filter: "blur(14px) brightness(0.75)", transform: "scale(1.08)" }} />
      <div style={{ position: "absolute", left: 60, right: 60, top: 470, padding: "70px 40px 76px", borderRadius: 60, background: CREAM, border: `8px solid ${INK}`, boxShadow: `0 16px 0 ${INK}`, textAlign: "center", transform: `scale(${0.9 + e * 0.1})` }}>
        <div style={{ fontFamily: B, fontWeight: 800, fontSize: 104, lineHeight: 1.0, letterSpacing: -2, color: INK }}>Some kids<br />play the game.</div>
        <div style={{ fontFamily: B, fontWeight: 800, fontSize: 104, lineHeight: 1.0, letterSpacing: -2, color: CORAL, marginTop: 26, opacity: ramp(s, second, second + 0.25) }}>Your kid<br />built it.</div>
        <div style={{ display: "inline-block", marginTop: 56, padding: "20px 46px", borderRadius: 60, background: YELLOW, border: `7px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 44, color: INK, opacity: ramp(s, second + 1.1, second + 1.4) }}>Free to start · codeitlearn.com</div>
      </div>
    </AbsoluteFill>
  );
};

/* Friday: the fix */
export const FIX3D_DUR = 14.4;
export const CodeItFix3D: React.FC = () => (
  <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
    <Fonts />
    <Clips clips={[{ src: "type", from: 0, dur: 4.4, rate: 1.14 }, { src: "stars", from: 4.4, dur: 4.7, rate: 1.07 }]} />
    <Shade />
    <Say a={0.2} b={2.5} size={78}>Line four.<br />Change one word.</Say>
    <Code a={0.5} typeAt={1.1} />
    <Say a={3.0} b={4.2} top={230}>Now run it!</Say>
    <Say a={4.8} b={6.6}>It's eating stars!</Say>
    <Say a={6.9} b={8.9} size={76}>One word.<br />That's all it took.</Say>
    <EndCard at={9.1} second={10.9} />
    <Label />
    <Vo file="fix-pip.mp3" lines={[[0.1, 2.42, 0.2], [2.78, 3.85, 3.0], [4.05, 5.8, 4.8], [8.1, 10.03, 6.9], [10.55, 11.95, 9.4], [12.27, 13.5, 10.9]]} />
  </AbsoluteFill>
);

/* Saturday: the week in 15 seconds */
export const RECAP_DUR = 15;
export const CodeItRecap3D: React.FC = () => {
  const { s } = useT();
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <Fonts />
      <Clips clips={[{ src: "bite", from: 0, dur: 4.8, rate: 1.04 }, { src: "chase", from: 4.8, dur: 2.1, start: 2.2, rate: 1.3 }, { src: "type", from: 6.9, dur: 2.5, rate: 1.9 }, { src: "stars", from: 9.4, dur: 1.9, start: 0.6, rate: 1.5 }]} />
      <Shade />
      {s < 4.8 ? <div style={{ position: "absolute", left: 0, right: 0, top: 110, textAlign: "center" }}><div style={{ display: "inline-block", fontFamily: N, fontWeight: 900, fontSize: 30, letterSpacing: 7, color: "#fff", background: CORAL, padding: "8px 26px", borderRadius: 30, border: `5px solid ${INK}` }}>THIS WEEK ON CODEIT</div></div> : null}
      <Say a={0.9} b={2.9} size={74}>A monster got out<br />of the game.</Say>
      <Say a={3.1} b={4.7}>It ate the<br />Run button!</Say>
      <Say a={4.95} b={6.75}>I could not catch it.</Say>
      <Say a={7.0} b={9.3} size={70} top={200}>Then one kid<br />changed one word.</Say>
      {s >= 6.9 && s < 9.4 ? <Code a={6.95} typeAt={7.5} /> : null}
      <Say a={9.5} b={11.0} size={120}>Stars!</Say>
      <EndCard at={11.2} second={12.9} />
      <Label />
      <Vo file="wk-recap.mp3" lines={[[0, 0.74, 0.1], [0.96, 2.81, 0.9], [3.04, 4.59, 3.1], [4.96, 6.24, 4.95], [6.77, 9.07, 7.0], [9.36, 10.3, 9.5], [10.58, 12.09, 11.4], [12.34, 13.79, 12.9]]} />
    </AbsoluteFill>
  );
};

/* Sunday: it sleeps */
export const SLEEP_DUR = 11.2;
export const CodeItSleep3D: React.FC = () => {
  const { s } = useT();
  const q = ramp(s, 7.6, 8.0);
  const whisper = (text: string, a: number, b: number) => s >= a && s < b ? <div key={text} style={{ position: "absolute", left: 60, right: 60, top: 230, textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: 84, lineHeight: 1.02, color: "#fff", textShadow: "0 6px 30px rgba(0,0,0,0.75)", opacity: ramp(s, a, a + 0.25) * (1 - ramp(s, b - 0.2, b)) }}>{text}</div> : null;
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <Fonts />
      <Clips clips={[{ src: "sleep", from: 0, dur: 11.2, rate: 0.45 }]} />
      <Shade />
      {whisper("Shh. It's sleeping.", 0.3, 2.7)}
      {whisper("It ate stars all day.", 2.9, 5.0)}
      {whisper("Tomorrow, Adam builds something new.", 5.2, 7.6)}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 760, background: "linear-gradient(0deg, rgba(10,10,20,0.9), transparent)", opacity: q }} />
      <div style={{ position: "absolute", left: 50, right: 50, top: 1300, textAlign: "center", opacity: q, transform: `translateY(${(1 - q) * 30}px)` }}>
        <div style={{ fontFamily: B, fontWeight: 800, fontSize: 92, lineHeight: 1.0, color: "#fff" }}>What should Adam<br /><span style={{ color: YELLOW }}>build next?</span></div>
        <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 34 }}>
          {["a game", "a quiz", "a website"].map((o, k) => { const p = ramp(s, 8.3 + k * 0.14, 8.55 + k * 0.14, 0, 1, back); return <div key={o} style={{ padding: "14px 28px", borderRadius: 34, background: "#fff", border: `7px solid ${INK}`, boxShadow: `0 9px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 44, color: INK, transform: `scale(${p}) rotate(${(k - 1) * 3}deg)`, opacity: Math.min(1, p * 2) }}>{o}?</div>; })}
        </div>
        <div style={{ fontFamily: N, fontWeight: 900, fontSize: 34, color: "#fff", marginTop: 40, opacity: ramp(s, 9.6, 9.9) }}>Tell us in the comments · codeitlearn.com</div>
      </div>
      <Label />
      <Vo file="wk-sleep.mp3" lines={[[0, 0.7, 0.4], [1.01, 1.88, 1.3], [2.37, 4.28, 3.0], [4.65, 5.35, 5.3], [5.54, 7.14, 6.0], [7.49, 8.37, 8.0], [8.74, 10.11, 9.0]]} />
    </AbsoluteFill>
  );
};
