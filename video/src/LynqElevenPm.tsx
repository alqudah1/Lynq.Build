import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ reel 2: "I messaged two shops at 11 PM."
 * Same build as the money reel: one phone, real-looking screens, no people, no AI footage.
 * She messages two shops late at night. One says nothing until morning. The other answers in
 * seconds and books her, because an assistant replies for them. Sells the AI assistant.
 * Both shops are made up. Silent first; voice (Yonisa) is cut in after the picture is approved.
 */
const LI = "#C7FF3D", BG = "#030303", IL = "'Inter Light'", IS = "'Inter SemiBold'";
const PW = 566, PH = 1170, PX = (1080 - PW) / 2, PY = 470, BZ = 12;
const SW = 390, SCALE = (PW - BZ * 2) / SW, SH = (PH - BZ * 2) / SCALE;
const SHOP_A = "Fern & Fade Barbers", SHOP_B = "Northline Cuts";
export const DUR = 23;

type Msg = { at: number; me?: boolean; text: string; stamp?: string; ai?: boolean };

const Bubble: React.FC<{ m: Msg }> = ({ m }) => {
  const p = useSpringAt(m.at, { damping: 15, stiffness: 190 });
  const { s } = useT();
  if (s < m.at) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start", marginTop: 14, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 14}px) scale(${0.94 + p * 0.06})`, transformOrigin: m.me ? "right bottom" : "left bottom" }}>
      {m.stamp ? <div style={{ alignSelf: "center", fontFamily: IL, fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "10px 0 10px" }}>{m.stamp}</div> : null}
      <div style={{ maxWidth: 300, padding: "13px 17px", borderRadius: 24, borderBottomRightRadius: m.me ? 7 : 24, borderBottomLeftRadius: m.me ? 24 : 7, background: m.me ? "#2f6bff" : m.ai ? LI : "#26282b", fontFamily: m.ai ? IS : IL, fontSize: 20, lineHeight: 1.28, color: m.ai ? "#0b0d0a" : "#fff" }}>{m.text}</div>
    </div>
  );
};

const Typing: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const { s } = useT();
  if (s < from || s >= to) return null;
  return (
    <div style={{ marginTop: 10, width: 58, padding: "12px 14px", borderRadius: 20, borderBottomLeftRadius: 6, background: "#26282b", display: "flex", gap: 5 }}>
      {[0, 1, 2].map((i) => <div key={i} style={{ width: 7, height: 7, borderRadius: 4, background: "#fff", opacity: 0.35 + 0.65 * Math.max(0, Math.sin((s - from) * 9 - i * 0.9)) }} />)}
    </div>
  );
};

