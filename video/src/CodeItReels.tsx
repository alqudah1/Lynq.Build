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
