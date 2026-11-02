import React from "react";
import { Sequence } from "remotion";
import { BROWN, Caption, CodeWindow, Episode, Game, GameIn, NextUp, ORANGE, Pip, PipLang, Svg, Tag, TopLine, YELLOW, MINT, useTr } from "./pip-kit";
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

const IdeaInput: React.FC<{ at: number; text: string; typeAt: number }> = ({ at, text: en, typeAt }) => {
  const { s } = useT();
  const { tr, ui, dir } = useTr();
  const text = tr(en);
  const p = useSpringAt(at, { damping: 15, stiffness: 140 });
  const typed = text.slice(0, Math.max(0, Math.floor((s - typeAt) * 15)));
  return (
    <div dir={dir} style={{ position: "absolute", left: 80, right: 80, top: 560, height: 210, borderRadius: 44, background: "#fff", boxShadow: "0 30px 70px rgba(53,34,14,0.18)", opacity: p, transform: `translateY(${(1 - p) * 80}px)`, display: "flex", alignItems: "center", padding: "0 50px", fontFamily: q(ui), fontWeight: 700, fontSize: 54, color: BROWN }}>
      {typed}
      <span style={{ width: 6, height: 70, borderRadius: 3, background: ORANGE, marginLeft: 6, opacity: Math.floor(s * 3) % 2 ? 1 : 0.2 }} />
    </div>
  );
};

const BuildButton: React.FC<{ at: number; pressAt: number }> = ({ at, pressAt }) => {
  const { s } = useT();
  const { tr, ui } = useTr();
  const p = useSpringAt(at, { damping: 10, stiffness: 220 });
  const press = s > pressAt && s < pressAt + 0.18 ? 0.9 : 1;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 830, display: "flex", justifyContent: "center", opacity: p, transform: `scale(${p * press})` }}>
      <div style={{ padding: "34px 74px", borderRadius: 70, background: YELLOW, boxShadow: "0 24px 50px rgba(53,34,14,0.2)", fontFamily: q(ui), fontWeight: 900, fontSize: 58, color: BROWN }}>{tr("▶ Build my game")}</div>
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
const SCORE_BUG = ["score = 0", "if touching(star):", "    score = 1"];

/*
 * Episodes 2 to 5 are cold opens: frame 0 is already the most dramatic moment, with the hook on
 * screen (no title card, no "last time"), each episode stops on a question and the next one opens
 * with its answer, and the last second leads back into the first so the Short loops.
 */

/** Line-by-line scan over a code window: which line is it? */
const scanLine = (s: number, from: number, n: number, every = 0.45) => (s < from ? undefined : Math.floor((s - from) / every) % n);

/** A quiz card: the question, three answers, and (from `pickAt`) the right one lit up. */
const Quiz: React.FC<{ at: number; pickAt?: number }> = ({ at, pickAt }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 15, stiffness: 140 });
  const card = at < 0 ? 1 : sp;
  const answered = pickAt !== undefined && s >= pickAt;
  const { tr, font, ui, dir } = useTr();
  const opts = ["5 points per star", "The score resets", "Nothing changes"].map(tr);
  const scan = !answered ? scanLine(s, Math.max(at, 0) + 0.8, 3, 0.5) : undefined;
  return (
    <div dir={dir} style={{ position: "absolute", left: 70, right: 70, top: 470, padding: "50px 50px 56px", borderRadius: 48, background: "#fff", boxShadow: "0 40px 90px rgba(53,34,14,0.2)", opacity: card, transform: `translateY(${(1 - card) * 100}px)` }}>
      <div style={{ fontFamily: `'${ui}'`, fontWeight: 800, fontSize: 30, letterSpacing: dir === "rtl" ? 0 : 5, color: "#d46500" }}>{tr("LINE 3 SAYS score + 5")}</div>
      <div style={{ fontFamily: `'${font}'`, fontWeight: 700, fontSize: 70, color: BROWN, lineHeight: 1.15, margin: "18px 0 30px" }}>{tr("What happens now?")}</div>
      {opts.map((o, i) => {
        const right = i === 0 && answered;
        const lit = scan === i;
        return (
          <div key={o} style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 22, padding: "28px 34px", borderRadius: 44, background: right ? "linear-gradient(135deg,#ff9a3c,#ff6a00)" : lit ? "#ffe2c2" : "#fff3e6", color: right ? "#fff" : BROWN, fontFamily: `'${ui}'`, fontWeight: 800, fontSize: 50, transform: right && s < pickAt! + 0.3 ? "scale(1.05)" : lit ? "scale(1.02)" : "none" }}>
            <span style={{ width: 64, height: 64, borderRadius: 32, background: right ? "#fff" : "rgba(255,122,0,0.15)", color: right ? "#ff6a00" : "#d46500", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>{right ? "✓" : "ABC"[i]}</span>
            {o}
          </div>
        );
      })}
    </div>
  );
};

