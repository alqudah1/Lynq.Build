import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts } from "./kit";

/*
 * LYNQ story frames for the service highlights. Same quiet look as the grid: black, Inter Light,
 * one lime line. Wording follows lynq.build (services and the book-a-call steps). No prices, no
 * city names, no made-up numbers. Every highlight ends on the same action: book a consultation.
 * 1080x1920, kept inside the story safe area (clear of the top bar and the reply box).
 */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'";

export type Frame = { hl: string; label: string; head: string[]; lime: string[]; body?: string[]; steps?: string[]; cta?: boolean };

export const FRAMES: Frame[] = [
  { hl: "start", label: "START HERE", head: ["Websites, systems,", "ads and AI."], lime: ["One team."], body: ["For local businesses that are done", "juggling five different vendors."] },
  { hl: "start", label: "WHO IT'S FOR", head: ["You run", "the business."], lime: ["We build", "what runs it."], body: ["Salons, trades, clinics,", "restaurants and studios."] },
  { hl: "start", label: "HOW IT WORKS", head: ["Three steps."], lime: [], steps: ["Tell us what needs to work better.", "We reply within a day with the right next step.", "A 15 to 20 minute call. Then we build."] },
  { hl: "start", label: "NEXT STEP", head: ["Book a"], lime: ["consultation."], cta: true },

  { hl: "websites", label: "WEBSITES", head: ["A site that makes", "the next step"], lime: ["obvious."], body: ["Visitors see what you sell, why it", "matters and how to buy. No hunting."] },
  { hl: "websites", label: "WHAT WE DO", head: ["Strategy, design,"], lime: ["copy and build."], body: ["Landing pages, redesigns and full sites,", "with lead capture and analytics connected."] },
  { hl: "websites", label: "WEBSITES", head: ["Want yours", "looked at?"], lime: ["Book a consultation."], cta: true },

  { hl: "systems", label: "ERP AND CRM", head: ["Spreadsheets, email", "and WhatsApp."], lime: ["Into one system."], body: ["Customers, sales, projects and", "reports, all in one place."] },
  { hl: "systems", label: "HOW WE DO IT", head: ["We map the business"], lime: ["before choosing tools."], body: ["CRM, forms, projects and reporting,", "built around how your team really works."] },
  { hl: "systems", label: "ERP AND CRM", head: ["Ready to stop", "copy and pasting?"], lime: ["Book a consultation."], cta: true },

  { hl: "ai", label: "AI AUTOMATION", head: ["Answers at"], lime: ["11 PM."], body: ["A chat assistant trained on your services", "and hours, guiding visitors toward booking."] },
  { hl: "ai", label: "AI AUTOMATION", head: ["Follow-ups that"], lime: ["send themselves."], body: ["AI agents that qualify a lead, draft the", "reply and check their own work first."] },
  { hl: "ai", label: "AI AUTOMATION", head: ["What should run", "without you?"], lime: ["Book a consultation."], cta: true },

  { hl: "booking", label: "BOOKING", head: ["They want to book."], lime: ["Let them."], body: ["Online booking on your site, so nobody", "has to call to become a customer."] },
  { hl: "booking", label: "BOOKING", head: ["Fewer missed calls."], lime: ["More booked jobs."], cta: true },

  { hl: "reels", label: "REELS AND ADS", head: ["Reels that explain"], lime: ["what you do."], body: ["Scripted, built and posted for you.", "Then shown to the right people with ads."] },
  { hl: "reels", label: "REELS AND ADS", head: ["Want one for", "your business?"], lime: ["Book a consultation."], cta: true },
];

