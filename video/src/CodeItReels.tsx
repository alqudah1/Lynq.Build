import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * Two CodeIt reels for the week of 16 Nov 2026, drawn here like the LYNQ ones: no faces, no AI
 * footage. Cream, yellow, coral and ink only. Baloo 2, Nunito, JetBrains Mono. Silent first.
 *  - CodeItQuiz:    "What does this print?" for kids (voice: Sheldon).
 *  - CodeItLessons: "31 Python lessons. Zero downloads." for parents (voice: VALF).
 * The lesson screen is an illustration, labelled as one; the real facts used are the ones already
 * on CodeIt's posts: 31 Python lessons, in the browser, nothing to install, free to start.
 */
const CREAM = "#fff4e5", INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340";
const B = "'Baloo 2'", N = "'Nunito'", M = "'JetBrains Mono'";

const Head: React.FC<{ a: string; b?: string; at: number; out: number; size?: number }> = ({ a, b, at, out, size = 96 }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 13, stiffness: 170 });
  if (s < at || s > out + 0.3) return null;
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top: 250, textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: size, lineHeight: 1.0, letterSpacing: -2, color: INK, opacity: Math.min(1, p * 1.5) * (1 - ramp(s, out, out + 0.3)), transform: `translateY(${(1 - p) * 30}px) scale(${0.92 + p * 0.08})` }}>
      <div>{a}</div>
      {b ? <div style={{ color: CORAL }}>{b}</div> : null}
    </div>
  );
};

const Logo: React.FC = () => (
  <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: 44, letterSpacing: 1, color: CORAL }}>CodeIt</div>
);

