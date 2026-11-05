import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { Backdrop, BALOO, BROWN, Caption, CodeWindow, Footer, Game, GameIn, MINT, MONO, NUNITO, ORANGE, ORANGE_T, Pip, Svg, Tag, TopLine, YELLOW } from "./pip-kit";
import { BuildButton, Burst, Clicks, IdeaInput } from "./PipSeries";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * CodeIt's lighter reels: quizzes, memes, lists and a speedrun. Each one is 9 to 11 seconds,
 * reads on mute, opens with its hook already on screen and ends with something to comment.
 */

const q = (f: string) => `'${f}'`;

const FunFrame: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <AbsoluteFill>
    <Fonts />
    <Backdrop />
    <div style={{ position: "absolute", top: 150, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 34px", borderRadius: 40, background: "rgba(255,122,0,0.13)", fontFamily: q(NUNITO), fontWeight: 800, fontSize: 28, letterSpacing: 5, color: ORANGE_T }}>
        <span style={{ width: 16, height: 16, borderRadius: 8, background: ORANGE, display: "inline-block" }} />{label}
      </div>
    </div>
    {children}
    <Footer />
    <Audio src={staticFile("sfx/codeit-bed.mp3")} volume={0.3} />
  </AbsoluteFill>
);

/* ── 1. Guess the output ─────────────────────────────────────────────── */

const Option: React.FC<{ letter: string; text: string; at: number; top: number; state: "idle" | "right" | "wrong" }> = ({ letter, text, at, top, state }) => {
  const sp = useSpringAt(at, { damping: 13, stiffness: 180 });
  const p = at < 0 ? 1 : sp;
  const right = state === "right";
  return (
    <div style={{ position: "absolute", left: 110, right: 110, top, display: "flex", alignItems: "center", gap: 30, padding: "26px 36px", borderRadius: 44, background: right ? "linear-gradient(135deg,#3ddc97,#22b878)" : "#fff", boxShadow: "0 18px 40px rgba(53,34,14,0.12)", opacity: (state === "wrong" ? 0.35 : 1) * p, transform: `translateX(${(1 - p) * -200}px) scale(${right ? 1.04 : 1})`, fontFamily: q(BALOO), fontWeight: 800, fontSize: 64, color: right ? "#fff" : BROWN }}>
      <span style={{ width: 80, height: 80, borderRadius: 40, background: right ? "#fff" : "rgba(255,122,0,0.15)", color: right ? "#22b878" : ORANGE_T, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 46 }}>{right ? "✓" : letter}</span>{text}
    </div>
  );
};

const Countdown: React.FC<{ from: number; secs: number }> = ({ from, secs }) => {
  const { s } = useT();
  if (s < from || s > from + secs + 0.2) return null;
  const left = Math.max(0, secs - (s - from));
  const n = Math.ceil(left);
  const pulse = 1 + (1 - (left % 1)) * 0.0 + ((left % 1) > 0.8 ? 0.12 : 0);
  return (
    <div style={{ position: "absolute", right: 90, top: 1440, width: 190, height: 190 }}>
      <Svg w={190} h={190} vb="0 0 190 190" html={`<circle cx="95" cy="95" r="82" fill="#fff" stroke="#f1dfc6" stroke-width="14"/><circle cx="95" cy="95" r="82" fill="none" stroke="${ORANGE}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${515 * (left / secs)} 600" transform="rotate(-90 95 95)"/>`} style={{ left: 0, top: 0 }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q(BALOO), fontWeight: 800, fontSize: 96, color: BROWN, transform: `scale(${pulse})` }}>{n}</div>
    </div>
  );
};

