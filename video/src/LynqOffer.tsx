import React from "react";
import { AbsoluteFill } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ offer reel: "Looking for an AI consultant?"
 * A search bar types the question people actually ask, three things an assistant does land as
 * cards, then the offer as two tickets. Draft: offer wording must be confirmed before posting.
 */
const LI = "#C7FF3D", BG = "#030303", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const OFFER_DUR = 13;
const Q = "can AI actually help my business?";

const Job: React.FC<{ at: number; n: string; title: string; sub: string; y: number }> = ({ at, n, title, sub, y }) => {
  const p = useSpringAt(at, { damping: 13, stiffness: 190 });
  const { s } = useT();
  const out = ramp(s, 7.3, 7.7);
  if (s < at) return null;
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: y, borderRadius: 40, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", padding: "34px 38px", display: "flex", alignItems: "center", gap: 30, opacity: Math.min(1, p * 1.4) * (1 - out), transform: `translateX(${(1 - p) * 120 - out * 160}px)` }}>
      <div style={{ width: 84, height: 84, borderRadius: 42, background: LI, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 38, color: "#0b0d0a", flexShrink: 0 }}>{n}</div>
      <div>
        <div style={{ fontFamily: IS, fontSize: 46, letterSpacing: -1, color: "#fff" }}>{title}</div>
        <div style={{ fontFamily: IL, fontSize: 32, color: "rgba(255,255,255,0.65)", marginTop: 6 }}>{sub}</div>
      </div>
    </div>
  );
};

const Ticket: React.FC<{ at: number; top: string; big: string; y: number; rot: number }> = ({ at, top, big, y, rot }) => {
  const p = useSpringAt(at, { damping: 11, stiffness: 170 });
  const { s } = useT();
  const out = ramp(s, 10.6, 11.0);
  if (s < at) return null;
  return (
    <div style={{ position: "absolute", left: 110, right: 110, top: y, borderRadius: 36, background: LI, padding: "40px 46px", opacity: Math.min(1, p * 1.4) * (1 - out), transform: `translateY(${(1 - p) * 200}px) rotate(${rot * p}deg) scale(${0.85 + p * 0.15})`, boxShadow: "0 40px 100px rgba(199,255,61,0.18)" }}>
      <div style={{ fontFamily: IS, fontSize: 26, letterSpacing: 6, color: "rgba(11,13,10,0.6)" }}>{top}</div>
      <div style={{ fontFamily: IS, fontSize: 78, letterSpacing: -3, lineHeight: 1.02, color: "#0b0d0a", marginTop: 10 }}>{big}</div>
      <div style={{ position: "absolute", left: -22, top: "50%", width: 44, height: 44, borderRadius: 22, background: BG, marginTop: -22 }} />
      <div style={{ position: "absolute", right: -22, top: "50%", width: 44, height: 44, borderRadius: 22, background: BG, marginTop: -22 }} />
    </div>
  );
};

export const LynqOffer: React.FC = () => {
  const { s } = useT();
  const bar = useSpringAt(0.05, { damping: 14, stiffness: 200 });
  const typed = Q.slice(0, Math.floor(ramp(s, 0.25, 1.9, 0, Q.length, (x) => x)));
  const barUp = ramp(s, 2.3, 2.8);
  const barOut = ramp(s, 7.3, 7.7);
  const yes = useSpringAt(2.4, { damping: 12, stiffness: 200 });
  const head2 = ramp(s, 7.7, 8.1) * (1 - ramp(s, 10.6, 11.0));
  const end = ramp(s, 11.0, 11.5);
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <div style={{ position: "absolute", left: 540 - 800, top: 960 - 800, width: 1600, height: 1600, borderRadius: 800, background: "radial-gradient(closest-side, rgba(199,255,61,0.13) 0%, rgba(0,0,0,0) 100%)" }} />

      {/* the question, typed into a search bar */}
      <div style={{ position: "absolute", left: 70, right: 70, top: 860 - barUp * 560, height: 130, borderRadius: 65, background: "#141516", border: "1px solid rgba(255,255,255,0.16)", display: "flex", alignItems: "center", padding: "0 44px", gap: 24, opacity: Math.min(1, bar * 1.4) * (1 - barOut), transform: `scale(${0.9 + bar * 0.1})` }}>
        <div style={{ width: 34, height: 34, borderRadius: 20, border: "5px solid rgba(255,255,255,0.5)", flexShrink: 0 }} />
        <div style={{ fontFamily: IL, fontSize: 46, letterSpacing: -1, color: "#fff", whiteSpace: "nowrap" }}>{typed}<span style={{ opacity: Math.floor(s * 2.5) % 2 ? 0 : 1, color: LI }}>|</span></div>
      </div>
      {s >= 2.4 && s < 7.8 ? <div style={{ position: "absolute", left: 90, top: 470, fontFamily: IL, fontSize: 104, letterSpacing: -5, color: "#fff", opacity: Math.min(1, yes * 1.3) * (1 - barOut), transform: `translateY(${(1 - yes) * 40}px)` }}>Yes. <span style={{ color: LI }}>Like this.</span></div> : null}

      <Job at={3.3} n="1" title="Answers at 2 AM" sub="Every message, every call" y={690} />
      <Job at={4.5} n="2" title="Books the appointment" sub="Straight into your calendar" y={920} />
      <Job at={5.7} n="3" title="Follows up for you" sub="No lead left sitting" y={1150} />

      <div style={{ position: "absolute", left: 90, right: 90, top: 330, fontFamily: IL, fontSize: 84, lineHeight: 1.05, letterSpacing: -4, color: "#fff", opacity: head2, transform: `translateY(${(1 - head2) * 30}px)` }}>Try it with us.<br /><span style={{ color: LI }}>On us.</span></div>
      <Ticket at={8.2} top="NO COST" big="Free consultation" y={640} rot={-2.5} />
      <Ticket at={9.0} top="WHEN YOU START" big="First month of your CRM free" y={930} rot={2} />

      <AbsoluteFill style={{ opacity: end, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "0 90px", transform: `translateY(${(1 - end) * 30}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 84, lineHeight: 1.06, letterSpacing: -4, color: "#fff" }}>Looking for an</div>
          <div style={{ fontFamily: IL, fontSize: 84, lineHeight: 1.06, letterSpacing: -4, color: LI }}>AI consultant?</div>
          <div style={{ display: "inline-block", marginTop: 70, padding: "24px 50px", borderRadius: 60, background: LI, fontFamily: IS, fontSize: 38, color: "#0b0d0a" }}>Book a consultation</div>
          <div style={{ marginTop: 22, fontFamily: IL, fontSize: 32, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>lynq.build/book</div>
        </div>
      </AbsoluteFill>

      {[0.3, 0.6, 0.9, 1.2, 1.5, 1.8].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.25} />)}
      <Sfx at={2.4} src="whoosh.wav" volume={0.35} />
      {[3.3, 4.5, 5.7].map((t) => <Sfx key={t} at={t} src="pop.wav" volume={0.5} />)}
      <Sfx at={7.4} src="whoosh.wav" volume={0.35} />
      <Sfx at={8.2} src="thump.wav" volume={0.45} />
      <Sfx at={9.0} src="thump.wav" volume={0.45} />
      <Sfx at={11.0} src="ding.wav" volume={0.5} />
    </AbsoluteFill>
  );
};