const End: React.FC<{ at: number; a: string; b: string }> = ({ at, a, b }) => {
  const { s } = useT();
  const p = useSpringAt(at + 0.1, { damping: 13, stiffness: 160 });
  const o = ramp(s, at, at + 0.4);
  return (
    <AbsoluteFill style={{ background: CREAM, opacity: o, alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", padding: "0 80px", transform: `scale(${0.9 + p * 0.1})` }}>
        <div style={{ fontFamily: B, fontWeight: 800, fontSize: 112, lineHeight: 1.0, letterSpacing: -3, color: INK }}>{a}</div>
        <div style={{ fontFamily: B, fontWeight: 800, fontSize: 112, lineHeight: 1.0, letterSpacing: -3, color: CORAL, marginTop: 16 }}>{b}</div>
        <div style={{ display: "inline-block", marginTop: 70, padding: "26px 54px", borderRadius: 70, background: YELLOW, border: `6px solid ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 50, color: INK }}>Free to start</div>
        <div style={{ marginTop: 26, fontFamily: N, fontWeight: 800, fontSize: 46, color: INK }}>codeitlearn.com</div>
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ quiz */
const CODE = ["score = 0", "score = score + 1", "score = score + 1", "print(score)"];
const STEP = [5.6, 6.6, 7.6, 8.7]; // when each line runs
const VAL = ["put 0 in the box", "add 1", "add 1 more", "show the box"];
const BOX = [0, 1, 2, 2];
export const QUIZ_DUR = 15;

export const CodeItQuiz: React.FC = () => {
  const { s } = useT();
  const cur = STEP.filter((t) => s >= t).length - 1; // line that is running
  const answer = s >= 10.0;
  const card = useSpringAt(0.3, { damping: 14, stiffness: 150 });
  const count = s >= 3.0 && s < 5.4 ? 3 - Math.floor((s - 3.0) / 0.8) : 0;
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      <div style={{ position: "absolute", left: -200, top: -200, width: 700, height: 700, borderRadius: 350, background: "rgba(254,211,64,0.35)" }} />
      <div style={{ position: "absolute", right: -260, bottom: -220, width: 800, height: 800, borderRadius: 400, background: "rgba(240,86,45,0.14)" }} />
      <Logo />
      <Head a="Don't run it." b="Guess." at={0.1} out={5.2} size={110} />
      <Head a="Now watch" b="the box." at={5.5} out={9.7} />
      <Head a="It prints" b="2." at={10.0} out={12.2} size={120} />

      {/* the code */}
      <div style={{ position: "absolute", left: 90, top: 560, width: 900, borderRadius: 44, background: INK, boxShadow: `0 18px 0 rgba(22,22,29,0.18)`, padding: "30px 0 44px", transform: `scale(${0.9 + card * 0.1})`, opacity: Math.min(1, card * 1.5) }}>
        <div style={{ display: "flex", gap: 14, padding: "0 40px 26px" }}>{[CORAL, YELLOW, "#62d26f"].map((c) => <div key={c} style={{ width: 22, height: 22, borderRadius: 11, background: c }} />)}<span style={{ marginLeft: 16, fontFamily: M, fontSize: 26, color: "rgba(255,255,255,0.5)" }}>quiz.py</span></div>
        {CODE.map((l, i) => {
          const typed = Math.round(ramp(s, 0.5 + i * 0.4, 0.9 + i * 0.4) * l.length);
          const on = cur === i && s < 10.0;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", height: 92, padding: "0 40px", background: on ? "rgba(254,211,64,0.18)" : "transparent", borderLeft: `10px solid ${on ? YELLOW : "transparent"}` }}>
              <span style={{ width: 54, fontFamily: M, fontSize: 30, color: "rgba(255,255,255,0.3)" }}>{i + 1}</span>
              <span style={{ fontFamily: M, fontWeight: 600, fontSize: 48, color: i === 3 ? YELLOW : "#8fe39a" }}>{l.slice(0, typed)}</span>
              {on ? <span style={{ marginLeft: "auto", padding: "8px 22px", borderRadius: 30, background: YELLOW, fontFamily: N, fontWeight: 900, fontSize: 32, color: INK }}>{VAL[i]}</span> : null}
            </div>
          );
        })}
      </div>

      {/* the three answers */}
      <div style={{ position: "absolute", left: 90, top: 1130, width: 900, display: "flex", gap: 30 }}>
        {["0", "1", "2"].map((o, i) => {
          const at = 2.4 + i * 0.22;
          // eslint-disable-next-line react-hooks/rules-of-hooks
          const p = useSpringAt(at, { damping: 11, stiffness: 190 });
          const right = answer && o === "2", wrong = answer && o !== "2";
          return (
            <div key={o} style={{ flex: 1, height: 220, borderRadius: 44, background: right ? CORAL : "#fff", border: `7px solid ${INK}`, boxShadow: `0 12px 0 ${INK}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: B, fontWeight: 800, fontSize: 130, color: right ? "#fff" : INK, opacity: s < at ? 0 : wrong ? 0.3 : 1, transform: `scale(${(0.6 + p * 0.4) * (right ? 1 + 0.08 * Math.max(0, Math.sin((s - 10) * 7)) * Math.max(0, 1 - (s - 10) / 1.2) : 1)})` }}>{o}</div>
          );
        })}
      </div>

      {/* the variable, drawn as a box that holds a number */}
      {cur >= 0 && s < 12.3 ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 1420, display: "flex", justifyContent: "center", alignItems: "center", gap: 40 }}>
          <div style={{ position: "relative", width: 250, height: 250, borderRadius: 50, background: "#fff", border: `8px solid ${INK}`, boxShadow: `0 14px 0 ${INK}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: B, fontWeight: 800, fontSize: 170, color: cur === 3 ? CORAL : INK, transform: `scale(${1 + 0.16 * Math.max(0, 1 - (s - STEP[cur]) / 0.25)})` }}>
            {BOX[cur]}
            <div style={{ position: "absolute", left: 34, top: -34, padding: "4px 24px", borderRadius: 24, background: CORAL, fontFamily: M, fontWeight: 600, fontSize: 34, color: "#fff" }}>score</div>
          </div>
          {cur === 3 ? <div style={{ fontFamily: B, fontWeight: 800, fontSize: 90, color: INK }}>→ <span style={{ color: CORAL }}>2</span></div> : null}
        </div>
      ) : null}

      {/* 3, 2, 1 */}
      {count > 0 ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 1450, textAlign: "center" }}>
          <div style={{ display: "inline-flex", width: 170, height: 170, borderRadius: 85, background: YELLOW, border: `7px solid ${INK}`, alignItems: "center", justifyContent: "center", fontFamily: B, fontWeight: 800, fontSize: 110, color: INK, transform: `scale(${1 + 0.25 * (1 - (((s - 3.0) % 0.8) / 0.8))})` }}>{count}</div>
          <div style={{ marginTop: 18, fontFamily: N, fontWeight: 800, fontSize: 40, color: INK }}>Pick one in your head</div>
        </div>
      ) : null}
      {answer && s < 12.4 ? ["✦", "✦", "✦", "✦", "✦"].map((st, i) => {
        const t = s - 10.0, a = (i / 5) * Math.PI * 2 + 0.4;
        return <div key={i} style={{ position: "absolute", left: 830 + Math.cos(a) * 200 * Math.min(1, t * 2), top: 1220 + Math.sin(a) * 200 * Math.min(1, t * 2), fontSize: 70, color: i % 2 ? YELLOW : CORAL, opacity: Math.max(0, 1 - t / 1.6), transform: `rotate(${t * 120}deg)` }}>{st}</div>;
      }) : null}

      <End at={12.3} a="That box is a variable." b="You just read Python." />

      {CODE.map((_, i) => <Sfx key={i} at={0.5 + i * 0.4} src="click.wav" volume={0.3} />)}
      {[0, 1, 2].map((i) => <Sfx key={`o${i}`} at={2.4 + i * 0.22} src="pop.wav" volume={0.5} />)}
      {[3.0, 3.8, 4.6].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.5} />)}
      {STEP.map((t) => <Sfx key={`s${t}`} at={t} src="pop.wav" volume={0.45} />)}
      <Sfx at={10.0} src="ding.wav" volume={0.7} />
      <Sfx at={12.3} src="whoosh.wav" volume={0.4} />
    </AbsoluteFill>
  );
};

/* --------------------------------------------------------------- lessons */
export const LESSONS_DUR = 16.5;
const LINE = 'print("Hello!")';

export const CodeItLessons: React.FC = () => {
  const { s } = useT();
  const win = useSpringAt(2.7, { damping: 14, stiffness: 150 });
  const typed = Math.round(ramp(s, 3.4, 4.8) * LINE.length);
  const ran = s >= 5.6;
  const out = useSpringAt(5.75, { damping: 11, stiffness: 190 });
  const press = s >= 5.5 && s < 5.75 ? 0.94 : 1;
  const scene2 = 1 - ramp(s, 7.2, 7.7);          // lesson window leaves
  const path = ramp(s, 7.5, 8.0);                 // the 31 steps arrive
  const filled = Math.floor(ramp(s, 8.2, 11.6, 1, 31, (x) => x));
  const heroOut = ramp(s, 2.4, 2.9);
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      <div style={{ position: "absolute", left: -220, top: -220, width: 720, height: 720, borderRadius: 360, background: "rgba(254,211,64,0.32)" }} />
      <div style={{ position: "absolute", right: -260, bottom: -240, width: 820, height: 820, borderRadius: 410, background: "rgba(240,86,45,0.13)" }} />
      <Logo />
      <Head a="No app. No download." b="Just a tab." at={0.1} out={2.4} size={88} />
      <Head a="Lesson 1:" b="make it say hello." at={2.8} out={5.3} />
      <Head a="Press Run." b="It talks back." at={5.6} out={7.2} />
      <Head a="31 lessons." b="Each one a small step." at={7.7} out={11.6} size={88} />
      <Head a="Real Python." b="Kid-sized steps." at={11.9} out={13.6} />

      {/* opening picture: the 3D art already used on the feed */}
      <div style={{ position: "absolute", left: 90, top: 640, width: 900, height: 900, borderRadius: 60, overflow: "hidden", border: `7px solid ${INK}`, boxShadow: `0 16px 0 ${INK}`, opacity: 1 - heroOut, transform: `scale(${1 + s * 0.012 - heroOut * 0.1})` }}>
        <Img src={staticFile("c3d/snake.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 70%" }} />
      </div>

      {/* a lesson, drawn */}
      <div style={{ position: "absolute", left: 70, top: 600, width: 940, height: 960, borderRadius: 50, background: "#fff", border: `7px solid ${INK}`, boxShadow: `0 16px 0 ${INK}`, overflow: "hidden", opacity: Math.min(1, win * 1.4) * scene2, transform: `translateY(${(1 - win) * 80 - (1 - scene2) * 120}px)` }}>
        <div style={{ height: 96, background: YELLOW, borderBottom: `6px solid ${INK}`, display: "flex", alignItems: "center", padding: "0 34px", gap: 14 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ width: 24, height: 24, borderRadius: 12, background: INK, opacity: 0.25 }} />)}
          <div style={{ marginLeft: 18, flex: 1, height: 56, borderRadius: 28, background: "#fff", border: `4px solid ${INK}`, display: "flex", alignItems: "center", padding: "0 26px", fontFamily: N, fontWeight: 800, fontSize: 30, color: INK }}>codeitlearn.com</div>
        </div>
        <div style={{ padding: "40px 44px" }}>
          <div style={{ display: "inline-block", padding: "8px 26px", borderRadius: 30, background: CORAL, fontFamily: N, fontWeight: 900, fontSize: 30, letterSpacing: 2, color: "#fff" }}>LESSON 1 OF 31</div>
          <div style={{ marginTop: 22, fontFamily: B, fontWeight: 800, fontSize: 64, lineHeight: 1.05, color: INK }}>Make the computer say hello</div>
          <div style={{ marginTop: 30, borderRadius: 30, background: INK, padding: "34px 36px", minHeight: 150 }}>
            <span style={{ fontFamily: M, fontWeight: 600, fontSize: 54, color: "#8fe39a" }}>{LINE.slice(0, typed)}</span>
            {s >= 3.2 && s < 5.4 && Math.floor(s * 2.5) % 2 === 0 ? <span style={{ fontFamily: M, fontSize: 54, color: YELLOW }}>▌</span> : null}
          </div>
          <div style={{ marginTop: 30, display: "flex", alignItems: "center", gap: 30 }}>
            <div style={{ padding: "20px 60px", borderRadius: 40, background: YELLOW, border: `6px solid ${INK}`, boxShadow: `0 ${press < 1 ? 2 : 8}px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 50, color: INK, transform: `scale(${press}) translateY(${press < 1 ? 6 : 0}px)` }}>▶ Run</div>
            {ran ? <div style={{ fontFamily: B, fontWeight: 800, fontSize: 66, color: CORAL, transform: `scale(${0.5 + out * 0.5})`, transformOrigin: "left center", opacity: Math.min(1, out * 1.5) }}>Hello! ✦</div> : null}
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 26, textAlign: "center", fontFamily: N, fontWeight: 800, fontSize: 24, letterSpacing: 3, color: "rgba(22,22,29,0.4)" }}>ILLUSTRATION OF A LESSON</div>
      </div>

      {/* 31 steps */}
      <div style={{ position: "absolute", left: 90, top: 660, width: 900, opacity: path * (1 - ramp(s, 13.5, 13.9)) }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 22 }}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => {
            const on = n <= filled, now = n === filled;
            return <div key={n} style={{ height: 124, borderRadius: 30, background: on ? (now ? CORAL : YELLOW) : "#fff", border: `6px solid ${INK}`, boxShadow: on ? `0 8px 0 ${INK}` : "none", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: B, fontWeight: 800, fontSize: 56, color: now ? "#fff" : INK, opacity: on ? 1 : 0.35, transform: `translateY(${now ? -10 : 0}px)` }}>{n}</div>;
          })}
        </div>
        <div style={{ marginTop: 40, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 50, color: INK }}>Lesson {filled} of 31</div>
      </div>

      <End at={13.7} a="31 lessons." b="One step at a time." />

      <Sfx at={2.7} src="whoosh.wav" volume={0.35} />
      {[3.4, 3.7, 4.0, 4.3, 4.6].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.3} />)}
      <Sfx at={5.5} src="click.wav" volume={0.6} />
      <Sfx at={5.75} src="ding.wav" volume={0.6} />
      <Sfx at={7.5} src="whoosh.wav" volume={0.35} />
      {[8.2, 8.9, 9.6, 10.3, 11.0].map((t) => <Sfx key={`p${t}`} at={t} src="pop.wav" volume={0.35} />)}
      <Sfx at={11.6} src="ding.wav" volume={0.55} />
      <Sfx at={13.7} src="whoosh.wav" volume={0.4} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ toys */
