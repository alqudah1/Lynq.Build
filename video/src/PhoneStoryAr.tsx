import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * Arabic (Jordanian) cut of the money reel, right to left, for an ad aimed at Jordan. Silent build.
 * "I tried to give this shop my money." Told from the customer's side as a screen recording of
 * her phone: she finds a shop first, can't see prices or book, calls and gets voicemail, then books
 * the next shop in two taps. Everything on the phone is drawn here, so nothing is AI-made and every
 * word is sharp. Both shops are made up and the reel says so. No hands, no faces.
 * 1080x1920, 18.5s. Silent build first; the voice is added once the picture is approved.
 */

const LI = "#C7FF3D";
const BG = "#030303";
const IL = "'IBM Plex Sans Arabic'";
const IS = "'IBM Plex Sans Arabic SemiBold'";
const ss = (x: number) => x * x * (3 - 2 * x);

// phone geometry on the 1080x1920 canvas
const PW = 566, PH = 1170, PX = (1080 - PW) / 2, PY = 470, BZ = 12;
const SW = 390, SCALE = (PW - BZ * 2) / SW, SH = (PH - BZ * 2) / SCALE;

const SHOP_A = "صالون ورد";
const SHOP_B = "صالون لمسة";

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
    <div dir="ltr" style={{ direction: "ltr", position: "absolute", left: 0, top: 0, width: SW, height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 26px 0", boxSizing: "border-box", fontFamily: IS, fontSize: 15, color: c, zIndex: 40 }}>
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
    <div style={{ marginTop: 10, display: "inline-block", padding: "4px 10px", borderRadius: 20, background: "#e7f5e9", fontFamily: IS, fontSize: 11.5, color: "#1e7a34" }}>مفتوح الآن</div>
  </div>
);

const Search: React.FC<{ pick: 1 | 2; tapAt: number; typing?: boolean }> = ({ pick, tapAt, typing }) => {
  const { s } = useT();
  const hot = s > tapAt && s < tapAt + 0.6;
  const Q = "صالون شعر قريب مني";
  const typed = typing ? Q.slice(0, Math.max(0, Math.floor((s - 0.15) * 20))) : Q;
  const shown = typing ? ramp(s, 1.15, 1.5, 0, 1, ss) : 1;
  return (
    <>
      <StatusBar />
      <div style={{ margin: "58px 16px 16px", padding: "13px 18px", borderRadius: 26, background: "#f1f3f4", fontFamily: IL, fontSize: 17, color: "#202124", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 14, height: 14, borderRadius: 8, border: "2px solid #7b8187", display: "inline-block" }} />
        {typed}{typing && s < 1.3 && <span style={{ width: 2, height: 20, background: "#1a73e8", marginLeft: -6, opacity: Math.floor(s * 4) % 2 ? 1 : 0.2 }} />}
      </div>
      <div style={{ opacity: shown, transform: `translateY(${(1 - shown) * 14}px)` }}>
      <div style={{ margin: "0 20px 12px", fontFamily: IL, fontSize: 12.5, color: "#70757a" }}>النتائج</div>
      <Result name={SHOP_A} url="salonward.example" line="صالون شعر. قص، صبغة وتصفيف." hot={hot && pick === 1} />
      <Result name={SHOP_B} url="salonlamsa.example" line="صالون شعر. احجزي أونلاين بثواني." hot={hot && pick === 2} />
      <Result name="صالون الشارع الثالث" url="thirdstreet.example" line="بدون موعد أغلب الأيام." />
      </div>
      <Tap at={tapAt} x={SW - 150} y={pick === 1 ? 190 : 330} dark />
    </>
  );
};

/* ── 2. The first shop's site: dated, no prices, nothing to tap ────── */

const WeakSite: React.FC = () => {
  const { s } = useT();
  const y = interpolate(s, [3.0, 4.3, 5.0, 5.7, 6.8], [0, 430, 150, 150, 560], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const serif = IL;
  return (
    <>
      <StatusBar />
      <div style={{ position: "absolute", left: 0, top: 48, width: SW, height: 40, background: "#f1f3f4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IL, fontSize: 13, color: "#5d6368", zIndex: 30 }}>salonward.example</div>
      <div style={{ position: "absolute", left: 0, top: 0, width: SW, height: 48, background: "#f1f3f4", zIndex: 29 }} />
      <div style={{ position: "absolute", left: 0, top: 88, width: SW, height: SH - 88, overflow: "hidden" }}>
      <div style={{ width: SW, transform: `translateY(${-y}px)` }}>
        <div style={{ background: "#6b7a5a", padding: "16px 14px", fontFamily: serif, fontSize: 22, color: "#f3ecd6", textAlign: "center", letterSpacing: 1 }}>~ صالون ورد ~</div>
        <div style={{ height: 150, background: "linear-gradient(100deg,#b9b09a 0%,#8f8a78 40%,#c9c2ad 70%,#7d7a6c 100%)", filter: "blur(1.4px)", transform: "scaleX(1.25)" }} />
        <div style={{ padding: "18px 18px 0", fontFamily: serif, color: "#2e2e2e" }}>
          <div style={{ fontSize: 24, textAlign: "center", color: "#5a6a48" }}>أهلاً وسهلاً بكم في موقعنا!!</div>
          <div style={{ marginTop: 14, fontSize: 13.5, lineHeight: 1.5 }}>نحن صالون متكامل نفتخر بخدمة زبائننا الكرام. فريقنا بانتظاركم دائماً. تفضلوا بزيارتنا أو اتصلوا بنا خلال ساعات الدوام وسنكون سعداء بخدمتكم في كل ما يخص العناية بالشعر.</div>
          <div style={{ marginTop: 20, fontSize: 19, color: "#5a6a48" }}>خدماتنا</div>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>قص<br />صبغة<br />تصفيف<br />مناسبات</div>
          <div style={{ marginTop: 14, padding: "12px 14px", border: "1px dashed #9a9a8a", fontSize: 16, textAlign: "center" }}>للأسعار يرجى الاتصال</div>
          <div style={{ marginTop: 22, fontSize: 19, color: "#5a6a48" }}>ساعات الدوام</div>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>من السبت إلى الخميس<br />الجمعة مغلق</div>
          <div style={{ marginTop: 22, fontSize: 19, color: "#5a6a48" }}>المواعيد</div>
          <div style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.5 }}>لحجز موعد يرجى الاتصال بالصالون هاتفياً. لا نستقبل الحجوزات عبر الإنترنت حالياً.</div>
          <div style={{ marginTop: 26, height: 110, background: "linear-gradient(120deg,#a39c88,#cfc8b3,#8d8876)", filter: "blur(1.2px)" }} />
          <div style={{ marginTop: 22, paddingBottom: 60, fontSize: 12, textAlign: "center", color: "#7a7a70" }}>© 2019 صالون ورد. جميع الحقوق محفوظة.<br />يفضل تصفح الموقع من الكمبيوتر.</div>
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
        <div style={{ width: 118, height: 118, borderRadius: 59, margin: "0 auto", background: "#2a2d2b", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IL, fontSize: 50, color: "#cfd3cc", transform: `scale(${vm ? 1 : ring})` }}>و</div>
        <div style={{ marginTop: 26, fontFamily: IL, fontSize: 27, color: "#fff" }}>{SHOP_A}</div>
        <div style={{ marginTop: 10, height: 26, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, fontFamily: IL, fontSize: 18, color: "rgba(255,255,255,0.6)", opacity: 1 - flip }}>جاري الاتصال{dots}</div>
          <div style={{ position: "absolute", inset: 0, fontFamily: IS, fontSize: 18, color: "#ff6b5e", opacity: flip }}>لا يوجد رد</div>
        </div>
        <div style={{ marginTop: 40, display: "inline-block", padding: "14px 24px", borderRadius: 18, background: "rgba(255,255,255,0.07)", fontFamily: IL, fontSize: 17, color: "rgba(255,255,255,0.85)", opacity: flip, transform: `translateY(${(1 - flip) * 14}px)` }}>الرقم المطلوب لا يجيب حالياً.</div>
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
        <span>صالون لمسة</span>
        <span style={{ fontFamily: IL, fontSize: 13, letterSpacing: 0, color: "rgba(255,255,255,0.6)" }}>مفتوح حتى 8</span>
      </div>
      <div style={{ position: "absolute", left: 22, right: 22, top: 118, height: 190, borderRadius: 22, background: "radial-gradient(120% 90% at 20% 10%, #3a3f38 0%, #17191a 70%)" }}>
        <div style={{ position: "absolute", right: 20, bottom: 18, fontFamily: IL, fontSize: 34, lineHeight: 1.25, color: "#fff" }}>شعرك،<br />على أصوله.</div>
      </div>
      {[["قص وتصفيف", "45 دقيقة", "15 د.أ"], ["صبغة", "90 دقيقة", "35 د.أ"], ["سشوار", "30 دقيقة", "8 د.أ"]].map(([n, t, p], i) => (
        <div key={n} style={{ position: "absolute", left: 22, right: 22, top: 328 + i * 66, height: 56, borderRadius: 16, background: "#141615", border: "1px solid #232625", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", boxSizing: "border-box" }}>
          <span><span style={{ fontFamily: IS, fontSize: 15.5, color: "#fff" }}>{n}</span><span style={{ marginRight: 10, fontFamily: IL, fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{t}</span></span>
          <span style={{ fontFamily: IS, fontSize: 15.5, color: "#fff" }}>{p}</span>
        </div>
      ))}
      <div style={{ position: "absolute", left: 22, right: 22, top: 540, height: 58, borderRadius: 30, background: LI, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 18, color: "#0b0d0a", transform: `scale(${pressed ? 0.96 : 1})` }}>احجزي الآن</div>
      <Tap at={12.2} x={SW / 2} y={569} />

      {/* booking sheet */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 430, borderRadius: "28px 28px 0 0", background: "#101211", borderTop: "1px solid #262928", transform: `translateY(${(1 - sheet) * 440}px)`, zIndex: 20 }}>
        <div style={{ width: 44, height: 5, borderRadius: 3, background: "#3a3d3b", margin: "12px auto 0" }} />
        {!booked ? (
          <div style={{ padding: "20px 22px 0" }}>
            <div style={{ fontFamily: IS, fontSize: 19, color: "#fff" }}>قص وتصفيف</div>
            <div style={{ marginTop: 4, fontFamily: IL, fontSize: 14, color: "rgba(255,255,255,0.55)" }}>السبت</div>
            <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 10 }}>
              {["11:00", "12:30", "2:00", "3:30", "5:00"].map((t) => (
                <span key={t} style={{ padding: "11px 18px", borderRadius: 14, fontFamily: IS, fontSize: 15, background: t === "2:00" ? "rgba(199,255,61,0.14)" : "#191c1a", border: `1.5px solid ${t === "2:00" ? LI : "#2a2d2b"}`, color: t === "2:00" ? LI : "rgba(255,255,255,0.85)" }}>{t}</span>
              ))}
            </div>
            <div style={{ marginTop: 26, height: 56, borderRadius: 28, background: LI, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 17.5, color: "#0b0d0a", transform: `scale(${pressed2 ? 0.96 : 1})` }}>تأكيد السبت 2:00</div>
          </div>
        ) : (
          <div style={{ paddingTop: 54, textAlign: "center" }}>
            <div style={{ width: 96, height: 96, borderRadius: 48, margin: "0 auto", background: LI, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${0.4 + 0.6 * done})` }}>
              <div style={{ width: 38, height: 20, borderLeft: "6px solid #0b0d0a", borderBottom: "6px solid #0b0d0a", transform: "rotate(-45deg) translate(3px,-5px)" }} />
            </div>
            <div style={{ marginTop: 24, fontFamily: IL, fontSize: 30, letterSpacing: -0.8, color: "#fff", opacity: Math.min(1, done * 1.4) }}>تم الحجز.</div>
            <div style={{ marginTop: 6, fontFamily: IL, fontSize: 16, color: "rgba(255,255,255,0.6)", opacity: Math.min(1, done * 1.4) }}>السبت، 2:00 مساءً</div>
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
    <div dir="rtl" style={{ position: "absolute", left: 70, right: 70, top: 250, height: 190, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: IL, fontSize: size, lineHeight: 1.3, color: "#fff", opacity: 1 - gone }}>
      <div>
        {text.split(" ").map((w, i) => {
          const p = Math.max(0, Math.min(1, (frame - Math.round((at + i * 0.07) * fps)) / 6));
          return <span key={i} style={{ display: "inline-block", margin: "0 0.13em", opacity: p, transform: `translateY(${(1 - p) * 16}px)`, color: lime.includes(w.replace(/[.,!?؟،]/g, "")) ? LI : undefined }}>{w}</span>;
        })}
      </div>
    </div>
  );
};

/** Her money: a lime chip that waits beside the phone, knocks on the first shop, and goes to the second. */
const Money: React.FC = () => {
  const { s } = useT();
  if (s < 2.2 || s > 13.9) return null;
  const k = (t: number[], v: number[]) => interpolate(s, t, v, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const born = ramp(s, 2.2, 2.9, 0, 1, ss);
  // start where the words "my money." were, settle beside the phone
  let x = k([2.2, 2.9], [760, 938]);
  let y = k([2.2, 2.9], [372, 800]);
  // two knocks on the first shop's edge: nothing lets it in
  x += k([5.9, 6.05, 6.2, 6.4, 6.55, 6.7], [0, -92, 0, 0, -92, 0]);
  // voicemail: it sinks
  const sink = k([8.8, 9.4, 10.6, 11.4], [0, 1, 1, 0]);
  y += sink * 46;
  // booked: it flies into the tick
  const go = k([13.45, 13.8], [0, 1]);
  x = x + (540 - x) * go;
  y = y + (1194 - y) * go;
  const bob = Math.sin(s * 2.2) * 7 * (1 - go);
  return (
    <div style={{ position: "absolute", left: x - 130, top: y - 42 + bob, width: 260, textAlign: "center", opacity: born * (1 - sink * 0.45) * (1 - ramp(s, 13.72, 13.85)), transform: `scale(${(0.6 + 0.4 * born) * (1 - go * 0.6)}) rotate(${sink * -7 + Math.sin(s * 1.7) * 1.5}deg)`, zIndex: 5 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 18px 12px 22px", borderRadius: 44, background: LI, boxShadow: `0 0 50px rgba(199,255,61,${0.35 * (1 - sink)}), 0 14px 30px rgba(0,0,0,0.5)` }}>
        <span style={{ fontFamily: IS, fontSize: 34, color: "#0b0d0a" }}>15</span>
        <span style={{ padding: "2px 12px", borderRadius: 18, background: "#0b0d0a", color: LI, fontFamily: IS, fontSize: 20 }}>د.أ</span>
      </div>
      <div style={{ marginTop: 12, fontFamily: IS, fontSize: 20, whiteSpace: "nowrap", color: "rgba(255,255,255,0.6)", opacity: 1 - go }}>{sink > 0.5 ? "لسا بستنى" : "جاهزة أدفع"}</div>
    </div>
  );
};

export const LynqMoneyAr: React.FC = () => {
  const { s } = useT();
  const hookOut = ramp(s, 2.3, 2.7);
  const lock = ramp(s, 15.0, 15.6, 0, 1, ss);
  const leave = ramp(s, 15.5, 16.0, 0, 1, ss);
  const end1 = ramp(s, 15.7, 16.3, 0, 1, ss);
  const end2 = useSpringAt(17.0, { damping: 15, stiffness: 130 });
  const pop = useSpringAt(13.75, { damping: 9, stiffness: 180 });
  // the room takes the colour of whatever is on her screen
  const gWhite = (1 - ramp(s, 2.4, 2.9)) + ramp(s, 10.5, 10.8) * (1 - ramp(s, 11.2, 11.6));
  const gBeige = ramp(s, 2.5, 3.0) * (1 - ramp(s, 6.8, 7.2));
  const gRed = ramp(s, 8.7, 9.0) * (1 - ramp(s, 10.3, 10.7));
  const gLime = ramp(s, 13.7, 14.0) * (1 - lock);
  // the camera leans in on "Call for prices", shudders on the voicemail, and lifts on the booking
  const lean = ramp(s, 4.9, 5.3, 0, 1, ss) * (1 - ramp(s, 5.75, 6.15, 0, 1, ss));
  const shake = s > 8.8 && s < 9.35 ? Math.sin((s - 8.8) * 70) * 9 * (1 - (s - 8.8) / 0.55) : 0;
  const float = Math.sin(s * 0.9) * 6;
  const tilt = Math.sin(s * 0.55) * 1.6;
  const flip = ramp(s, 15.25, 15.95, 0, 1, ss);
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <style>{`[dir=rtl], [dir=rtl] * { letter-spacing: 0 !important; }`}</style>
      {/* soft light behind the phone so it sits in a room, not on a flat card */}
      {[["255,255,255", gWhite * 0.13], ["226,214,180", gBeige * 0.14], ["255,69,58", gRed * 0.2], ["199,255,61", gLime * 0.22], ["255,255,255", 0.045]].map(([c, o], i) => (
        <div key={i} style={{ position: "absolute", left: -110, top: 380, width: 1300, height: 1360, borderRadius: 680, background: `radial-gradient(closest-side, rgba(${c},${o}) 0%, rgba(${c},0) 100%)`, opacity: 1 - leave }} />
      ))}
      <Money />

      <div style={{ position: "absolute", left: 70, top: 150, display: "flex", alignItems: "center", gap: 14, opacity: 1 - leave }}>
        <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 38, height: 38 }} />
        <span style={{ fontFamily: IS, fontSize: 28, letterSpacing: 6, color: "#fff" }}>LYNQ</span>
      </div>
      <div style={{ position: "absolute", right: 70, top: 160, fontFamily: IS, fontSize: 24, color: "rgba(255,255,255,0.5)", opacity: 1 - leave }}>محلات وهمية</div>

      {/* hook: full on frame 0, so the first frame is the cover */}
      {s < 2.8 && (
        <div dir="rtl" style={{ position: "absolute", left: 64, right: 64, top: 222, fontFamily: IL, fontSize: 92, lineHeight: 1.22, color: "#fff", opacity: 1 - hookOut, transform: `translateY(${-hookOut * 20}px)` }}>
          حاولت أعطي هالمحل<br /><span style={{ color: LI }}>مصاريي.</span>
        </div>
      )}
      <Line text="لقيتهم أول واحد." at={2.9} out={4.3} />
      <Line text="ما في أسعار. وما في حجز." at={4.7} out={6.8} lime={["ما", "وما"]} />
      <Line text="اتصلت." at={7.25} out={8.6} size={84} />
      <Line text="ما حدا رد." at={8.9} out={10.3} lime={["ما", "حدا", "رد"]} size={84} />
      <Line text="المحل اللي بعده؟ حجزت بكبستين." at={11.5} out={13.6} size={60} lime={["بكبستين"]} />
      <Line text="فأخدوا مصاريي هم." at={13.9} out={15.0} lime={["مصاريي"]} />

      {/* real sounds only, kept low: taps, the ring, the voicemail thud, the booking chime */}
      <Sfx at={2.05} src="click.wav" volume={0.35} />
      <Sfx at={7.0} src="ring.wav" volume={0.22} />
      <Sfx at={8.8} src="thump.wav" volume={0.5} />
      <Sfx at={10.15} src="click.wav" volume={0.35} />
      <Sfx at={10.95} src="click.wav" volume={0.35} />
      <Sfx at={12.2} src="click.wav" volume={0.35} />
      <Sfx at={13.45} src="click.wav" volume={0.35} />
      <Sfx at={13.75} src="ding.wav" volume={0.4} />
      <Sfx at={15.25} src="whoosh.wav" volume={0.25} />

      {/* the phone */}
      <div style={{ position: "absolute", left: PX, top: PY, width: PW, height: PH, borderRadius: 86, background: "#0d0f0e", boxShadow: "0 0 0 2px #3a3d3b, 0 0 0 5px #121413, inset 0 0 0 1px rgba(255,255,255,0.08), 0 70px 130px rgba(0,0,0,0.85)", opacity: 1 - ramp(s, 15.8, 15.95), transformOrigin: "50% 48%", transform: `perspective(1800px) translate(${shake}px, ${float}px) scale(${1 + lean * 0.1 + (pop > 0 && s < 15 ? Math.max(0, 1 - Math.abs(pop - 1) * 6) * 0 : 0) + (s >= 13.75 ? (pop - 1) * 0.25 + 0.02 : 0)}) rotateY(${tilt + flip * 88}deg) rotateX(${lean * 2}deg)` }}>
        <div style={{ position: "absolute", left: BZ, top: BZ, width: PW - BZ * 2, height: PH - BZ * 2, borderRadius: 74, overflow: "hidden", background: "#000" }}>
          <div dir="rtl" style={{ direction: "rtl", width: SW, height: SH, transform: `scale(${SCALE})`, transformOrigin: "0 0", position: "relative" }}>
            <Screen from={0} to={2.6} bg="#fff"><Search pick={1} tapAt={2.05} /></Screen>
            <Screen from={2.6} to={7.0} bg="#f7f3e6"><WeakSite /></Screen>
            <Screen from={7.0} to={10.6} bg="#0b0c0c"><Call /></Screen>
            <Screen from={10.6} to={11.4} back bg="#fff"><Search pick={2} tapAt={10.95} /></Screen>
            <Screen from={11.4} to={16.5} bg="#0a0b0b"><GoodSite /></Screen>
          </div>
          {/* island and the screen going dark at the end */}
          <div style={{ position: "absolute", left: (PW - BZ * 2) / 2 - 62, top: 16, width: 124, height: 36, borderRadius: 18, background: "#000", zIndex: 60 }} />
          <div style={{ position: "absolute", inset: 0, background: "#000", opacity: lock, zIndex: 70 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 22%, rgba(255,255,255,0) 40%)", zIndex: 80, pointerEvents: "none" }} />
        </div>
      </div>

      <AbsoluteFill style={{ background: "radial-gradient(120% 80% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />
      {/* end card: the black the phone left behind */}
      {s >= 15.7 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ marginTop: -180, padding: "0 70px", textAlign: "center" }}>
            <div dir="rtl" style={{ fontFamily: IL, fontSize: 96, lineHeight: 1.25, color: "#fff", opacity: end1, transform: `translateY(${(1 - end1) * 24}px)` }}>المحل الأول<br />ولا عرف<br /><span style={{ color: LI }}>إني كنت موجودة.</span></div>
            <div style={{ marginTop: 90, display: "inline-flex", alignItems: "center", gap: 20, opacity: Math.min(1, end2 * 1.3), transform: `translateY(${(1 - end2) * 24}px)` }}>
              <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 62, height: 62 }} />
              <span style={{ fontFamily: IS, fontSize: 52, letterSpacing: 10, color: "#fff" }}>LYNQ</span>
            </div>
            <div style={{ marginTop: 26, fontFamily: IL, fontSize: 40, color: "rgba(255,255,255,0.7)", opacity: Math.min(1, end2 * 1.3) }} dir="rtl">لا تكون المحل الأول.</div>
            <div style={{ marginTop: 14, fontFamily: IL, fontSize: 30, color: "rgba(255,255,255,0.45)", opacity: Math.min(1, end2 * 1.3) }}>lynq.build</div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

