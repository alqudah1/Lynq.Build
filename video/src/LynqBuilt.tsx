import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * "What we built", third cut: one phone, every client. The phone stays put and each swipe
 * brings the next client's real site onto it while the room changes colour to match.
 * Real screens only (the ERP is the demo build with sample data), no results claimed.
 */
const LI = "#C7FF3D", BG = "#040405", IL = "'Inter Light'", IS = "'Inter SemiBold'";
const PW = 600, PH = 1230, PX = (1080 - PW) / 2, PY = 590, SW = PW - 20, SH = PH - 20, K = SW / 720;
type Slide = { sec: string; name: string; what: string; chips: string[]; img: string; h: number; glow: string; dur: number; note?: string };
const SLIDES: Slide[] = [
  { sec: "WEBSITE", name: "Kingsbridge Group", what: "Custom homes and property management", chips: ["Two inquiry paths", "Built for search", "Fast on phones"], img: "s-kingsbridge", h: 3096, glow: "#c9a45c", dur: 3.3 },
  { sec: "WEBSITE", name: "Nasma", what: "A restaurant you can book from the menu", chips: ["Reserve a table", "Full menu", "WhatsApp chat"], img: "s-nasma", h: 2203, glow: "#e2853f", dur: 3.3 },
  { sec: "3D WEBSITE", name: "Finding Amy", what: "A photo booth you can tap", chips: ["Interactive 3D", "Live booking"], img: "s-amy", h: 1502, glow: "#b3263c", dur: 3.0 },
  { sec: "ONLINE STORE", name: "Arcubed Label", what: "Handmade bags, made to order", chips: ["Custom orders", "Cart and checkout", "Stock or made for you"], img: "s-arcubed", h: 2218, glow: "#f2a8e2", dur: 3.3 },
  { sec: "LEAD SITE", name: "House Deals Direct", what: "An offer form that takes a minute", chips: ["3-step form", "Leads to inbox", "Two audiences"], img: "s-housedeals", h: 3138, glow: "#27a35c", dur: 3.3 },
  { sec: "LEARNING PLATFORM", name: "CodeIt", what: "Kids learn Python in the browser", chips: ["31 lessons", "Games to remix", "Runs in the browser"], img: "s-codeit", h: 2870, glow: "#ff7a1a", dur: 3.6 },
  { sec: "ERP SYSTEM", name: "KHAIRAT", what: "A whole factory in one system", chips: ["Every department", "Approvals", "Arabic and English"], img: "s-erp", h: 3096, glow: "#3fae6a", dur: 5.4, note: "DEMO BUILD · SAMPLE DATA" },
];
const START = 2.4;
const AT = SLIDES.map((_, i) => START + SLIDES.slice(0, i).reduce((a, b) => a + b.dur, 0));
const FLOW_AT = AT[AT.length - 1] + SLIDES[SLIDES.length - 1].dur, FLOW_DUR = 6.0;
const END = FLOW_AT + FLOW_DUR;
export const BUILT_DUR = END + 4.6;
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

const NOTIFS: [string, string, string][] = [
  ["New enquiry", "Sara needs a quote for a kitchen", "9:14 PM"],
  ["Saved to your CRM", "Name, need and where she found you", "9:14 PM"],
  ["Reply sent", "“Thanks Sara, here are two times to talk”", "9:15 PM"],
  ["Follow-up set", "Reminder tomorrow at 9:00 AM", "9:15 PM"],
  ["Ready for you", "Approve the quote in one tap", "9:16 PM"],
];

