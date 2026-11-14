import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile } from "remotion";
import { Fonts, ramp, useSpringAt, useT } from "./kit";

/*
 * "I tried to give this shop my money." Told from the customer's side as a screen recording of
 * her phone: she finds a shop first, can't see prices or book, calls and gets voicemail, then books
 * the next shop in two taps. Everything on the phone is drawn here, so nothing is AI-made and every
 * word is sharp. Both shops are made up and the reel says so. No hands, no faces.
 * 1080x1920, 18.5s. Silent build first; the voice is added once the picture is approved.
 */

const LI = "#C7FF3D";
const BG = "#030303";
const IL = "'Inter Light'";
const IS = "'Inter SemiBold'";
const ss = (x: number) => x * x * (3 - 2 * x);

// phone geometry on the 1080x1920 canvas
const PW = 566, PH = 1170, PX = (1080 - PW) / 2, PY = 470, BZ = 12;
const SW = 390, SCALE = (PW - BZ * 2) / SW, SH = (PH - BZ * 2) / SCALE;

const SHOP_A = "Olive & Thread Salon";
const SHOP_B = "Kindred Chair";

/** A finger tap: a soft ring that grows and fades at a point on the screen. */
const Tap: React.FC<{ at: number; x: number; y: number; dark?: boolean }> = ({ at, x, y, dark }) => {
  const { s } = useT();
  if (s < at || s > at + 0.55) return null;
  const k = ramp(s, at, at + 0.55);
  const c = dark ? "0,0,0" : "255,255,255";
  return (
    <div style={{ position: "absolute", left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: 34, background: `rgba(${c},${0.28 * (1 - k)})`, border: `2px solid rgba(${c},${0.55 * (1 - k)})`, transform: `scale(${0.5 + k * 0.9})`, zIndex: 50 }} />
  );
};

/** One screen of the phone. Slides in from the right (or left when going back) and dims out. */
const Screen: React.FC<{ from: number; to: number; back?: boolean; bg: string; children: React.ReactNode }> = ({ from, to, back, bg, children }) => {
  const { s } = useT();
  const T = 0.32;
  if (s < from - T || s > to + T) return null;
  const inn = from <= 0 ? 1 : ramp(s, from - T, from, 0, 1, ss);
  const out = ramp(s, to, to + T, 0, 1, ss);
  const dx = (1 - inn) * SW * (back ? -1 : 1) + out * SW * (back ? 0.25 : -0.25);
  return <div style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH, overflow: "hidden", background: bg, transform: `translateX(${dx}px)`, opacity: 1 - out * 0.6 }}>{children}</div>;
};

const StatusBar: React.FC<{ dark?: boolean }> = ({ dark }) => {
  const { s } = useT();
  const time = s < 7.0 ? "9:41" : s < 11.4 ? "9:42" : "9:43";
  const c = dark ? "#fff" : "#111";
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: SW, height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 26px 0", boxSizing: "border-box", fontFamily: IS, fontSize: 15, color: c, zIndex: 40 }}>
      <span>{time}</span>
      <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
        {[5, 8, 11, 14].map((h) => <span key={h} style={{ width: 3, height: h, borderRadius: 1, background: c }} />)}
        <span style={{ marginLeft: 6, width: 24, height: 11, borderRadius: 3, border: `1.5px solid ${c}`, position: "relative" }}><span style={{ position: "absolute", left: 1.5, top: 1.5, bottom: 1.5, width: 9, borderRadius: 1, background: c }} /></span>
      </span>
    </div>
  );
};

/* ── 1. Search results ─────────────────────────────────────────────── */

const Result: React.FC<{ name: string; url: string; line: string; hot?: boolean }> = ({ name, url, line, hot }) => (
  <div style={{ margin: "0 16px 12px", padding: "16px 18px", borderRadius: 18, background: hot ? "#eef0f2" : "#fff", border: "1px solid #e6e8ea" }}>
    <div style={{ fontFamily: IL, fontSize: 12.5, color: "#5d6368" }}>{url}</div>
    <div style={{ marginTop: 4, fontFamily: IS, fontSize: 19, color: "#1a3fb0" }}>{name}</div>
    <div style={{ marginTop: 6, fontFamily: IL, fontSize: 14, lineHeight: 1.35, color: "#3c4146" }}>{line}</div>
    <div style={{ marginTop: 10, display: "inline-block", padding: "4px 10px", borderRadius: 20, background: "#e7f5e9", fontFamily: IS, fontSize: 11.5, color: "#1e7a34" }}>Open now</div>
  </div>
);

