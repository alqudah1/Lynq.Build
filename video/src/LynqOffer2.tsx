import React from "react";
import { AbsoluteFill } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ offer reel, second cut. Opens on a relatable scene (three missed calls after hours),
 * shows the calls being answered and booked, then the offer: first month of work free.
 * No date on screen (it lives in the caption). Ends on a tap-the-button call to action.
 */
const LI = "#C7FF3D", BG = "#030303", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const OFFER2_DUR = 17;
const CALLS = [["6:42 PM", "Haircut, Saturday?"], ["8:15 PM", "Do you take walk-ins?"], ["11:03 PM", "Can I book for two?"]] as const;

const Head: React.FC<{ a: string; b: string; at: number; out: number; top?: number }> = ({ a, b, at, out, top = 250 }) => {
  const { s } = useT();
  if (s < at || s > out + 0.3) return null;
  const i = ramp(s, at, at + 0.3), o = i * (1 - ramp(s, out, out + 0.3));
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top, textAlign: "center", opacity: o, transform: `translateY(${(1 - i) * 22}px)` }}>
      <div style={{ fontFamily: IL, fontSize: 80, letterSpacing: -3.4, lineHeight: 1.05, color: "#fff" }}>{a}</div>
      <div style={{ fontFamily: IL, fontSize: 80, letterSpacing: -3.4, lineHeight: 1.05, color: LI }}>{b}</div>
    </div>
  );
};

