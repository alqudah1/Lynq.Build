import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useT } from "./kit";
import { Pip } from "./pip-kit";

/*
 * "The monster got out", day 2: the game monster eats its way through the real CodeIt site
 * while Pip chases it. Real screens of codeitlearn.com; the story is made up and labelled.
 */
const CREAM = "#fff4e5", INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340";
const B = "'Baloo 2'", N = "'Nunito'";
const K = 1080 / 483, TOP = 98;
const P = (x: number, y: number): [number, number] => [x * K, y * K + TOP];
export const MONSTER_DUR = 23.5;

type Scene = { img: string; a: number; b: number; bites: [number, number, number, number][]; path: [number, number, number][] };
const SCENES: Scene[] = [
  { img: "lessons", a: 0, b: 5, bites: [[1.9, ...P(82, 358), 95], [3.1, ...P(370, 461), 105]], path: [[0.7, 1250, 1500], [1.8, ...P(150, 400)], [2.3, ...P(150, 400)], [3.0, ...P(420, 500)], [3.6, ...P(420, 500)], [5.0, -300, 900]] },
  { img: "explore", a: 5, b: 10, bites: [[5.9, ...P(125, 345), 120], [6.9, ...P(357, 340), 120], [7.9, ...P(394, 111), 90], [8.8, ...P(125, 690), 110]], path: [[5.0, 1300, 700], [5.8, ...P(190, 400)], [6.2, ...P(190, 400)], [6.8, ...P(420, 395)], [7.2, ...P(420, 395)], [7.8, ...P(440, 170)], [8.2, ...P(440, 170)], [8.7, ...P(190, 720)], [9.2, ...P(190, 720)], [10.0, 1400, 1500]] },
  { img: "play", a: 10, b: 14.8, bites: [[11.0, ...P(406, 648), 95], [12.0, ...P(84, 480), 85], [13.0, ...P(241, 295), 150]], path: [[10.0, -300, 1500], [10.9, ...P(350, 690)], [11.3, ...P(350, 690)], [11.9, ...P(140, 530)], [12.3, ...P(140, 530)], [12.9, ...P(300, 350)], [13.5, ...P(300, 350)], [14.8, 1400, 300]] },
  { img: "build", a: 14.8, b: 18.2, bites: [[15.7, ...P(241, 243), 130], [16.7, ...P(241, 180), 110]], path: [[14.8, 1400, 300], [15.6, ...P(310, 290)], [16.1, ...P(310, 290)], [16.6, ...P(310, 230)], [17.2, ...P(310, 230)], [18.2, 540, 2300]] },
];
const END = 18.2;
const SAY: [string, number, number][] = [
  ["It got out.", 0.2, 2.0], ["Hey! Those are lessons!", 3.2, 4.9], ["Stop eating the games!", 6.6, 9.6], ["Not the Run button!", 11.2, 13.6], ["I can't catch it.", 15.9, 18.0],
];

const Sky: React.FC = () => (
  <AbsoluteFill style={{ background: "linear-gradient(180deg,#1d2a7a 0%,#3b5cc0 100%)" }}>
    {Array.from({ length: 70 }).map((_, i) => <div key={i} style={{ position: "absolute", left: (i * 277) % 1080, top: (i * 431) % 1920, width: 4 + (i % 3) * 3, height: 4 + (i % 3) * 3, borderRadius: 6, background: i % 4 === 0 ? YELLOW : "#fff", opacity: 0.5 + (i % 5) * 0.1 }} />)}
  </AbsoluteFill>
);

