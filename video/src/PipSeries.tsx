import React from "react";
import { BROWN, Caption, CodeWindow, Episode, Game, GameIn, NextUp, ORANGE, Pip, Svg, TopLine, YELLOW, MINT, NUNITO } from "./pip-kit";
import { Sfx, useSpringAt, useT } from "./kit";

const q = (f: string) => `'${f}'`;

const Burst: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const { s } = useT();
  const d = s - at;
  if (d < 0 || d > 0.9) return null;
  const html = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2, r = d * 1300;
    return `<circle cx="${Math.cos(a) * r}" cy="${Math.sin(a) * r + d * d * 600}" r="${Math.max(0, 18 - d * 18)}" fill="${[ORANGE, YELLOW, MINT, "#ff5a6e"][i % 4]}"/>`;
  }).join("");
  return <Svg w={10} h={10} vb="0 0 10 10" html={html} style={{ left: x, top: y }} />;
};

const IdeaInput: React.FC<{ at: number; text: string; typeAt: number }> = ({ at, text, typeAt }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 15, stiffness: 140 });
  const typed = text.slice(0, Math.max(0, Math.floor((s - typeAt) * 15)));
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: 560, height: 210, borderRadius: 44, background: "#fff", boxShadow: "0 30px 70px rgba(53,34,14,0.18)", opacity: p, transform: `translateY(${(1 - p) * 80}px)`, display: "flex", alignItems: "center", padding: "0 50px", fontFamily: q(NUNITO), fontWeight: 700, fontSize: 54, color: BROWN }}>
      {typed}
      <span style={{ width: 6, height: 70, borderRadius: 3, background: ORANGE, marginLeft: 6, opacity: Math.floor(s * 3) % 2 ? 1 : 0.2 }} />
    </div>
  );
};

const BuildButton: React.FC<{ at: number; pressAt: number }> = ({ at, pressAt }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 10, stiffness: 220 });
  const press = s > pressAt && s < pressAt + 0.18 ? 0.9 : 1;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 830, display: "flex", justifyContent: "center", opacity: p, transform: `scale(${p * press})` }}>
      <div style={{ padding: "34px 74px", borderRadius: 70, background: YELLOW, boxShadow: "0 24px 50px rgba(53,34,14,0.2)", fontFamily: q(NUNITO), fontWeight: 900, fontSize: 58, color: BROWN }}>▶ Build my game</div>
    </div>
  );
};

const Clicks: React.FC<{ at: number; n: number; every?: number }> = ({ at, n, every = 0.12 }) => <>{Array.from({ length: n }, (_, i) => <Sfx key={i} at={at + i * every} src="click.wav" volume={0.5} />)}</>;

/** Episode 1: the idea. Ends on the crash. */
export const PipEp1: React.FC = () => {
  const { s } = useT();
  const drop = useSpringAt(0.95, { damping: 9, stiffness: 170, mass: 0.8 });
  return (
    <Episode ep={1} title="The idea" seconds={15}>
      {s < 3.0 && <><TopLine text="Pip has never made a game." at={1.0} out={2.75} accent={["never"]} /><Pip pose="think" x={540} y={1150 - (1 - drop) * 1200} size={560} /></>}
      {s >= 2.9 && s < 6.3 && (
        <>
          <TopLine text="So Pip types one sentence." at={3.0} out={6.0} accent={["one", "sentence."]} size={84} />
          <IdeaInput at={3.1} text="a rocket that dodges asteroids" typeAt={3.4} />
          <BuildButton at={5.4} pressAt={6.0} />
          <Pip pose="type" x={540} y={1330} size={460} />
          <Burst at={6.05} x={540} y={900} />
        </>
      )}
      <GameIn at={6.3} out={11.85}>{(t) => <Game t={t} crashAt={4.5} />}</GameIn>
      {s >= 6.3 && s < 10.8 && <><Caption text="It works?!" at={6.8} out={10.6} accent={["works?!"]} /><Pip pose="cheer" x={900} y={1380} size={240} bounce={Math.abs(Math.sin(s * 6)) * 30} /></>}
      {s >= 10.8 && s < 11.9 && <><Caption text="Uh oh." at={10.8} size={150} accent={["oh."]} /><Pip pose="think" x={900} y={1380} size={240} /></>}
      <NextUp at={11.9} line1="Next episode:" line2="Pip fixes it." />
      <Clicks at={3.4} n={14} every={0.14} />
      <Sfx at={5.4} src="pop.wav" />
      <Sfx at={6.0} src="whoosh.wav" />
      <Sfx at={6.8} src="ding.wav" volume={0.5} />
      <Sfx at={10.8} src="crash.wav" />
      <Sfx at={11.9} src="whoosh.wav" volume={0.6} />
    </Episode>
  );
};

