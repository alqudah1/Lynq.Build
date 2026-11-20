import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * "What we built", second cut: every client, real screens only. Websites, stores and lead
 * sites, a learning platform, an ERP (the demo build, sample data) and the CRM/automation
 * flow. No results are claimed anywhere.
 */
const LI = "#C7FF3D", BG = "#040405", IL = "'Inter Light'", IS = "'Inter SemiBold'";
type Media = { t: "desk"; img: string; img2?: string; focus?: string } | { t: "phones"; imgs: string[] } | { t: "tall"; img: string; h: number };
type Slide = { sec: string; name: string; what: string; chips: string[]; media: Media; dur: number; note?: string };
const SLIDES: Slide[] = [
  { sec: "WEBSITES", name: "Kingsbridge Group", what: "Custom homes and property management", chips: ["Website", "Two inquiry paths", "SEO"], media: { t: "phones", imgs: ["kb1", "kb3"] }, dur: 3.2 },
  { sec: "WEBSITES", name: "Nasma", what: "Levantine restaurant", chips: ["Website", "Menu", "Reservations"], media: { t: "desk", img: "nasma", focus: "12% 78%" }, dur: 3.2 },
  { sec: "WEBSITES", name: "Finding Amy", what: "Photo booth rentals", chips: ["3D website", "Live booking"], media: { t: "desk", img: "amy", focus: "50% 25%" }, dur: 3.2 },
  { sec: "ONLINE STORES", name: "Arcubed Label", what: "Handmade bags, made to order", chips: ["Online store", "Custom orders", "Checkout"], media: { t: "desk", img: "arcubed-d", focus: "85% 45%" }, dur: 3.2 },
  { sec: "LEAD SITES", name: "House Deals Direct", what: "Direct home buyers", chips: ["Lead site", "Offer form", "Two audiences"], media: { t: "tall", img: "hd-tall", h: 7000 / 780 }, dur: 3.4 },
  { sec: "PLATFORMS", name: "CodeIt", what: "Coding platform for kids", chips: ["Lessons", "Browser playground", "Accounts"], media: { t: "desk", img: "ci-lessons", img2: "ci-play" }, dur: 3.4 },
  { sec: "ERP SYSTEMS", name: "KHAIRAT", what: "One system for a whole factory", chips: ["10 departments", "Approvals", "Arabic and English"], media: { t: "desk", img: "erp-d-dashboard", img2: "erp-d-cold-store" }, dur: 3.2, note: "DEMO BUILD · SAMPLE DATA" },
  { sec: "ERP SYSTEMS", name: "KHAIRAT", what: "The same system, on every phone", chips: ["Production", "Food safety", "Export orders"], media: { t: "phones", imgs: ["erp-m-dashboard", "erp-m-food-safety", "erp-m-export-orders"] }, dur: 3.0, note: "DEMO BUILD · SAMPLE DATA" },
];
const START = 2.6;
const AT = SLIDES.map((_, i) => START + SLIDES.slice(0, i).reduce((a, b) => a + b.dur, 0));
const FLOW_AT = AT[AT.length - 1] + SLIDES[SLIDES.length - 1].dur, FLOW_DUR = 6.0;
const END = FLOW_AT + FLOW_DUR;
export const BUILT_DUR = END + 4.6;

const card: React.CSSProperties = { position: "absolute", overflow: "hidden", background: "#111", border: "2px solid rgba(255,255,255,0.18)", boxShadow: "0 50px 140px rgba(0,0,0,0.75), 0 0 90px rgba(199,255,61,0.08)" };

