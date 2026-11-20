import React from "react";
import { AbsoluteFill } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ offer reel, third cut: "the call". A closed shop at 11:42 PM, a neon CLOSED sign, the
 * phone rings and the assistant takes the call on screen. Then the neon sign itself flips to
 * the offer. Built to be voiced as a two-person phone call. The shop is made up.
 */
const LI = "#C7FF3D", RED = "#ff4d5e", BG = "#040405", IL = "'Inter Light'", IS = "'Inter SemiBold'";
export const NEON_DUR = 21;
const TALK: [number, "a" | "c", string][] = [
  [3.3, "a", "Northline Cuts. How can I help?"],
  [5.3, "c", "Any chance of a cut Saturday morning?"],
  [7.5, "a", "9:30 is open. Want it?"],
  [9.1, "c", "Yes please."],
  [10.1, "a", "Booked. See you Saturday."],
];

const neon = (c: string, on: number) => ({ color: on > 0.5 ? "#fff" : "rgba(255,255,255,0.12)", textShadow: on > 0.5 ? `0 0 12px ${c}, 0 0 34px ${c}, 0 0 80px ${c}, 0 0 150px ${c}` : "none" });

export const LynqNeon: React.FC = () => {
  const { s } = useT();
  // sign: CLOSED (red) with a nervous flicker, then it dies and relights as the offer (lime)
  const flick = s < 0.5 ? (Math.floor(s * 22) % 3 === 0 ? 0 : 1) : s > 13.0 && s < 13.9 ? (Math.floor(s * 26) % 2) : 1;
  const offer = s >= 13.9;
  const relight = offer ? (s < 14.5 ? (Math.floor(s * 24) % 3 === 0 ? 0 : 1) : 1) : 0;
  const signH = offer ? 470 : 300;
  const ring = s >= 0.9 && s < 2.9;
  const buzz = ring ? Math.sin(s * 70) * 5 : 0;
  const pulse = ring ? ((s - 0.9) % 0.8) / 0.8 : 0;
  const call = ramp(s, 2.6, 3.1) * (1 - ramp(s, 11.6, 12.0));
  const booked = useSpringAt(12.0, { damping: 12, stiffness: 190 });
  const bookedOut = ramp(s, 16.6, 17.0);
  const end = ramp(s, 17.0, 17.5);
  const tapT = ((s - 18.0) % 1.3 + 1.3) % 1.3;
  const tap = s > 18.0 ? (tapT < 0.16 ? tapT / 0.16 : tapT < 0.38 ? 1 - (tapT - 0.16) / 0.22 : 0) : 0;
  const sub = ramp(s, 14.8, 15.2) * (1 - ramp(s, 16.6, 17.0));
  const col = offer ? LI : RED;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      {/* wall glow from the sign */}
      <div style={{ position: "absolute", left: 540 - 900, top: 380 - 900, width: 1800, height: 1800, borderRadius: 900, background: `radial-gradient(closest-side, ${offer ? "rgba(199,255,61,0.20)" : "rgba(255,77,94,0.20)"} 0%, rgba(0,0,0,0) 100%)`, opacity: (offer ? relight : flick) * (1 - end) }} />

      {/* clock */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", fontFamily: IS, fontSize: 30, letterSpacing: 8, color: "rgba(255,255,255,0.55)", opacity: 1 - end }}>11:42 PM</div>

      {/* the neon sign */}
      <div style={{ position: "absolute", left: 150, right: 150, top: 200, height: signH, borderRadius: 50, border: `8px solid ${(offer ? relight : flick) > 0.5 ? col : "rgba(255,255,255,0.1)"}`, boxShadow: (offer ? relight : flick) > 0.5 ? `0 0 30px ${col}, inset 0 0 30px ${col}55` : "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 1 - end, transform: `scale(${1 - end * 0.1})` }}>
        {offer ? (
          <>
            <div style={{ fontFamily: IS, fontSize: 96, letterSpacing: 6, lineHeight: 1, ...neon(LI, relight) }}>FIRST MONTH</div>
            <div style={{ fontFamily: IS, fontSize: 210, letterSpacing: 10, lineHeight: 1.02, ...neon(LI, relight) }}>FREE</div>
          </>
        ) : <div style={{ fontFamily: IS, fontSize: 160, letterSpacing: 16, ...neon(RED, flick) }}>CLOSED</div>}
      </div>
      <div style={{ position: "absolute", left: 80, right: 80, top: 720, textAlign: "center", opacity: sub }}>
        <div style={{ fontFamily: IL, fontSize: 62, letterSpacing: -2, lineHeight: 1.1, color: "#fff" }}>We build it for you.</div>
        <div style={{ fontFamily: IL, fontSize: 62, letterSpacing: -2, lineHeight: 1.1, color: LI }}>Your first month of work is on us.</div>
      </div>

      {/* the phone on the counter, ringing in the dark */}
      {s < 3.1 ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1420, height: 6, background: "rgba(255,255,255,0.10)", opacity: 1 - call }} />
          {ring ? [0, 1].map((k) => { const p = (pulse + k * 0.5) % 1; return <div key={k} style={{ position: "absolute", left: 540 - 170 - p * 160, top: 1250 - 170 - p * 160, width: 340 + p * 320, height: 340 + p * 320, borderRadius: 400, border: `5px solid ${LI}`, opacity: (1 - p) * 0.6 }} />; }) : null}
          <div style={{ position: "absolute", left: 540 - 105 + buzz, top: 1060, width: 210, height: 360, borderRadius: 36, background: "#111", border: "5px solid #2a2a2e", opacity: 1 - call, transform: `rotate(${buzz * 0.4}deg)`, boxShadow: ring ? "0 0 90px rgba(199,255,61,0.45)" : "none", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 10, borderRadius: 26, background: ring ? "#16210a" : "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
              {ring ? <><div style={{ width: 70, height: 70, borderRadius: 35, background: LI }} /><div style={{ fontFamily: IS, fontSize: 20, letterSpacing: 2, color: "#fff" }}>INCOMING</div></> : null}
            </div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1560, textAlign: "center", fontFamily: IL, fontSize: 54, letterSpacing: -1.5, color: "#fff", opacity: ramp(s, 0.5, 0.9) * (1 - call) }}>The shop is closed. <span style={{ color: LI }}>The phone rings.</span></div>
        </>
      ) : null}

      {/* the call, answered */}
      {call > 0 ? (
        <div style={{ position: "absolute", left: 70, right: 70, top: 600, bottom: 150, borderRadius: 56, background: "#0e0f10", border: "1px solid rgba(255,255,255,0.12)", opacity: call, transform: `scale(${0.6 + call * 0.4}) translateY(${(1 - call) * 300}px)`, overflow: "hidden" }}>
          <div style={{ padding: "40px 46px 30px", display: "flex", alignItems: "center", gap: 26, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ width: 92, height: 92, borderRadius: 46, background: LI, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 40, color: "#0b0d0a" }}>N</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: IS, fontSize: 42, color: "#fff", letterSpacing: -1 }}>Northline Cuts</div>
              <div style={{ fontFamily: IS, fontSize: 24, letterSpacing: 3, color: LI, marginTop: 6 }}>● ANSWERED BY THE ASSISTANT</div>
            </div>
            <div style={{ fontFamily: IL, fontSize: 36, color: "rgba(255,255,255,0.6)" }}>0:{String(Math.max(0, Math.floor(s - 3.1))).padStart(2, "0")}</div>
          </div>
          {/* live waveform */}
          <div style={{ height: 130, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
            {Array.from({ length: 34 }).map((_, i) => {
              const cur = [...TALK].reverse().find((t) => s >= t[0]);
              const live = cur && s < cur[0] + 1.7;
              const h = live ? 14 + Math.abs(Math.sin(s * 11 + i * 0.9) * Math.cos(s * 5 + i * 0.37)) * 86 : 10;
              return <div key={i} style={{ width: 9, height: h, borderRadius: 5, background: cur && cur[1] === "a" ? LI : "#fff", opacity: 0.85 }} />;
            })}
          </div>
          <div style={{ padding: "6px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
            {TALK.map(([at, who, text]) => {
              if (s < at) return null;
              const p = ramp(s, at, at + 0.25);
              const a = who === "a";
              return (
                <div key={at} style={{ alignSelf: a ? "flex-start" : "flex-end", maxWidth: "84%", padding: "24px 32px", borderRadius: 36, background: a ? LI : "#2a2c30", color: a ? "#0b0d0a" : "#fff", fontFamily: a ? IS : IL, fontSize: 40, letterSpacing: -0.8, lineHeight: 1.18, opacity: p, transform: `translateY(${(1 - p) * 26}px)` }}>{text}</div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* after the call */}
      {s >= 12.0 && s < 17.1 ? (
        <div style={{ position: "absolute", left: 110, right: 110, top: offer ? 1010 : 760, opacity: Math.min(1, booked * 1.3) * (1 - bookedOut), transform: `scale(${0.8 + booked * 0.2})` }}>
          <div style={{ borderRadius: 40, background: "rgba(199,255,61,0.10)", border: `2px solid rgba(199,255,61,0.6)`, padding: "34px 40px", display: "flex", alignItems: "center", gap: 30 }}>
            <div style={{ width: 92, height: 92, borderRadius: 46, background: LI, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 36, height: 19, borderLeft: "8px solid #0b0d0a", borderBottom: "8px solid #0b0d0a", transform: "rotate(-45deg)", marginTop: -8 }} /></div>
            <div><div style={{ fontFamily: IS, fontSize: 46, color: "#fff", letterSpacing: -1 }}>Booked while closed</div><div style={{ fontFamily: IL, fontSize: 34, color: "rgba(255,255,255,0.7)", marginTop: 6 }}>Saturday · 9:30 AM · 47 seconds</div></div>
          </div>
          {!offer ? <div style={{ marginTop: 70, textAlign: "center", fontFamily: IL, fontSize: 70, letterSpacing: -3, lineHeight: 1.08, color: "#fff", opacity: ramp(s, 12.3, 12.7) }}>Nobody was there.<br /><span style={{ color: LI }}>The call still got answered.</span></div> : null}
        </div>
      ) : null}

      {/* call to action */}
      <AbsoluteFill style={{ opacity: end, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "0 80px", transform: `translateY(${(1 - end) * 30}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 88, lineHeight: 1.05, letterSpacing: -4, color: "#fff" }}>Want your phone</div>
          <div style={{ fontFamily: IL, fontSize: 88, lineHeight: 1.05, letterSpacing: -4, color: LI }}>answered at midnight?</div>
          <div style={{ position: "relative", display: "inline-block", marginTop: 90 }}>
            <div style={{ padding: "34px 72px", borderRadius: 80, background: LI, fontFamily: IS, fontSize: 54, color: "#0b0d0a", transform: `scale(${1 - tap * 0.07})`, boxShadow: `0 0 ${40 + tap * 60}px rgba(199,255,61,0.5)` }}>Book a consultation</div>
            <div style={{ position: "absolute", right: 30 - tap * 14, bottom: -70 + tap * 16, width: 78, height: 78, borderRadius: 39, background: "rgba(255,255,255,0.9)", border: "6px solid rgba(0,0,0,0.25)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)", transform: `scale(${1 - tap * 0.18})` }} />
          </div>
          <div style={{ marginTop: 100, fontFamily: IS, fontSize: 34, letterSpacing: 6, color: "rgba(255,255,255,0.75)" }}>LINK IN BIO</div>
          <div style={{ marginTop: 14, fontFamily: IL, fontSize: 34, letterSpacing: 2, color: "rgba(255,255,255,0.55)" }}>lynq.build/book</div>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1800, textAlign: "center", fontFamily: IS, fontSize: 19, letterSpacing: 5, color: "rgba(255,255,255,0.34)", opacity: 1 - end }}>THE SHOP IS MADE UP</div>

      <Sfx at={0.9} src="ring.wav" volume={0.7} />
      <Sfx at={1.9} src="ring.wav" volume={0.7} />
      <Sfx at={2.7} src="click.wav" volume={0.6} />
      {TALK.map(([at]) => <Sfx key={at} at={at} src="pop.wav" volume={0.3} />)}
      <Sfx at={12.0} src="ding.wav" volume={0.6} />
      <Sfx at={13.9} src="thump.wav" volume={0.6} />
      <Sfx at={17.0} src="whoosh.wav" volume={0.35} />
      <Sfx at={18.16} src="click.wav" volume={0.5} />
    </AbsoluteFill>
  );
};