const LIVES = ["lives = 0", "if hit:", "    lives -= 1", "if lives < 0: game_over()"];

/** Episode 2: it breaks, and Pip finds the one number. */
export const PipEp2: React.FC = () => {
  const { s } = useT();
  return (
    <Episode ep={2} title="It breaks" seconds={15.5}>
      {s < 3.6 && <TopLine text="Last time: one hit, game over." at={1.0} out={3.3} accent={["one", "hit,"]} size={84} />}
      <GameIn at={1.0} out={3.4} scale={0.78} top={430}>{(t) => <Game t={t} crashAt={1.7} />}</GameIn>
      {s >= 3.6 && s < 9.0 && (
        <>
          <TopLine text="Pip reads the code." at={3.7} out={6.0} accent={["reads"]} size={88} />
          <CodeWindow at={3.7} lines={LIVES} highlight={0} highlightAt={4.7} bad edit={{ line: 0, from: "0", to: "3", at: 7.0 }} />
          <Caption text="Zero spare lives!" at={4.8} out={6.8} accent={["Zero"]} size={90} top={1200} />
          <Caption text="Change one number." at={7.2} out={8.8} accent={["one", "number."]} size={90} top={1200} />
          <Pip pose={s > 6.9 ? "type" : "think"} x={540} y={1580} size={320} />
        </>
      )}
      <GameIn at={9.0} out={12.85}>{(t) => <Game t={t} hearts={3} hitAt={1.6} />}</GameIn>
      {s >= 9.0 && s < 12.9 && <><Caption text="It survives!" at={10.8} out={12.7} accent={["survives!"]} /><Pip pose="cheer" x={900} y={1380} size={240} bounce={s > 10.8 ? Math.abs(Math.sin(s * 6)) * 30 : 0} /></>}
      <NextUp at={12.9} line1="Next episode:" line2="Pip adds stars." />
      <Sfx at={1.0} src="whoosh.wav" volume={0.5} />
      <Sfx at={2.7} src="crash.wav" volume={0.7} />
      <Sfx at={4.7} src="pop.wav" />
      <Clicks at={7.0} n={3} />
      <Sfx at={9.0} src="whoosh.wav" volume={0.6} />
      <Sfx at={10.6} src="thump.wav" />
      <Sfx at={10.8} src="ding.wav" volume={0.5} />
      <Sfx at={12.9} src="whoosh.wav" volume={0.6} />
    </Episode>
  );
};

const SCORE_BUG = ["score = 0", "if touching(star):", "    score = 1"];

/** Episode 3: stars, and a score that won't move. Ends asking the audience to find the bug. */
export const PipEp3: React.FC = () => {
  const { s } = useT();
  return (
    <Episode ep={3} title="Stars" seconds={15}>
      {s < 4.2 && (
        <>
          <TopLine text="Pip adds stars to collect." at={1.0} out={3.9} accent={["stars"]} size={86} />
          <CodeWindow at={1.3} lines={SCORE_BUG} />
          <Pip pose="type" x={540} y={1500} size={420} />
          <Clicks at={1.5} n={10} />
        </>
      )}
      <GameIn at={4.2} out={11.35}>{(t) => <Game t={t} stars score="stuck" />}</GameIn>
      {s >= 4.2 && s < 11.4 && (
        <>
          <Caption text="Collect them all!" at={4.7} out={7.7} accent={["all!"]} />
          <Caption text="But the score is stuck on 1." at={8.0} out={11.2} accent={["stuck"]} size={80} />
          <Pip pose={s > 8 ? "think" : "cheer"} x={900} y={1380} size={240} bounce={s < 8 ? Math.abs(Math.sin(s * 6)) * 30 : 0} />
        </>
      )}
      <NextUp at={11.4} line1="Can you spot the bug?" line2="Comment the line." cta="The answer is in Ep 4. Follow!" />
      <Sfx at={4.2} src="whoosh.wav" volume={0.6} />
      {[5.0, 5.9, 6.8, 7.7, 8.6, 9.5, 10.4].map((t) => <Sfx key={t} at={t} src="pop.wav" volume={0.45} />)}
      <Sfx at={8.0} src="thump.wav" />
      <Sfx at={11.4} src="whoosh.wav" volume={0.6} />
    </Episode>
  );
};

