import React from "react";
import { AbsoluteFill } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ reel 3: "I lost a job in my own notes."
 * An owner's point of view. Jobs live on sticky notes, in chats and in a spreadsheet, and one
 * of them slips away. Then the same jobs sit on one board. Sells ERP and CRM.
 * Drawn here, no people, no AI footage. The story is made up and labelled. Voice: Armando.
 */
const LI = "#C7FF3D", BG = "#030303", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const NOTES_DUR = 18;

type Scrap = { id: string; kind: "note" | "chat" | "sheet"; top: string; text: string; x: number; y: number; r: number; at: number; col: 0 | 1 | 2; row: number; status: string };
const SCRAPS: Scrap[] = [
  { id: "dana", kind: "note", top: "CALL BACK", text: "Dana. Roof quote", x: 120, y: 560, r: -7, at: 0.5, col: 0, row: 0, status: "Reply due today" },
  { id: "sam", kind: "chat", top: "Sam · 3 unread", text: "Can you do Tuesday?", x: 560, y: 640, r: 5, at: 0.9, col: 0, row: 1, status: "Call booked" },
  { id: "kit", kind: "sheet", top: "Sheet1 · row 48", text: "Kitchen refit", x: 150, y: 930, r: 3, at: 1.3, col: 1, row: 0, status: "Crew on site" },
  { id: "wall", kind: "note", top: "INVOICE?", text: "Garden wall", x: 590, y: 1010, r: -5, at: 1.7, col: 2, row: 0, status: "Paid" },
  { id: "deck", kind: "chat", top: "Priya · yesterday", text: "Any update on the deck?", x: 330, y: 1250, r: -3, at: 2.1, col: 1, row: 1, status: "Quote sent" },
];
const SW = 400, SH = 210;        // scrap size in the mess
const BX = 50, BY = 600, CW = 312, GAP = 22, CH = 210; // board geometry
const COLS = ["New", "In progress", "Done"];

const Line: React.FC<{ text: string; at: number; out: number; lime?: string[]; size?: number }> = ({ text, at, out, lime = [], size = 64 }) => {
  const { s } = useT();
  if (s < at || s > out + 0.3) return null;
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 236, textAlign: "center", fontFamily: IL, fontSize: size, lineHeight: 1.08, letterSpacing: -2.6, color: "#fff", opacity: 1 - ramp(s, out, out + 0.3) }}>
      {text.split(" ").map((w, i) => {
        const t = at + i * 0.085, o = ramp(s, t, t + 0.22);
        return <span key={i} style={{ display: "inline-block", marginRight: "0.24em", opacity: o, transform: `translateY(${(1 - o) * 18}px)`, color: lime.includes(w.replace(/[.,?]/g, "")) ? LI : "#fff" }}>{w}</span>;
      })}
    </div>
  );
};

const Piece: React.FC<{ c: Scrap }> = ({ c }) => {
  const { s } = useT();
  const pop = useSpringAt(c.at, { damping: 12, stiffness: 180 });
  const tidy = ramp(s, 8.6 + c.row * 0.12 + c.col * 0.1, 9.5 + c.row * 0.12 + c.col * 0.1); // mess to board
  // Dana's note slides under the pile and fades while it is still a mess.
  const lost = c.id === "dana" ? ramp(s, 4.9, 6.2) * (1 - ramp(s, 8.3, 8.6)) : 0;
  // On the board Dana's job moves New, In progress, Done.
  const hop1 = c.id === "dana" ? ramp(s, 11.6, 12.2) : 0, hop2 = c.id === "dana" ? ramp(s, 13.0, 13.6) : 0;
  const tx = BX + (c.col + hop1 + hop2) * (CW + GAP), ty = BY + 84 + (c.id === "dana" ? (hop2 > 0.5 ? 1 : hop1 > 0.5 ? 2 : 0) : c.row) * (CH + 18);
  const x = c.x + (tx - c.x) * tidy, y = c.y + (ty - c.y) * tidy + lost * 60;
  const w = SW + (CW - SW) * tidy, h = SH + (CH - SH) * tidy;
  const rot = c.r * (1 - tidy) + lost * -8;
  const done = c.id === "dana" ? hop2 > 0.5 : c.col === 2;
  const status = c.id === "dana" ? (hop2 > 0.5 ? "Paid" : hop1 > 0.5 ? "Quote sent" : c.status) : c.status;
  const paper = c.kind === "note" ? "#e9e4b4" : c.kind === "chat" ? "#1c2a4a" : "#12301f";
  const ink = c.kind === "note" ? "#1a1a12" : "#fff";
  const mix = (a: number, b: number) => Math.round(a + (b - a) * tidy);
  const hex = (p: string) => [1, 3, 5].map((i) => parseInt(p.slice(i, i + 2), 16));
  const [pr, pg, pb] = hex(paper);
  const bg = `rgb(${mix(pr, 20)},${mix(pg, 22)},${mix(pb, 20)})`;
  const fg = tidy > 0.5 ? "#fff" : ink;
  if (s < c.at) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 14 + tidy * 8, background: bg, border: tidy > 0.5 ? `2px solid ${done ? "rgba(199,255,61,0.6)" : "rgba(255,255,255,0.12)"}` : "none", boxShadow: `0 ${24 * (1 - tidy)}px ${50 * (1 - tidy)}px rgba(0,0,0,0.6)`, transform: `rotate(${rot}deg) scale(${0.6 + pop * 0.4})`, opacity: Math.min(1, pop * 1.5) * (1 - lost * 0.85), padding: `${22 - tidy * 4}px ${26 - tidy * 6}px`, boxSizing: "border-box", zIndex: c.id === "dana" && tidy < 0.5 ? 0 : 2 }}>
      <div style={{ fontFamily: IS, fontSize: 20 + tidy * 2, letterSpacing: tidy > 0.5 ? 0 : 3, color: tidy > 0.5 ? (done ? LI : "rgba(255,255,255,0.55)") : c.kind === "note" ? "rgba(26,26,18,0.55)" : "rgba(255,255,255,0.6)" }}>{tidy > 0.5 ? status : c.top}</div>
      <div style={{ marginTop: 12 - tidy * 4, fontFamily: c.kind === "note" && tidy < 0.5 ? IS : IL, fontSize: 38 - tidy * 2, lineHeight: 1.12, letterSpacing: -1, color: fg }}>{c.text}</div>
    </div>
  );
};