export const GuessOutput1: React.FC = () => {
  const { s } = useT();
  const reveal = 6.6;
  const done = s >= reveal + 1.6;
  const st = (i: number) => (!done ? "idle" : i === 1 ? "right" : "wrong");
  return (
    <FunFrame label="GUESS THE OUTPUT · ROUND 1">
      <TopLine text="What does this print? You get 5 seconds." at={-1} accent={["5", "seconds"]} size={78} />
      <CodeWindow at={-1} top={470} lines={["x = 2", "x = x * 3", "print(x + 1)"]} highlight={s < reveal ? undefined : Math.min(2, Math.floor((s - reveal) / 0.55))} highlightAt={reveal} />
      {s >= reveal && s < 9.4 && (
        <div style={{ position: "absolute", right: 120, top: 640 + Math.min(2, Math.floor((s - reveal) / 0.55)) * 92, fontFamily: q(MONO), fontSize: 44, color: YELLOW }}>
          {["x is 2", "x is 6", "6 + 1 = 7"][Math.min(2, Math.floor((s - reveal) / 0.55))]}
        </div>
      )}
      <Option letter="A" text="6" at={0.5} top={1000} state={st(0)} />
      <Option letter="B" text="7" at={0.7} top={1160} state={st(1)} />
      <Option letter="C" text="9" at={0.9} top={1320} state={st(2)} />
      <Countdown from={1.4} secs={5} />
      {!done && <Pip pose="think" x={240} y={1660} size={230} tilt={Math.sin(s * 3) * 6} />}
      {done && <Pip pose="cheer" x={240} y={1660} size={230} bounce={Math.abs(Math.sin(s * 6)) * 26} />}
      <Burst at={reveal + 1.6} x={540} y={1240} />
      {done && <Tag text="Did you get it? Comment A, B or C" at={reveal + 2.0} top={1500} />}
      {[0, 1, 2, 3, 4].map((i) => <Sfx key={i} at={1.4 + i} src="click.wav" volume={0.7} />)}
      <Sfx at={reveal} src="whoosh.wav" volume={0.6} />
      <Sfx at={reveal + 1.6} src="ding.wav" />
    </FunFrame>
  );
};

/* ── 2. Python can make your computer… ──────────────────────────────── */

const Seg: React.FC<{ at: number; out: number; children: React.ReactNode }> = ({ at, out, children }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 14, stiffness: 170 });
  const p = at <= 0 ? 1 : sp;
  if (s < at || s >= out) return null;
  return <div style={{ position: "absolute", inset: 0, opacity: Math.min(1, p * 1.4), transform: `scale(${0.85 + p * 0.15})` }}>{children}</div>;
};

const Big: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: "absolute", left: 60, right: 60, top: 470, textAlign: "center", fontFamily: q(BALOO), fontWeight: 800, fontSize: 130, lineHeight: 1, color: ORANGE }}>{text}</div>
);
const Chip: React.FC<{ code: string; top?: number }> = ({ code, top = 1420 }) => (
  <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center" }}>
    <div style={{ padding: "22px 40px", borderRadius: 30, background: "#2a1d12", fontFamily: q(MONO), fontSize: 44, color: MINT }}>{code}</div>
  </div>
);

const Die: React.FC<{ from: number }> = ({ from }) => {
  const { s } = useT();
  const t = Math.max(0, s - from);
  const settled = t > 1.1;
  const face = settled ? 6 : 1 + (Math.floor(t * 14) % 6);
  const spots: Record<number, [number, number][]> = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] };
  const html = `<rect x="0" y="0" width="420" height="420" rx="80" fill="#fff" stroke="${BROWN}" stroke-width="14"/>` + spots[face].map(([x, y]) => `<circle cx="${90 + x * 120}" cy="${90 + y * 120}" r="38" fill="${BROWN}"/>`).join("");
  return <Svg w={420} h={420} vb="0 0 420 420" html={html} style={{ left: 330, top: 760, transform: `rotate(${settled ? 0 : t * 700}deg) scale(${settled ? 1 : 0.9})` }} />;
};

const Counter: React.FC<{ from: number }> = ({ from }) => {
  const { s } = useT();
  const k = ramp(s, from + 0.2, from + 1.5, 0, 1);
  const n = Math.round(1000000 * k * k);
  return <div style={{ position: "absolute", left: 0, right: 0, top: 860, textAlign: "center", fontFamily: q(MONO), fontWeight: 700, fontSize: 140, color: BROWN }}>{n.toLocaleString("en-US")}</div>;
};

const StarDraw: React.FC<{ from: number }> = ({ from }) => {
  const { s } = useT();
  const k = ramp(s, from + 0.1, from + 1.5, 0, 1);
  const pts = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + i * (4 * Math.PI / 5); return `${250 + Math.cos(a) * 220},${250 + Math.sin(a) * 220}`; }).join(" ");
  const len = 2100;
  return <Svg w={500} h={500} vb="0 0 500 500" html={`<polyline points="${pts}" fill="${k >= 1 ? YELLOW : "none"}" fill-opacity="${k >= 1 ? 0.6 : 0}" stroke="${ORANGE}" stroke-width="16" stroke-linejoin="round" stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - k)}"/>`} style={{ left: 290, top: 720 }} />;
};