const Search: React.FC<{ pick: 1 | 2; tapAt: number }> = ({ pick, tapAt }) => {
  const { s } = useT();
  const hot = s > tapAt && s < tapAt + 0.6;
  return (
    <>
      <StatusBar />
      <div style={{ margin: "58px 16px 16px", padding: "13px 18px", borderRadius: 26, background: "#f1f3f4", fontFamily: IL, fontSize: 17, color: "#202124", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 14, height: 14, borderRadius: 8, border: "2px solid #7b8187", display: "inline-block" }} />
        hair salon near me
      </div>
      <div style={{ margin: "0 20px 12px", fontFamily: IL, fontSize: 12.5, color: "#70757a" }}>Results</div>
      <Result name={SHOP_A} url="oliveandthread.example" line="Hair salon. Cuts, colour and styling." hot={hot && pick === 1} />
      <Result name={SHOP_B} url="kindredchair.example" line="Hair salon. Book online in seconds." hot={hot && pick === 2} />
      <Result name="Third Street Hair" url="thirdstreethair.example" line="Walk-ins welcome most days." />
      <Tap at={tapAt} x={150} y={pick === 1 ? 190 : 330} dark />
    </>
  );
};

/* ── 2. The first shop's site: dated, no prices, nothing to tap ────── */

