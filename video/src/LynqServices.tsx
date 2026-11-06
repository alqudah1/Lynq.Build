import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { BK, CARD, Kw, LI, LN, MU, RED, Say, Tag, WH } from "./lynq-story-kit";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ services, one reel each: CRM, website from zero, AI social manager, paper to online.
 * Names and numbers on screen are sample data and say so.
 */

const q = (f: string) => `'${f}'`;
const EN = "en" as const;

const Frame: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <AbsoluteFill style={{ background: `radial-gradient(70% 45% at 50% 28%, #1e221d 0%, ${BK} 72%)` }}>
    <Fonts />
    {children}
    <div style={{ position: "absolute", left: 90, right: 90, top: 110, display: "flex", justifyContent: "space-between", fontFamily: q("JetBrains Mono"), fontSize: 26, letterSpacing: 4, color: MU }}>
      <span style={{ color: WH }}>LYNQ</span><span>{label}</span>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 165, display: "flex", justifyContent: "center" }}>
      <div style={{ padding: "8px 22px", borderRadius: 30, border: `1px solid ${LN}`, fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 3, color: MU }}>SAMPLE DATA · MADE-UP NAMES</div>
    </div>
    <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={0.3} />
  </AbsoluteFill>
);

/* ── CRM: where do your leads go? ────────────────────────────────────── */

type Lead = { kind: string; text: string; x: number; y: number; rot: number; color: string };
const MESS: Lead[] = [
  { kind: "STICKY NOTE", text: "call back Sara?? cake", x: 90, y: 560, rot: -6, color: "#d5fd71" },
  { kind: "DM · TUESDAY", text: "how much for 40 people?", x: 520, y: 520, rot: 4, color: CARD },
  { kind: "MISSED CALL ×2", text: "+1 416 ···", x: 140, y: 860, rot: 3, color: CARD },
  { kind: "EMAIL", text: "Quote request: catering", x: 540, y: 820, rot: -3, color: CARD },
  { kind: "COMMENT", text: "price?", x: 330, y: 1120, rot: 5, color: CARD },
  { kind: "TEXT", text: "still open saturday?", x: 620, y: 1120, rot: -5, color: CARD },
];

const MessCard: React.FC<{ l: Lead; i: number; lostAt?: number; gatherAt: number }> = ({ l, i, lostAt, gatherAt }) => {
  const { s } = useT();
  const sp = useSpringAt(-1 + i * 0.12, { damping: 12, stiffness: 200 });
  const shake = s < gatherAt ? Math.sin(s * 9 + i) * 4 : 0;
  const fall = lostAt !== undefined ? ramp(s, lostAt, lostAt + 0.7) : 0;
  const g = ramp(s, gatherAt, gatherAt + 0.6);
  if (g >= 1) return null;
  const dark = l.color === CARD;
  return (
    <div style={{ position: "absolute", left: l.x, top: l.y + fall * 900, width: 380, padding: "22px 26px", borderRadius: dark ? 24 : 6, background: l.color, border: dark ? `1px solid ${LN}` : "none", boxShadow: "0 20px 40px rgba(0,0,0,0.5)", transform: `rotate(${l.rot + shake + fall * 40}deg) scale(${sp * (1 - g * 0.6)})`, opacity: (1 - fall) * (1 - g) }}>
      <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 20, letterSpacing: 3, color: dark ? (l.kind.startsWith("MISSED") ? RED : MU) : "#3d4a12" }}>{l.kind}</div>
      <div style={{ marginTop: 8, fontFamily: q(dark ? "Outfit Regular" : "Outfit Bold"), fontSize: 34, color: dark ? WH : "#151a08" }}>{l.text}</div>
    </div>
  );
};

const BOARD = [
  { col: 0, name: "Sara K.", what: "Birthday cake · 40 people" },
  { col: 0, name: "Omar H.", what: "Catering quote" },
  { col: 1, name: "Lina M.", what: "Saturday order" },
  { col: 2, name: "Dana R.", what: "Weekly bread order" },
];