/*
 * "Screen time you'll brag about": the approved 3D toy pictures from the feed, one idea each,
 * using the same lines the posts already carry. For parents (voice: VALF).
 */
export const TOYS_DUR = 17;
const TOYS: { img: string; a: string; b: string; at: number; blob: string }[] = [
  { img: "trophy", a: "Screen time", b: "you'll brag about.", at: 0, blob: "rgba(254,211,64,0.42)" },
  { img: "controller", a: "They don't just play it.", b: "They build it.", at: 2.8, blob: "rgba(240,86,45,0.20)" },
  { img: "dial", a: "Change one number.", b: "See what breaks.", at: 5.6, blob: "rgba(254,211,64,0.42)" },
  { img: "ladybug", a: "Find the bug.", b: "Fix it themselves.", at: 8.4, blob: "rgba(240,86,45,0.20)" },
  { img: "dinner", a: "“5 more minutes.”", b: "The good kind.", at: 11.2, blob: "rgba(254,211,64,0.42)" },
];
const TOYS_END = 14.0;

const Toy: React.FC<{ t: (typeof TOYS)[number]; next: number; i: number }> = ({ t, next, i }) => {
  const { s } = useT();
  const p = useSpringAt(t.at + 0.05, { damping: 12, stiffness: 150 });
  const txt = useSpringAt(t.at + 0.3, { damping: 13, stiffness: 170 });
  if (s < t.at || s > next + 0.35) return null;
  const out = ramp(s, next, next + 0.35);
  const dir = i % 2 ? 1 : -1;
  return (
    <>
      <div style={{ position: "absolute", left: 60, right: 60, top: 240, textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: t.a.length > 20 ? 78 : 96, lineHeight: 1.02, letterSpacing: -2, color: INK, opacity: Math.min(1, txt * 1.5) * (1 - out), transform: `translateY(${(1 - txt) * 30}px)` }}>
        <div>{t.a}</div>
        <div style={{ color: CORAL }}>{t.b}</div>
      </div>
      <div style={{ position: "absolute", left: 90, top: 640, width: 900, height: 900, borderRadius: 70, overflow: "hidden", border: `8px solid ${INK}`, boxShadow: `0 18px 0 ${INK}`, opacity: Math.min(1, p * 1.6) * (1 - out), transform: `translateX(${(1 - p) * 500 * dir - out * 500 * dir}px) rotate(${(1 - p) * 10 * dir - out * 8 * dir}deg) scale(${0.86 + p * 0.14})` }}>
        <Img src={staticFile(`c3d/${t.img}.jpg`)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.04 + (s - t.at) * 0.022})` }} />
      </div>
    </>
  );
};

export const CodeItToys: React.FC = () => {
  const { s } = useT();
  const cur = TOYS.filter((t) => s >= t.at).length - 1;
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      <div style={{ position: "absolute", left: -220, top: -220, width: 760, height: 760, borderRadius: 380, background: TOYS[Math.max(0, cur)].blob }} />
      <div style={{ position: "absolute", right: -280, bottom: -260, width: 860, height: 860, borderRadius: 430, background: TOYS[Math.max(0, cur)].blob, opacity: 0.7 }} />
      <Logo />
      {TOYS.map((t, i) => <Toy key={t.img} t={t} i={i} next={i + 1 < TOYS.length ? TOYS[i + 1].at : TOYS_END} />)}
      {/* progress dots */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 1620, display: "flex", justifyContent: "center", gap: 18, opacity: 1 - ramp(s, TOYS_END - 0.2, TOYS_END) }}>
        {TOYS.map((t, i) => <div key={t.img} style={{ width: i === cur ? 54 : 20, height: 20, borderRadius: 10, background: i === cur ? CORAL : "rgba(22,22,29,0.2)" }} />)}
      </div>
      <End at={TOYS_END} a="Real Python." b="Built for kids." />
      {TOYS.map((t) => <Sfx key={t.img} at={t.at + 0.05} src={t.at === 0 ? "pop.wav" : "whoosh.wav"} volume={0.4} />)}
      {TOYS.map((t) => <Sfx key={`p${t.img}`} at={t.at + 0.35} src="pop.wav" volume={0.45} />)}
      <Sfx at={TOYS_END} src="ding.wav" volume={0.6} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- dinner */
/*
 * "He skipped dinner. I wasn't even mad." A parent's text thread, told in messages: they go to
 * take the tablet away and find the kid fixing his own game. Made-up story, labelled on screen.
 * For parents (voice: VALF). The narrator is a made-up parent, never the founder.
 */
export const DINNER_DUR = 17.5;
type Txt = { at: number; me?: boolean; text?: string; shot?: boolean };
const THREAD: Txt[] = [
  { at: 0.7, text: "Dinner's ready. Where is he?" },
  { at: 1.7, me: true, text: "Still on the tablet." },
  { at: 2.9, text: "AGAIN? Take it away." },
  { at: 4.3, me: true, text: "I went to. Then I looked at the screen." },
  { at: 5.8, me: true, shot: true },
  { at: 7.5, me: true, text: "He's lowering the gravity so his cat stops falling so fast." },
  { at: 9.4, text: "Our kid said gravity?" },
  { at: 10.6, me: true, text: "He asked for 5 more minutes. I said okay." },
  { at: 12.2, text: "Save him a plate." },
];
const DINNER_END = 13.9;

const Msg2: React.FC<{ m: Txt }> = ({ m }) => {
  const { s } = useT();
  const p = useSpringAt(m.at, { damping: 13, stiffness: 190 });
  if (s < m.at) return null;
  const grow = Math.min(1, p * 1.25);
  return (
    <div style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start", marginTop: 18 * grow, maxHeight: 420 * grow, opacity: Math.min(1, p * 1.5), transform: `scale(${0.9 + p * 0.1})`, transformOrigin: m.me ? "right bottom" : "left bottom" }}>
      {m.shot ? (
        <div style={{ width: 500, borderRadius: 40, border: `6px solid ${INK}`, overflow: "hidden", background: "#1d2147" }}>
          <div style={{ position: "relative", height: 250 }}>
            {[60, 180, 330, 430].map((x, i) => <div key={x} style={{ position: "absolute", left: x, top: 30 + (i % 2) * 50, fontSize: 30, color: YELLOW }}>✦</div>)}
            <div style={{ position: "absolute", left: 200, top: 40 + 70 * Math.abs(Math.sin((s - m.at) * 1.6)), width: 100, height: 76, borderRadius: 38, background: "#ff9a3d", border: `5px solid ${INK}` }}>
              <div style={{ position: "absolute", left: 26, top: 24, width: 11, height: 15, borderRadius: 7, background: INK }} /><div style={{ position: "absolute", right: 26, top: 24, width: 11, height: 15, borderRadius: 7, background: INK }} />
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 26, background: "#62d26f", borderTop: `5px solid ${INK}` }} />
          </div>
          <div style={{ background: INK, padding: "16px 24px", fontFamily: M, fontWeight: 600, fontSize: 34, color: "#8fe39a" }}>gravity = <span style={{ color: "rgba(255,255,255,0.35)", textDecoration: "line-through" }}>9</span> <span style={{ color: YELLOW }}>4</span></div>
        </div>
      ) : (
        <div style={{ maxWidth: 600, padding: "22px 30px", borderRadius: 44, borderBottomRightRadius: m.me ? 12 : 44, borderBottomLeftRadius: m.me ? 44 : 12, background: m.me ? CORAL : "#fff", border: `6px solid ${INK}`, fontFamily: N, fontWeight: 800, fontSize: 40, lineHeight: 1.2, color: m.me ? "#fff" : INK }}>{m.text}</div>
      )}
    </div>
  );
};

export const CodeItDinner: React.FC = () => {
  const { s } = useT();
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      <div style={{ position: "absolute", left: -220, top: -220, width: 760, height: 760, borderRadius: 380, background: "rgba(254,211,64,0.40)" }} />
      <div style={{ position: "absolute", right: -280, bottom: -260, width: 860, height: 860, borderRadius: 430, background: "rgba(240,86,45,0.15)" }} />
      <Logo />
      <Head a="He skipped dinner." b="I wasn't even mad." at={0.1} out={4.0} size={100} />
      <Head a="Then I looked" b="at the screen." at={4.3} out={7.2} />
      <Head a="He was fixing" b="his own game." at={7.5} out={10.3} />
      <Head a="“5 more minutes.”" b="I said okay." at={10.6} out={13.6} />

      {/* the thread: newest message at the bottom, older ones pushed up and clipped */}
      <div style={{ position: "absolute", left: 70, top: 560, width: 940, height: 1090, borderRadius: 60, background: "rgba(255,255,255,0.55)", border: `7px solid ${INK}`, boxShadow: `0 16px 0 ${INK}`, overflow: "hidden", opacity: 1 - ramp(s, DINNER_END - 0.3, DINNER_END) }}>
        <div style={{ height: 96, background: YELLOW, borderBottom: `6px solid ${INK}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: B, fontWeight: 800, fontSize: 40, color: INK }}>Home</div>
        <div style={{ position: "absolute", left: 30, right: 30, top: 96, bottom: 34, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden" }}>
          {THREAD.map((m) => <Msg2 key={m.at} m={m} />)}
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1700, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: "rgba(22,22,29,0.4)", opacity: 1 - ramp(s, DINNER_END - 0.3, DINNER_END) }}>MADE-UP STORY</div>

      <End at={DINNER_END} a="“5 more minutes.”" b="The good kind." />
      {THREAD.map((m) => <Sfx key={m.at} at={m.at} src={m.me ? "pop.wav" : "ding.wav"} volume={m.me ? 0.45 : 0.4} />)}
      <Sfx at={DINNER_END} src="whoosh.wav" volume={0.4} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- tablet */