const WeakSite: React.FC = () => {
  const { s } = useT();
  const y = interpolate(s, [3.0, 4.3, 5.0, 5.7, 6.8], [0, 430, 150, 150, 560], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const serif = "Georgia, 'Times New Roman', serif";
  return (
    <>
      <StatusBar />
      <div style={{ position: "absolute", left: 0, top: 48, width: SW, height: 40, background: "#f1f3f4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IL, fontSize: 13, color: "#5d6368", zIndex: 30 }}>oliveandthread.example</div>
      <div style={{ position: "absolute", left: 0, top: 0, width: SW, height: 48, background: "#f1f3f4", zIndex: 29 }} />
      <div style={{ position: "absolute", left: 0, top: 88, width: SW, height: SH - 88, overflow: "hidden" }}>
      <div style={{ width: SW, transform: `translateY(${-y}px)` }}>
        <div style={{ background: "#6b7a5a", padding: "16px 14px", fontFamily: serif, fontSize: 22, color: "#f3ecd6", textAlign: "center", letterSpacing: 1 }}>~ Olive &amp; Thread Salon ~</div>
        <div style={{ height: 150, background: "linear-gradient(100deg,#b9b09a 0%,#8f8a78 40%,#c9c2ad 70%,#7d7a6c 100%)", filter: "blur(1.4px)", transform: "scaleX(1.25)" }} />
        <div style={{ padding: "18px 18px 0", fontFamily: serif, color: "#2e2e2e" }}>
          <div style={{ fontSize: 24, textAlign: "center", color: "#5a6a48" }}>Welcome to our website!!</div>
          <div style={{ marginTop: 14, fontSize: 13.5, lineHeight: 1.5 }}>We are a full service salon proudly serving our community. Our friendly staff look forward to seeing you. Please stop by or give us a call during business hours and we will be happy to help you with all of your hair care needs.</div>
          <div style={{ marginTop: 20, fontSize: 19, color: "#5a6a48" }}>Our Services</div>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>Cuts<br />Colour<br />Styling<br />Special occasions</div>
          <div style={{ marginTop: 14, padding: "12px 14px", border: "1px dashed #9a9a8a", fontSize: 16, textAlign: "center" }}>Call for prices</div>
          <div style={{ marginTop: 22, fontSize: 19, color: "#5a6a48" }}>Hours</div>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>Monday to Saturday<br />Closed Sunday</div>
          <div style={{ marginTop: 22, fontSize: 19, color: "#5a6a48" }}>Appointments</div>
          <div style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.5 }}>To make an appointment please telephone the salon. We do not take appointments by email at this time.</div>
          <div style={{ marginTop: 26, height: 110, background: "linear-gradient(120deg,#a39c88,#cfc8b3,#8d8876)", filter: "blur(1.2px)" }} />
          <div style={{ marginTop: 22, paddingBottom: 60, fontSize: 12, textAlign: "center", color: "#7a7a70" }}>© 2019 Olive &amp; Thread Salon. All rights reserved.<br />Best viewed on a desktop computer.</div>
        </div>
      </div>
      </div>
    </>
  );
};

/* ── 3. She calls. Voicemail. ──────────────────────────────────────── */

const Call: React.FC = () => {
  const { s } = useT();
  const vm = s >= 8.8;
  const dots = ".".repeat(1 + (Math.floor(s * 2.4) % 3));
  const ring = 1 + 0.05 * Math.sin(s * 9);
  const flip = ramp(s, 8.6, 8.9, 0, 1, ss);
  return (
    <>
      <StatusBar dark />
      <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center" }}>
        <div style={{ width: 118, height: 118, borderRadius: 59, margin: "0 auto", background: "#2a2d2b", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IL, fontSize: 50, color: "#cfd3cc", transform: `scale(${vm ? 1 : ring})` }}>O</div>
        <div style={{ marginTop: 26, fontFamily: IL, fontSize: 27, color: "#fff" }}>{SHOP_A}</div>
        <div style={{ marginTop: 10, height: 26, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, fontFamily: IL, fontSize: 18, color: "rgba(255,255,255,0.6)", opacity: 1 - flip }}>calling{dots}</div>
          <div style={{ position: "absolute", inset: 0, fontFamily: IS, fontSize: 18, color: "#ff6b5e", opacity: flip }}>Voicemail</div>
        </div>
        <div style={{ marginTop: 40, display: "inline-block", padding: "14px 24px", borderRadius: 18, background: "rgba(255,255,255,0.07)", fontFamily: IL, fontSize: 17, color: "rgba(255,255,255,0.85)", opacity: flip, transform: `translateY(${(1 - flip) * 14}px)` }}>This mailbox is full.</div>
      </div>
      <div style={{ position: "absolute", left: SW / 2 - 37, top: SH - 190, width: 74, height: 74, borderRadius: 37, background: "#ff453a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: 40, height: 16 }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 9, borderRadius: 5, background: "#fff" }} />
          <div style={{ position: "absolute", left: 0, top: 4, width: 11, height: 12, borderRadius: 3, background: "#fff" }} />
          <div style={{ position: "absolute", right: 0, top: 4, width: 11, height: 12, borderRadius: 3, background: "#fff" }} />
        </div>
      </div>
      <Tap at={10.15} x={SW / 2} y={SH - 153} />
    </>
  );
};

/* ── 4. The next shop: prices up front, book in two taps ───────────── */

const GoodSite: React.FC = () => {
  const { s } = useT();
  const sheet = ramp(s, 12.35, 12.75, 0, 1, ss);
  const done = useSpringAt(13.75, { damping: 13, stiffness: 170 });
  const booked = s >= 13.75;
  const pressed = s > 12.2 && s < 12.4;
  const pressed2 = s > 13.45 && s < 13.65;
  return (
    <>
      <StatusBar dark />
      <div style={{ position: "absolute", left: 22, right: 22, top: 62, display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: IS, fontSize: 16, letterSpacing: 2.5, color: "#fff" }}>
        <span>KINDRED CHAIR</span>
        <span style={{ fontFamily: IL, fontSize: 13, letterSpacing: 0, color: "rgba(255,255,255,0.6)" }}>Open until 8</span>
      </div>
      <div style={{ position: "absolute", left: 22, right: 22, top: 118, height: 190, borderRadius: 22, background: "radial-gradient(120% 90% at 20% 10%, #3a3f38 0%, #17191a 70%)" }}>
        <div style={{ position: "absolute", left: 20, bottom: 18, fontFamily: IL, fontSize: 34, lineHeight: 1.02, letterSpacing: -1.2, color: "#fff" }}>Hair, done<br />right.</div>
      </div>
      {[["Cut & style", "45 min", "$60"], ["Colour", "90 min", "$120"], ["Blow dry", "30 min", "$40"]].map(([n, t, p], i) => (
        <div key={n} style={{ position: "absolute", left: 22, right: 22, top: 328 + i * 66, height: 56, borderRadius: 16, background: "#141615", border: "1px solid #232625", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", boxSizing: "border-box" }}>
          <span><span style={{ fontFamily: IS, fontSize: 15.5, color: "#fff" }}>{n}</span><span style={{ marginLeft: 10, fontFamily: IL, fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{t}</span></span>
          <span style={{ fontFamily: IS, fontSize: 15.5, color: "#fff" }}>{p}</span>
        </div>
      ))}
      <div style={{ position: "absolute", left: 22, right: 22, top: 540, height: 58, borderRadius: 30, background: LI, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 18, color: "#0b0d0a", transform: `scale(${pressed ? 0.96 : 1})` }}>Book now</div>
      <Tap at={12.2} x={SW / 2} y={569} />

      {/* booking sheet */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 430, borderRadius: "28px 28px 0 0", background: "#101211", borderTop: "1px solid #262928", transform: `translateY(${(1 - sheet) * 440}px)`, zIndex: 20 }}>
        <div style={{ width: 44, height: 5, borderRadius: 3, background: "#3a3d3b", margin: "12px auto 0" }} />
        {!booked ? (
          <div style={{ padding: "20px 22px 0" }}>
            <div style={{ fontFamily: IS, fontSize: 19, color: "#fff" }}>Cut &amp; style</div>
            <div style={{ marginTop: 4, fontFamily: IL, fontSize: 14, color: "rgba(255,255,255,0.55)" }}>Saturday</div>
            <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 10 }}>
              {["11:00", "12:30", "2:00", "3:30", "5:00"].map((t) => (
                <span key={t} style={{ padding: "11px 18px", borderRadius: 14, fontFamily: IS, fontSize: 15, background: t === "2:00" ? "rgba(199,255,61,0.14)" : "#191c1a", border: `1.5px solid ${t === "2:00" ? LI : "#2a2d2b"}`, color: t === "2:00" ? LI : "rgba(255,255,255,0.85)" }}>{t}</span>
              ))}
            </div>
            <div style={{ marginTop: 26, height: 56, borderRadius: 28, background: LI, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 17.5, color: "#0b0d0a", transform: `scale(${pressed2 ? 0.96 : 1})` }}>Confirm Saturday 2:00</div>
          </div>
        ) : (
          <div style={{ paddingTop: 54, textAlign: "center" }}>
            <div style={{ width: 96, height: 96, borderRadius: 48, margin: "0 auto", background: LI, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${0.4 + 0.6 * done})` }}>
              <div style={{ width: 38, height: 20, borderLeft: "6px solid #0b0d0a", borderBottom: "6px solid #0b0d0a", transform: "rotate(-45deg) translate(3px,-5px)" }} />
            </div>
            <div style={{ marginTop: 24, fontFamily: IL, fontSize: 30, letterSpacing: -0.8, color: "#fff", opacity: Math.min(1, done * 1.4) }}>Booked.</div>
            <div style={{ marginTop: 6, fontFamily: IL, fontSize: 16, color: "rgba(255,255,255,0.6)", opacity: Math.min(1, done * 1.4) }}>Saturday, 2:00 PM</div>
          </div>
        )}
        <Tap at={13.45} x={SW / 2} y={225} />
      </div>
    </>
  );
};

/* ── Text on the black around the phone ────────────────────────────── */

const Line: React.FC<{ text: string; at: number; out: number; lime?: string[]; size?: number }> = ({ text, at, out, lime = [], size = 66 }) => {
  const { s, frame, fps } = useT();
  if (s < at || s > out + 0.3) return null;
  const gone = ramp(s, out, out + 0.3);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 250, height: 190, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: IL, fontSize: size, lineHeight: 1.06, letterSpacing: -size / 26, color: "#fff", opacity: 1 - gone }}>
      <div>
        {text.split(" ").map((w, i) => {
          const p = Math.max(0, Math.min(1, (frame - Math.round((at + i * 0.07) * fps)) / 6));
          return <span key={i} style={{ display: "inline-block", margin: "0 0.13em", opacity: p, transform: `translateY(${(1 - p) * 16}px)`, color: lime.includes(w.replace(/[.,!?]/g, "")) ? LI : undefined }}>{w}</span>;
        })}
      </div>
    </div>
  );
};

export const LynqMoney: React.FC = () => {
  const { s } = useT();
  const hookOut = ramp(s, 2.3, 2.7);
  const lock = ramp(s, 15.0, 15.6, 0, 1, ss);
  const leave = ramp(s, 15.3, 16.1, 0, 1, ss);
  const end1 = ramp(s, 15.7, 16.3, 0, 1, ss);
  const end2 = useSpringAt(17.0, { damping: 15, stiffness: 130 });
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      {/* soft light behind the phone so it sits in a room, not on a flat card */}
      <div style={{ position: "absolute", left: 90, top: 560, width: 900, height: 1000, borderRadius: 500, background: "radial-gradient(closest-side, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0) 100%)", opacity: 1 - leave }} />

      <div style={{ position: "absolute", left: 70, top: 150, display: "flex", alignItems: "center", gap: 14, opacity: 1 - leave }}>
        <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 38, height: 38 }} />
        <span style={{ fontFamily: IS, fontSize: 28, letterSpacing: 6, color: "#fff" }}>LYNQ</span>
      </div>
      <div style={{ position: "absolute", right: 70, top: 160, fontFamily: IS, fontSize: 18, letterSpacing: 4, color: "rgba(255,255,255,0.5)", opacity: 1 - leave }}>MADE-UP SHOPS</div>

      {/* hook: full on frame 0, so the first frame is the cover */}
      {s < 2.8 && (
        <div style={{ position: "absolute", left: 64, right: 60, top: 236, fontFamily: IL, fontSize: 92, lineHeight: 1.0, letterSpacing: -4.6, color: "#fff", opacity: 1 - hookOut, transform: `translateY(${-hookOut * 20}px)` }}>
          I tried to give this<br />shop <span style={{ color: LI }}>my money.</span>
        </div>
      )}
      <Line text="I found them first." at={2.9} out={4.4} />
      <Line text="No prices. No way to book." at={4.7} out={6.8} lime={["No"]} />
      <Line text="So I called. Voicemail." at={7.2} out={10.3} lime={["Voicemail"]} />
      <Line text="The next place let me book in two taps." at={11.5} out={13.5} size={58} lime={["two", "taps"]} />
      <Line text="So they got my money." at={13.8} out={15.0} lime={["my", "money"]} />

      {/* the phone */}
      <div style={{ position: "absolute", left: PX, top: PY, width: PW, height: PH, borderRadius: 86, background: "#0d0f0e", boxShadow: "0 0 0 2px #2b2e2c, 0 0 0 5px #121413, 0 60px 120px rgba(0,0,0,0.8)", opacity: 1 - leave, transform: `scale(${1 - leave * 0.06}) translateY(${leave * 40}px)` }}>
        <div style={{ position: "absolute", left: BZ, top: BZ, width: PW - BZ * 2, height: PH - BZ * 2, borderRadius: 74, overflow: "hidden", background: "#000" }}>
          <div style={{ width: SW, height: SH, transform: `scale(${SCALE})`, transformOrigin: "0 0", position: "relative" }}>
            <Screen from={0} to={2.6} bg="#fff"><Search pick={1} tapAt={1.9} /></Screen>
            <Screen from={2.6} to={7.0} bg="#f7f3e6"><WeakSite /></Screen>
            <Screen from={7.0} to={10.6} bg="#0b0c0c"><Call /></Screen>
            <Screen from={10.6} to={11.4} back bg="#fff"><Search pick={2} tapAt={10.95} /></Screen>
            <Screen from={11.4} to={16.5} bg="#0a0b0b"><GoodSite /></Screen>
          </div>
          {/* island and the screen going dark at the end */}
          <div style={{ position: "absolute", left: (PW - BZ * 2) / 2 - 62, top: 16, width: 124, height: 36, borderRadius: 18, background: "#000", zIndex: 60 }} />
          <div style={{ position: "absolute", inset: 0, background: "#000", opacity: lock, zIndex: 70 }} />
        </div>
      </div>

      {/* end card: the black the phone left behind */}
      {s >= 15.7 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ marginTop: -180, padding: "0 70px", textAlign: "center" }}>
            <div style={{ fontFamily: IL, fontSize: 96, lineHeight: 1.02, letterSpacing: -4.8, color: "#fff", opacity: end1, transform: `translateY(${(1 - end1) * 24}px)` }}>The first shop<br />never knew<br /><span style={{ color: LI }}>I was there.</span></div>
            <div style={{ marginTop: 90, display: "inline-flex", alignItems: "center", gap: 20, opacity: Math.min(1, end2 * 1.3), transform: `translateY(${(1 - end2) * 24}px)` }}>
              <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 62, height: 62 }} />
              <span style={{ fontFamily: IS, fontSize: 52, letterSpacing: 10, color: "#fff" }}>LYNQ</span>
            </div>
            <div style={{ marginTop: 26, fontFamily: IL, fontSize: 40, color: "rgba(255,255,255,0.7)", opacity: Math.min(1, end2 * 1.3) }}>Don't be the first shop.</div>
            <div style={{ marginTop: 14, fontFamily: IL, fontSize: 30, color: "rgba(255,255,255,0.45)", opacity: Math.min(1, end2 * 1.3) }}>lynq.build</div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
