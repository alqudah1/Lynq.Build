import React from "react";
import { AbsoluteFill, Audio, Img, staticFile } from "remotion";
import { ORANGE } from "./pip-kit";
import { Burst } from "./PipSeries";
import { Fonts, Sfx, Words, ramp, useSpringAt, useT } from "./kit";

/*
 * "Adam builds a game", cut from the six Pixar-style stills made in OpenArt (AI images, labeled
 * on screen). Opens on the magic moment, then goes back to how he got there, and lands on the mom.
 */

const q = (f: string) => `'${f}'`;

type Shot = { src: string; from: number; to: number; zoom: [number, number]; pan?: [number, number]; focusY?: number };
const SHOTS: Shot[] = [
  { src: "codeit/4-magic.jpg", from: 0, to: 2.0, zoom: [1.18, 1.04], focusY: 55 },
  { src: "codeit/1-bored.jpg", from: 2.0, to: 4.0, zoom: [1.04, 1.12], pan: [0, -20] },
  { src: "codeit/2-idea.jpg", from: 4.0, to: 5.8, zoom: [1.0, 1.16], focusY: 40 },
  { src: "codeit/3-typing.jpg", from: 5.8, to: 8.8, zoom: [1.06, 1.16], focusY: 60 },
  { src: "codeit/5-mom-proud.jpg", from: 8.8, to: 11.6, zoom: [1.12, 1.02] },
  { src: "codeit/6-together.jpg", from: 11.6, to: 16.0, zoom: [1.02, 1.12], focusY: 60 },
];

const Still: React.FC<{ shot: Shot }> = ({ shot }) => {
  const { s } = useT();
  if (s < shot.from - 0.6 || s > shot.to + 0.01) return null;
  const k = ramp(s, shot.from - 0.6, shot.to, 0, 1, (x) => x);
  const z = shot.zoom[0] + (shot.zoom[1] - shot.zoom[0]) * k;
  const py = shot.pan ? shot.pan[0] + (shot.pan[1] - shot.pan[0]) * k : 0;
  const fadeIn = ramp(s, shot.from - 0.6, shot.from + 0.1);
  return (
    <AbsoluteFill style={{ opacity: shot.from === 0 ? 1 : fadeIn }}>
      <Img src={staticFile(shot.src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z + (1 - fadeIn) * 0.06}) translateY(${py}px)`, filter: `blur(${(1 - fadeIn) * 6}px)`, transformOrigin: `50% ${shot.focusY ?? 50}%` }} />
    </AbsoluteFill>
  );
};

/** White words with a soft dark backing, top of frame, readable over any still. */
const Line: React.FC<{ text: string; at: number; out?: number; accent?: string[]; size?: number; top?: number }> = ({ text, at, out, accent = [], size = 76, top = 250 }) => {
  const { s } = useT();
  if (s < at || (out !== undefined && s > out + 0.3)) return null;
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top, textAlign: "center", textShadow: "0 4px 24px rgba(30,15,5,0.65), 0 2px 6px rgba(30,15,5,0.5)" }}>
      <Words text={text} at={at} out={out} size={size} color="#ffffff" accent="#ffb15c" accentWords={accent} font="Baloo 2" weight={800} align="center" lineHeight={1.08} />
    </div>
  );
};

const Typed: React.FC<{ at: number; text: string }> = ({ at, text }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 14, stiffness: 180 });
  if (s < at || s > 8.85) return null;
  const gone = ramp(s, 8.2, 8.75);
  const typed = text.slice(0, Math.max(0, Math.floor((s - at - 0.2) * 16)));
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: 560, padding: "34px 40px", borderRadius: 40, background: "rgba(255,255,255,0.95)", boxShadow: "0 24px 60px rgba(30,15,5,0.35)", fontFamily: q("Baloo 2"), fontWeight: 700, fontSize: 52, color: "#35220e", opacity: p * (1 - gone), transform: `translateY(${(1 - p) * 60 - gone * 40}px)` }}>
      {typed}<span style={{ display: "inline-block", width: 5, height: 56, marginLeft: 4, background: ORANGE, verticalAlign: "middle", opacity: Math.floor(s * 3) % 2 ? 1 : 0.2 }} />
    </div>
  );
};

export const AdamFilm: React.FC = () => {
  const { s } = useT();
  const tag = useSpringAt(13.2, { damping: 12, stiffness: 200 });
  const flash = Math.max(1 - ramp(s, 0, 0.35), ramp(s, 15.55, 16.0));
  return (
    <AbsoluteFill style={{ background: "#1a0f08" }}>
      <Fonts />
      {SHOTS.map((sh) => <Still key={sh.src} shot={sh} />)}
      {/* top shade so the words always read */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(25,12,4,0.55) 0%, rgba(25,12,4,0) 32%)" }} />
      <AbsoluteFill style={{ background: "#fff", opacity: flash * 0.7 }} />
      <Burst at={0.1} x={540} y={1000} />

      <Line text="He typed one sentence. This came out." at={0.15} out={1.8} accent={["one", "sentence."]} />
      <Line text="An hour ago he was bored, watching other kids play." at={2.05} out={3.8} accent={["bored,"]} />
      <Line text="Then he wondered: could I make my own?" at={4.05} out={5.6} accent={["my", "own?"]} />
      <Line text="So he typed what he wanted." at={5.85} out={8.6} accent={["typed"]} />
      <Typed at={6.4} text="a cat that catches falling fish" />
      <Line text="Then he showed Mom the number he changed to make it harder." at={8.85} out={11.4} accent={["changed"]} size={68} />
      <Line text="He didn't just play a game tonight." at={11.7} size={72} />
      <Line text="He built one." at={12.4} size={124} top={420} accent={["built"]} />
      <Line text="Screen time he can explain to you." at={13.6} size={54} top={590} />

      {s >= 13.2 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 1360, display: "flex", justifyContent: "center", opacity: tag, transform: `translateY(${(1 - tag) * 40}px)` }}>
          <div style={{ padding: "22px 50px", borderRadius: 60, background: "linear-gradient(135deg,#ff9a3c,#ff6a00)", boxShadow: "0 16px 36px rgba(255,106,0,0.35)", fontFamily: q("Nunito"), fontWeight: 900, fontSize: 42, color: "#fff" }}>Free to start · codeitlearn.com</div>
        </div>
      )}
      <div style={{ position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", fontFamily: q("Nunito"), fontWeight: 800, fontSize: 24, letterSpacing: 3, color: "rgba(255,255,255,0.8)" }}>CODEIT · AI-MADE IMAGES</div>

      <Audio src={staticFile("sfx/codeit-bed.mp3")} volume={0.32} />
      <Sfx at={0.05} src="whoosh.wav" />
      <Sfx at={0.15} src="ding.wav" volume={0.6} />
      <Sfx at={1.6} src="whoosh.wav" volume={0.3} />
      <Sfx at={3.6} src="whoosh.wav" volume={0.25} />
      <Sfx at={5.4} src="whoosh.wav" volume={0.25} />
      <Sfx at={11.2} src="whoosh.wav" volume={0.3} />
      <Sfx at={4.0} src="pop.wav" volume={0.6} />
      {Array.from({ length: 14 }, (_, i) => <Sfx key={i} at={6.6 + i * 0.12} src="click.wav" volume={0.4} />)}
      <Sfx at={8.4} src="whoosh.wav" volume={0.3} />
      <Sfx at={12.4} src="ding.wav" volume={0.6} />
      <Sfx at={13.2} src="pop.wav" volume={0.6} />
    </AbsoluteFill>
  );
};
