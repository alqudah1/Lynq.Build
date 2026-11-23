import React from "react";
import { AbsoluteFill } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * "The 9 PM customer": one customer, three plumbers, one text each. Two answer the next
 * morning (or never). The third answers in seconds because an assistant is on, and it says
 * so in its first line. The shops are made up and labelled from the first frame.
 */
const LI = "#C7FF3D", BG = "#040405", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const NINEPM_DUR = 25;
const END = 19.4;
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const ASK = "Hi, my kitchen sink is leaking. Can someone come tomorrow?";

const Bubble: React.FC<{ at: number; mine?: boolean; children: React.ReactNode; small?: boolean }> = ({ at, mine, children, small }) => {
  const { s } = useT();
  if (s < at) return null;
  const p = ramp(s, at, at + 0.25, 0, 1, ease);
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginTop: 14, opacity: p, transform: `translateY(${(1 - p) * 18}px)` }}>
      <div style={{ maxWidth: 760, padding: small ? "14px 24px" : "18px 28px", borderRadius: 34, borderBottomRightRadius: mine ? 8 : 34, borderBottomLeftRadius: mine ? 34 : 8, background: mine ? "#2a2a31" : LI, color: mine ? "#fff" : "#0a0a0a", fontFamily: mine ? IL : IS, fontSize: small ? 32 : 36, lineHeight: 1.25 }}>{children}</div>
    </div>
  );
};