const Board: React.FC<{ at: number; moveAt: number }> = ({ at, moveAt }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 15, stiffness: 140 });
  const cols = ["NEW", "TALKING", "WON"];
  const move = ramp(s, moveAt, moveAt + 0.6);
  const move2 = ramp(s, moveAt + 1.2, moveAt + 1.8);
  return (
    <div style={{ position: "absolute", left: 50, right: 50, top: 520, height: 760, opacity: sp, transform: `scale(${0.9 + sp * 0.1})` }}>
      {cols.map((c, ci) => (
        <div key={c} style={{ position: "absolute", left: ci * 330, top: 0, width: 310, height: 740, borderRadius: 30, background: "#0f120f", border: `1px solid ${LN}`, padding: 18 }}>
          <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 24, letterSpacing: 4, color: ci === 2 ? LI : MU }}>{c}</div>
        </div>
      ))}
      {BOARD.map((b, i) => {
        const col = b.col; let y = 80 + (b.col === 0 ? i : 0) * 190;
        let x = col * 330 + 18;
        if (i === 0) { x = 18 + (move + move2) * 330; y = 80 + 190 * move; }
        const won = i === 0 && move2 >= 1;
        const cp = ramp(s, at + 0.3 + i * 0.15, at + 0.6 + i * 0.15);
        return (
          <div key={b.name} style={{ position: "absolute", left: x, top: y, width: 274, padding: "20px 20px", borderRadius: 20, background: won ? "#1d2a10" : CARD, border: `1px solid ${won ? LI : LN}`, opacity: cp }}>
            <div style={{ fontFamily: q("Outfit Bold"), fontSize: 32, color: WH }}>{b.name}{won && <span style={{ color: LI }}> ✓</span>}</div>
            <div style={{ marginTop: 6, fontFamily: q("Outfit Regular"), fontSize: 24, color: MU }}>{b.what}</div>
          </div>
        );
      })}
      {s >= moveAt + 2.0 && (
        <div style={{ position: "absolute", left: 18, top: 600, padding: "14px 22px", borderRadius: 20, background: "rgba(199,255,61,0.12)", border: `1px solid ${LI}`, fontFamily: q("Outfit Regular"), fontSize: 26, color: LI, transform: `scale(${Math.min(1, (s - moveAt - 2.0) * 4)})`, transformOrigin: "0 50%" }}>
          Reminder: follow up with Omar tomorrow
        </div>
      )}
    </div>
  );
};

export const LynqCrm: React.FC = () => {
  const { s } = useT();
  const gatherAt = 6.4;
  return (
    <Frame label="CRM">
      {s < 6.4 && <Say text="Where do your leads go?" at={-1} top={260} size={92} bold accent={["leads"]} lang={EN} />}
      {s >= 3.2 && s < 6.4 && <div style={{ position: "absolute", left: 0, right: 0, top: 1460, textAlign: "center", fontFamily: q("Outfit Regular"), fontSize: 54, color: MU }}>Some just <span style={{ color: RED }}>disappear.</span></div>}
      {MESS.map((l, i) => <MessCard key={i} l={l} i={i} gatherAt={gatherAt} lostAt={i === 1 ? 3.4 : i === 2 ? 4.2 : i === 4 ? 5.0 : undefined} />)}
      {s >= gatherAt && (
        <>
          <Say text="One board. Every lead." at={gatherAt} top={260} size={92} bold accent={["Every", "lead"]} lang={EN} />
          <Board at={gatherAt + 0.3} moveAt={gatherAt + 1.6} />
        </>
      )}
      {s >= 11.0 && <Tag text="We set this up for you" at={11.0} top={1320} lang={EN} />}
      {s >= 11.3 && <Kw text="Comment CRM · or lynq.build/book" at={11.3} top={1450} lang={EN} />}
      {[0, 1, 2, 3, 4, 5].map((i) => <Sfx key={i} at={i * 0.12 + 0.05} src="pop.wav" volume={0.35} />)}
      <Sfx at={3.4} src="whoosh.wav" volume={0.4} />
      <Sfx at={4.2} src="whoosh.wav" volume={0.4} />
      <Sfx at={5.0} src="whoosh.wav" volume={0.4} />
      <Sfx at={gatherAt} src="thump.wav" volume={0.8} />
      <Sfx at={gatherAt + 1.6} src="click.wav" />
      <Sfx at={gatherAt + 2.8} src="ding.wav" volume={0.7} />
    </Frame>
  );
};