const Joke: React.FC<{ from: number }> = ({ from }) => {
  const { s } = useT();
  const a = useSpringAt(from + 0.1), b = useSpringAt(from + 1.0);
  return (
    <>
      <div style={{ position: "absolute", left: 100, right: 100, top: 720, padding: "40px 46px", borderRadius: 50, background: "#fff", fontFamily: q(NUNITO), fontWeight: 800, fontSize: 56, color: BROWN, opacity: a, transform: `scale(${0.8 + a * 0.2})` }}>Why did the computer go to the doctor?</div>
      <div style={{ position: "absolute", left: 160, right: 100, top: 1040, padding: "36px 46px", borderRadius: 50, background: ORANGE, fontFamily: q(NUNITO), fontWeight: 900, fontSize: 60, color: "#fff", opacity: s > from + 1.0 ? b : 0, transform: `scale(${0.8 + b * 0.2})` }}>It had a virus!</div>
    </>
  );
};

export const PythonCan: React.FC = () => {
  const { s } = useT();
  const segs: [number, number][] = [[0, 2.3], [2.3, 4.6], [4.6, 6.9], [6.9, 9.2]];
  return (
    <FunFrame label="THINGS PYTHON CAN DO">
      <TopLine text="Python can make your computer..." at={-1} size={74} />
      <Seg at={0} out={2.3}><Big text="roll a dice" /><Die from={0.1} /><Chip code="random.randint(1, 6)" /></Seg>
      <Seg at={2.3} out={4.6}><Big text="count to a million" /><Counter from={2.3} /><Chip code="for i in range(1000000):" /></Seg>
      <Seg at={4.6} out={6.9}><Big text="draw a star" /><StarDraw from={4.6} /><Chip code="turtle.forward(200)" /></Seg>
      <Seg at={6.9} out={10}><Big text="tell jokes" /><Joke from={6.9} /><Chip code={'print("It had a virus!")'} /></Seg>
      {s < 9.2 && <Pip pose={segs.findIndex(([a, b]) => s >= a && s < b) % 2 ? "jump" : "cheer"} x={900} y={1700} size={200} bounce={Math.abs(Math.sin(s * 5)) * 20} />}
      {s >= 9.2 && <Pip pose="think" x={900} y={1700} size={200} />}
      <Tag text="What should Pip make it do next? Comment it" at={8.4} top={1270} />
      {segs.map(([a], i) => <Sfx key={i} at={a + 0.02} src={i ? "whoosh.wav" : "pop.wav"} volume={0.6} />)}
      <Sfx at={1.2} src="thump.wav" volume={0.7} />
      <Sfx at={3.8} src="ding.wav" volume={0.5} />
      <Sfx at={6.1} src="ding.wav" volume={0.5} />
      <Sfx at={7.9} src="pop.wav" />
    </FunFrame>
  );
};

/* ── 3. POV: your code works on the first try ───────────────────────── */

const Console: React.FC<{ runs: number[] }> = ({ runs }) => {
  const { s } = useT();
  const shown = runs.filter((r) => s >= r).length;
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 925, padding: "28px 46px", borderRadius: 36, background: "#17120d", fontFamily: q(MONO), fontSize: 46, color: MINT, minHeight: 120 }}>
      {Array.from({ length: shown }, (_, i) => <div key={i}>&gt; 1 <span style={{ color: "#fff", background: "#22b878", borderRadius: 10, padding: "0 12px", fontSize: 36 }}>no errors</span></div>)}
      {shown === 0 && <span style={{ color: "#7d6a58" }}>&gt; _</span>}
    </div>
  );
};

export const PovFirstTry: React.FC = () => {
  const { s } = useT();
  const zoom = s >= 1.6 && s < 4.4 ? 1 + ramp(s, 1.6, 4.3, 0, 0.35) : 1;
  const back = ramp(s, 6.8, 8.8, 0, 1);
  return (
    <FunFrame label="POV">
      <TopLine text="POV: your code works on the first try" at={-1} accent={["first", "try"]} size={80} />
      <CodeWindow at={-1} top={470} lines={["score = 0", "score = score + 1", "print(score)"]} highlight={s >= 2.6 && s < 4.4 ? Math.floor((s - 2.6) / 0.6) % 3 : undefined} highlightAt={2.6} />
      <Console runs={[0.6, 4.9, 5.4, 5.9]} />
      {s < 1.6 && <Pip pose="type" x={540} y={1720} size={240} />}
      {s >= 1.6 && s < 4.4 && <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920, transform: `scale(${zoom})`, transformOrigin: "540px 1650px" }}><Pip pose="think" x={540} y={1720} size={240} tilt={Math.sin(s * 2.4) * 10} /></div>}
      {s >= 4.4 && s < 6.6 && <Pip pose="jump" x={540} y={1720} size={240} bounce={Math.abs(Math.sin(s * 9)) * 24} />}
      {s >= 6.6 && <Pip pose="think" x={540 + back * 330} y={1720} size={240 - back * 80} />}
      {s >= 1.6 && s < 4.4 && <Caption text="...that's suspicious." at={1.7} top={1240} size={80} accent={["suspicious"]} />}
      {s >= 4.4 && s < 6.6 && <Caption text="Ran it 3 more times. Still works??" at={4.45} top={1240} size={72} accent={["Still", "works"]} />}
      {s >= 6.6 && <Caption text="Pip does not trust it." at={6.65} top={1240} size={80} accent={["not"]} />}
      <Tag text="Happened to you? Comment YES" at={7.6} top={1370} />
      <Sfx at={0.6} src="ding.wav" volume={0.6} />
      <Sfx at={1.6} src="thump.wav" volume={0.6} />
      <Sfx at={4.9} src="click.wav" /><Sfx at={5.4} src="click.wav" /><Sfx at={5.9} src="click.wav" />
      <Sfx at={6.6} src="whoosh.wav" volume={0.5} />
    </FunFrame>
  );
};