const Card: React.FC<{ top: number; h: number; name: string; at: number; glow?: boolean; children: React.ReactNode }> = ({ top, h, name, at, glow, children }) => {
  const p = useSpringAt(at, { damping: 16, stiffness: 150 });
  return (
    <div style={{ position: "absolute", left: 50, right: 50, top, height: h, borderRadius: 40, background: "#0e0e11", border: `2px solid ${glow ? "rgba(199,255,61,0.55)" : "rgba(255,255,255,0.12)"}`, boxShadow: glow ? "0 0 90px rgba(199,255,61,0.14)" : "none", padding: "22px 30px", opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 60}px)`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 54, height: 54, borderRadius: 27, background: glow ? LI : "#26262c", color: glow ? "#0a0a0a" : "#fff", fontFamily: IS, fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>{name[0]}</div>
        <div style={{ fontFamily: IS, fontSize: 34, color: "#fff" }}>{name}</div>
      </div>
      {children}
    </div>
  );
};

export const LynqNinePm: React.FC = () => {
  const { s } = useT();
  const morning = s >= 11.6;
  const clock = morning ? "8:04 AM" : s < 7.0 ? "9:02 PM" : "9:03 PM";
  const flip = ramp(s, 11.6, 12.0);
  const typing = s >= 6.2 && s < 7.0;
  const status = (sentAt: number, idx: number) => {
    if (s < sentAt + 0.4) return null;
    const m = morning && s >= 12.4 + idx * 0.9;
    return (
      <div style={{ textAlign: "right", marginTop: 10, fontFamily: m ? IS : IL, fontSize: 26, color: m ? "#ff7a6b" : "rgba(255,255,255,0.45)" }}>
        {m ? (idx === 0 ? "Replied 8:04 AM, eleven hours later" : "Still no reply") : "Delivered · 9:02 PM"}
      </div>
    );
  };
  const cap = (text: string, a: number, b: number) => {
    if (s < a || s > b + 0.25) return null;
    const p = ramp(s, a, a + 0.3, 0, 1, ease) * (1 - ramp(s, b, b + 0.25));
    return <div key={text} style={{ position: "absolute", left: 60, right: 60, top: 258, fontFamily: IL, fontSize: 46, lineHeight: 1.15, color: "rgba(255,255,255,0.85)", opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>{text}</div>;
  };
  const e = useSpringAt(END + 0.1, { damping: 14, stiffness: 150 });
  const tap = s >= END + 2.6 && s < END + 2.85;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      {s < END ? (
        <>
          <div style={{ position: "absolute", left: 60, top: 84, fontFamily: IS, fontSize: 26, letterSpacing: 10, color: "#fff" }}>LYNQ</div>
          <div style={{ position: "absolute", right: 60, top: 86, fontFamily: IS, fontSize: 20, letterSpacing: 5, color: "rgba(255,255,255,0.5)" }}>MADE-UP SHOPS</div>
          <div style={{ position: "absolute", left: 60, top: 132, display: "flex", alignItems: "baseline", gap: 20, transform: `scale(${1 + Math.sin(flip * Math.PI) * 0.08})`, transformOrigin: "0 50%" }}>
            <div style={{ fontFamily: IS, fontSize: 108, letterSpacing: -4, color: morning ? "#fff" : LI, lineHeight: 1 }}>{clock}</div>
            {morning ? <div style={{ fontFamily: IS, fontSize: 26, letterSpacing: 6, color: LI }}>NEXT MORNING</div> : null}
          </div>
          {cap("Her sink is leaking. She texts three plumbers.", 0.3, 5.6)}
          {cap("One of them answers in seconds.", 6.6, 11.2)}
          {cap("The other two wake up.", 11.8, 15.0)}
          {cap("She booked last night.", 15.4, 19.0)}

          <Card top={390} h={272} name="Harbour Plumbing" at={1.2}>
            <Bubble at={2.4} mine small>{ASK}</Bubble>
            {status(2.4, 0)}
          </Card>
          <Card top={682} h={272} name="QuickFix Plumbing" at={1.4}>
            <Bubble at={3.6} mine small>{ASK}</Bubble>
            {status(3.6, 1)}
          </Card>
          <Card top={974} h={810} name="Northside Plumbing" at={1.6} glow={s >= 7.0}>
            <Bubble at={4.8} mine small>{ASK}</Bubble>
            {typing ? <div style={{ marginTop: 14, display: "flex", gap: 10, padding: "20px 26px", width: 120, borderRadius: 30, background: "#1c1c21" }}>{[0, 1, 2].map((k) => <div key={k} style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", opacity: 0.3 + 0.7 * Math.abs(Math.sin(s * 8 + k)) }} />)}</div> : null}
            <Bubble at={7.0}>Hi, I'm Northside's assistant. Sorry about the leak. I can book a plumber for tomorrow at 8:30 AM or 11:00 AM. Which works?</Bubble>
            <Bubble at={8.9} mine small>8:30 please</Bubble>
            <Bubble at={9.9}>Booked. Tomorrow, 8:30 AM. You'll get a reminder at 7:30.</Bubble>
            {s >= 10.6 ? <div style={{ marginTop: 22, display: "inline-block", padding: "10px 24px", borderRadius: 30, border: `2px solid ${LI}`, fontFamily: IS, fontSize: 26, letterSpacing: 3, color: LI, opacity: ramp(s, 10.6, 10.9) }}>BOOKED AT 9:03 PM</div> : null}
          </Card>
        </>
      ) : (
        <div style={{ position: "absolute", left: 70, right: 70, top: 600, textAlign: "center", opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * 40}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 92, letterSpacing: -3.5, lineHeight: 1.06, color: "#fff" }}>Nobody was awake<br />at Northside either.</div>
          <div style={{ fontFamily: IS, fontSize: 92, letterSpacing: -3.5, lineHeight: 1.06, color: LI, marginTop: 30, opacity: ramp(s, END + 1.2, END + 1.5) }}>We build that.</div>
          <div style={{ display: "inline-block", marginTop: 84, padding: "32px 70px", borderRadius: 70, background: LI, fontFamily: IS, fontSize: 50, color: "#0a0a0a", transform: `scale(${tap ? 0.93 : 1})`, boxShadow: "0 0 80px rgba(199,255,61,0.35)", opacity: ramp(s, END + 1.9, END + 2.2) }}>Book a consultation</div>
          <div style={{ marginTop: 50, fontFamily: IS, fontSize: 28, letterSpacing: 8, color: "#fff" }}>LINK IN BIO</div>
          <div style={{ marginTop: 14, fontFamily: IL, fontSize: 30, color: "rgba(255,255,255,0.55)" }}>lynq.build/book</div>
          <div style={{ marginTop: 90, fontFamily: IS, fontSize: 20, letterSpacing: 5, color: "rgba(255,255,255,0.45)" }}>MADE-UP SHOPS · THE ASSISTANT IS REAL</div>
        </div>
      )}
      {[2.4, 3.6, 4.8, 7.0, 8.9, 9.9].map((t) => <Sfx key={t} at={t} src="pop.wav" volume={0.25} />)}
      <Sfx at={END + 2.6} src="click.wav" volume={0.4} />
    </AbsoluteFill>
  );
};