const Chat: React.FC<{ shop: string; sub: React.ReactNode; msgs: Msg[]; children?: React.ReactNode }> = ({ shop, sub, msgs, children }) => (
  <div style={{ position: "absolute", inset: 0, background: "#0d0e10" }}>
    <div style={{ height: 92, paddingTop: 44, display: "flex", alignItems: "center", gap: 10, padding: "44px 14px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontFamily: IL, fontSize: 24, color: "#2f6bff", marginTop: -3 }}>‹</div>
      <div style={{ width: 34, height: 34, borderRadius: 17, background: "#1d2022", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 14, color: "#fff" }}>{shop[0]}</div>
      <div>
        <div style={{ fontFamily: IS, fontSize: 18, color: "#fff" }}>{shop}</div>
        <div style={{ fontFamily: IL, fontSize: 13.5, color: "rgba(255,255,255,0.55)" }}>{sub}</div>
      </div>
    </div>
    <div style={{ padding: "8px 14px" }}>
      {msgs.map((m) => <Bubble key={m.text} m={m} />)}
      {children}
    </div>
    <div style={{ position: "absolute", left: 14, right: 14, bottom: 26, height: 40, borderRadius: 20, border: "1px solid rgba(255,255,255,0.14)", display: "flex", alignItems: "center", padding: "0 16px", fontFamily: IL, fontSize: 14, color: "rgba(255,255,255,0.35)" }}>Message</div>
  </div>
);

const ASK = "Hi! Do you have anything Saturday morning?";

/** Shop A: her message, then a clock that runs through the night with no answer. */
const ChatA: React.FC = () => {
  const { s } = useT();
  const morning = s >= 13.2;
  return (
    <Chat shop={SHOP_A} sub={morning ? "Active now" : "Usually replies within a day"} msgs={[{ at: 0.7, me: true, text: ASK, stamp: "Today 11:04 PM" }, { at: 13.7, text: "Hi, sorry, just saw this! Still need Saturday?", stamp: "9:12 AM" }, { at: 14.9, me: true, text: "Already booked, thanks." }]}>
      {s >= 1.3 && !morning ? <div style={{ textAlign: "right", fontFamily: IL, fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 6 }}>Delivered</div> : null}
    </Chat>
  );
};

/** Shop B: same message, an answer in seconds, and a booking. */
const ChatB: React.FC = () => {
  const { s } = useT();
  const done = useSpringAt(10.0, { damping: 13, stiffness: 170 });
  return (
    <Chat shop={SHOP_B} sub={<span><span style={{ color: LI }}>●</span> Assistant · replies 24/7</span>} msgs={[
      { at: 5.9, me: true, text: ASK, stamp: "Today 11:05 PM" },
      { at: 7.2, ai: true, text: "Hi! Yes. Saturday at 9:30 or 11:00. Which works?" },
      { at: 8.5, me: true, text: "9:30" },
      { at: 9.5, ai: true, text: "Booked. Saturday 9:30. See you then." },
    ]}>
      {s >= 7.35 ? <div style={{ display: "inline-block", marginTop: 8, padding: "5px 12px", borderRadius: 20, border: "1px solid rgba(199,255,61,0.6)", fontFamily: IS, fontSize: 12.5, letterSpacing: 1.5, color: LI }}>REPLIED IN 3 SECONDS</div> : null}
      <Typing from={6.4} to={7.2} />
      <Typing from={8.9} to={9.5} />
      {s >= 10.0 ? (
        <div style={{ marginTop: 14, borderRadius: 16, background: "rgba(199,255,61,0.12)", border: "1px solid rgba(199,255,61,0.45)", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, opacity: Math.min(1, done * 1.3), transform: `scale(${0.9 + done * 0.1})`, transformOrigin: "left top" }}>
          <div style={{ width: 30, height: 30, borderRadius: 15, background: LI, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 13, height: 7, borderLeft: "3px solid #0b0d0a", borderBottom: "3px solid #0b0d0a", transform: "rotate(-45deg)", marginTop: -3 }} />
          </div>
          <div>
            <div style={{ fontFamily: IS, fontSize: 18, color: LI }}>Appointment confirmed</div>
            <div style={{ fontFamily: IL, fontSize: 15, color: "rgba(255,255,255,0.7)" }}>Saturday · 9:30 AM · Haircut</div>
          </div>
        </div>
      ) : null}
    </Chat>
  );
};

/** The clock in the status bar: it sits at 11:04, then spins through the night on shop A. */
const clock = (s: number) => {
  if (s >= 16.4) return "7:02";
  if (s >= 13.2) return "9:12";
  if (s >= 5.5) return s >= 8.5 ? "11:06" : "11:05";
  if (s < 2.9) return "11:04";
  const mins = Math.floor(ramp(s, 2.9, 5.2, 0, 174, (x) => x)); // 11:04 PM to about 2 AM
  const total = 23 * 60 + 4 + mins;
  const h = Math.floor(total / 60) % 24, m = total % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`;
};

const Line: React.FC<{ text: string; at: number; out: number; lime?: string[]; size?: number }> = ({ text, at, out, lime = [], size = 64 }) => {
  const { s } = useT();
  if (s < at || s > out + 0.3) return null;
  const words = text.split(" ");
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 236, textAlign: "center", fontFamily: IL, fontSize: size, lineHeight: 1.08, letterSpacing: -2.6, color: "#fff", opacity: 1 - ramp(s, out, out + 0.3) }}>
      {words.map((w, i) => {
        const t = at + i * 0.085;
        const o = ramp(s, t, t + 0.22);
        return <span key={i} style={{ display: "inline-block", marginRight: "0.24em", opacity: o, transform: `translateY(${(1 - o) * 18}px)`, color: lime.includes(w.replace(/[.,?]/g, "")) ? LI : "#fff" }}>{w}</span>;
      })}
    </div>
  );
};

export const LynqElevenPm: React.FC = () => {
  const { s } = useT();
  // Which chat is on screen: A, then B (5.5), then back to A in the morning (13.0).
  const toB = ramp(s, 5.35, 5.85), backA = ramp(s, 12.85, 13.35);
  const slide = toB - backA; // 0 = A, 1 = B
  const night = s >= 2.9 && s < 5.35;
  const dim = night ? ramp(s, 2.9, 3.6, 0, 0.55) : s < 5.9 ? 1 - ramp(s, 5.35, 5.6) > 0 && s >= 5.35 ? 0.55 * (1 - ramp(s, 5.35, 5.6)) : 0 : 0;
  const end = ramp(s, 19.6, 20.2);
  const lock = ramp(s, 16.4, 16.9); // the owner of shop two, next morning
  const phoneOut = ramp(s, 19.5, 20.1);
  const float = Math.sin(s * 1.3) * 5;
  const bump = s >= 7.2 && s < 7.5 ? Math.sin((s - 7.2) * 60) * 3 * (1 - (s - 7.2) / 0.3) : 0;
  const glow = s >= 16.4 ? "rgba(199,255,61,0.20)" : slide > 0.5 ? "rgba(199,255,61,0.20)" : s >= 13.2 ? "rgba(255,255,255,0.10)" : "rgba(60,100,255,0.13)";
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <div style={{ position: "absolute", left: 540 - 700, top: PY + PH / 2 - 700, width: 1400, height: 1400, borderRadius: 700, background: `radial-gradient(closest-side, ${glow} 0%, rgba(0,0,0,0) 100%)`, opacity: 1 - end }} />

      <Line text="11 PM. The only time I'm free to book." at={0.15} out={2.6} lime={["11", "PM"]} />
      <Line text="Shop one: nothing." at={2.9} out={5.2} lime={["nothing"]} size={76} />
      <Line text="Shop two: three seconds." at={5.7} out={8.2} lime={["three", "seconds"]} size={76} />
      <Line text="Saturday, 9:30. Done." at={8.5} out={10.6} lime={["Done"]} size={76} />
      <Line text="Nobody there was awake. Their assistant was." at={10.9} out={12.8} lime={["assistant"]} />
      <Line text="Shop one woke up at 9 AM." at={13.2} out={14.7} lime={["9", "AM"]} />
      <Line text="My Saturday was already taken." at={15.0} out={16.2} lime={["taken"]} />
      <Line text="Shop two's owner woke up to this." at={16.6} out={19.4} lime={["this"]} />

      <div style={{ position: "absolute", left: PX, top: PY + float + phoneOut * 900, width: PW, height: PH, borderRadius: 78, background: "#17191b", boxShadow: "0 60px 140px rgba(0,0,0,0.8), inset 0 0 0 2px rgba(255,255,255,0.10)", transform: `translateX(${bump}px) rotate(${Math.sin(s * 0.9) * 0.5}deg)`, opacity: 1 - phoneOut }}>
        <div style={{ position: "absolute", left: BZ, top: BZ, width: PW - BZ * 2, height: PH - BZ * 2, borderRadius: 66, overflow: "hidden", background: "#000" }}>
          <div style={{ width: SW, height: SH, transform: `scale(${SCALE})`, transformOrigin: "0 0", position: "relative" }}>
            <div style={{ position: "absolute", inset: 0, transform: `translateX(${-slide * SW}px)` }}><ChatA /></div>
            <div style={{ position: "absolute", inset: 0, transform: `translateX(${(1 - slide) * SW}px)` }}><ChatB /></div>
            <div style={{ position: "absolute", inset: 0, background: "#000", opacity: dim, pointerEvents: "none" }} />
            {/* the owner's lock screen: what the assistant did overnight */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#0b0f06 0%,#050505 60%)", transform: `translateY(${(1 - lock) * SH}px)` }}>
              <div style={{ marginTop: 96, textAlign: "center", fontFamily: IL, fontSize: 86, letterSpacing: -3, color: "#fff" }}>7:02</div>
              <div style={{ textAlign: "center", fontFamily: IL, fontSize: 17, color: "rgba(255,255,255,0.6)", marginTop: -4 }}>Good morning</div>
              <div style={{ padding: "26px 14px 0" }}>
                {[["Saturday · 9:30 AM", 17.1], ["Sunday · 2:00 PM", 17.5], ["Monday · 11:15 AM", 17.9]].map(([t, at]) => {
                  const o = ramp(s, at as number, (at as number) + 0.3);
                  return (
                    <div key={t as string} style={{ marginTop: 10, borderRadius: 20, background: "rgba(255,255,255,0.10)", padding: "13px 15px", display: "flex", alignItems: "center", gap: 12, opacity: o, transform: `translateY(${(1 - o) * 16}px) scale(${0.96 + o * 0.04})` }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: LI, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 18, color: "#0b0d0a" }}>N</div>
                      <div>
                        <div style={{ fontFamily: IS, fontSize: 15.5, color: "#fff" }}>New booking</div>
                        <div style={{ fontFamily: IL, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{t} · booked by your assistant</div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 18, textAlign: "center", fontFamily: IS, fontSize: 14, letterSpacing: 3, color: LI, opacity: ramp(s, 18.3, 18.7) }}>3 BOOKINGS WHILE YOU SLEPT</div>
              </div>
            </div>
            {night ? <div style={{ position: "absolute", left: 0, right: 0, top: 300, textAlign: "center", fontFamily: IL, fontSize: 64, letterSpacing: -2, color: "#fff", opacity: ramp(s, 3.0, 3.5) }}>{clock(s)}<div style={{ fontFamily: IL, fontSize: 14, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>STILL NO REPLY</div></div> : null}
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 26px 0", fontFamily: IS, fontSize: 15, color: "#fff" }}>
              <span>{clock(s)}</span>
              <span style={{ display: "flex", gap: 5, alignItems: "center" }}><span style={{ width: 17, height: 11, borderRadius: 3, border: "1.5px solid #fff", display: "inline-block" }} /></span>
            </div>
            <div style={{ position: "absolute", left: SW / 2 - 55, top: 10, width: 110, height: 30, borderRadius: 15, background: "#000" }} />
          </div>
        </div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 1700, textAlign: "center", fontFamily: IS, fontSize: 19, letterSpacing: 5, color: "rgba(255,255,255,0.34)", opacity: 1 - end }}>BOTH SHOPS ARE MADE UP</div>

      <AbsoluteFill style={{ opacity: end, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "0 90px", transform: `translateY(${(1 - end) * 30}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 84, lineHeight: 1.06, letterSpacing: -4, color: "#fff" }}>Wake up to bookings.</div>
          <div style={{ fontFamily: IL, fontSize: 84, lineHeight: 1.06, letterSpacing: -4, color: LI, marginTop: 26 }}>Not missed messages.</div>
          <div style={{ display: "inline-block", marginTop: 70, padding: "24px 50px", borderRadius: 60, background: LI, fontFamily: IS, fontSize: 38, color: "#0b0d0a" }}>Book a consultation</div>
          <div style={{ marginTop: 22, fontFamily: IL, fontSize: 32, letterSpacing: 2, color: "rgba(255,255,255,0.6)" }}>lynq.build/book</div>
        </div>
      </AbsoluteFill>

      <Sfx at={0.7} src="pop.wav" volume={0.5} />
      <Sfx at={5.4} src="whoosh.wav" volume={0.35} />
      <Sfx at={5.9} src="pop.wav" volume={0.5} />
      <Sfx at={7.2} src="ding.wav" volume={0.55} />
      <Sfx at={8.5} src="pop.wav" volume={0.5} />
      <Sfx at={9.5} src="ding.wav" volume={0.55} />
      <Sfx at={10.0} src="thump.wav" volume={0.4} />
      <Sfx at={12.9} src="whoosh.wav" volume={0.35} />
      <Sfx at={13.7} src="ding.wav" volume={0.4} />
      <Sfx at={14.9} src="pop.wav" volume={0.5} />
      <Sfx at={16.4} src="whoosh.wav" volume={0.4} />
      {[17.1, 17.5, 17.9].map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.5} />)}
      <Sfx at={19.6} src="whoosh.wav" volume={0.4} />
    </AbsoluteFill>
  );
};