/*
 * "I tried to take his tablet away." Told like the LYNQ money reel: one object on stage (the
 * tablet), things that move, and a small character (the timer chip). A parent goes to take the
 * tablet, sees a game that keeps crashing, and watches the kid fix it by changing one number.
 * Made-up story, labelled. For parents (voice: VALF). The narrator is a made-up parent.
 */
export const TABLET_DUR = 17.5;
const TW = 780, TH = 1040, TX = (1080 - TW) / 2, TY = 590;
const SKY = "#1d2147", GROUND = "#62d26f";
const TABLET_END = 13.8;

const Cat: React.FC<{ x: number; y: number; squash: number; happy: boolean }> = ({ x, y, squash, happy }) => (
  <div style={{ position: "absolute", left: x - 70, top: y - 110 + squash * 44, width: 140, height: 110, transform: `scale(${1 + squash * 0.35}, ${1 - squash * 0.4})`, transformOrigin: "50% 100%" }}>
    <div style={{ position: "absolute", left: 8, top: -22, width: 0, height: 0, borderLeft: "22px solid transparent", borderRight: "22px solid transparent", borderBottom: `40px solid ${INK}` }} />
    <div style={{ position: "absolute", right: 8, top: -22, width: 0, height: 0, borderLeft: "22px solid transparent", borderRight: "22px solid transparent", borderBottom: `40px solid ${INK}` }} />
    <div style={{ position: "absolute", left: 15, top: -12, width: 0, height: 0, borderLeft: "15px solid transparent", borderRight: "15px solid transparent", borderBottom: "28px solid #ff9a3d" }} />
    <div style={{ position: "absolute", right: 15, top: -12, width: 0, height: 0, borderLeft: "15px solid transparent", borderRight: "15px solid transparent", borderBottom: "28px solid #ff9a3d" }} />
    <div style={{ position: "absolute", inset: 0, borderRadius: 54, background: "#ff9a3d", border: `7px solid ${INK}` }} />
    {happy ? (
      <>
        <div style={{ position: "absolute", left: 34, top: 40, width: 22, height: 12, borderTop: `6px solid ${INK}`, borderRadius: "50% 50% 0 0" }} />
        <div style={{ position: "absolute", right: 34, top: 40, width: 22, height: 12, borderTop: `6px solid ${INK}`, borderRadius: "50% 50% 0 0" }} />
      </>
    ) : (
      <>
        <div style={{ position: "absolute", left: 36, top: 34, fontFamily: B, fontWeight: 800, fontSize: 34, lineHeight: 1, color: INK }}>{squash > 0.3 ? "×" : "•"}</div>
        <div style={{ position: "absolute", right: 36, top: 34, fontFamily: B, fontWeight: 800, fontSize: 34, lineHeight: 1, color: INK }}>{squash > 0.3 ? "×" : "•"}</div>
      </>
    )}
  </div>
);