export const Monster: React.FC<{ x: number; y: number; size: number; chew: number; tilt?: number }> = ({ x, y, size, chew, tilt = 0 }) => {
  const s = size / 360;
  return (
    <div style={{ position: "absolute", left: x - size / 2, top: y - size * 0.58, width: 360, height: 420, transform: `scale(${s}) rotate(${tilt}deg)`, transformOrigin: "0 0" }}>
      <div style={{ position: "absolute", left: 60, top: -26, width: 44, height: 70, borderRadius: "50% 50% 10% 10%", background: "#6d3fd6", border: `7px solid ${INK}`, transform: "rotate(-18deg)" }} />
      <div style={{ position: "absolute", right: 60, top: -26, width: 44, height: 70, borderRadius: "50% 50% 10% 10%", background: "#6d3fd6", border: `7px solid ${INK}`, transform: "rotate(18deg)" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "48% 48% 40% 40%", background: "#9b6bff", border: `8px solid ${INK}` }} />
      {[[50, 250, 34], [280, 210, 26], [250, 320, 30]].map(([a, b, r], k) => <div key={k} style={{ position: "absolute", left: a, top: b, width: r, height: r, borderRadius: r, background: "#7c4be6" }} />)}
      {[90, 210].map((a) => (
        <div key={a} style={{ position: "absolute", left: a, top: 70, width: 74, height: 84, borderRadius: 40, background: "#fff", border: `7px solid ${INK}` }}>
          <div style={{ position: "absolute", left: 20, top: 24, width: 32, height: 32, borderRadius: 16, background: INK }} />
        </div>
      ))}
      <div style={{ position: "absolute", left: 80, top: 180, width: 200, height: 46 + chew * 70, borderRadius: 40, background: "#3a1140", border: `7px solid ${INK}`, overflow: "hidden" }}>
        {[18, 68, 118, 162].map((a) => <div key={a} style={{ position: "absolute", left: a, top: -4, width: 26, height: 24, background: "#fff", borderRadius: "0 0 10px 10px" }} />)}
      </div>
    </div>
  );
};

const Hole: React.FC<{ at: number; x: number; y: number; r: number }> = ({ at, x, y, r }) => {
  const { s } = useT();
  if (s < at) return null;
  const p = ramp(s, at, at + 0.18, 0.3, 1);
  const n = 11, rr = r * 0.26;
  const dots = Array.from({ length: n }).map((_, k) => { const a = (2 * Math.PI * k) / n; return [Math.cos(a) * r, Math.sin(a) * r]; });
  const layer = (grow: number, fill: string, key: string) => (
    <div key={key} style={{ position: "absolute", left: x, top: y, transform: `scale(${p})` }}>
      <div style={{ position: "absolute", left: -r - grow, top: -r - grow, width: (r + grow) * 2, height: (r + grow) * 2, borderRadius: r + grow, background: fill }} />
      {dots.map(([dx, dy], k) => <div key={k} style={{ position: "absolute", left: dx - rr - grow, top: dy - rr - grow, width: (rr + grow) * 2, height: (rr + grow) * 2, borderRadius: rr + grow, background: fill }} />)}
    </div>
  );
  return <>{layer(9, INK, "o")}{layer(0, "#2a3f9c", "i")}<div style={{ position: "absolute", left: x - r * 0.4, top: y - r * 0.3, width: 8, height: 8, borderRadius: 4, background: "#fff", opacity: p }} /><div style={{ position: "absolute", left: x + r * 0.3, top: y + r * 0.2, width: 10, height: 10, borderRadius: 5, background: YELLOW, opacity: p }} /></>;
};