/** Episode 2: it breaks. Opens on the crash, ends on "which line?" (the answer opens episode 3). */
export const PipEp2: React.FC = () => {
  const { s } = useT();
  const scan = scanLine(s, 9.3, 4);
  return (
    <Episode ep={2} title="It breaks" seconds={14} cold>
      {s < 3.0 && <TopLine text="One hit. Game over." at={-1} out={2.8} accent={["Game", "over."]} />}
      <GameIn at={-0.5} out={2.85} scale={0.86} top={400}>{(t) => <Game t={t} crashAt={0.8} gameOver />}</GameIn>
      {s >= 3.0 && s < 6.3 && (
        <>
          <TopLine text="Pip tries again." at={3.0} out={6.0} accent={["again."]} />
          <GameIn at={3.0} out={6.1} scale={0.86} top={400}>{(t) => <Game t={t} crashAt={1.6} gameOver />}</GameIn>
        </>
      )}
      {s >= 6.3 && s < 9.2 && (
        <>
          <TopLine text="Every. Single. Time." at={6.3} out={9.0} accent={["Single."]} />
          <GameIn at={6.3} out={9.1} scale={0.86} top={400}>{(t) => <Game t={t} crashAt={0.9} gameOver />}</GameIn>
        </>
      )}
      {s >= 9.2 && (
        <>
          <TopLine text="One of these lines is why." at={9.2} accent={["One", "why."]} size={84} />
          <CodeWindow at={9.2} lines={LIVES} highlight={scan} highlightAt={9.3} bad />
          <Caption text="Which line?" at={10.4} accent={["line?"]} size={120} top={1090} />
          <Tag text="Comment the number" at={11.6} top={1260} />
          <Pip pose="think" x={540} y={1600} size={240} />
        </>
      )}
      <Sfx at={0.3} src="crash.wav" />
      <Sfx at={3.0} src="whoosh.wav" volume={0.5} />
      <Sfx at={4.6} src="crash.wav" volume={0.8} />
      <Sfx at={6.3} src="whoosh.wav" volume={0.5} />
      <Sfx at={7.2} src="crash.wav" volume={0.8} />
      <Sfx at={9.2} src="pop.wav" />
      {[9.3, 9.75, 10.2, 10.65, 11.1, 11.55, 12.0, 12.45, 12.9, 13.35].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.45} />)}
    </Episode>
  );
};

/** Episode 3: line 1 was the bug. The rocket survives, Pip adds stars, and the score gets stuck. */
export const PipEp3: React.FC = () => {
  const { s } = useT();
  const scan = scanLine(s, 11.4, 3);
  return (
    <Episode ep={3} title="Stars" seconds={15} cold>
      {s < 2.6 && (
        <>
          <TopLine text="It was line 1." at={-1} out={2.4} accent={["line", "1."]} size={100} />
          <CodeWindow at={-1} lines={LIVES} highlight={0} highlightAt={0} bad edit={{ line: 0, from: "0", to: "3", at: 0.9 }} />
          <Caption text="Zero spare lives. Now 3." at={1.0} out={2.4} accent={["3."]} size={88} top={1110} />
          <Pip pose="type" x={540} y={1600} size={260} />
        </>
      )}
      <GameIn at={2.6} out={5.35}>{(t) => <Game t={t} hearts={3} hitAt={1.0} />}</GameIn>
      {s >= 2.6 && s < 5.4 && <><Caption text="It survives!" at={3.7} out={5.2} accent={["survives!"]} /><Pip pose="cheer" x={900} y={1380} size={240} bounce={s > 3.6 ? Math.abs(Math.sin(s * 6)) * 30 : 0} /></>}
      <GameIn at={5.4} out={11.25}>{(t) => <Game t={t} stars score="stuck" />}</GameIn>
      {s >= 5.4 && s < 11.3 && (
        <>
          <Caption text="So Pip adds stars." at={5.5} out={7.6} accent={["stars."]} />
          <Caption text="Every star. Score: 1?!" at={8.0} out={11.1} accent={["1?!"]} />
          <Pip pose={s > 8 ? "think" : "cheer"} x={900} y={1380} size={240} bounce={s < 8 ? Math.abs(Math.sin(s * 6)) * 30 : 0} />
        </>
      )}
      {s >= 11.3 && (
        <>
          <TopLine text="Another bug. Where?" at={11.3} accent={["Where?"]} />
          <CodeWindow at={11.3} lines={SCORE_BUG} highlight={scan} highlightAt={11.4} bad />
          <Tag text="Answer in episode 4" at={12.4} top={1100} />
          <Pip pose="think" x={540} y={1560} size={300} />
        </>
      )}
      <Clicks at={0.9} n={3} />
      <Sfx at={1.6} src="ding.wav" volume={0.5} />
      <Sfx at={2.6} src="whoosh.wav" volume={0.6} />
      <Sfx at={3.6} src="thump.wav" />
      <Sfx at={5.4} src="whoosh.wav" volume={0.6} />
      {[6.2, 7.1, 8.0, 8.9, 9.8, 10.7].map((t) => <Sfx key={t} at={t} src="pop.wav" volume={0.45} />)}
      <Sfx at={8.0} src="thump.wav" />
      <Sfx at={11.3} src="pop.wav" />
    </Episode>
  );
};