export const CodeItTablet: React.FC = () => {
  const { s } = useT();
  // 1. The grab: the tablet is pulled to the right and tugged back.
  const pull = ramp(s, 0.5, 1.1) * (1 - ramp(s, 2.2, 2.7));
  const tug = s > 1.1 && s < 2.2 ? Math.sin((s - 1.1) * 14) * 16 * (1 - (s - 1.1) / 1.1) : 0;
  // 2. Code panel slides up, the number is changed, Run is pressed.
  const code = ramp(s, 5.3, 5.9) * (1 - ramp(s, 9.4, 9.9));
  const fixed = s >= 8.0;                       // gravity is now 4
  const typed = s >= 7.3 ? "4" : "9";
  const selecting = s >= 6.6 && s < 7.3;
  const press = s >= 7.8 && s < 8.0;
  // The game. Before the fix the cat drops like a stone and splats; after it, it floats down.
  const gameH = 980 - code * 400;               // game area height in tablet pixels (screen is 720 by 980)
  const groundY = gameH - 46;
  const cycle = fixed ? 2.4 : 0.95;
  const t = (((s - (fixed ? 8.0 : 0)) % cycle) + cycle) % cycle;
  const fall = fixed ? Math.min(1, t / 1.5) : Math.min(1, (t / 0.34) ** 2);
  const catY = 70 + (groundY - 70) * (fixed ? 1 - (1 - fall) ** 2 : fall);
  const landed = fall >= 1;
  const squash = !fixed && landed ? Math.max(0, 1 - (t - 0.34) / 0.35) : 0;
  const shake = !fixed && landed && t < 0.5 ? Math.sin(t * 90) * 7 * (1 - (t - 0.34) / 0.16 > 0 ? 1 : 0.4) : 0;
  const score = fixed ? Math.floor((s - 8.0) / cycle) + (landed ? 1 : 0) : 0;
  const crashes = fixed ? 0 : Math.floor(s / cycle) + (landed ? 1 : 0);
  // 3. The timer chip: a plea, then a countdown, then five more minutes.
  const chip = useSpringAt(1.2, { damping: 9, stiffness: 180 });
  const more = useSpringAt(11.9, { damping: 9, stiffness: 190 });
  const left = Math.max(0, Math.ceil(ramp(s, 2.7, 11.6, 300, 0, (x) => x)));
  const chipText = s < 2.7 ? "5 more minutes?" : s < 11.9 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "+5:00";
  const out = ramp(s, TABLET_END - 0.35, TABLET_END);
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      <div style={{ position: "absolute", left: -220, top: -220, width: 760, height: 760, borderRadius: 380, background: "rgba(254,211,64,0.40)" }} />
      <div style={{ position: "absolute", right: -280, bottom: -260, width: 860, height: 860, borderRadius: 430, background: "rgba(240,86,45,0.15)" }} />
      <Logo />
      <Head a="I tried to take" b="his tablet away." at={0.1} out={2.4} size={104} />
      <Head a="Then I saw" b="the screen." at={2.7} out={5.0} size={104} />
      <Head a="He wasn't playing." b="He was fixing it." at={5.3} out={9.3} size={92} />
      <Head a="One number." b="No more crashing." at={9.6} out={11.6} />
      <Head a="So I gave him" b="five more minutes." at={11.9} out={13.5} />

      <div style={{ position: "absolute", left: TX + pull * 250 + tug + shake, top: TY + pull * 40, width: TW, height: TH, opacity: 1 - out, transform: `rotate(${pull * 9 + tug * 0.12}deg) scale(${1 - out * 0.1})`, transformOrigin: "100% 100%" }}>
        {/* tablet body */}
        <div style={{ position: "absolute", inset: 0, borderRadius: 70, background: INK, boxShadow: "0 22px 0 rgba(22,22,29,0.25)" }} />
        <div style={{ position: "absolute", left: 30, top: 30, width: TW - 60, height: TH - 60, borderRadius: 46, overflow: "hidden", background: SKY }}>
          {/* the game */}
          <div style={{ position: "absolute", left: 0, top: 0, width: 720, height: gameH, overflow: "hidden" }}>
            {[[70, 60], [250, 130], [470, 70], [620, 170], [150, 230], [540, 280]].map(([x, y], i) => <div key={i} style={{ position: "absolute", left: x, top: y, fontSize: 34, color: YELLOW, opacity: 0.5 + 0.5 * Math.abs(Math.sin(s * 2 + i)) }}>✦</div>)}
            <div style={{ position: "absolute", right: 24, top: 22, padding: "6px 22px", borderRadius: 26, background: "rgba(0,0,0,0.35)", fontFamily: M, fontWeight: 600, fontSize: 30, color: "#fff" }}>{fixed ? `SCORE ${score}` : `CRASHES ${crashes}`}</div>
            <div style={{ position: "absolute", left: 0, right: 0, top: groundY, bottom: 0, background: GROUND, borderTop: `7px solid ${INK}` }} />
            <Cat x={360} y={catY} squash={squash} happy={fixed} />
            {!fixed && squash > 0.2 ? <div style={{ position: "absolute", left: 440, top: groundY - 170, fontFamily: B, fontWeight: 800, fontSize: 70, color: CORAL, transform: "rotate(12deg)" }}>OUCH</div> : null}
            {fixed && landed ? <div style={{ position: "absolute", left: 450, top: groundY - 190 - (t - 1.5) * 60, fontFamily: B, fontWeight: 800, fontSize: 64, color: YELLOW, opacity: Math.max(0, 1 - (t - 1.5) / 0.8) }}>+1 ✦</div> : null}
          </div>
          {/* the code */}
          <div style={{ position: "absolute", left: 0, right: 0, top: gameH, bottom: 0, background: INK, borderTop: `6px solid ${YELLOW}`, padding: "26px 34px" }}>
            <div style={{ fontFamily: M, fontSize: 26, color: "rgba(255,255,255,0.45)" }}>game.py</div>
            <div style={{ marginTop: 14, fontFamily: M, fontWeight: 600, fontSize: 58, color: "#8fe39a" }}>gravity = <span style={{ padding: "0 12px", borderRadius: 12, background: selecting ? YELLOW : fixed ? "rgba(254,211,64,0.25)" : "transparent", color: selecting ? INK : YELLOW }}>{typed}</span></div>
            <div style={{ marginTop: 6, fontFamily: M, fontWeight: 600, fontSize: 58, color: "rgba(143,227,154,0.45)" }}>jump = 12</div>
            <div style={{ marginTop: 22, display: "inline-block", padding: "12px 44px", borderRadius: 34, background: YELLOW, border: `5px solid #000`, fontFamily: B, fontWeight: 800, fontSize: 40, color: INK, transform: `scale(${press ? 0.9 : 1})` }}>▶ Run</div>
          </div>
        </div>
        {/* the timer chip, stuck to the corner of the tablet */}
        <div style={{ position: "absolute", left: -46, top: -70, padding: "16px 34px", borderRadius: 50, background: s >= 11.9 ? CORAL : YELLOW, border: `7px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 56, color: s >= 11.9 ? "#fff" : INK, transform: `rotate(-8deg) scale(${(s >= 11.9 ? 0.7 + more * 0.5 : chip) * (s > 2.7 && s < 11.9 && left <= 20 ? 1 + 0.06 * Math.sin(s * 16) : 1)})`, transformOrigin: "20% 80%", opacity: s < 1.2 ? 0 : 1 }}>{chipText}</div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 1720, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: "rgba(22,22,29,0.4)", opacity: 1 - out }}>MADE-UP STORY</div>
      <End at={TABLET_END} a="Screen time" b="you'll brag about." />

      <Sfx at={0.5} src="whoosh.wav" volume={0.5} />
      <Sfx at={1.2} src="pop.wav" volume={0.6} />
      {[0.34, 1.29, 2.24, 3.19, 4.14, 5.09, 6.04, 6.99].map((x) => <Sfx key={x} at={x} src="thump.wav" volume={0.35} />)}
      <Sfx at={5.3} src="whoosh.wav" volume={0.35} />
      <Sfx at={6.6} src="click.wav" volume={0.5} />
      <Sfx at={7.3} src="click.wav" volume={0.6} />
      <Sfx at={7.8} src="click.wav" volume={0.7} />
      {[9.5, 11.9].map((x) => <Sfx key={`d${x}`} at={x} src="ding.wav" volume={0.5} />)}
      <Sfx at={11.9} src="pop.wav" volume={0.7} />
      <Sfx at={TABLET_END} src="whoosh.wav" volume={0.4} />
    </AbsoluteFill>
  );
};