export const LynqNotes: React.FC = () => {
  const { s } = useT();
  const board = ramp(s, 8.5, 9.3);
  const end = ramp(s, 15.2, 15.8);
  const shake = s >= 6.2 && s < 6.6 ? Math.sin((s - 6.2) * 70) * 5 * (1 - (s - 6.2) / 0.4) : 0;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <div style={{ position: "absolute", left: 540 - 760, top: 1000 - 760, width: 1520, height: 1520, borderRadius: 760, background: `radial-gradient(closest-side, ${board > 0.5 ? "rgba(199,255,61,0.14)" : "rgba(255,190,90,0.08)"} 0%, rgba(0,0,0,0) 100%)`, opacity: 1 - end }} />

      <Line text="I lost a job in my own notes." at={0.15} out={2.6} lime={["lost"]} />
      <Line text="A sticky note. Two chats. A spreadsheet." at={2.9} out={5.0} />
      <Line text="Dana waited four days. Then hired someone else." at={5.3} out={8.2} lime={["someone", "else"]} size={60} />
      <Line text="So I put every job in one place." at={8.6} out={11.2} lime={["one", "place"]} />
      <Line text="Now I see what's waiting on me." at={11.5} out={13.2} lime={["waiting"]} />
      <Line text="Quoted. Done. Paid." at={13.4} out={15.0} lime={["Paid"]} />

      <div style={{ opacity: 1 - end, transform: `translateX(${shake}px)` }}>
        {/* the board frame fades in behind the pieces */}
        <div style={{ position: "absolute", left: BX - 26, top: BY - 26, width: 3 * CW + 2 * GAP + 52, height: 790, borderRadius: 34, background: "#0c0d0c", border: "2px solid rgba(255,255,255,0.08)", opacity: board }}>
          {COLS.map((n, i) => (
            <div key={n} style={{ position: "absolute", left: 26 + i * (CW + GAP), top: 34, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 14, height: 14, borderRadius: 7, background: i === 2 ? LI : "rgba(255,255,255,0.4)" }} />
              <span style={{ fontFamily: IS, fontSize: 32, color: "#fff" }}>{n}</span>
            </div>
          ))}
        </div>
        {SCRAPS.map((c) => <Piece key={c.id} c={c} />)}
        {s >= 6.2 && s < 8.3 ? <div style={{ position: "absolute", left: 120, top: 600, width: SW, height: SH, borderRadius: 14, border: "3px dashed rgba(255,255,255,0.25)", transform: "rotate(-7deg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 24, letterSpacing: 5, color: "rgba(255,255,255,0.4)", opacity: ramp(s, 6.2, 6.6) }}>WHERE DID IT GO?</div> : null}
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 1700, textAlign: "center", fontFamily: IS, fontSize: 19, letterSpacing: 5, color: "rgba(255,255,255,0.34)", opacity: 1 - end }}>MADE-UP STORY</div>

      <AbsoluteFill style={{ opacity: end, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "0 90px", transform: `translateY(${(1 - end) * 30}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 84, lineHeight: 1.06, letterSpacing: -4, color: "#fff" }}>A business can't run on sticky notes.</div>
          <div style={{ fontFamily: IL, fontSize: 84, lineHeight: 1.06, letterSpacing: -4, color: LI, marginTop: 26 }}>Put it in one system.</div>
          <div style={{ display: "inline-block", marginTop: 70, padding: "24px 50px", borderRadius: 60, background: LI, fontFamily: IS, fontSize: 38, color: "#0b0d0a" }}>Book a consultation</div>
          <div style={{ marginTop: 22, fontFamily: IL, fontSize: 32, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>lynq.build/book</div>
        </div>
      </AbsoluteFill>

      {SCRAPS.map((c) => <Sfx key={c.id} at={c.at} src="pop.wav" volume={0.4} />)}
      <Sfx at={6.2} src="thump.wav" volume={0.45} />
      <Sfx at={8.6} src="whoosh.wav" volume={0.45} />
      <Sfx at={11.6} src="click.wav" volume={0.5} />
      <Sfx at={13.0} src="click.wav" volume={0.5} />
      <Sfx at={13.6} src="ding.wav" volume={0.55} />
      <Sfx at={15.2} src="whoosh.wav" volume={0.4} />
    </AbsoluteFill>
  );
};