const Notifs: React.FC = () => {
  const { s } = useT();
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#0b0d08 0%,#050505 60%)" }}>
      <div style={{ textAlign: "center", marginTop: 70, fontFamily: IL, fontSize: 120, letterSpacing: -4, color: "#fff" }}>9:1{s < FLOW_AT + 2.2 ? 4 : s < FLOW_AT + 4.0 ? 5 : 6}</div>
      <div style={{ textAlign: "center", fontFamily: IL, fontSize: 28, color: "rgba(255,255,255,0.55)", marginTop: -6 }}>Shop closed · LYNQ Office is on</div>
      {NOTIFS.map(([a, b, t], k) => {
        const at = FLOW_AT + 0.55 + k * 0.9;
        const p = ramp(s, at, at + 0.35, 0, 1, ease);
        const last = k === NOTIFS.length - 1;
        return (
          <div key={a} style={{ position: "absolute", left: 22, right: 22, top: 320 + k * 168, padding: "20px 24px", borderRadius: 30, background: last ? "rgba(199,255,61,0.16)" : "rgba(255,255,255,0.09)", border: `2px solid ${last ? LI : "rgba(255,255,255,0.12)"}`, opacity: p, transform: `translateY(${(1 - p) * -40}px) scale(${0.94 + p * 0.06})` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: LI, fontFamily: IS, fontSize: 19, color: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>L</div>
              <div style={{ fontFamily: IS, fontSize: 21, letterSpacing: 3, color: "rgba(255,255,255,0.6)", flex: 1 }}>LYNQ OFFICE</div>
              <div style={{ fontFamily: IL, fontSize: 22, color: "rgba(255,255,255,0.5)" }}>{t}</div>
            </div>
            <div style={{ fontFamily: IS, fontSize: 36, color: "#fff", marginTop: 8, letterSpacing: -0.5 }}>{a}</div>
            <div style={{ fontFamily: IL, fontSize: 26, color: "rgba(255,255,255,0.7)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden" }}>{b}</div>
          </div>
        );
      })}
    </div>
  );
};

const Screen: React.FC<{ i: number }> = ({ i }) => {
  const { s } = useT();
  const sl = SLIDES[i], at = AT[i];
  const max = Math.max(0, sl.h * K - SH);
  const sc = ramp(s, at + 0.9, at + sl.dur - 0.2, 0, 1, (x) => x * x * (3 - 2 * x)) * Math.min(max, sl.dur > 5 ? 900 : 760);
  return <Img src={staticFile(`built/${sl.img}.jpg`)} style={{ position: "absolute", left: 0, top: 0, width: SW, height: sl.h * K, transform: `translateY(${-sc}px)` }} />;
};

export const LynqBuilt: React.FC = () => {
  const { s } = useT();
  const n = SLIDES.length;
  const cur = s < START ? -1 : s >= END ? n + 1 : s >= FLOW_AT ? n : AT.filter((a) => s >= a).length - 1;
  const starts = [...AT, FLOW_AT, END];
  const tIn = cur >= 0 ? ramp(s, starts[cur], starts[cur] + 0.45, 0, 1, ease) : 1;
  const rise = useSpringAt(0.15, { damping: 16, stiffness: 110 });
  const glow = cur < 0 ? LI : cur >= n ? LI : SLIDES[cur].glow;
  const erpAt = AT[n - 1];
  const e = ramp(s, erpAt + 1.7, erpAt + 2.3, 0, 1, ease) * (1 - ramp(s, FLOW_AT - 0.3, FLOW_AT + 0.1));
  const tap = s >= END + 2.2 && s < END + 2.45;
  const layer = (idx: number): React.ReactNode =>
    idx < 0 ? (
      <div style={{ position: "absolute", inset: 0, background: "#050505", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: IS, fontSize: 64, letterSpacing: 26, color: "#fff", marginLeft: 26 }}>LYNQ</div>
        <div style={{ fontFamily: IL, fontSize: 30, color: LI, marginTop: 22 }}>swipe up</div>
      </div>
    ) : idx < n ? (
      <Screen i={idx} />
    ) : idx === n ? (
      <Notifs />
    ) : (
      <div style={{ position: "absolute", inset: 0, background: "#050505", textAlign: "center" }}>
        <div style={{ marginTop: 300, fontFamily: IL, fontSize: 76, letterSpacing: -3, color: "#fff", lineHeight: 1.05 }}>Yours</div>
        <div style={{ fontFamily: IS, fontSize: 76, letterSpacing: -3, color: LI, lineHeight: 1.05 }}>is next.</div>
        <div style={{ display: "inline-block", marginTop: 90, padding: "28px 44px", borderRadius: 60, background: LI, fontFamily: IS, fontSize: 40, color: "#0a0a0a", transform: `scale(${tap ? 0.93 : 1})`, boxShadow: "0 0 70px rgba(199,255,61,0.4)" }}>Book a consultation</div>
        <div style={{ marginTop: 120, fontFamily: IS, fontSize: 24, letterSpacing: 7, color: "#fff" }}>LINK IN BIO</div>
        <div style={{ marginTop: 12, fontFamily: IL, fontSize: 28, color: "rgba(255,255,255,0.55)" }}>lynq.build/book</div>
      </div>
    );
  const head = (sec: string, name: string, what: string, key: string, at: number) => {
    const p = ramp(s, at + 0.08, at + 0.5, 0, 1, ease);
    return (
      <div key={key} style={{ position: "absolute", left: 70, right: 70, top: 190, opacity: p, transform: `translateY(${(1 - p) * 34}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 28, letterSpacing: 9, color: LI }}>{sec}</div>
        <div style={{ fontFamily: IS, fontSize: name.length > 15 ? 88 : 112, letterSpacing: -3.5, color: "#fff", marginTop: 12, lineHeight: 1 }}>{name}</div>
        <div style={{ fontFamily: IL, fontSize: 40, color: "rgba(255,255,255,0.7)", marginTop: 18 }}>{what}</div>
      </div>
    );
  };
  const chipPos: [number | null, number | null, number, number][] = [[24, null, 800, -5], [null, 24, 1130, 4], [34, null, 1470, -3]];
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <div style={{ position: "absolute", left: -260, top: 380, width: 1600, height: 1600, borderRadius: 800, background: `radial-gradient(circle, ${glow}55 0%, ${glow}00 62%)`, opacity: 0.55 + tIn * 0.45 }} />
      <div style={{ position: "absolute", left: 70, top: 96, fontFamily: IS, fontSize: 30, letterSpacing: 12, color: "#fff" }}>LYNQ</div>
      {cur >= 0 && cur <= n ? (
        <div style={{ position: "absolute", right: 70, top: 108, display: "flex", gap: 8 }}>
          {Array.from({ length: n + 1 }).map((_, k) => <div key={k} style={{ width: k === cur ? 44 : 14, height: 6, borderRadius: 3, background: k <= cur ? LI : "rgba(255,255,255,0.2)" }} />)}
        </div>
      ) : null}

      {cur < 0 ? (
        <div style={{ position: "absolute", left: 70, right: 70, top: 200, opacity: 1 - ramp(s, START - 0.3, START) }}>
          <div style={{ fontFamily: IL, fontSize: 104, lineHeight: 1.04, letterSpacing: -4, color: "#fff" }}>One phone.</div>
          <div style={{ fontFamily: IS, fontSize: 104, lineHeight: 1.04, letterSpacing: -4, color: LI }}>Everything we built.</div>
        </div>
      ) : cur < n ? head(SLIDES[cur].sec, SLIDES[cur].name, SLIDES[cur].what, `h${cur}`, AT[cur])
        : cur === n ? head("CRM AND AUTOMATION", "LYNQ Office", "Your follow-up, while you sleep", "hf", FLOW_AT)
        : head("THAT WAS REAL WORK", "We built those.", "Real clients. Real screens.", "he", END)}

      {/* desktop view of the ERP, behind the phone */}
      {e > 0.01 ? (
        <div style={{ position: "absolute", left: 40, top: 640, width: 900, height: 634, borderRadius: 22, overflow: "hidden", border: "2px solid rgba(255,255,255,0.18)", background: "#111", boxShadow: "0 50px 140px rgba(0,0,0,0.8)", opacity: e, transform: `perspective(1800px) translateX(${(1 - e) * -200}px) rotateY(${8 - e * 2}deg) rotateZ(-2deg)` }}>
          <div style={{ height: 40, background: "#17171a", display: "flex", alignItems: "center", padding: "0 16px", gap: 8 }}>
            {[0, 1, 2].map((k) => <div key={k} style={{ width: 11, height: 11, borderRadius: 6, background: "rgba(255,255,255,0.22)" }} />)}
          </div>
          <Img src={staticFile("built/erp-desk.jpg")} style={{ width: 900 }} />
        </div>
      ) : null}

      {/* the phone */}
      <div style={{ position: "absolute", left: PX, top: PY, width: PW, height: PH, borderRadius: 66, background: "#000", border: "10px solid #1c1c20", outline: "2px solid rgba(255,255,255,0.2)", overflow: "hidden", boxShadow: `0 60px 160px rgba(0,0,0,0.85), 0 0 120px ${glow}33`, transform: `translate(${e * 190}px, ${(1 - Math.min(1, rise)) * 900 + e * 150}px) scale(${1 - e * 0.22}) rotate(${e * 3}deg)` }}>
        {cur >= 0 && tIn < 1 ? <div style={{ position: "absolute", inset: 0, transform: `translateY(${-tIn * SH}px)` }}>{layer(cur - 1)}</div> : null}
        <div style={{ position: "absolute", inset: 0, transform: `translateY(${cur >= 0 ? (1 - tIn) * SH : 0}px)` }}>{layer(cur)}</div>
        <div style={{ position: "absolute", left: (SW - 150) / 2, top: 14, width: 150, height: 34, borderRadius: 17, background: "#000" }} />
      </div>

      {/* chips pinned on the phone's edges */}
      {cur >= 0 && cur < n ? SLIDES[cur].chips.map((c, k) => {
        const at = AT[cur] + 0.55 + k * 0.28;
        const p = ramp(s, at, at + 0.3, 0, 1, ease) * (1 - ramp(s, AT[cur] + SLIDES[cur].dur - 0.25, AT[cur] + SLIDES[cur].dur)) * (cur === n - 1 ? 1 - e : 1);
        const [l, r, t, rot] = chipPos[k];
        return <div key={c + cur} style={{ position: "absolute", left: l ?? undefined, right: r ?? undefined, top: t, padding: "16px 28px", borderRadius: 44, background: k === 0 ? LI : "#0d0d10", border: `2px solid ${k === 0 ? LI : "rgba(255,255,255,0.35)"}`, fontFamily: IS, fontSize: 32, color: k === 0 ? "#0a0a0a" : "#fff", boxShadow: "0 18px 50px rgba(0,0,0,0.6)", opacity: p, transform: `scale(${0.7 + p * 0.3}) rotate(${rot}deg)` }}>{c}</div>;
      }) : null}

      {cur >= 0 && cur < n && SLIDES[cur].note ? <div style={{ position: "absolute", left: 0, right: 0, top: 1850, textAlign: "center", fontFamily: IS, fontSize: 22, letterSpacing: 6, color: "rgba(255,255,255,0.5)" }}>{SLIDES[cur].note}</div> : null}
      {cur === n ? <div style={{ position: "absolute", left: 0, right: 0, top: 1850, textAlign: "center", fontFamily: IS, fontSize: 22, letterSpacing: 6, color: "rgba(255,255,255,0.5)" }}>HOW IT WORKS · EXAMPLE ENQUIRY</div> : null}

      {starts.map((a) => <Sfx key={a} at={a} src="whoosh.wav" volume={0.2} />)}
      {NOTIFS.map((_, k) => <Sfx key={k} at={FLOW_AT + 0.55 + k * 0.9} src="pop.wav" volume={0.3} />)}
      <Sfx at={END + 2.2} src="click.wav" volume={0.4} />
    </AbsoluteFill>
  );
};