const Desk: React.FC<{ img: string; top: number; w: number; p: number; drift: number; rot: number; left?: number; zoom?: string }> = ({ img, top, w, p, drift, rot, left, zoom }) => {
  const h = Math.round(w * 0.662);
  return (
    <div style={{ ...card, left: left ?? (1080 - w) / 2, top, width: w, height: h + 40, borderRadius: 22, opacity: Math.min(1, p * 1.4), transform: `perspective(1800px) translateY(${(1 - p) * 160}px) rotateX(${6 - drift * 3}deg) rotateZ(${rot}deg) scale(${0.95 + p * 0.05})` }}>
      <div style={{ height: 40, background: "#17171a", display: "flex", alignItems: "center", padding: "0 16px", gap: 8 }}>
        {[0, 1, 2].map((k) => <div key={k} style={{ width: 11, height: 11, borderRadius: 6, background: "rgba(255,255,255,0.22)" }} />)}
      </div>
      <div style={{ width: w, height: h, overflow: "hidden" }}>
        <Img src={staticFile(`built/${img}.jpg`)} style={zoom ? { width: w * 2.1, height: h * 2.1, objectFit: "cover", marginLeft: 0, transform: `translate(${-parseFloat(zoom) / 100 * w * 1.1}px, ${-parseFloat(zoom.split(" ")[1]) / 100 * h * 1.1 - drift * 20}px)` } : { width: w, height: h, objectFit: "cover", objectPosition: "top", transform: `scale(${1 + drift * 0.04})`, transformOrigin: "50% 0%" }} />
      </div>
    </div>
  );
};