/*
 * Result-first cut: the reel opens on the booking that already happened (a lock screen
 * notification), then tells the 11 PM story of how. Same body, shifted by COLD seconds.
 */
const COLD = 2.5;
export const DUR_RF = DUR + COLD;
const ColdOpen: React.FC = () => {
  const { s } = useT();
  const card = useSpringAt(0.12, { damping: 13, stiffness: 200 });
  const tick = useSpringAt(0.75, { damping: 10, stiffness: 240 });
  const out = ramp(s, COLD - 0.3, COLD);
  if (s > COLD) return null;
  const words = "This booking came in while the shop was closed.".split(" ");
  return (
    <AbsoluteFill style={{ background: BG, opacity: 1 - out }}>
      <div style={{ position: "absolute", left: 540 - 700, top: 960 - 700, width: 1400, height: 1400, borderRadius: 700, background: "radial-gradient(closest-side, rgba(199,255,61,0.20) 0%, rgba(0,0,0,0) 100%)" }} />
      <div style={{ position: "absolute", left: 70, right: 70, top: 470, textAlign: "center", fontFamily: IL, fontSize: 70, lineHeight: 1.08, letterSpacing: -2.8 }}>
        {words.map((w, i) => {
          const o = ramp(s, 0.25 + i * 0.07, 0.45 + i * 0.07);
          return <span key={i} style={{ display: "inline-block", marginRight: "0.24em", opacity: o, transform: `translateY(${(1 - o) * 18}px)`, color: w === "closed." ? LI : "#fff" }}>{w}</span>;
        })}
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 900, borderRadius: 44, background: "rgba(255,255,255,0.10)", border: "1px solid rgba(199,255,61,0.45)", padding: "40px 40px", display: "flex", alignItems: "center", gap: 32, opacity: Math.min(1, card * 1.4), transform: `translateY(${(1 - card) * 60}px) scale(${0.9 + card * 0.1})` }}>
        <div style={{ width: 104, height: 104, borderRadius: 52, background: LI, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${0.4 + tick * 0.6})`, flexShrink: 0 }}>
          <div style={{ width: 44, height: 24, borderLeft: "9px solid #0b0d0a", borderBottom: "9px solid #0b0d0a", transform: "rotate(-45deg)", marginTop: -10 }} />
        </div>
        <div>
          <div style={{ fontFamily: IS, fontSize: 50, color: "#fff", letterSpacing: -1 }}>New booking confirmed</div>
          <div style={{ fontFamily: IL, fontSize: 36, color: "rgba(255,255,255,0.7)", marginTop: 8 }}>Saturday · 9:30 AM · Haircut</div>
          <div style={{ fontFamily: IS, fontSize: 24, letterSpacing: 4, color: LI, marginTop: 14 }}>RECEIVED 11:06 PM</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1700, textAlign: "center", fontFamily: IS, fontSize: 19, letterSpacing: 5, color: "rgba(255,255,255,0.34)" }}>BOTH SHOPS ARE MADE UP</div>
      <Sfx at={0.12} src="ding.wav" volume={0.6} />
      <Sfx at={0.75} src="thump.wav" volume={0.4} />
    </AbsoluteFill>
  );
};

export const LynqElevenPmRF: React.FC = () => {
  const { fps } = useT();
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <Sequence from={Math.round(COLD * fps)}><LynqElevenPm /></Sequence>
      <ColdOpen />
    </AbsoluteFill>
  );
};
