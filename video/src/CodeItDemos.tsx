import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { Backdrop, BROWN, CodeWindow, Footer, MINT, MONO, NUNITO, ORANGE, ORANGE_T, Pip, Svg, Tag, TopLine, YELLOW } from "./pip-kit";
import { BuildButton, Burst, Clicks, IdeaInput } from "./PipSeries";
import { Adam, Mom } from "./AdamStory";
import { Fonts, Sfx, Words, ramp, useSpringAt, useT } from "./kit";

/*
 * CodeIt, round 2: no rocket. One reel for parents (a sentence becomes a game, then one number
 * changes it) and one for kids (a comment-your-answer quiz where the wrong answer is the funny one).
 */

const q = (f: string) => `'${f}'`;

/* ── The cat game: fish fall, the cat runs to catch each one ────────── */

const PW = 940, PH = 880, CATCH = 700;
const fishX = (i: number) => 110 + (((i * 7919) % 720) + 720) % 720;

const CAT = `
  <path d="M60 -40 Q130 -60 120 -150" stroke="#e8701a" stroke-width="22" fill="none" stroke-linecap="round"/>
  <ellipse cx="0" cy="-55" rx="72" ry="58" fill="#ff9a3c"/>
  <ellipse cx="0" cy="-40" rx="40" ry="30" fill="#ffd6a8"/>
  <path d="M-52 -170 L-60 -232 L-12 -196 Z M52 -170 L60 -232 L12 -196 Z" fill="#ff9a3c"/>
  <path d="M-46 -184 L-50 -218 L-24 -198 Z M46 -184 L50 -218 L24 -198 Z" fill="#ffb8b8"/>
  <circle cx="0" cy="-150" r="62" fill="#ff9a3c"/>
  <circle cx="-22" cy="-160" r="11" fill="${BROWN}"/><circle cx="22" cy="-160" r="11" fill="${BROWN}"/>
  <circle cx="-18" cy="-164" r="4" fill="#fff"/><circle cx="26" cy="-164" r="4" fill="#fff"/>
  <path d="M-8 -138 L8 -138 L0 -128 Z" fill="#ff6b8a"/>
  <path d="M-14 -122 Q-7 -114 0 -124 Q7 -114 14 -122" stroke="${BROWN}" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M-30 -132 L-70 -140 M-30 -126 L-70 -122 M30 -132 L70 -140 M30 -126 L70 -122" stroke="${BROWN}" stroke-width="3" stroke-linecap="round" opacity="0.6"/>`;
const FISH = `<path d="M30 0 L56 -20 L56 20 Z" fill="#2a9fd0"/><ellipse cx="0" cy="0" rx="40" ry="22" fill="#3db3e0"/><circle cx="-20" cy="-5" r="5" fill="${BROWN}"/>`;
const heart = (x: number, on: boolean) => `<path transform="translate(${x} 0) scale(1.6)" d="M0 6 C-12 -6 -6 -16 0 -9 C6 -16 12 -6 0 6 Z" fill="${on ? "#ff5a6e" : "#e8d8c8"}"/>`;