export const Story: React.FC<{ f: Frame; i: number; n: number }> = ({ f, i, n }) => {
  const size = f.head.concat(f.lime).some((l) => l.length > 19) ? 92 : 112;
  return (
    <AbsoluteFill style={{ background: "#040404" }}>
      <Fonts />
      <div style={{ position: "absolute", left: -160, top: 300, width: 1400, height: 1400, borderRadius: 700, background: `radial-gradient(closest-side, rgba(199,255,61,${f.cta ? 0.1 : 0.05}) 0%, rgba(199,255,61,0) 100%)` }} />
      <div style={{ position: "absolute", left: 80, top: 270, display: "flex", alignItems: "center", gap: 16 }}>
        <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 44, height: 44 }} />
        <span style={{ fontFamily: IS, fontSize: 34, letterSpacing: 7, color: "#fff" }}>LYNQ</span>
      </div>
      <div style={{ position: "absolute", right: 80, top: 282, fontFamily: IS, fontSize: 22, letterSpacing: 6, color: LI }}>{f.label}</div>
      <div style={{ position: "absolute", left: 80, top: 345, right: 80, display: "flex", gap: 10 }}>
        {Array.from({ length: n }).map((_, k) => <div key={k} style={{ flex: 1, height: 4, borderRadius: 2, background: k <= i ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.18)" }} />)}
      </div>

      <div style={{ position: "absolute", left: 76, right: 70, top: 560 }}>
        <div style={{ fontFamily: IL, fontSize: size, lineHeight: 1.03, letterSpacing: -size / 19, color: "#fff", whiteSpace: "nowrap" }}>
          {f.head.map((l) => <div key={l}>{l}</div>)}
          {f.lime.map((l) => <div key={l} style={{ color: LI }}>{l}</div>)}
        </div>
        {f.body && <div style={{ marginTop: 64, fontFamily: IL, fontSize: 46, lineHeight: 1.3, letterSpacing: -0.6, color: "rgba(255,255,255,0.74)" }}>{f.body.map((l) => <div key={l}>{l}</div>)}</div>}
        {f.steps && (
          <div style={{ marginTop: 80 }}>
            {f.steps.map((t, k) => (
              <div key={t} style={{ display: "flex", gap: 34, alignItems: "flex-start", padding: "34px 0", borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                <span style={{ fontFamily: IS, fontSize: 30, color: LI, width: 40, paddingTop: 8 }}>0{k + 1}</span>
                <span style={{ flex: 1, fontFamily: IL, fontSize: 48, lineHeight: 1.22, letterSpacing: -0.8, color: "#fff" }}>{t}</span>
              </div>
            ))}
          </div>
        )}
        {f.cta && (
          <div style={{ marginTop: 90 }}>
            <div style={{ display: "inline-block", padding: "30px 56px", borderRadius: 70, background: LI, fontFamily: IS, fontSize: 46, color: "#0b0d0a" }}>lynq.build/book</div>
            <div style={{ marginTop: 34, fontFamily: IL, fontSize: 40, lineHeight: 1.3, color: "rgba(255,255,255,0.65)" }}>Send a short form. We reply within a day<br />and set up a 15 to 20 minute call.</div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

const GLYPH: Record<string, React.ReactNode> = {
  start: <div style={{ width: 0, height: 0, borderTop: "70px solid transparent", borderBottom: "70px solid transparent", borderLeft: `120px solid ${LI}`, marginLeft: 30 }} />,
  websites: <div style={{ width: 230, height: 160, borderRadius: 22, border: `12px solid ${LI}`, position: "relative" }}><div style={{ position: "absolute", left: 0, right: 0, top: 30, height: 12, background: LI }} /></div>,
  systems: <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>{[0, 1, 2, 3].map((k) => <div key={k} style={{ width: 96, height: 96, borderRadius: 20, background: k === 3 ? LI : "transparent", border: `12px solid ${LI}`, boxSizing: "border-box" }} />)}</div>,
  ai: <div style={{ position: "relative", width: 200, height: 200 }}>{[0, 45, 90, 135].map((r) => <div key={r} style={{ position: "absolute", left: 94, top: 0, width: 12, height: 200, borderRadius: 6, background: LI, transform: `rotate(${r}deg)` }} />)}</div>,
  booking: <div style={{ width: 210, height: 190, borderRadius: 26, border: `12px solid ${LI}`, position: "relative" }}><div style={{ position: "absolute", left: 0, right: 0, top: 44, height: 12, background: LI }} /><div style={{ position: "absolute", left: 62, top: 88, width: 70, height: 36, borderLeft: `14px solid ${LI}`, borderBottom: `14px solid ${LI}`, transform: "rotate(-45deg)" }} /></div>,
  reels: <div style={{ width: 150, height: 240, borderRadius: 34, border: `12px solid ${LI}`, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 0, height: 0, borderTop: "34px solid transparent", borderBottom: "34px solid transparent", borderLeft: `56px solid ${LI}`, marginLeft: 14 }} /></div>,
};

/** Highlight cover: Instagram crops this to a small circle, so one lime glyph, dead centre. */
export const HlCover: React.FC<{ hl: string }> = ({ hl }) => (
  <AbsoluteFill style={{ background: "#040404", alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: 620, height: 620, borderRadius: 310, background: "radial-gradient(closest-side, rgba(199,255,61,0.10) 0%, rgba(199,255,61,0) 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>{GLYPH[hl]}</div>
  </AbsoluteFill>
);