export const CodeItMonster: React.FC = () => {
  const { s } = useT();
  const sc = SCENES.find((c) => s >= c.a && s < c.b);
  const pos = (t: number, c: Scene): [number, number] => [interpolate(t, c.path.map((k) => k[0]), c.path.map((k) => k[1]), { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), interpolate(t, c.path.map((k) => k[0]), c.path.map((k) => k[2]), { extrapolateLeft: "clamp", extrapolateRight: "clamp" })];
  const chewing = sc ? sc.bites.some(([t]) => s >= t - 0.1 && s < t + 0.55) : s >= END + 1.4;
  const chew = chewing ? Math.sin(s * 26) * 0.5 + 0.5 : 0.15;
  const e = ramp(s, END, END + 0.4);
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      {sc ? (() => {
        const [mx, my] = pos(s, sc);
        const [px, py] = pos(s - 0.75, sc);
        const pipOn = s > 2.4;
        const slide = ramp(s, sc.a, sc.a + 0.3);
        return (
          <AbsoluteFill key={sc.img} style={{ transform: `translateX(${sc.a === 0 ? 0 : (1 - slide) * 1080}px)` }}>
            <Img src={staticFile(`mon/${sc.img}.jpg`)} style={{ position: "absolute", left: 0, top: TOP, width: 1080 }} />
            {sc.bites.map(([t, x, y, r]) => <Hole key={t} at={t} x={x} y={y} r={r} />)}
            {pipOn ? <Pip pose="jump" x={px - 40} y={py + 150} size={230} bounce={Math.abs(Math.sin(s * 11)) * 26} tilt={Math.sin(s * 11) * 6} /> : null}
            <Monster x={mx} y={my} size={300} chew={chew} tilt={Math.sin(s * 9) * 7} />
          </AbsoluteFill>
        );
      })() : null}
      {/* speech bubbles */}
      {SAY.map(([line, a, b], k) => {
        if (s < a || s > b + 0.2) return null;
        const p = ramp(s, a, a + 0.2) * (1 - ramp(s, b, b + 0.2));
        const pip = k > 0;
        return (
          <div key={k} style={{ position: "absolute", left: 50, right: 50, top: 150, textAlign: "center", opacity: p, transform: `translateY(${(1 - p) * 24}px) scale(${0.92 + p * 0.08})` }}>
            <div style={{ display: "inline-block", position: "relative", padding: "24px 44px 20px", borderRadius: 44, background: "#fff", border: `8px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: k === 0 ? 120 : 76, lineHeight: 1.05, color: INK }}>
              {pip ? <div style={{ position: "absolute", left: 30, top: -30, padding: "2px 18px", borderRadius: 14, background: "#ff8a1f", border: `5px solid ${INK}`, fontFamily: N, fontWeight: 900, fontSize: 26, letterSpacing: 3, color: "#fff" }}>PIP</div> : null}
              {line}
            </div>
          </div>
        );
      })}
      {s < END ? <div style={{ position: "absolute", left: 0, right: 0, bottom: 38, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: "rgba(22,22,29,0.55)" }}>MADE-UP STORY · REAL CODEIT SCREENS</div> : null}
      {/* ending: the page is gone, one way to stop it */}
      {s >= END ? (
        <AbsoluteFill style={{ opacity: e }}>
          <Sky />
          <div style={{ position: "absolute", left: 70, right: 70, top: 330, padding: "60px 50px 70px", borderRadius: 60, background: CREAM, border: `8px solid ${INK}`, boxShadow: `0 16px 0 ${INK}`, textAlign: "center", transform: `scale(${0.9 + e * 0.1})` }}>
            <div style={{ fontFamily: B, fontWeight: 800, fontSize: 92, lineHeight: 1.02, letterSpacing: -2, color: INK }}>It only stops<br />if someone<br /><span style={{ color: CORAL }}>fixes line 4.</span></div>
            <div style={{ margin: "44px auto 0", padding: "24px 30px", borderRadius: 26, background: INK, textAlign: "left", opacity: ramp(s, END + 0.9, END + 1.2) }}>
              <div style={{ fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 4, color: YELLOW }}>LINE 4</div>
              <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 50, color: "#fff", marginTop: 4, whiteSpace: "nowrap" }}>monster.eat(<span style={{ color: "#ff6b6b" }}>everything</span>)</div>
            </div>
            <div style={{ display: "inline-block", marginTop: 46, padding: "20px 54px", borderRadius: 60, background: YELLOW, border: `7px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 54, color: INK, transform: `scale(${ramp(s, END + 1.8, END + 2.1, 0.6, 1)})`, opacity: ramp(s, END + 1.8, END + 2.0) }}>Comment the fix</div>
          </div>
          <Monster x={830} y={1560 + (1 - ramp(s, END + 1.2, END + 1.6)) * 600} size={420} chew={chew} tilt={-8} />
          <Pip pose="think" x={230} y={1430 + (1 - ramp(s, END + 2.4, END + 2.8)) * 600} size={280} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, textAlign: "center", fontFamily: N, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: "rgba(255,255,255,0.7)" }}>MADE-UP STORY · CODEITLEARN.COM</div>
        </AbsoluteFill>
      ) : null}
      {SCENES.flatMap((c) => c.bites).map(([t]) => <Sfx key={t} at={t} src="crash.wav" volume={0.3} />)}
      <Sfx at={END} src="whoosh.wav" volume={0.3} />
    </AbsoluteFill>
  );
};