const CatGame: React.FC<{ t: number; v: number; every: number; base?: number }> = ({ t, v, every, base = 0 }) => {
  const fall = (CATCH + 60) / v;
  const n = Math.ceil((t + fall) / every) + 4;
  const fish: React.ReactNode[] = [];
  const lands: number[] = [];
  for (let i = -4; i < n; i++) {
    const spawn = i * every;
    const land = spawn + fall;
    lands.push(land);
    if (t >= spawn && t < land) {
      const y = -60 + (t - spawn) * v;
      fish.push(<Svg key={i} w={10} h={10} vb="0 0 10 10" html={FISH} style={{ left: fishX(i), top: y, transform: `rotate(${Math.sin(t * 8 + i) * 12}deg)` }} />);
    }
  }
  const caught = lands.filter((l) => l >= 0 && l <= t).length + base;
  const k = lands.findIndex((l) => l > t);
  const prev = Math.max(0, k - 1);
  const a = lands[prev], b = lands[k];
  const u = Math.min(1, Math.max(0, (t - a) / Math.max(0.01, b - a)));
  const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  const cx = fishX(prev - 4) + (fishX(k - 4) - fishX(prev - 4)) * ease;
  const since = t - a;
  const plus = since >= 0 && since < 0.45;
  return (
    <div style={{ position: "relative", width: PW, height: PH, borderRadius: 54, overflow: "hidden", background: "linear-gradient(180deg,#bfe9ff,#eaf8ff)", boxShadow: "0 40px 90px rgba(53,34,14,0.25)", border: "10px solid #fff" }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 110, background: "#7ed6a0" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 96, height: 24, borderRadius: 12, background: "#5fc487" }} />
      {fish}
      <Svg w={10} h={10} vb="0 0 10 10" html={CAT} style={{ left: cx, top: CATCH + 100, transform: `rotate(${Math.sin(t * 14) * 4}deg)` }} />
      {plus && <div style={{ position: "absolute", left: cx - 40, top: CATCH - 150 - since * 160, fontFamily: q(NUNITO), fontWeight: 900, fontSize: 56, color: ORANGE, opacity: 1 - since * 2 }}>+1</div>}
      <div style={{ position: "absolute", left: 36, top: 30, padding: "10px 26px", borderRadius: 30, background: "rgba(255,255,255,0.85)", fontFamily: q(MONO), fontWeight: 700, fontSize: 40, color: BROWN }}>SCORE {caught}</div>
      <Svg w={10} h={10} vb="0 0 10 10" html={[0, 1, 2].map((i) => heart(i * 52, true)).join("")} style={{ left: PW - 190, top: 66 }} />
    </div>
  );
};

const Panel: React.FC<{ at: number; out: number; children: (t: number) => React.ReactNode }> = ({ at, out, children }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 15, stiffness: 140 });
  const p = at <= 0 ? 1 : sp;
  if (s < at || s > out + 0.25) return null;
  const leave = ramp(s, out, out + 0.25);
  return <div style={{ position: "absolute", left: 70, top: 540, opacity: Math.min(1, p * 1.4) * (1 - leave), transform: `scale(${(0.85 + p * 0.15) * (1 - leave * 0.1)})`, transformOrigin: "50% 0" }}>{children(s - Math.max(0, at))}</div>;
};

const Chip: React.FC<{ text: string; at: number; top: number; color?: string }> = ({ text, at, top, color = ORANGE_T }) => {
  const p = useSpringAt(at, { damping: 12, stiffness: 200 });
  const { s } = useT();
  if (s < at) return null;
  return <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center", opacity: p, transform: `scale(${0.8 + 0.2 * p})` }}><div style={{ padding: "14px 34px", borderRadius: 40, background: "rgba(255,255,255,0.9)", fontFamily: q(MONO), fontWeight: 700, fontSize: 38, color }}>{text}</div></div>;
};

const CAT_CODE = ["fish_speed = 3", "lives = 3", "if caught:", "    score += 1"];

