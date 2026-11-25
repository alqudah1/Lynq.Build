import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, ramp, useT } from "./kit";
import { Pip } from "./pip-kit";
import { Monster } from "./CodeItMonster";

/*
 * "The monster got out", day 3: line 4 gets one word changed, the monster eats stars instead,
 * and the bitten CodeIt screens heal. Real screens; the story is made up and labelled.
 */
const CREAM = "#fff4e5", INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340";
const B = "'Baloo 2'", N = "'Nunito'", MONO = "'JetBrains Mono'";
const K = 1080 / 483, TOP = 98;
const P = (x: number, y: number): [number, number] => [x * K, y * K + TOP];
export const FIX_DUR = 19;
const A = 4.4, END = 13.6; // screens start, end card
// x, y, r, heal time
const HOLES: Record<string, [number, number, number, number][]> = {
  lessons: [[...P(82, 358), 95, 5.6], [...P(370, 461), 105, 6.6]],
  explore: [[...P(125, 345), 120, 8.6], [...P(357, 340), 120, 9.4], [...P(394, 111), 90, 10.2], [...P(125, 690), 110, 11.0]],
};
const SAY: [string, number, number][] = [["Line four. Change one word.", 0.2, 2.6], ["Now run it!", 3.0, 4.2], ["It's eating stars!", 5.0, 7.2], ["The lessons are back!", 8.2, 10.8], ["One word. That's all it took.", 11.2, 13.4]];

const Sky: React.FC = () => (
  <AbsoluteFill style={{ background: "linear-gradient(180deg,#1d2a7a 0%,#3b5cc0 100%)" }}>
    {Array.from({ length: 70 }).map((_, i) => <div key={i} style={{ position: "absolute", left: (i * 277) % 1080, top: (i * 431) % 1920, width: 4 + (i % 3) * 3, height: 4 + (i % 3) * 3, borderRadius: 6, background: i % 4 === 0 ? YELLOW : "#fff", opacity: 0.5 + (i % 5) * 0.1 }} />)}
  </AbsoluteFill>
);
const Star: React.FC<{ x: number; y: number; size: number; rot?: number }> = ({ x, y, size, rot = 0 }) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ position: "absolute", left: x - size / 2, top: y - size / 2, transform: `rotate(${rot}deg)` }}>
    <polygon points="0,-46 13,-15 46,-15 19,6 29,40 0,20 -29,40 -19,6 -46,-15 -13,-15" fill={YELLOW} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
  </svg>
);
const Hole: React.FC<{ x: number; y: number; r: number; heal: number }> = ({ x, y, r, heal }) => {
  const { s } = useT();
  const p = 1 - ramp(s, heal, heal + 0.45);
  if (p <= 0.01) return <Star x={x} y={y - ramp(s, heal + 0.4, heal + 1.0) * 120} size={90 * (1 - ramp(s, heal + 0.7, heal + 1.0))} rot={s * 200} />;
  const n = 11, rr = r * 0.26;
  const dots = Array.from({ length: n }).map((_, k) => { const a = (2 * Math.PI * k) / n; return [Math.cos(a) * r, Math.sin(a) * r]; });
  const layer = (grow: number, fill: string, key: string) => (
    <div key={key} style={{ position: "absolute", left: x, top: y, transform: `scale(${p}) rotate(${(1 - p) * 120}deg)` }}>
      <div style={{ position: "absolute", left: -r - grow, top: -r - grow, width: (r + grow) * 2, height: (r + grow) * 2, borderRadius: r + grow, background: fill }} />
      {dots.map(([dx, dy], k) => <div key={k} style={{ position: "absolute", left: dx - rr - grow, top: dy - rr - grow, width: (rr + grow) * 2, height: (rr + grow) * 2, borderRadius: rr + grow, background: fill }} />)}
    </div>
  );
  return <>{layer(9, INK, "o")}{layer(0, "#2a3f9c", "i")}</>;
};