export const LynqOffer2: React.FC = () => {
  const { s } = useT();
  const flipAt = [4.3, 4.9, 5.5];
  const listOut = ramp(s, 8.2, 8.6);
  const stamp = useSpringAt(10.0, { damping: 9, stiffness: 190 });
  const ticket = useSpringAt(8.9, { damping: 12, stiffness: 170 });
  const offerOut = ramp(s, 12.3, 12.7);
  const end = ramp(s, 12.7, 13.2);
  const tapT = ((s - 13.6) % 1.4 + 1.4) % 1.4;
  const tap = s > 13.6 ? (tapT < 0.18 ? tapT / 0.18 : tapT < 0.4 ? 1 - (tapT - 0.18) / 0.22 : 0) : 0;
  const ring = s > 13.6 ? ramp(tapT, 0.18, 0.9) : 0;
  const shakeAll = s < 2.6;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <div style={{ position: "absolute", left: 540 - 800, top: 1000 - 800, width: 1600, height: 1600, borderRadius: 800, background: `radial-gradient(closest-side, rgba(${s < 4.3 ? "255,80,60" : "199,255,61"},0.13) 0%, rgba(0,0,0,0) 100%)` }} />
      <Head a="Three customers called." b="Nobody answered." at={0.1} out={3.5} />
      <Head a="Now every call" b="gets picked up." at={3.9} out={7.9} />
      <Head a="Want this" b="for your business?" at={8.6} out={12.2} top={230} />

      {/* the three calls: missed, then answered and booked */}
      {CALLS.map(([time, msg], i) => {
        const at = 0.5 + i * 0.6;
        const p = ramp(s, at, at + 0.3);
        if (s < at) return null;
        const f = ramp(s, flipAt[i], flipAt[i] + 0.35);
        const done = f > 0.5;
        const wob = shakeAll && s > at && s < at + 0.5 ? Math.sin((s - at) * 50) * 6 * (1 - (s - at) / 0.5) : 0;
        return (
          <div key={time} style={{ position: "absolute", left: 80, right: 80, top: 640 + i * 230, height: 190, borderRadius: 40, background: done ? "rgba(199,255,61,0.10)" : "rgba(255,80,60,0.10)", border: `2px solid ${done ? "rgba(199,255,61,0.6)" : "rgba(255,80,60,0.55)"}`, padding: "0 40px", display: "flex", alignItems: "center", gap: 32, opacity: p * (1 - listOut), transform: `translateX(${(1 - p) * 140 + wob}px) rotateX(${Math.sin(f * Math.PI) * 70}deg)` }}>
            <div style={{ width: 96, height: 96, borderRadius: 48, background: done ? LI : "#ff503c", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {done ? <div style={{ width: 38, height: 20, borderLeft: "8px solid #0b0d0a", borderBottom: "8px solid #0b0d0a", transform: "rotate(-45deg)", marginTop: -8 }} /> : <div style={{ fontFamily: IS, fontSize: 56, color: "#fff", marginTop: -4 }}>!</div>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: IS, fontSize: 46, color: "#fff", letterSpacing: -1 }}>{done ? "Answered and booked" : "Missed call"}</div>
              <div style={{ fontFamily: IL, fontSize: 32, color: "rgba(255,255,255,0.7)", marginTop: 6 }}>{done ? `"${msg}" Done.` : "Shop closed. No answer."}</div>
            </div>
            <div style={{ fontFamily: IS, fontSize: 28, letterSpacing: 2, color: done ? LI : "#ff8a7a" }}>{time}</div>
          </div>
        );
      })}

      {/* the offer */}
      {s >= 8.9 && s < 12.8 ? (
        <div style={{ position: "absolute", left: 90, right: 90, top: 560, opacity: 1 - offerOut }}>
          <div style={{ borderRadius: 44, background: LI, padding: "56px 54px 60px", transform: `translateY(${(1 - ticket) * 260}px) rotate(${-2.5 * ticket}deg) scale(${0.85 + ticket * 0.15})`, opacity: Math.min(1, ticket * 1.4), boxShadow: "0 50px 130px rgba(199,255,61,0.22)", position: "relative" }}>
            <div style={{ fontFamily: IS, fontSize: 30, letterSpacing: 7, color: "rgba(11,13,10,0.6)" }}>WE BUILD IT FOR YOU</div>
            <div style={{ fontFamily: IS, fontSize: 104, letterSpacing: -5, lineHeight: 0.98, color: "#0b0d0a", marginTop: 18 }}>Your first month of work</div>
            <div style={{ position: "absolute", left: -24, top: "50%", width: 48, height: 48, borderRadius: 24, background: BG, marginTop: -24 }} />
            <div style={{ position: "absolute", right: -24, top: "50%", width: 48, height: 48, borderRadius: 24, background: BG, marginTop: -24 }} />
          </div>
          {s >= 10.0 ? <div style={{ position: "absolute", right: -10, top: 250, padding: "16px 54px", borderRadius: 26, border: "10px solid #fff", background: BG, fontFamily: IS, fontSize: 150, letterSpacing: -4, color: "#fff", transform: `rotate(9deg) scale(${2.2 - stamp * 1.2})`, opacity: Math.min(1, stamp * 2) }}>FREE</div> : null}
          <div style={{ marginTop: 150, textAlign: "center", fontFamily: IL, fontSize: 44, letterSpacing: -1, color: "rgba(255,255,255,0.85)", opacity: ramp(s, 10.8, 11.2) }}>Starts with a free consultation.</div>
        </div>
      ) : null}

      {/* call to action */}
      <AbsoluteFill style={{ opacity: end, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "0 80px", transform: `translateY(${(1 - end) * 30}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 88, lineHeight: 1.05, letterSpacing: -4, color: "#fff" }}>First month free.</div>
          <div style={{ fontFamily: IL, fontSize: 88, lineHeight: 1.05, letterSpacing: -4, color: LI }}>Start here.</div>
          <div style={{ position: "relative", display: "inline-block", marginTop: 90 }}>
            <div style={{ position: "absolute", inset: -8, borderRadius: 90, border: `6px solid ${LI}`, opacity: (1 - ring) * 0.8, transform: `scale(${1 + ring * 0.35})` }} />
            <div style={{ padding: "34px 72px", borderRadius: 80, background: LI, fontFamily: IS, fontSize: 54, color: "#0b0d0a", transform: `scale(${1 - tap * 0.07})` }}>Book a consultation</div>
            <div style={{ position: "absolute", right: 30 - tap * 14, bottom: -70 + tap * 16, width: 78, height: 78, borderRadius: 39, background: "rgba(255,255,255,0.9)", border: "6px solid rgba(0,0,0,0.25)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)", transform: `scale(${1 - tap * 0.18})` }} />
          </div>
          <div style={{ marginTop: 100, fontFamily: IS, fontSize: 34, letterSpacing: 6, color: "rgba(255,255,255,0.75)" }}>LINK IN BIO</div>
          <div style={{ marginTop: 14, fontFamily: IL, fontSize: 34, letterSpacing: 2, color: "rgba(255,255,255,0.55)" }}>lynq.build/book</div>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1760, textAlign: "center", fontFamily: IS, fontSize: 19, letterSpacing: 5, color: "rgba(255,255,255,0.34)", opacity: 1 - end }}>THE SHOP IS MADE UP</div>

      {[0.5, 1.1, 1.7].map((t) => <Sfx key={t} at={t} src="thump.wav" volume={0.5} />)}
      {flipAt.map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.45} />)}
      <Sfx at={8.9} src="whoosh.wav" volume={0.4} />
      <Sfx at={10.0} src="thump.wav" volume={0.7} />
      <Sfx at={12.7} src="whoosh.wav" volume={0.35} />
      {[13.78, 15.18].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.5} />)}
    </AbsoluteFill>
  );
};