export const OneSentence: React.FC = () => {
  const { s } = useT();
  return (
    <AbsoluteFill>
      <Fonts />
      <Backdrop />
      {/* 0: open on the payoff */}
      <Panel at={0} out={2.3}>{(t) => <CatGame t={t + 3} v={300} every={0.85} base={6} />}</Panel>
      <TopLine text="This game didn't exist 20 seconds ago." at={0.05} out={2.3} accent={["20", "seconds"]} size={80} />
      {/* 2.5: the sentence */}
      {s >= 2.5 && s < 5.4 && (
        <>
          <TopLine text="A kid typed one sentence." at={2.5} accent={["one", "sentence."]} size={84} />
          <IdeaInput at={2.5} text="a cat that catches falling fish" typeAt={2.7} />
          <BuildButton at={4.4} pressAt={5.0} />
          <Burst at={5.05} x={540} y={900} />
        </>
      )}
      <Panel at={5.3} out={7.8}>{(t) => <CatGame t={t + 0.6} v={300} every={0.85} />}</Panel>
      {s >= 5.3 && s < 7.8 && <TopLine text="And got a game he can play." at={5.35} accent={["play."]} size={84} />}
      {/* 7.9: one number */}
      {s >= 7.9 && s < 10.6 && (
        <>
          <TopLine text="Then he changed one number." at={7.9} accent={["one", "number."]} size={84} />
          <CodeWindow at={7.9} lines={CAT_CODE} file="cat_game.py" top={560} highlight={0} highlightAt={8.4} edit={{ line: 0, from: "3", to: "9", at: 8.9 }} />
        </>
      )}
      <Panel at={10.6} out={12.7}>{(t) => <CatGame t={t + 0.3} v={950} every={0.38} base={9} />}</Panel>
      {s >= 10.6 && s < 12.7 && <TopLine text="Now he knows why it got harder." at={10.65} accent={["why"]} size={80} />}
      {/* 12.8: the parent line */}
      {s >= 12.8 && (
        <>
          <div style={{ position: "absolute", left: 60, right: 60, top: 260, textAlign: "center" }}>
            <Words text="He didn't just play a game tonight." at={12.8} size={78} color={BROWN} font="Baloo 2" weight={700} align="center" />
            <Words text="He built one." at={13.6} size={130} color={ORANGE} font="Baloo 2" weight={700} align="center" lineHeight={1.15} />
          </div>
          <Adam x={360} y={1400} size={1.45} pose="wow" bob={Math.abs(Math.sin(s * 5)) * 16} />
          <Mom x={720} y={1400} size={1.25} pose="smile" />
          <Tag text="Free to start · codeitlearn.com" at={14.3} top={1440} />
        </>
      )}
      <Footer />
      <Audio src={staticFile("sfx/codeit-bed.mp3")} volume={0.3} />
      <Clicks at={2.7} n={16} every={0.12} />
      <Sfx at={4.4} src="pop.wav" />
      <Sfx at={5.05} src="whoosh.wav" />
      <Sfx at={5.4} src="ding.wav" volume={0.5} />
      <Sfx at={7.9} src="whoosh.wav" volume={0.6} />
      <Sfx at={8.9} src="click.wav" volume={0.7} />
      <Sfx at={10.6} src="whoosh.wav" volume={0.6} />
      <Sfx at={13.6} src="ding.wav" volume={0.6} />
    </AbsoluteFill>
  );
};

/* ── The jump quiz: A, B or C? ──────────────────────────────────────── */

const OPTS = [
  { k: "A", code: "jump = 5" },
  { k: "B", code: "jump = 50" },
  { k: "C", code: "jump = -50" },
];

const QuizCard: React.FC<{ i: number; at: number; out: number }> = ({ i, at, out }) => {
  const { s } = useT();
  const p = useSpringAt(at + i * 0.15, { damping: 13, stiffness: 190 });
  if (s > out + 0.3) return null;
  const leave = ramp(s, out, out + 0.3);
  const o = OPTS[i];
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: 600 + i * 190, height: 160, borderRadius: 44, background: "#fff", boxShadow: "0 20px 50px rgba(53,34,14,0.14)", display: "flex", alignItems: "center", gap: 40, padding: "0 40px", opacity: p * (1 - leave), transform: `translateX(${(1 - p) * 300 + leave * -400}px)` }}>
      <div style={{ width: 96, height: 96, borderRadius: 48, background: [ORANGE, YELLOW, MINT][i], display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q(NUNITO), fontWeight: 900, fontSize: 56, color: i === 0 ? "#fff" : BROWN }}>{o.k}</div>
      <div style={{ fontFamily: q(MONO), fontWeight: 700, fontSize: 64, color: BROWN }}>{o.code}</div>
    </div>
  );
};

