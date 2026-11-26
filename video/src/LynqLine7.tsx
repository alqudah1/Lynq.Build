import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/*
 * "This is your menu. This is ours." One line of a PDF menu ("Grilled octopus .... 28") turns into
 * the dish: the dotted leader becomes the plate's ring, the name and price become the page.
 * Made-up restaurant, AI food photos, labelled.
 */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'", SERIF = "Fraunces", TIMES = "'Times New Roman', Times, serif";
export const LINE7_DUR = 11.4;
const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const out = (x: number) => 1 - Math.pow(1 - x, 3);
const back = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const ROWS: [string, string][] = [["Marinated olives", "9"], ["Burrata, heirloom tomato", "19"], ["Salmon crudo", "24"], ["Wild mushroom pappardelle", "26"], ["Saffron risotto", "27"], ["Charred aubergine", "21"], ["Grilled octopus", "28"], ["Lamb shoulder", "38"], ["Sea bass, fennel", "34"], ["Hand cut fries", "8"], ["Bitter leaf salad", "11"], ["Dark chocolate tart", "14"], ["Lemon posset", "12"]];
const DISH = [{ n: "Grilled", i: "octopus", $: "$28", ac: "#f0a36b", c: "#2e140f" }, { n: "Wild mushroom", i: "pappardelle", $: "$26", ac: "#e8cf8a", c: "#262010" }, { n: "Salmon", i: "crudo", $: "$24", ac: "#ff9c8a", c: "#2e1019" }];
const T_ZOOM = 1.5, T_MORPH = 3.95, T_HIT = 4.45, T_CMP = 6.8, T_CTA = 8.95;
const Plate: React.FC<{ k: number; x: number; y: number; r: number; rot: number; sc?: number }> = ({ k, x, y, r, rot, sc = 1 }) => (
  <div style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%", backgroundImage: `url(${staticFile(`niche/dish${k + 1}.jpg`)})`, backgroundSize: "127%", backgroundPosition: "center", boxShadow: "0 50px 120px rgba(0,0,0,0.7)", transform: `scale(${sc}) rotate(${rot}deg)` }} />
);

