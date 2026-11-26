import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { Fonts, ramp, useT } from "./kit";

/*
 * "Your menu is a PDF. Ours spins." Starts on the pain (a PDF menu being pinch-zoomed on a phone),
 * the page gets spun off like a plate, and a phone-size menu takes over where dishes orbit in.
 * Made-up restaurant, AI food photos, labelled.
 */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'", SERIF = "Fraunces";
export const PDFSPIN_DUR = 12.8;
const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const key = (s: number, K: [number, number][]) => { for (let i = 0; i < K.length - 1; i++) { const [a, va] = K[i], [b, vb] = K[i + 1]; if (s <= b) return va + (vb - va) * io(Math.max(0, (s - a) / (b - a))); } return K[K.length - 1][1]; };
const D = [
  { n: "Grilled", i: "octopus", p: "Crispy potatoes, smoked paprika oil, charred lemon.", $: "$28", c: "#3a1a14", ac: "#f0a36b", g: ["Octopus", "Smoked paprika", "Charred lemon"] },
  { n: "Wild mushroom", i: "pappardelle", p: "Hand cut pasta, brown butter, thyme, aged parmesan.", $: "$26", c: "#2c2512", ac: "#e8cf8a", g: ["Hand cut pasta", "Wild mushrooms", "Aged parmesan"] },
  { n: "Salmon", i: "crudo", p: "Blood orange, dill, pink peppercorn, olive oil.", $: "$24", c: "#3a1420", ac: "#ff9c8a", g: ["Salmon", "Blood orange", "Pink peppercorn"] },
];
const MENU = ["Marinated olives", "Grilled octopus", "Burrata, heirloom tomato", "Salmon crudo", "Wild mushroom pappardelle", "Saffron risotto", "Charred aubergine", "Lamb shoulder", "Sea bass, fennel", "Hand cut fries", "Bitter leaf salad", "Dark chocolate tart", "Lemon posset", "Cheese, honeycomb"];

const Pdf: React.FC = () => {
  const { s } = useT();
  const z = key(s, [[0, 1], [0.7, 1], [1.5, 3.4], [2.0, 3.4], [2.5, 2.2], [3.2, 2.2]]);
  const px = key(s, [[0, 0], [0.7, 0], [1.5, -520], [2.0, -200], [2.5, 380], [3.2, 380]]);
  const py = key(s, [[0, 0], [0.7, 0], [1.5, 300], [2.0, 620], [2.5, -100], [3.2, -100]]);
  const spread = key(s, [[0.6, 0], [1.5, 1], [2.0, 1], [2.5, 0.5]]);
  const blur = Math.max(0, Math.sin(ramp(s, 0.7, 1.5, 0, 1) * Math.PI)) * 5 + (z > 2.5 ? 1.2 : 0);
  return (
    <AbsoluteFill style={{ background: "#d9d9de" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 210, background: "#f4f4f6", borderBottom: "2px solid #c8c8cf" }}>
        <div style={{ position: "absolute", left: 60, right: 60, bottom: 30, height: 76, borderRadius: 22, background: "#e4e4ea", display: "flex", alignItems: "center", padding: "0 30px", fontFamily: IL, fontSize: 32, color: "#55555f" }}>saline.example/menu-FINAL-v3.pdf</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 212, bottom: 0, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 90, top: 70, width: 900, height: 1270, background: "#fff", boxShadow: "0 10px 40px rgba(0,0,0,0.25)", transform: `translate(${px}px, ${py}px) scale(${z})`, filter: `blur(${blur}px)`, padding: "60px 56px" }}>
          <div style={{ fontFamily: "Times New Roman, serif", fontSize: 44, textAlign: "center", letterSpacing: 10, color: "#222" }}>SALINE</div>
          <div style={{ fontFamily: "Times New Roman, serif", fontSize: 15, textAlign: "center", color: "#777", marginTop: 6, letterSpacing: 3 }}>DINNER MENU · PRICES SUBJECT TO CHANGE</div>
          <div style={{ columnCount: 2, columnGap: 50, marginTop: 44 }}>
            {[...MENU, ...MENU, ...MENU].map((m, k) => (
              <div key={k} style={{ fontFamily: "Times New Roman, serif", fontSize: 15, color: "#333", display: "flex", justifyContent: "space-between", borderBottom: "1px dotted #aaa", padding: "5px 0", breakInside: "avoid" }}><span>{m}</span><span>{12 + ((k * 7) % 23)}</span></div>
            ))}
          </div>
        </div>
        {[-1, 1].map((d) => <div key={d} style={{ position: "absolute", left: 540 - 55 + d * (70 + spread * 250), top: 760 - 55 - d * (50 + spread * 190), width: 110, height: 110, borderRadius: 55, background: "rgba(40,40,50,0.28)", border: "4px solid rgba(40,40,50,0.4)", opacity: ramp(s, 0.4, 0.6, 0, 1) }} />)}
      </div>
    </AbsoluteFill>
  );
};