export const CodeItFix: React.FC = () => {
  const { s } = useT();
  const OLD = "everything", NEW = "stars";
  const del = Math.round(ramp(s, 0.9, 1.9, 0, OLD.length, (x) => x));
  const typ = Math.round(ramp(s, 2.1, 2.9, 0, NEW.length, (x) => x));
  const word = s < 2.1 ? OLD.slice(0, OLD.length - del) : NEW.slice(0, typ);
  const run = s >= 3.5 && s < 3.75;
  const scr = s < 7.6 ? "lessons" : "explore";
  const slide = ramp(s, 7.6, 7.9);
  const holes = HOLES[scr];
  const next = holes.find((h) => s < h[3] + 0.2) ?? holes[holes.length - 1];
  const mx = s < END - 2.2 ? next[0] + 150 + Math.sin(s * 3) * 20 : 800, my = s < END - 2.2 ? next[1] - 20 + Math.cos(s * 4) * 16 : 1500;
  const eating = holes.some((h) => s > h[3] - 0.1 && s < h[3] + 0.5);
  const stars = [...HOLES.lessons, ...HOLES.explore].filter((h) => s > h[3] + 0.4).length;
  const e = ramp(s, END, END + 0.4);
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      {s < A ? (
        <AbsoluteFill>
          <Sky />
          <div style={{ position: "absolute", left: 60, right: 60, top: 560, padding: "44px 40px 50px", borderRadius: 50, background: INK, border: `8px solid ${INK}`, boxShadow: "0 16px 0 rgba(0,0,0,0.35)" }}>
            <div style={{ fontFamily: N, fontWeight: 900, fontSize: 28, letterSpacing: 5, color: YELLOW }}>monster.py · LINE 4</div>
            {["1  monster = Monster()", "2  monster.wake()", "3  # what does it eat?"].map((l) => <div key={l} style={{ fontFamily: MONO, fontSize: 40, color: "rgba(255,255,255,0.4)", marginTop: 16, whiteSpace: "pre" }}>{l}</div>)}
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 50, color: "#fff", marginTop: 16, padding: "14px 16px", marginLeft: -16, marginRight: -16, borderRadius: 18, background: "rgba(254,211,64,0.14)", whiteSpace: "pre" }}>
              4  monster.eat(<span style={{ color: s < 2.1 ? "#ff6b6b" : "#7ee787" }}>{word}</span><span style={{ opacity: Math.sin(s * 14) > 0 ? 1 : 0, color: YELLOW }}>|</span>)
            </div>
            <div style={{ display: "inline-block", marginTop: 40, padding: "18px 50px", borderRadius: 50, background: "#39c26b", border: "6px solid #fff", fontFamily: B, fontWeight: 800, fontSize: 50, color: "#fff", transform: `scale(${run ? 0.9 : 1 + (s > 3.0 && s < 3.5 ? Math.sin(s * 20) * 0.03 : 0)})`, opacity: ramp(s, 2.9, 3.1, 0.35, 1) }}>▶ Run</div>
          </div>
          <Pip pose="type" x={260} y={1560} size={300} bounce={Math.abs(Math.sin(s * 6)) * 10} />
          <Monster x={830} y={1620} size={380} chew={Math.sin(s * 22) * 0.5 + 0.5} tilt={-8} />
        </AbsoluteFill>
      ) : s < END ? (
        <AbsoluteFill key={scr} style={{ transform: `translateX(${scr === "explore" ? (1 - slide) * 1080 : 0}px)` }}>
          <Img src={staticFile(`mon/${scr}.jpg`)} style={{ position: "absolute", left: 0, top: TOP, width: 1080 }} />
          {holes.map(([x, y, r, h]) => <Hole key={h} x={x} y={y} r={r} heal={h} />)}
          <Pip pose="cheer" x={200} y={1560} size={270} bounce={Math.abs(Math.sin(s * 8)) * 40} />
          <Monster x={mx} y={my} size={300} chew={eating ? Math.sin(s * 26) * 0.5 + 0.5 : 0.1} tilt={Math.sin(s * 5) * 5} />
          <div style={{ position: "absolute", right: 40, top: 1700, padding: "14px 30px", borderRadius: 40, background: "#fff", border: `7px solid ${INK}`, boxShadow: `0 8px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 50, color: INK }}>★ {stars}</div>
        </AbsoluteFill>
      ) : null}
      {SAY.map(([line, a, b], k) => {
        if (s < a || s > b + 0.2) return null;
        const p = ramp(s, a, a + 0.2) * (1 - ramp(s, b, b + 0.2));
        return (
          <div key={k} style={{ position: "absolute", left: 50, right: 50, top: s < A ? 250 : 150, textAlign: "center", opacity: p, transform: `translateY(${(1 - p) * 24}px) scale(${0.92 + p * 0.08})` }}>
            <div style={{ display: "inline-block", position: "relative", padding: "24px 44px 20px", borderRadius: 44, background: "#fff", border: `8px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 72, lineHeight: 1.05, color: INK }}>
              <div style={{ position: "absolute", left: 30, top: -30, padding: "2px 18px", borderRadius: 14, background: "#ff8a1f", border: `5px solid ${INK}`, fontFamily: N, fontWeight: 900, fontSize: 26, letterSpacing: 3, color: "#fff" }}>PIP</div>
              {line}
            </div>
          </div>
        );
      })}
      {s < END ? <div style={{ position: "absolute", left: 0, right: 0, bottom: 38, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: s < A ? "rgba(255,255,255,0.7)" : "rgba(22,22,29,0.55)" }}>MADE-UP STORY · REAL CODEIT SCREENS</div> : null}
      {s >= END ? (
        <AbsoluteFill style={{ opacity: e, background: CREAM }}>
          <div style={{ position: "absolute", left: 70, right: 70, top: 380, textAlign: "center", transform: `scale(${0.92 + e * 0.08})` }}>
            <div style={{ fontFamily: B, fontWeight: 800, fontSize: 104, lineHeight: 1.0, letterSpacing: -2, color: INK }}>Some kids<br />play the game.</div>
            <div style={{ fontFamily: B, fontWeight: 800, fontSize: 104, lineHeight: 1.0, letterSpacing: -2, color: CORAL, marginTop: 26, opacity: ramp(s, END + 1.4, END + 1.7) }}>Your kid<br />built it.</div>
            <div style={{ display: "inline-block", marginTop: 60, padding: "20px 50px", borderRadius: 60, background: YELLOW, border: `7px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 46, color: INK, opacity: ramp(s, END + 2.6, END + 2.9) }}>Free to start · codeitlearn.com</div>
          </div>
          <Pip pose="cheer" x={300} y={1520} size={300} bounce={Math.abs(Math.sin(s * 5)) * 18} />
          <Monster x={760} y={1560} size={340} chew={0.05} tilt={6} />
          {[0, 1, 2].map((k) => <div key={k} style={{ position: "absolute", left: 880 + k * 36, top: 1250 - k * 60 - ((s * 40) % 40), fontFamily: B, fontWeight: 800, fontSize: 50 + k * 14, color: INK, opacity: 0.7 - k * 0.15 }}>z</div>)}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: "rgba(22,22,29,0.55)" }}>MADE-UP STORY · AI VOICE</div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/* Thursday picture: the monster is still loose. */
export const PostMonsterLoose: React.FC = () => (
  <AbsoluteFill style={{ background: CREAM, overflow: "hidden" }}>
    <Fonts />
    <Sky />
    <div style={{ position: "absolute", left: 60, right: 60, top: 90, padding: "50px 46px 56px", borderRadius: 56, background: CREAM, border: `8px solid ${INK}`, boxShadow: `0 16px 0 ${INK}` }}>
      <div style={{ fontFamily: N, fontWeight: 900, fontSize: 28, letterSpacing: 5, color: CORAL }}>DAY 3 · STILL LOOSE</div>
      <div style={{ fontFamily: B, fontWeight: 800, fontSize: 112, lineHeight: 0.98, letterSpacing: -2, color: INK, marginTop: 10 }}>It ate the<br />Run button.</div>
      <div style={{ marginTop: 36, padding: "26px 30px", borderRadius: 28, background: INK }}>
        <div style={{ fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 4, color: YELLOW }}>LINE 4</div>
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 52, color: "#fff", marginTop: 6, whiteSpace: "nowrap" }}>monster.eat(<span style={{ color: "#ff6b6b" }}>everything</span>)</div>
      </div>
      <div style={{ fontFamily: B, fontWeight: 800, fontSize: 56, color: INK, marginTop: 34 }}>Change one word to stop it.</div>
    </div>
    <Monster x={760} y={1060} size={430} chew={0.8} tilt={-8} />
    <Pip pose="think" x={250} y={1040} size={300} />
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: "rgba(255,255,255,0.8)" }}>MADE-UP STORY · CODEITLEARN.COM</div>
  </AbsoluteFill>
);
