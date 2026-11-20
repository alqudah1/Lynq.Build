import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * "What we built": real LYNQ work, one screen per kind of build. Every picture is a real
 * screen or an existing case slide, nothing is invented and no results are claimed.
 */
const LI = "#C7FF3D", BG = "#040405", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const BUILT_DUR = 31;
const START = 2.7, STEP = 4.0;
const CH: { kind: string; who: string; img: string; wide: boolean }[] = [
  { kind: "Websites", who: "Kingsbridge Group", img: "kingsbridge", wide: true },
  { kind: "Order systems", who: "Arcubed Label", img: "arcubed", wide: false },
  { kind: "Lead sites", who: "House Deals Direct", img: "housedeals", wide: false },
  { kind: "Learning platforms", who: "CodeIt", img: "codeit", wide: true },
  { kind: "ERP systems", who: "KHAIRAT. Every department, one system.", img: "khairat", wide: true },
  { kind: "CRM and automation", who: "LYNQ Office", img: "office", wide: false },
];
const END = START + CH.length * STEP;

const Chapter: React.FC<{ i: number }> = ({ i }) => {
  const { s } = useT();
  const at = START + i * STEP, c = CH[i];
  const p = useSpringAt(at, { damping: 16, stiffness: 150 });
  const q = useSpringAt(at + 0.15, { damping: 15, stiffness: 140 });
  if (s < at || s > at + STEP + 0.3) return null;
  const out = ramp(s, at + STEP - 0.3, at + STEP);
  const drift = ramp(s, at, at + STEP, 0, 1, (x) => x);
  const W = c.wide ? 960 : 600, H = c.wide ? 640 : 1066;
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <div style={{ position: "absolute", left: 70, top: 190, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 30}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 30, letterSpacing: 8, color: LI }}>{`0${i + 1} / 0${CH.length}`}</div>
        <div style={{ fontFamily: IS, fontSize: c.kind.length > 14 ? 84 : 104, letterSpacing: -3, color: "#fff", marginTop: 14, lineHeight: 1 }}>{c.kind}</div>
        <div style={{ fontFamily: IL, fontSize: 40, color: "rgba(255,255,255,0.62)", marginTop: 18 }}>{c.who}</div>
      </div>
      <div style={{ position: "absolute", left: (1080 - W) / 2, top: c.wide ? 640 : 560, width: W, height: H + (c.wide ? 46 : 0), borderRadius: c.wide ? 22 : 44, overflow: "hidden", border: "2px solid rgba(255,255,255,0.16)", boxShadow: `0 40px 120px rgba(199,255,61,${0.10 * q})`, background: "#111", opacity: Math.min(1, q * 1.3), transform: `translateY(${(1 - q) * 120}px) scale(${0.94 + q * 0.06})` }}>
        {c.wide ? (
          <div style={{ height: 46, background: "#17171a", display: "flex", alignItems: "center", padding: "0 18px", gap: 9 }}>
            {[0, 1, 2].map((k) => <div key={k} style={{ width: 12, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.22)" }} />)}
          </div>
        ) : null}
        <div style={{ width: W, height: H, overflow: "hidden" }}>
          <Img src={staticFile(`built/${c.img}.jpg`)} style={{ width: W * 1.08, marginLeft: -W * 0.04, transform: `translateY(${-drift * (c.wide ? 14 : 40)}px) scale(${1 + drift * 0.03})`, transformOrigin: "50% 0%" }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const LynqBuilt: React.FC = () => {
  const { s } = useT();
  const h = useSpringAt(0.1, { damping: 14, stiffness: 160 });
  const hOut = ramp(s, START - 0.35, START);
  const e = useSpringAt(END + 0.15, { damping: 14, stiffness: 150 });
  const tap = s >= END + 2.0 && s < END + 2.25;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <div style={{ position: "absolute", left: 70, top: 90, fontFamily: IS, fontSize: 30, letterSpacing: 12, color: "#fff", opacity: 0.9 }}>LYNQ</div>
      {s < START ? (
        <div style={{ position: "absolute", left: 70, right: 70, top: 700, opacity: Math.min(1, h * 1.4) * (1 - hOut), transform: `translateY(${(1 - h) * 40}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 96, lineHeight: 1.05, letterSpacing: -3, color: "#fff" }}>What does LYNQ</div>
          <div style={{ fontFamily: IS, fontSize: 96, lineHeight: 1.05, letterSpacing: -3, color: LI }}>actually build?</div>
          <div style={{ fontFamily: IL, fontSize: 40, color: "rgba(255,255,255,0.6)", marginTop: 30 }}>Six real ones. 30 seconds.</div>
        </div>
      ) : null}
      {CH.map((_, i) => <Chapter key={i} i={i} />)}
      {s >= END ? (
        <div style={{ position: "absolute", left: 70, right: 70, top: 640, textAlign: "center", opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * 40}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 92, letterSpacing: -3, lineHeight: 1.05, color: "#fff" }}>We built those.</div>
          <div style={{ fontFamily: IS, fontSize: 92, letterSpacing: -3, lineHeight: 1.05, color: LI }}>Yours is next.</div>
          <div style={{ display: "inline-block", marginTop: 80, padding: "30px 64px", borderRadius: 70, background: LI, fontFamily: IS, fontSize: 48, color: "#0a0a0a", transform: `scale(${tap ? 0.93 : 1})` }}>Book a consultation</div>
          <div style={{ marginTop: 46, fontFamily: IS, fontSize: 28, letterSpacing: 8, color: "#fff" }}>LINK IN BIO</div>
          <div style={{ marginTop: 14, fontFamily: IL, fontSize: 30, color: "rgba(255,255,255,0.55)" }}>lynq.build/book</div>
        </div>
      ) : null}
      {CH.map((_, i) => <Sfx key={i} at={START + i * STEP} src="whoosh.wav" volume={0.25} />)}
      <Sfx at={END + 2.0} src="click.wav" volume={0.4} />
    </AbsoluteFill>
  );
};
