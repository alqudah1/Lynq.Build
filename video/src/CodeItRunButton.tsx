import React from "react";
import { AbsoluteFill } from "remotion";
import { Fonts, ramp, useT } from "./kit";
import { Pip } from "./pip-kit";
import { Monster } from "./CodeItMonster";

/*
 * "The monster got out", day 3 short: it eats the Run button bite by bite, Pip gives up the chase,
 * and line 4 is put to the viewer as a question. Made-up story, AI voice, labelled.
 */
const CREAM = "#fff4e5", INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340", GREEN = "#39c26b";
const B = "'Baloo 2'", N = "'Nunito'", MONO = "'JetBrains Mono'";
export const RUNBTN_DUR = 11;
const back = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const BITES: [number, number, number, number][] = [[1.0, 700, 60, 150], [1.75, 470, 250, 170], [2.5, 180, 40, 190], [3.05, 380, 120, 260]];
const T_B = 3.6, T_C = 5.3;
const Bubble: React.FC<{ a: number; b: number; children: React.ReactNode; top?: number }> = ({ a, b, children, top = 190 }) => {
  const { s } = useT();
  if (s < a || s > b + 0.15) return null;
  const p = ramp(s, a, a + 0.16, 0, 1, back) * (1 - ramp(s, b, b + 0.15));
  return (
    <div style={{ position: "absolute", left: 50, right: 50, top, textAlign: "center", opacity: Math.min(1, p * 1.5), transform: `scale(${0.7 + p * 0.3}) rotate(${(1 - p) * -4}deg)` }}>
      <div style={{ display: "inline-block", position: "relative", padding: "26px 48px 22px", borderRadius: 48, background: "#fff", border: `8px solid ${INK}`, boxShadow: `0 12px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 92, lineHeight: 1.02, color: INK }}>
        <div style={{ position: "absolute", left: 34, top: -32, padding: "2px 20px", borderRadius: 14, background: "#ff8a1f", border: `5px solid ${INK}`, fontFamily: N, fontWeight: 900, fontSize: 28, letterSpacing: 3, color: "#fff" }}>PIP</div>
        {children}
      </div>
    </div>
  );
};
export const CodeItRunButton: React.FC = () => {
  const { s } = useT();
  const bite = BITES.filter((b) => s >= b[0]).length;
  const next = BITES[Math.min(BITES.length - 1, bite)];
  const chewing = BITES.some((b) => s >= b[0] - 0.12 && s < b[0] + 0.4);
  const shake = BITES.map((b) => (s >= b[0] && s < b[0] + 0.25 ? Math.sin(s * 80) * 16 * (1 - (s - b[0]) / 0.25) : 0)).reduce((a, c) => a + c, 0);
  const BX = 130, BY = 760, BW = 820, BH = 300;
  const mx = BX + next[1] + 150, my = BY + next[2] + 40;
  const pulse = 0.5 + 0.5 * Math.sin(s * 9);
  const opts = ["stars", "nothing", "homework"];
  return (
    <AbsoluteFill style={{ background: CREAM, overflow: "hidden" }}>
      <Fonts />
      {s < T_B ? (
        <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.5}px)` }}>
          {Array.from({ length: 14 }).map((_, k) => <div key={k} style={{ position: "absolute", left: 540, top: 910, width: 14, height: 500, background: k % 2 ? "rgba(254,211,64,0.5)" : "rgba(240,86,45,0.14)", transformOrigin: "50% 0", transform: `rotate(${k * 25.7 + s * 12}deg) translateY(120px)` }} />)}
          <div style={{ position: "absolute", left: 0, right: 0, top: 590, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 30, letterSpacing: 8, color: CORAL }}>DAY 3 · STILL LOOSE</div>
          <div style={{ position: "absolute", left: BX, top: BY, width: BW, height: BH, borderRadius: 150, background: GREEN, border: `10px solid ${INK}`, boxShadow: `0 18px 0 ${INK}`, overflow: "hidden", transform: `scale(${1 - bite * 0.03})` }}>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: B, fontWeight: 800, fontSize: 170, color: "#fff", letterSpacing: -2 }}>▶ Run</div>
            {BITES.map(([t, x, y, r], k) => s >= t ? (
              <div key={k} style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, background: CREAM, border: `10px solid ${INK}`, transform: `scale(${ramp(s, t, t + 0.14, 0.3, 1, back)})` }}>
                {Array.from({ length: 9 }).map((_, j) => { const a = (j / 9) * Math.PI * 2; return <div key={j} style={{ position: "absolute", left: r - 10 + Math.cos(a) * r - 26, top: r - 10 + Math.sin(a) * r - 26, width: 52, height: 52, borderRadius: 26, background: CREAM }} />; })}
              </div>
            ) : null)}
          </div>
          {BITES.map(([t, x, y], k) => s >= t && s < t + 0.6 ? Array.from({ length: 6 }).map((_, j) => { const p = (s - t) / 0.6, a = j * 1.05 + k; return <div key={`${k}${j}`} style={{ position: "absolute", left: BX + x + Math.cos(a) * p * 260, top: BY + y + Math.sin(a) * p * 220 + p * p * 260, width: 34, height: 34, borderRadius: 10, background: GREEN, border: `5px solid ${INK}`, transform: `rotate(${p * 400}deg)`, opacity: 1 - p }} />; }) : null)}
          <Monster x={s < 0.7 ? 1400 - ramp(s, 0.2, 0.7, 0, 1) * (1400 - mx) : mx + Math.sin(s * 7) * 14} y={my + Math.cos(s * 9) * 12} size={360} chew={chewing ? Math.sin(s * 30) * 0.5 + 0.5 : 0.2} tilt={Math.sin(s * 8) * 8} />
          <Pip pose="jump" x={170 + ramp(s, 2.2, 3.4, 0, 1) * 120} y={1560} size={280} bounce={Math.abs(Math.sin(s * 12)) * 46} tilt={Math.sin(s * 12) * 7} />
          <Bubble a={0.75} b={3.2}>Not the<br />Run button!</Bubble>
        </AbsoluteFill>
      ) : s < T_C ? (
        <AbsoluteFill>
          <Monster x={1300 - ramp(s, T_B, T_C, 0, 1) * 1700} y={1050 + Math.sin(s * 14) * 30} size={420} chew={Math.sin(s * 26) * 0.5 + 0.5} tilt={-14} />
          {[0, 1, 2].map((k) => <div key={k} style={{ position: "absolute", left: 0, right: 0, top: 880 + k * 130, height: 12, background: "rgba(22,22,29,0.12)", transform: `translateX(${((s * 2600 + k * 500) % 2400) - 1200}px)`, width: 600, borderRadius: 6 }} />)}
          <Pip pose="think" x={540} y={1500} size={380} bounce={Math.abs(Math.sin(s * 7)) * 8} tilt={Math.sin(s * 3) * 3} />
          <Bubble a={T_B + 0.1} b={T_C - 0.15} top={360}>I can't catch it.</Bubble>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ background: "linear-gradient(180deg,#1d2a7a 0%,#3b5cc0 100%)" }}>
          {Array.from({ length: 60 }).map((_, i) => <div key={i} style={{ position: "absolute", left: (i * 277) % 1080, top: (i * 431) % 1920, width: 4 + (i % 3) * 3, height: 4 + (i % 3) * 3, borderRadius: 6, background: i % 4 === 0 ? YELLOW : "#fff", opacity: 0.5 + (i % 5) * 0.1 }} />)}
          <div style={{ position: "absolute", left: 60, right: 60, top: 190, textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: 104, lineHeight: 0.98, letterSpacing: -2, color: "#fff", transform: `scale(${ramp(s, T_C, T_C + 0.25, 0.7, 1, back)})` }}>It only stops if<br />someone <span style={{ color: YELLOW }}>fixes line 4.</span></div>
          <div style={{ position: "absolute", left: 50, right: 50, top: 560, padding: "40px 40px 46px", borderRadius: 50, background: INK, boxShadow: "0 18px 0 rgba(0,0,0,0.35)", transform: `translateY(${(1 - ramp(s, T_C + 0.15, T_C + 0.5, 0, 1, back)) * 900}px)` }}>
            <div style={{ fontFamily: N, fontWeight: 900, fontSize: 28, letterSpacing: 5, color: YELLOW }}>monster.py</div>
            {["1  monster = Monster()", "2  monster.wake()", "3  # what does it eat?"].map((l) => <div key={l} style={{ fontFamily: MONO, fontSize: 38, color: "rgba(255,255,255,0.38)", marginTop: 14, whiteSpace: "pre" }}>{l}</div>)}
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 49, color: "#fff", marginTop: 16, padding: "16px 16px", marginLeft: -16, marginRight: -16, borderRadius: 18, background: "rgba(254,211,64,0.16)", whiteSpace: "pre" }}>
              4  monster.eat(<span style={{ color: "#ff6b6b", background: `rgba(255,107,107,${0.15 + pulse * 0.25})`, borderRadius: 10, padding: "0 6px" }}>{s < 7.7 ? "everything" : " ? "}</span>)
            </div>
          </div>
          <div style={{ position: "absolute", left: 50, right: 50, top: 1050, display: "flex", justifyContent: "center", gap: 20 }}>
            {opts.map((o, k) => { const p = ramp(s, 7.7 + k * 0.16, 7.95 + k * 0.16, 0, 1, back); return <div key={o} style={{ padding: "18px 30px", borderRadius: 34, background: "#fff", border: `7px solid ${INK}`, boxShadow: `0 9px 0 ${INK}`, fontFamily: MONO, fontWeight: 700, fontSize: 42, color: INK, transform: `scale(${p}) rotate(${(k - 1) * 4 + Math.sin(s * 3 + k) * 2}deg)`, opacity: Math.min(1, p * 2) }}>{o}?</div>; })}
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1220, textAlign: "center", opacity: ramp(s, 8.2, 8.4), transform: `scale(${ramp(s, 8.2, 8.5, 0.6, 1, back)})` }}>
            <div style={{ display: "inline-block", padding: "22px 60px", borderRadius: 60, background: YELLOW, border: `8px solid ${INK}`, boxShadow: `0 12px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 76, color: INK }}>Comment the fix</div>
          </div>
          <Monster x={830} y={1690} size={340} chew={Math.sin(s * 22) * 0.5 + 0.5} tilt={-8} />
          <Pip pose="think" x={240} y={1650} size={260} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 1378, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 34, color: "#fff", opacity: ramp(s, 9.3, 9.6) }}>Free to start · codeitlearn.com</div>
        </AbsoluteFill>
      )}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: s < T_C ? "rgba(22,22,29,0.55)" : "rgba(255,255,255,0.75)" }}>MADE-UP STORY · AI VOICE</div>
    </AbsoluteFill>
  );
};