const Menu: React.FC = () => {
  const { s } = useT();
  const pos = key(s, [[3.6, 0], [5.3, 0], [6.2, 1], [7.3, 1], [8.2, 2], [13, 2]]);
  const i0 = Math.min(1, Math.floor(pos)), t = pos - i0;
  const hx = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const a = hx(D[i0].c), b = hx(D[i0 + 1].c), col = a.map((v, k) => Math.round(v + (b[k] - v) * t));
  const CX = 540, CY = 1900, R = 1000;
  const G: [number, number][] = [[70, 610], [760, 690], [120, 1190]];
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 46%, rgb(${col.map((v) => Math.min(255, Math.round(v * 1.9)))}) 0%, rgb(${col}) 45%, #0a0706 100%)`, overflow: "hidden" }}>
      {[0, 1].map((k) => <div key={k} style={{ position: "absolute", left: CX - R - k * 130, top: CY - R - k * 130, width: (R + k * 130) * 2, height: (R + k * 130) * 2, borderRadius: "50%", border: `2px ${k ? "dashed" : "solid"} rgba(244,236,223,0.16)` }} />)}
      <div style={{ position: "absolute", left: 60, top: 96, fontFamily: SERIF, fontSize: 44, letterSpacing: 8, color: "#f4ecdf" }}>SALINE</div>
      <div style={{ position: "absolute", right: 60, top: 92, fontFamily: IS, fontSize: 28, color: "#f4ecdf", border: "2px solid rgba(244,236,223,0.5)", padding: "14px 28px", borderRadius: 40 }}>Book a table</div>
      {D.map((d, k) => {
        const dd = k - pos, v = Math.max(0, 1 - Math.abs(dd) * 2.4);
        return (
          <div key={k} style={{ position: "absolute", left: 60, right: 60, top: 230, opacity: v, transform: `translateX(${dd * 220}px)` }}>
            <div style={{ fontFamily: IS, fontSize: 24, letterSpacing: 8, color: "rgba(244,236,223,0.7)" }}>0{k + 1} / 04</div>
            <div style={{ fontFamily: SERIF, fontSize: 112, lineHeight: 0.98, letterSpacing: -3, color: "#f4ecdf", marginTop: 10 }}>{d.n}<br /><span style={{ fontStyle: "italic", color: d.ac }}>{d.i}</span></div>
          </div>
        );
      })}
      {D.map((d, k) => {
        const dd = k - pos, ang = -Math.PI / 2 + dd * 0.62, x = CX + R * Math.cos(ang), y = CY + R * Math.sin(ang), sc = 1 - Math.min(0.45, Math.abs(dd) * 0.45);
        return <div key={k} style={{ position: "absolute", left: x - 330, top: y - 330, width: 660, height: 660, borderRadius: "50%", backgroundImage: `url(${staticFile(`niche/dish${k + 1}.jpg`)})`, backgroundSize: "127%", backgroundPosition: "center", boxShadow: "0 50px 110px rgba(0,0,0,0.6)", transform: `scale(${sc}) rotate(${dd * 150 + s * 3}deg)`, filter: `brightness(${1 - Math.min(0.45, Math.abs(dd) * 0.45)})` }} />;
      })}
      {D.flatMap((d, k) => d.g.map((g, j) => {
        const dist = Math.abs(k - pos), base = k === 0 ? ramp(s, 3.9 + j * 0.22, 4.2 + j * 0.22, 0, 1) : 1;
        const v = Math.max(0, Math.min(1, (0.3 - dist) / 0.14 - j * 0.25)) * base;
        return <div key={`${k}${j}`} style={{ position: "absolute", left: G[j][0], top: G[j][1], fontFamily: IS, fontSize: 30, color: "#f4ecdf", padding: "14px 26px", borderRadius: 40, background: "rgba(244,236,223,0.14)", border: "2px solid rgba(244,236,223,0.4)", opacity: v, transform: `translate(${(1 - v) * (j === 1 ? 160 : -160)}px, ${(1 - v) * (j === 2 ? 120 : -120)}px) scale(${0.8 + 0.2 * v})` }}>{g}</div>;
      }))}
      {D.map((d, k) => {
        const dd = k - pos, v = Math.max(0, 1 - Math.abs(dd) * 2.4);
        return (
          <div key={k} style={{ position: "absolute", left: 60, right: 60, top: 1300, opacity: v, transform: `translateY(${Math.abs(dd) * 60}px)`, textAlign: "center" }}>
            <div style={{ fontFamily: IL, fontSize: 36, color: "rgba(244,236,223,0.85)" }}>{d.p}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 30, marginTop: 30 }}>
              <span style={{ fontFamily: SERIF, fontSize: 84, color: "#f4ecdf" }}>{d.$}</span>
              <span style={{ fontFamily: IS, fontSize: 34, color: "#17110c", background: "#f4ecdf", padding: "22px 44px", borderRadius: 50 }}>Add to table</span>
            </div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 1640, display: "flex", justifyContent: "center", gap: 14 }}>{[0, 1, 2, 3].map((k) => <div key={k} style={{ width: 70, height: 6, borderRadius: 3, background: k === Math.round(pos) ? "#f4ecdf" : "rgba(244,236,223,0.25)" }} />)}</div>
    </AbsoluteFill>
  );
};