/** Episode 4: the fix. Every star counts. */
export const PipEp4: React.FC = () => {
  const { s } = useT();
  return (
    <Episode ep={4} title="The score" seconds={14.5}>
      {s < 5.0 && (
        <>
          <TopLine text="The bug was line 3." at={1.0} out={4.7} accent={["line", "3."]} size={88} />
          <CodeWindow at={1.1} lines={SCORE_BUG} highlight={2} highlightAt={1.7} bad edit={{ line: 2, from: "1", to: "score + 1", at: 2.9 }} />
          <Caption text="Add one every time." at={3.7} out={4.8} accent={["every"]} size={88} top={1150} />
          <Pip pose={s > 2.8 ? "type" : "think"} x={540} y={1600} size={360} />
          <Clicks at={2.9} n={8} every={0.07} />
        </>
      )}
      <GameIn at={5.0} out={10.75}>{(t) => <Game t={t} stars score="plus1" />}</GameIn>
      {s >= 5.0 && s < 10.8 && <><Caption text="Now every star counts!" at={5.6} out={10.6} accent={["every", "counts!"]} size={88} /><Pip pose="cheer" x={900} y={1380} size={240} bounce={Math.abs(Math.sin(s * 6)) * 30} /></>}
      <Burst at={9.8} x={540} y={700} />
      <NextUp at={10.8} line1="The final episode:" line2="Can Pip explain it?" />
      <Sfx at={1.7} src="pop.wav" />
      <Sfx at={5.0} src="whoosh.wav" volume={0.6} />
      {[5.8, 6.7, 7.6, 8.5, 9.4, 10.3].map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.3} />)}
      <Sfx at={10.8} src="whoosh.wav" volume={0.6} />
    </Episode>
  );
};

/** Episode 5: prove it. A question from Pip's own code; Pip gets it right first time. */
export const PipEp5: React.FC = () => {
  const { s } = useT();
  const card = useSpringAt(3.0, { damping: 15, stiffness: 140 });
  const answered = s >= 6.6;
  const opts = ["5 points per star", "The score resets", "Nothing changes"];
  return (
    <Episode ep={5} title="Prove it" seconds={15}>
      {s < 2.4 && <TopLine text="Building it is half." at={1.0} out={2.2} accent={["half."]} />}
      {s >= 2.3 && s < 11.2 && <TopLine text="Explaining it is the other half." at={2.4} out={8.4} accent={["other", "half."]} size={80} />}
      {s >= 3.0 && s < 11.2 && (
        <div style={{ position: "absolute", left: 70, right: 70, top: 520, padding: "50px 50px 56px", borderRadius: 48, background: "#fff", boxShadow: "0 40px 90px rgba(53,34,14,0.2)", opacity: card, transform: `translateY(${(1 - card) * 100}px)` }}>
          <div style={{ fontFamily: q(NUNITO), fontWeight: 800, fontSize: 30, letterSpacing: 5, color: "#d46500" }}>A QUESTION FROM PIP'S OWN CODE</div>
          <div style={{ fontFamily: "'Baloo 2'", fontWeight: 700, fontSize: 64, color: BROWN, lineHeight: 1.05, margin: "18px 0 34px" }}>If line 3 says score + 5, what happens?</div>
          {opts.map((o, i) => {
            const right = i === 0 && answered;
            return (
              <div key={o} style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 22, padding: "28px 34px", borderRadius: 44, background: right ? "linear-gradient(135deg,#ff9a3c,#ff6a00)" : "#fff3e6", color: right ? "#fff" : BROWN, fontFamily: q(NUNITO), fontWeight: 800, fontSize: 50, transform: right && s < 6.9 ? "scale(1.04)" : "none" }}>
                <span style={{ width: 64, height: 64, borderRadius: 32, background: right ? "#fff" : "rgba(255,122,0,0.15)", color: right ? "#ff6a00" : "#d46500", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>{right ? "✓" : "ABC"[i]}</span>
                {o}
              </div>
            );
          })}
        </div>
      )}
      {s >= 3.0 && s < 11.2 && <Pip pose={answered ? "cheer" : "think"} x={540} y={1650} size={300} bounce={answered ? Math.abs(Math.sin(s * 6)) * 30 : 0} />}
      {s >= 8.4 && s < 11.2 && <TopLine text="First try. Pip gets it." at={8.5} out={11.0} accent={["First", "try."]} size={84} />}
      <Burst at={6.65} x={540} y={900} />
      <NextUp at={11.2} line1="Your kid's turn:" line2="build one free." cta="Comment what Pip builds next" pose="cheer" />
      <Sfx at={3.0} src="whoosh.wav" volume={0.5} />
      <Sfx at={6.6} src="ding.wav" volume={0.7} />
      <Sfx at={6.65} src="pop.wav" />
      <Sfx at={11.2} src="whoosh.wav" volume={0.6} />
    </Episode>
  );
};