const Phone: React.FC<{ img: string; left: number; top: number; w: number; p: number; rot: number; scroll?: number; ratio?: number }> = ({ img, left, top, w, p, rot, scroll = 0, ratio = 2.15 }) => {
  const h = Math.round(w * 2.05);
  return (
    <div style={{ ...card, left, top, width: w, height: h, borderRadius: 54, border: "10px solid #1b1b1f", outline: "2px solid rgba(255,255,255,0.16)", opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 200}px) rotate(${rot}deg)` }}>
      <Img src={staticFile(`built/${img}.jpg`)} style={{ width: w - 20, height: (w - 20) * ratio, transform: `translateY(${-scroll}px)` }} />
    </div>
  );
};

const SlideView: React.FC<{ i: number }> = ({ i }) => {
  const { s } = useT();
  const sl = SLIDES[i], at = AT[i];
  const p = useSpringAt(at, { damping: 16, stiffness: 160 });
  const q = useSpringAt(at + 0.12, { damping: 15, stiffness: 130 });
  const r = useSpringAt(at + 0.3, { damping: 15, stiffness: 130 });
  const r2 = useSpringAt(at + 0.45, { damping: 15, stiffness: 130 });
  if (s < at || s > at + sl.dur + 0.25) return null;
  const out = ramp(s, at + sl.dur - 0.25, at + sl.dur);
  const drift = ramp(s, at, at + sl.dur, 0, 1, (x) => x);
  const m = sl.media;
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <div style={{ position: "absolute", left: 70, right: 70, top: 200, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 30}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 28, letterSpacing: 9, color: LI }}>{sl.sec}</div>
        <div style={{ fontFamily: IS, fontSize: sl.name.length > 15 ? 86 : 108, letterSpacing: -3.5, color: "#fff", marginTop: 14, lineHeight: 1 }}>{sl.name}</div>
        <div style={{ fontFamily: IL, fontSize: 42, color: "rgba(255,255,255,0.66)", marginTop: 18 }}>{sl.what}</div>
        <div style={{ display: "flex", gap: 14, marginTop: 30, flexWrap: "wrap" }}>
          {sl.chips.map((c, k) => {
            const cp = ramp(s, at + 0.25 + k * 0.12, at + 0.5 + k * 0.12);
            return <div key={c} style={{ padding: "12px 26px", borderRadius: 40, border: `2px solid ${k === 0 ? LI : "rgba(255,255,255,0.28)"}`, fontFamily: IS, fontSize: 28, color: k === 0 ? LI : "#fff", opacity: cp, transform: `translateY(${(1 - cp) * 14}px)` }}>{c}</div>;
          })}
        </div>
      </div>
      {m.t === "desk" ? (
        <>
          <Desk img={m.img} top={690} w={1000} p={q} drift={drift} rot={-1.5} />
          {m.img2 ? <Desk img={m.img2} top={1270} w={820} left={210} p={r} drift={drift} rot={2} /> : <Desk img={m.img} top={1290} w={760} left={250} p={r} drift={drift} rot={2.5} zoom={m.focus} />}
        </>
      ) : m.t === "phones" ? (
        m.imgs.length === 2 ? (
          <>
            <Phone img={m.imgs[0]} left={70} top={720} w={470} p={q} rot={-3} />
            <Phone img={m.imgs[1]} left={545} top={800} w={470} p={r} rot={3} />
          </>
        ) : (
          <>
            <Phone img={m.imgs[0]} left={20} top={840} w={360} p={q} rot={-5} />
            <Phone img={m.imgs[2]} left={700} top={840} w={360} p={r2} rot={5} />
            <Phone img={m.imgs[1]} left={330} top={720} w={420} p={r} rot={0} />
          </>
        )
      ) : (
        <Phone img={m.img} left={250} top={700} w={580} p={q} rot={0} ratio={m.h} scroll={drift * 1500} />
      )}
      {sl.note ? <div style={{ position: "absolute", left: 0, right: 0, top: 1830, textAlign: "center", fontFamily: IS, fontSize: 22, letterSpacing: 6, color: "rgba(255,255,255,0.5)" }}>{sl.note}</div> : null}
    </AbsoluteFill>
  );
};

/* CRM and automation: one enquiry travelling through the steps, a lime line drawing as it goes */
const STEPS: [string, string][] = [
  ["New enquiry", "A customer fills the form at 9:14 PM"],
  ["Saved to the CRM", "Name, need and source, no typing"],
  ["Answered in a minute", "A reply goes out while you sleep"],
  ["Follow-up reminder", "Nothing slips after day one"],
  ["You approve", "Nothing sends without your say"],
];
const Flow: React.FC = () => {
  const { s } = useT();
  const p = useSpringAt(FLOW_AT, { damping: 16, stiffness: 160 });
  if (s < FLOW_AT || s > END + 0.25) return null;
  const out = ramp(s, END - 0.25, END);
  const line = ramp(s, FLOW_AT + 0.5, FLOW_AT + 4.6, 0, 1, (x) => x);
  const Y0 = 700, GAP = 196;
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <div style={{ position: "absolute", left: 70, right: 70, top: 200, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 30}px)` }}>
        <div style={{ fontFamily: IS, fontSize: 28, letterSpacing: 9, color: LI }}>CRM AND AUTOMATION</div>
        <div style={{ fontFamily: IS, fontSize: 108, letterSpacing: -3.5, color: "#fff", marginTop: 14, lineHeight: 1 }}>LYNQ Office</div>
        <div style={{ fontFamily: IL, fontSize: 42, color: "rgba(255,255,255,0.66)", marginTop: 18 }}>The follow-up runs itself</div>
      </div>
      <div style={{ position: "absolute", left: 128, top: Y0 + 40, width: 4, height: GAP * 4, background: "rgba(255,255,255,0.12)" }} />
      <div style={{ position: "absolute", left: 128, top: Y0 + 40, width: 4, height: GAP * 4 * line, background: LI, boxShadow: `0 0 24px ${LI}` }} />
      {STEPS.map(([a, b], k) => {
        const on = line >= k / 4 - 0.02;
        const sp = ramp(s, FLOW_AT + 0.3 + k * 0.14, FLOW_AT + 0.6 + k * 0.14);
        const hit = ramp(s, FLOW_AT + 0.5 + (k / 4) * 4.1, FLOW_AT + 0.75 + (k / 4) * 4.1);
        return (
          <div key={a} style={{ position: "absolute", left: 90, right: 70, top: Y0 + k * GAP, height: 150, opacity: sp, transform: `translateX(${(1 - sp) * 40}px)` }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: 80, height: 80, borderRadius: 40, background: on ? LI : "#101012", border: `3px solid ${on ? LI : "rgba(255,255,255,0.25)"}`, boxShadow: on ? `0 0 ${30 + hit * 30}px rgba(199,255,61,0.55)` : "none", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: IS, fontSize: 34, color: on ? "#0a0a0a" : "rgba(255,255,255,0.5)", transform: `scale(${1 + (hit > 0 && hit < 1 ? 0.12 : 0)})` }}>{k === 4 ? "✓" : k + 1}</div>
            <div style={{ position: "absolute", left: 120, right: 0, top: -14, padding: "22px 30px", borderRadius: 26, background: on ? "rgba(199,255,61,0.08)" : "rgba(255,255,255,0.04)", border: `2px solid ${on ? "rgba(199,255,61,0.45)" : "rgba(255,255,255,0.1)"}` }}>
              <div style={{ fontFamily: IS, fontSize: 46, letterSpacing: -1, color: on ? "#fff" : "rgba(255,255,255,0.5)" }}>{a}</div>
              <div style={{ fontFamily: IL, fontSize: 30, color: on ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)", marginTop: 4 }}>{b}</div>
            </div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 1830, textAlign: "center", fontFamily: IS, fontSize: 22, letterSpacing: 6, color: "rgba(255,255,255,0.5)" }}>HOW IT WORKS · EXAMPLE ENQUIRY</div>
    </AbsoluteFill>
  );
};