/** Episode 4: line 3 was the bug. Every star counts, then Pip gets a question (answered in episode 5). */
export const PipEp4: React.FC = () => {
  const { s } = useT();
  return (
    <Episode ep={4} title="The score" seconds={15} cold>
      <GameIn at={-6} out={2.35}>{(t) => <Game t={t} stars score="stuck" />}</GameIn>
      {s < 2.4 && <><Caption text="Every star. Score: 1." at={-1} out={2.2} accent={["1."]} /><Pip pose="think" x={900} y={1380} size={240} /></>}
      {s >= 2.4 && s < 5.6 && (
        <>
          <TopLine text="It was line 3." at={2.4} out={5.4} accent={["line", "3."]} size={100} />
          <CodeWindow at={2.4} lines={SCORE_BUG} highlight={2} highlightAt={2.8} bad edit={{ line: 2, from: "1", to: "score + 1", at: 3.6 }} />
          <Caption text="Add one every time." at={4.3} out={5.4} accent={["every"]} size={88} top={1150} />
          <Pip pose={s > 3.5 ? "type" : "think"} x={540} y={1580} size={260} />
        </>
      )}
      <GameIn at={5.6} out={10.25}>{(t) => <Game t={t} stars score="plus1" />}</GameIn>
      {s >= 5.6 && s < 10.3 && <><Caption text="Now every star counts!" at={6.0} out={10.1} accent={["every", "counts!"]} size={88} /><Pip pose="cheer" x={900} y={1380} size={240} bounce={Math.abs(Math.sin(s * 6)) * 30} /></>}
      {s >= 10.3 && (
        <>
          <TopLine text="Then the teacher asks:" at={10.3} accent={["asks:"]} size={84} />
          <Quiz at={10.5} />
          <Tag text="Comment A, B or C" at={12.2} top={1260} />
          <Pip pose="think" x={540} y={1600} size={240} />
        </>
      )}
      <Sfx at={2.4} src="whoosh.wav" volume={0.5} />
      <Sfx at={2.8} src="pop.wav" />
      <Clicks at={3.6} n={8} every={0.07} />
      <Sfx at={5.6} src="whoosh.wav" volume={0.6} />
      {[6.4, 7.3, 8.2, 9.1, 10.0].map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.3} />)}
      <Sfx at={10.3} src="thump.wav" />
    </Episode>
  );
};

/** Episode 5: the answer, the proof, and the only ask in the series. */
export const PipEp5: React.FC = () => {
  const { s } = useT();
  return (
    <Episode ep={5} title="Prove it" seconds={13} cold>
      {s < 4.6 && (
        <>
          <TopLine text="Pip has 3 seconds." at={-1} out={4.4} accent={["3", "seconds."]} size={88} />
          <Quiz at={-1} pickAt={2.6} />
          <Caption text="A! First try." at={2.9} out={4.4} accent={["A!"]} size={100} top={1230} />
          <Pip pose={s > 2.6 ? "cheer" : "think"} x={540} y={1600} size={240} bounce={s > 2.6 ? Math.abs(Math.sin(s * 6)) * 30 : 0} />
        </>
      )}
      <Burst at={2.65} x={540} y={900} />
      <GameIn at={4.6} out={10.05}>{(t) => <Game t={t} stars score="plus5" />}</GameIn>
      {s >= 4.6 && s < 10.1 && <><Caption text="5 points a star." at={5.0} out={7.6} accent={["5"]} /><Caption text="Pip built it. And gets it." at={7.8} out={9.9} accent={["gets"]} size={84} /><Pip pose="cheer" x={900} y={1380} size={240} bounce={Math.abs(Math.sin(s * 6)) * 30} /></>}
      <NextUp at={10.1} line1="Your kid's turn:" line2="build one free." cta="codeitlearn.com" pose="cheer" />
      {[0.8, 1.3, 1.8, 2.3].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.45} />)}
      <Sfx at={2.6} src="ding.wav" volume={0.7} />
      <Sfx at={2.65} src="pop.wav" />
      <Sfx at={4.6} src="whoosh.wav" volume={0.6} />
      {[5.4, 6.3, 7.2, 8.1, 9.0, 9.9].map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.3} />)}
      <Sfx at={10.1} src="whoosh.wav" volume={0.6} />
    </Episode>
  );
};

/** Arabic cuts: the same episodes with every line in Arabic (the Python on screen stays). */
const inArabic = (K: React.FC): React.FC => {
  const A: React.FC = () => <PipLang.Provider value="ar"><K /></PipLang.Provider>;
  return A;
};
/** Arabic episode 1 starts 1 s in, past the title card, so it opens on Pip (a cold open like the others). */
export const PipEp1Ar: React.FC = () => <PipLang.Provider value="ar"><Sequence from={-30} layout="none"><PipEp1 /></Sequence></PipLang.Provider>;
export const PipEp2Ar = inArabic(PipEp2), PipEp3Ar = inArabic(PipEp3), PipEp4Ar = inArabic(PipEp4), PipEp5Ar = inArabic(PipEp5);
