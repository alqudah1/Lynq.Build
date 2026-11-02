import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { Backdrop, BROWN, Caption, CodeWindow, Footer, Game, GameIn, MONO, NUNITO, ORANGE, Pip, Tag, TopLine } from "./pip-kit";
import { BuildButton, Burst, Clicks, IdeaInput } from "./PipSeries";
import { Fonts, Sfx, useSpringAt, useT } from "./kit";

/*
 * A 10 second hook reel in the "reaction, then the better way" shape: four shots of about two
 * seconds, words on screen so it works on mute, and the last shot is the first one again so it loops.
 * 0.0 the boring way (a 3 hour video, Pip asleep) · 2.3 say one sentence · 4.5 the game plays
 * 6.6 change one number and see why · 9.0 back to the boring way.
 */

const q = (f: string) => `'${f}'`;

/** A long course video, barely started. */
const BoringVideo: React.FC<{ at: number }> = ({ at }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 15, stiffness: 140 });
  const p = at < 0 ? 1 : sp;
  const secs = 4 + Math.floor(Math.max(0, s - Math.max(0, at)));
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: 560, borderRadius: 40, overflow: "hidden", background: "#2b2b2e", boxShadow: "0 30px 70px rgba(53,34,14,0.22)", opacity: p, transform: `translateY(${(1 - p) * 80}px)` }}>
      <div style={{ height: 460, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#3a3a3f,#26262a)" }}>
        <div style={{ width: 150, height: 150, borderRadius: 75, background: "rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 0, height: 0, borderTop: "34px solid transparent", borderBottom: "34px solid transparent", borderLeft: "56px solid rgba(255,255,255,0.8)", marginLeft: 14 }} />
        </div>
      </div>
      <div style={{ height: 12, background: "#55555a" }}><div style={{ width: "0.6%", height: "100%", background: "#ff4b4b" }} /></div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "26px 36px 30px", fontFamily: q(NUNITO), fontWeight: 700, fontSize: 36, color: "#d8d8dc" }}>
        <span>Coding full course, part 1 of 9</span>
        <span style={{ fontFamily: q(MONO), fontSize: 32 }}>0:0{Math.min(9, secs)} / 3:12:45</span>
      </div>
    </div>
  );
};

/** Floating z's over a sleepy Pip. */
const Zzz: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const { s } = useT();
  return (
    <>
      {[0, 1, 2].map((i) => {
        const k = ((s * 0.8 + i / 3) % 1);
        return <div key={i} style={{ position: "absolute", left: x + k * 90 + i * 20, top: y - k * 220, fontFamily: q(NUNITO), fontWeight: 900, fontSize: 60 + i * 14, color: BROWN, opacity: Math.sin(k * Math.PI) * 0.7 }}>z</div>;
      })}
    </>
  );
};

const LIVES3 = ["lives = 3", "if hit:", "    lives -= 1"];

const BoringShot: React.FC<{ at: number }> = ({ at }) => (
  <>
    <TopLine text="Learning to code from a 3 hour video?" at={at} accent={["3", "hour"]} size={86} />
    <BoringVideo at={at} />
    <Pip pose="think" x={540} y={1440} size={380} tilt={-12} />
    <Zzz x={700} y={1180} />
  </>
);

export const PipHook1: React.FC = () => {
  const { s } = useT();
  return (
    <AbsoluteFill>
      <Fonts />
      <Backdrop />
      {s < 2.3 && <BoringShot at={-1} />}
      {s >= 2.3 && s < 4.5 && (
        <>
          <TopLine text="Or say what you want to build." at={2.3} accent={["say"]} size={86} />
          <IdeaInput at={2.3} text="a rocket that dodges asteroids" typeAt={2.45} />
          <BuildButton at={3.6} pressAt={4.25} />
          <Pip pose="type" x={540} y={1360} size={420} />
          <Burst at={4.3} x={540} y={900} />
        </>
      )}
      <GameIn at={4.5} out={6.45} scale={0.9} top={330}>{(t) => <Game t={t + 1} hearts={3} />}</GameIn>
      {s >= 4.5 && s < 6.6 && <Caption text="Play it in seconds." at={4.6} accent={["seconds."]} />}
      {s >= 6.6 && s < 9.0 && (
        <>
          <TopLine text="Then change one thing. See why." at={6.6} accent={["one", "why."]} size={86} />
          <CodeWindow at={6.6} lines={LIVES3} highlight={0} highlightAt={7.0} edit={{ line: 0, from: "3", to: "5", at: 7.3 }} />
          <Pip pose="cheer" x={540} y={1400} size={340} bounce={s > 8.0 ? Math.abs(Math.sin(s * 6)) * 30 : 0} />
          <Tag text="Comment GAME · 10 free game ideas" at={7.6} top={1660} />
        </>
      )}
      {s >= 9.0 && <BoringShot at={9.0} />}
      <Footer />
      <Audio src={staticFile("sfx/codeit-bed.mp3")} volume={0.3} />
      <Clicks at={2.45} n={12} every={0.1} />
      <Sfx at={3.6} src="pop.wav" />
      <Sfx at={4.3} src="whoosh.wav" />
      <Sfx at={4.6} src="ding.wav" volume={0.5} />
      <Sfx at={6.6} src="whoosh.wav" volume={0.6} />
      <Sfx at={7.3} src="click.wav" volume={0.6} />
      <Sfx at={8.0} src="ding.wav" volume={0.5} />
    </AbsoluteFill>
  );
};