/* ── 4. Speedrun ─────────────────────────────────────────────────────── */

const Timer: React.FC<{ stop: number }> = ({ stop }) => {
  const { s } = useT();
  const t = Math.min(s, stop);
  const done = s >= stop;
  const p = useSpringAt(stop, { damping: 9, stiffness: 220 });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 230, display: "flex", justifyContent: "center", alignItems: "center", gap: 22 }}>
      <div style={{ padding: "10px 36px", borderRadius: 30, background: done ? "linear-gradient(135deg,#3ddc97,#22b878)" : BROWN, fontFamily: q(MONO), fontWeight: 700, fontSize: 84, color: done ? "#fff" : YELLOW, transform: `scale(${done ? 1 + p * 0.12 : 1})` }}>{t.toFixed(2).padStart(5, "0")}</div>
      <div style={{ fontFamily: q(NUNITO), fontWeight: 800, fontSize: 26, color: ORANGE_T, opacity: 0.8 }}>sped up</div>
    </div>
  );
};

export const Speedrun: React.FC = () => {
  const { s } = useT();
  const stop = 9.31;
  return (
    <FunFrame label="SPEEDRUN · MAKE A GAME">
      <Timer stop={stop} />
      {s < 2.2 && (
        <>
          <IdeaInput at={-1} text="a rocket that dodges asteroids" typeAt={0} />
          <BuildButton at={1.0} pressAt={1.85} />
          <Pip pose="type" x={540} y={1400} size={400} />
          <Burst at={1.9} x={540} y={900} />
        </>
      )}
      <GameIn at={2.2} out={4.9} scale={0.82} top={400}>{(t) => <Game t={t + 1} hearts={3} />}</GameIn>
      {s >= 2.2 && s < 4.9 && <Caption text="Game: done." at={2.3} accent={["done"]} top={1580} />}
      {s >= 4.9 && s < 7.0 && (
        <>
          <CodeWindow at={4.9} top={480} lines={["lives = 3", "if hit:", "    lives -= 1"]} highlight={0} highlightAt={5.2} edit={{ line: 0, from: "3", to: "9", at: 5.6 }} />
          <Caption text="Now: change one number." at={5.0} accent={["one"]} top={1100} size={84} />
          <Pip pose="think" x={540} y={1550} size={300} />
        </>
      )}
      <GameIn at={7.0} out={10.5} scale={0.82} top={400}>{(t) => <Game t={t + 0.2} hearts={9} hitAt={1.2} />}</GameIn>
      {s >= 7.0 && s < stop && <Caption text="9 lives. Ha." at={7.1} accent={["9"]} top={1580} />}
      {s >= stop && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1000, textAlign: "center", fontFamily: q(BALOO), fontWeight: 800, fontSize: 150, color: "#22b878", textShadow: "0 8px 0 rgba(0,0,0,0.15)", transform: `rotate(-6deg) scale(${Math.min(1, 0.5 + (s - stop) * 3)})` }}>NEW RECORD</div>
          <Tag text="Can you beat 9.31? Comment your idea" at={stop + 0.15} top={1580} />
        </>
      )}
      <Clicks at={0} n={10} every={0.09} />
      <Sfx at={1.85} src="pop.wav" />
      <Sfx at={2.2} src="whoosh.wav" />
      <Sfx at={5.6} src="click.wav" />
      <Sfx at={7.0} src="whoosh.wav" volume={0.6} />
      <Sfx at={8.0} src="crash.wav" volume={0.4} />
      <Sfx at={stop} src="ding.wav" />
    </FunFrame>
  );
};