export const LynqPdfSpin: React.FC = () => {
  const { s } = useT();
  const fly = ramp(s, 3.1, 3.75, 0, 1, (x) => x * x);
  const end = ramp(s, 9.3, 10.0, 0, 1, io);
  const sc = 1 - end * 0.4;
  return (
    <AbsoluteFill style={{ background: "#040405", overflow: "hidden" }}>
      <Fonts />
      <style>{`@font-face{font-family:Fraunces;src:url(${staticFile("fonts/fraunces-latin-400-normal.woff2")});font-style:normal}@font-face{font-family:Fraunces;src:url(${staticFile("fonts/fraunces-latin-400-italic.woff2")});font-style:italic}`}</style>
      <div style={{ position: "absolute", left: -200, right: -200, top: 300, height: 1300, background: "radial-gradient(closest-side, rgba(199,255,61,0.18), transparent)", opacity: end }} />
      {s >= 3.0 ? (
        <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920, transformOrigin: "50% 40%", transform: `translateY(${-end * 150}px) scale(${sc})`, borderRadius: end * 90, overflow: "hidden", border: end > 0.02 ? "6px solid rgba(255,255,255,0.25)" : "none", boxShadow: end > 0.02 ? "0 60px 160px rgba(0,0,0,0.9)" : "none" }}>
          <Menu />
        </div>
      ) : null}
      {s < 3.8 ? (
        <AbsoluteFill style={{ transform: `rotate(${fly * 560}deg) scale(${1 - fly})`, opacity: 1 - ramp(s, 3.55, 3.75, 0, 1), borderRadius: fly * 540, overflow: "hidden" }}>
          <Pdf />
        </AbsoluteFill>
      ) : null}
      {s < 3.3 ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 1480, textAlign: "center", opacity: ramp(s, 0.2, 0.45, 0, 1) * (1 - ramp(s, 3.0, 3.2, 0, 1)) }}>
          <div style={{ display: "inline-block", fontFamily: IS, fontSize: 88, letterSpacing: -3.5, color: "#fff", background: "#0a0a0a", padding: "22px 46px", borderRadius: 32, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>Your menu is a PDF.</div>
          <div><div style={{ display: "inline-block", fontFamily: IL, fontSize: 40, color: "#fff", background: "rgba(10,10,10,0.82)", padding: "12px 30px", borderRadius: 22, marginTop: 18, opacity: ramp(s, 1.6, 1.9, 0, 1) }}>Pinch. Zoom. Squint. Give up.</div></div>
        </div>
      ) : null}
      {s >= 3.6 && s < 5.4 ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 1700, textAlign: "center", opacity: ramp(s, 3.7, 3.9, 0, 1) * (1 - ramp(s, 5.1, 5.4, 0, 1)), transform: `scale(${ramp(s, 3.7, 4.0, 0.8, 1)})` }}>
          <div style={{ display: "inline-block", fontFamily: IS, fontSize: 96, letterSpacing: -4, color: "#0a0a0a", background: LI, padding: "14px 50px", borderRadius: 32 }}>Ours spins.</div>
        </div>
      ) : null}
      <div style={{ position: "absolute", left: 60, right: 60, top: 1290, textAlign: "center", opacity: ramp(s, 9.7, 10.2, 0, 1), transform: `translateY(${(1 - ramp(s, 9.7, 10.2, 0, 1)) * 30}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 84, color: "#fff", letterSpacing: -3, lineHeight: 1.05 }}>Comment <span style={{ color: LI }}>"MENU"</span>.<br />We'll design yours.</div>
        <div style={{ display: "inline-block", marginTop: 44, background: LI, color: "#0a0a0a", fontFamily: IS, fontSize: 40, padding: "22px 44px", borderRadius: 60 }}>Book a consultation · lynq.build/book</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, textAlign: "center", fontFamily: IS, fontSize: 20, letterSpacing: 4, color: s < 3.3 ? "rgba(30,30,40,0.6)" : "rgba(255,255,255,0.5)" }}>CONCEPT SITE · MADE-UP RESTAURANT · AI FOOD PHOTOS</div>
    </AbsoluteFill>
  );
};