export const LynqLine7: React.FC = () => {
  const { s } = useT();
  const m = ramp(s, T_MORPH, T_HIT, 0, 1, io); // paper -> dark
  const hit = ramp(s, T_HIT, T_HIT + 0.45, 0, 1, back);
  const shake = s >= T_HIT && s < T_HIT + 0.3 ? Math.sin(s * 90) * 14 * (1 - (s - T_HIT) / 0.3) : 0;
  // dish index with quick spin swaps
  const swaps = [5.5, 6.05, 6.55];
  const idx = s < swaps[0] ? 0 : s < swaps[1] ? 1 : s < swaps[2] ? 2 : 0;
  const sw = swaps.map((t) => (s >= t - 0.14 && s < t + 0.2 ? (s - (t - 0.14)) / 0.34 : -1)).find((v) => v >= 0) ?? -1;
  const swRot = sw >= 0 ? sw * 360 : 0, swSc = sw >= 0 ? 1 - Math.sin(sw * Math.PI) * 0.22 : 1;
  const d = DISH[idx];
  const zoomIn = ramp(s, T_ZOOM - 0.12, T_ZOOM + 0.22, 0, 1, out);
  const cmp = ramp(s, T_CMP, T_CMP + 0.35, 0, 1, out), cta = ramp(s, T_CTA, T_CTA + 0.4, 0, 1, out);
  const hlName = ramp(s, 2.4, 2.65, 0, 1, out), hlPrice = ramp(s, 3.5, 3.68, 0, 1, out);
  const N = 30;
  const stage = s < T_CMP + 0.02 ? "main" : s < T_CTA + 0.02 ? "cmp" : "cta";
  const cap = (text: React.ReactNode, a: number, b: number, dark = false, y = 1650) => s >= a && s < b ? (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, textAlign: "center", transform: `scale(${ramp(s, a, a + 0.14, 0.8, 1, out)})`, opacity: ramp(s, a, a + 0.08, 0, 1) }}>
      <div style={{ display: "inline-block", fontFamily: IS, fontSize: 96, letterSpacing: -4, lineHeight: 1, padding: "18px 44px 22px", borderRadius: 30, background: dark ? "#0a0a0a" : LI, color: dark ? "#fff" : "#0a0a0a" }}>{text}</div>
    </div>
  ) : null;
  return (
    <AbsoluteFill style={{ background: "#040405", overflow: "hidden" }}>
      <Fonts />
      <style>{`@font-face{font-family:Fraunces;src:url(${staticFile("fonts/fraunces-latin-400-normal.woff2")});font-style:normal}@font-face{font-family:Fraunces;src:url(${staticFile("fonts/fraunces-latin-400-italic.woff2")});font-style:italic}`}</style>
      {stage === "main" ? (
        <AbsoluteFill style={{ transform: `translate(${shake}px, ${-shake * 0.6}px)` }}>
          {/* dark page under the paper */}
          <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 52%, ${d.c} 0%, #0a0706 75%)` }} />
          {/* paper */}
          <AbsoluteFill style={{ background: "#f6f4ee", opacity: 1 - m }} />
          {/* scene 1: whole page, small */}
          {s < T_ZOOM + 0.22 ? (
            <div style={{ position: "absolute", left: 130, top: 250, width: 820, height: 1180, background: "#fff", boxShadow: "0 20px 70px rgba(0,0,0,0.22)", padding: "60px 60px", transformOrigin: "50% 55%", transform: `scale(${1 + zoomIn * 3.2}) rotate(${-2 + zoomIn * 2}deg)`, opacity: 1 - zoomIn, filter: `blur(${zoomIn * 14}px)` }}>
              <div style={{ fontFamily: TIMES, fontSize: 54, textAlign: "center", letterSpacing: 12, color: "#222" }}>SALINE</div>
              <div style={{ fontFamily: TIMES, fontSize: 17, textAlign: "center", color: "#777", marginTop: 8, letterSpacing: 3 }}>DINNER MENU · menu-FINAL-v3.pdf</div>
              <div style={{ marginTop: 50 }}>{ROWS.map(([n, p], k) => <div key={k} style={{ fontFamily: TIMES, fontSize: 26, color: "#333", display: "flex", justifyContent: "space-between", borderBottom: "2px dotted #aaa", padding: "17px 0 6px" }}><span>{n}</span><span>{p}</span></div>)}</div>
            </div>
          ) : null}
          {/* scene 2: the line, big */}
          {s >= T_ZOOM - 0.1 ? (
            <>
              {ROWS.map(([n, p], k) => k === 6 ? null : (
                <div key={k} style={{ position: "absolute", left: 80, right: 80, top: 930 + (k - 6) * 150, display: "flex", justifyContent: "space-between", fontFamily: TIMES, fontSize: 56, color: "#333", opacity: 0.2 * zoomIn * (1 - ramp(s, T_MORPH - 0.1, T_MORPH + 0.15, 0, 1)), filter: "blur(2.5px)" }}><span>{n}</span><span>{p}</span></div>
              ))}
              {s < 4.0 ? <div style={{ position: "absolute", left: 80, top: 870, fontFamily: IS, fontSize: 22, letterSpacing: 6, color: "#999", opacity: zoomIn * (1 - ramp(s, T_MORPH - 0.1, T_MORPH, 0, 1)) }}>LINE 7</div> : null}
              {/* highlights */}
              <div style={{ position: "absolute", left: 70, top: 940, width: 410 * hlName, height: 62, background: "#ffe45c", opacity: (1 - ramp(s, T_MORPH, T_MORPH + 0.12, 0, 1)) * zoomIn }} />
              <div style={{ position: "absolute", left: 1010 - 82 * hlPrice, top: 940, width: 82 * hlPrice, height: 62, background: "#ffe45c", opacity: (1 - ramp(s, T_MORPH, T_MORPH + 0.12, 0, 1)) * zoomIn }} />
              {/* name: Times -> Fraunces */}
              <div style={{ position: "absolute", left: 80 - m * 20, top: 930 - m * 700, fontFamily: TIMES, fontSize: 56, color: "#222", opacity: zoomIn * (1 - ramp(s, T_MORPH, T_MORPH + 0.3, 0, 1)), transform: `scale(${1 + m * 1.2})`, transformOrigin: "0 0", whiteSpace: "nowrap" }}>Grilled octopus</div>
              <div style={{ position: "absolute", left: 60, right: 60, top: 230 + (1 - m) * 700, opacity: ramp(s, T_MORPH + 0.12, T_HIT, 0, 1), transform: `translateX(${sw >= 0 ? Math.sin(sw * Math.PI) * -40 : 0}px)` }}>
                <div style={{ fontFamily: SERIF, fontSize: 128, lineHeight: 0.96, letterSpacing: -4, color: "#f4ecdf" }}>{d.n}<br /><span style={{ fontStyle: "italic", color: d.ac }}>{d.i}</span></div>
              </div>
              {/* price */}
              <div style={{ position: "absolute", left: 930 - m * 680, top: 930 + m * 500, fontFamily: m < 0.5 ? TIMES : SERIF, fontSize: 56 + m * 60, color: m < 0.5 ? "#222" : "#f4ecdf", opacity: zoomIn, whiteSpace: "nowrap" }}>{m < 0.5 ? "28" : d.$}</div>
              {s >= T_HIT ? <div style={{ position: "absolute", left: 520, top: 1462, fontFamily: IS, fontSize: 34, color: "#17110c", background: "#f4ecdf", padding: "20px 40px", borderRadius: 50, opacity: ramp(s, T_HIT + 0.1, T_HIT + 0.3, 0, 1), transform: `scale(${ramp(s, T_HIT + 0.1, T_HIT + 0.35, 0.6, 1, back)})` }}>Add to table</div> : null}
              {/* dotted leader -> ring */}
              {Array.from({ length: N }).map((_, k) => {
                const mm = ramp(s, T_MORPH + k * 0.006, T_HIT + k * 0.004, 0, 1, io);
                const x0 = 500 + (k / (N - 1)) * 400, y0 = 986;
                const a = (k / N) * Math.PI * 2 + (s - T_MORPH) * 1.1, R = 372;
                const x1 = 540 + Math.cos(a) * R, y1 = 960 + Math.sin(a) * R;
                return <div key={k} style={{ position: "absolute", left: x0 + (x1 - x0) * mm - 5, top: y0 + (y1 - y0) * mm - 5, width: 10, height: 10, borderRadius: 5, background: mm < 0.5 ? "#888" : k % 5 === 0 ? LI : "rgba(244,236,223,0.75)", opacity: zoomIn }} />;
              })}
              {/* the dish lands */}
              {s >= T_HIT ? <Plate k={idx} x={540} y={960} r={335} rot={(1 - hit) * -220 + swRot + s * 4} sc={Math.max(0, hit) * swSc} /> : null}
              {s >= T_HIT && s < T_HIT + 0.35 ? <AbsoluteFill style={{ background: "#fff", opacity: 0.55 * (1 - (s - T_HIT) / 0.35) }} /> : null}
            </>
          ) : null}
          {cap("This is your menu.", 0.1, T_ZOOM - 0.05, true)}
          {cap("This is ours.", T_HIT, 5.45)}
        </AbsoluteFill>
      ) : null}
      {stage === "cmp" ? (
        <AbsoluteFill>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 830, background: "#f6f4ee", transform: `translateY(${(1 - cmp) * -830}px)` }}>
            <div style={{ position: "absolute", left: 80, top: 330, fontFamily: IS, fontSize: 24, letterSpacing: 7, color: "#999" }}>YOUR MENU</div>
            <div style={{ position: "absolute", left: 80, right: 80, top: 400, display: "flex", justifyContent: "space-between", fontFamily: TIMES, fontSize: 62, color: "#222", borderBottom: "4px dotted #999", paddingBottom: 10 }}><span>Grilled octopus</span><span>28</span></div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 830, bottom: 0, background: `radial-gradient(circle at 30% 45%, ${DISH[0].c} 0%, #0a0706 80%)`, transform: `translateY(${(1 - cmp) * 1100}px)` }}>
            <div style={{ position: "absolute", left: 80, top: 150, fontFamily: IS, fontSize: 24, letterSpacing: 7, color: LI }}>OURS</div>
            <Plate k={0} x={330} y={560} r={270} rot={s * 14} />
            <div style={{ position: "absolute", left: 640, top: 380, fontFamily: SERIF, fontSize: 84, lineHeight: 0.98, letterSpacing: -2, color: "#f4ecdf" }}>Grilled<br /><span style={{ fontStyle: "italic", color: DISH[0].ac }}>octopus</span><div style={{ fontSize: 70, marginTop: 24 }}>$28</div></div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 830 - 78, textAlign: "center", transform: `scale(${ramp(s, T_CMP + 0.15, T_CMP + 0.4, 0.7, 1, back)})`, opacity: ramp(s, T_CMP + 0.15, T_CMP + 0.25, 0, 1) }}>
            <div style={{ display: "inline-block", fontFamily: IS, fontSize: s < 7.55 ? 110 : 70, letterSpacing: -3.5, padding: "20px 46px 24px", borderRadius: 32, background: LI, color: "#0a0a0a", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>{s < 7.55 ? "Same dish." : "Which one are you ordering?"}</div>
          </div>
        </AbsoluteFill>
      ) : null}
      {stage === "cta" ? (
        <AbsoluteFill style={{ background: "#040405" }}>
          <div style={{ position: "absolute", left: -200, right: -200, top: 100, height: 1200, background: "radial-gradient(closest-side, rgba(199,255,61,0.2), transparent)" }} />
          {Array.from({ length: N }).map((_, k) => { const a = (k / N) * Math.PI * 2 + s * 0.8; return <div key={k} style={{ position: "absolute", left: 540 + Math.cos(a) * 372 - 5, top: 640 + Math.sin(a) * 372 - 5, width: 10, height: 10, borderRadius: 5, background: k % 5 === 0 ? LI : "rgba(244,236,223,0.6)" }} />; })}
          <Plate k={0} x={540} y={640} r={335} rot={s * 20} sc={0.7 + cta * 0.3} />
          <div style={{ position: "absolute", left: 60, right: 60, top: 1150, textAlign: "center", opacity: cta, transform: `translateY(${(1 - cta) * 40}px)` }}>
            <div style={{ fontFamily: IS, fontSize: 96, color: "#fff", letterSpacing: -4, lineHeight: 1.02 }}>Comment <span style={{ color: LI }}>"MENU"</span>.<br />We'll design yours.</div>
            <div style={{ display: "inline-block", marginTop: 50, background: LI, color: "#0a0a0a", fontFamily: IS, fontSize: 42, padding: "24px 48px", borderRadius: 60 }}>Book a consultation · lynq.build/book</div>
          </div>
        </AbsoluteFill>
      ) : null}
      <div style={{ position: "absolute", left: 60, top: 84, fontFamily: IS, fontSize: 26, letterSpacing: 10, color: stage === "main" && m < 0.5 || (stage === "cmp") ? "#111" : "#fff" }}>LYNQ</div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, textAlign: "center", fontFamily: IS, fontSize: 20, letterSpacing: 4, color: stage === "main" && m < 0.5 ? "rgba(30,30,40,0.55)" : "rgba(255,255,255,0.5)" }}>CONCEPT SITE · MADE-UP RESTAURANT · AI FOOD PHOTOS</div>
    </AbsoluteFill>
  );
};