export const LynqBuilt: React.FC = () => {
  const { s } = useT();
  const h = useSpringAt(0.1, { damping: 14, stiffness: 160 });
  const hOut = ramp(s, START - 0.35, START);
  const e = useSpringAt(END + 0.15, { damping: 14, stiffness: 150 });
  const tap = s >= END + 2.2 && s < END + 2.45;
  const total = SLIDES.length + 1;
  const cur = s < START ? -1 : s >= FLOW_AT ? SLIDES.length : AT.filter((a) => s >= a).length - 1;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Fonts />
      <div style={{ position: "absolute", left: -200, top: 500, width: 1500, height: 1500, borderRadius: 750, background: "radial-gradient(circle, rgba(199,255,61,0.07) 0%, rgba(199,255,61,0) 60%)" }} />
      <div style={{ position: "absolute", left: 70, top: 96, fontFamily: IS, fontSize: 30, letterSpacing: 12, color: "#fff" }}>LYNQ</div>
      {s >= START && s < END ? (
        <div style={{ position: "absolute", right: 70, top: 108, display: "flex", gap: 8 }}>
          {Array.from({ length: total }).map((_, k) => <div key={k} style={{ width: k === cur ? 44 : 14, height: 6, borderRadius: 3, background: k <= cur ? LI : "rgba(255,255,255,0.2)" }} />)}
        </div>
      ) : null}
      {s < START ? (
        <div style={{ position: "absolute", left: 70, right: 70, top: 690, opacity: Math.min(1, h * 1.4) * (1 - hOut), transform: `translateY(${(1 - h) * 40}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 104, lineHeight: 1.04, letterSpacing: -4, color: "#fff" }}>What does LYNQ</div>
          <div style={{ fontFamily: IS, fontSize: 104, lineHeight: 1.04, letterSpacing: -4, color: LI }}>actually build?</div>
          <div style={{ fontFamily: IL, fontSize: 42, color: "rgba(255,255,255,0.6)", marginTop: 34 }}>Real clients. Real screens.</div>
        </div>
      ) : null}
      {SLIDES.map((_, i) => <SlideView key={i} i={i} />)}
      <Flow />
      {s >= END ? (
        <div style={{ position: "absolute", left: 70, right: 70, top: 620, textAlign: "center", opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * 40}px)` }}>
          <div style={{ fontFamily: IL, fontSize: 98, letterSpacing: -3.5, lineHeight: 1.05, color: "#fff" }}>We built those.</div>
          <div style={{ fontFamily: IS, fontSize: 98, letterSpacing: -3.5, lineHeight: 1.05, color: LI }}>Yours is next.</div>
          <div style={{ display: "inline-block", marginTop: 84, padding: "32px 70px", borderRadius: 70, background: LI, fontFamily: IS, fontSize: 50, color: "#0a0a0a", transform: `scale(${tap ? 0.93 : 1})`, boxShadow: "0 0 80px rgba(199,255,61,0.35)" }}>Book a consultation</div>
          <div style={{ marginTop: 50, fontFamily: IS, fontSize: 28, letterSpacing: 8, color: "#fff" }}>LINK IN BIO</div>
          <div style={{ marginTop: 14, fontFamily: IL, fontSize: 30, color: "rgba(255,255,255,0.55)" }}>lynq.build/book</div>
        </div>
      ) : null}
      {AT.map((a) => <Sfx key={a} at={a} src="whoosh.wav" volume={0.22} />)}
      <Sfx at={FLOW_AT} src="whoosh.wav" volume={0.22} />
      <Sfx at={END + 2.2} src="click.wav" volume={0.4} />
    </AbsoluteFill>
  );
};