const Count: React.FC<{ from: number }> = ({ from }) => {
  const { s } = useT();
  const d = s - from;
  if (d < 0 || d >= 3) return null;
  const n = 3 - Math.floor(d);
  const f = d % 1;
  return <div style={{ position: "absolute", left: 0, right: 0, top: 1170, textAlign: "center", fontFamily: q(NUNITO), fontWeight: 900, fontSize: 150, color: ORANGE, transform: `scale(${1.3 - f * 0.3})`, opacity: 1 - f * 0.5 }}>{n}</div>;
};

/** How high Pip is off the ground at second s (negative = under it). */
const pipLift = (s: number) => {
  const hop = (a: number, len: number, h: number) => (s >= a && s < a + len ? Math.sin(((s - a) / len) * Math.PI) * h : 0);
  if (s < 5.9) return hop(4.3, 0.55, 110) + hop(5.0, 0.55, 110);
  if (s < 8.0) return hop(6.1, 1.5, 1900);
  if (s < 9.9) return -ramp(s, 8.25, 8.9, 0, 680);
  return -680 + ramp(s, 9.9, 10.35, 0, 680);
};

export const JumpQuiz: React.FC = () => {
  const { s } = useT();
  const reveal = s >= 4.0;
  const lift = pipLift(s);
  return (
    <AbsoluteFill>
      <Fonts />
      <Backdrop />
      <TopLine text="Which one makes Pip jump the highest?" at={0.05} out={3.9} accent={["highest?"]} size={80} />
      {[0, 1, 2].map((i) => <QuizCard key={i} i={i} at={0.3} out={3.8} />)}
      <Count from={1.0} />
      {!reveal && <Tag text="Comment A, B or C" at={1.0} top={1360} />}
      {reveal && (
        <>
          <Pip pose={s >= 9.9 ? "cheer" : "jump"} x={540} y={1020} size={330} bounce={lift} />
          {/* the ground is drawn over Pip, so C can sink into it */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 1290, bottom: 0, background: "#7ed6a0" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 1270, height: 40, borderRadius: 20, background: "#5fc487" }} />
          {s < 5.9 && <><Chip text="A · jump = 5" at={4.0} top={560} /><TopLine text="A tiny hop." at={4.1} size={84} accent={["tiny"]} /></>}
          {s >= 5.9 && s < 8.0 && <><Chip text="B · jump = 50" at={5.9} top={560} /><TopLine text="WHOA. Where's the ceiling?" at={6.2} size={84} accent={["WHOA."]} /></>}
          {s >= 8.0 && s < 9.9 && <><Chip text="C · jump = -50" at={8.0} top={560} /><TopLine text="Wait. Where did Pip go?" at={8.4} size={84} accent={["Where"]} /></>}
          {s >= 9.9 && (
            <>
              <TopLine text="Answer: B. Minus means down!" at={10.0} size={84} accent={["B.", "down!"]} />
              <Tag text="Make Pip jump yourself · free" at={10.6} top={1360} />
            </>
          )}
        </>
      )}
      <Footer />
      <Audio src={staticFile("sfx/codeit-bed.mp3")} volume={0.3} />
      {[1.0, 2.0, 3.0].map((a) => <Sfx key={a} at={a} src="click.wav" volume={0.8} />)}
      <Sfx at={4.0} src="whoosh.wav" volume={0.6} />
      <Sfx at={4.3} src="pop.wav" volume={0.5} />
      <Sfx at={5.0} src="pop.wav" volume={0.5} />
      <Sfx at={6.1} src="whoosh.wav" />
      <Sfx at={7.55} src="thump.wav" />
      <Sfx at={8.25} src="crash.wav" volume={0.5} />
      <Sfx at={9.9} src="pop.wav" />
      <Sfx at={10.0} src="ding.wav" volume={0.6} />
    </AbsoluteFill>
  );
};
