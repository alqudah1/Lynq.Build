import React from "react";
import { AbsoluteFill } from "remotion";
import { Fonts } from "./kit";

/*
 * LYNQ highlights, second pass: one story per service, and each one shows the thing itself as a
 * small product scene (a site, a pipeline, a chat, a calendar, a reel), so one tap explains it.
 * Black and lime like the grid, no prices, no city names, no made-up numbers. Shops are made up.
 * 1080x1920, kept clear of the story top bar and reply box.
 */
const LI = "#C7FF3D", IL = "'Inter Light'", IS = "'Inter SemiBold'";
const line = "rgba(255,255,255,0.10)";
const card: React.CSSProperties = { background: "#0f110e", border: `1.5px solid ${line}`, borderRadius: 28 };
const dim = "rgba(255,255,255,0.5)";

const Shell: React.FC<{ label: string; head: string[]; lime: string; sub: string; glow?: [number, number]; children: React.ReactNode }> = ({ label, head, lime, sub, glow = [540, 760], children }) => (
  <AbsoluteFill style={{ background: "#040404" }}>
    <Fonts />
    <div style={{ position: "absolute", left: glow[0] - 620, top: glow[1] - 620, width: 1240, height: 1240, borderRadius: 620, background: "radial-gradient(closest-side, rgba(199,255,61,0.13) 0%, rgba(199,255,61,0) 100%)" }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 262, textAlign: "center", fontFamily: IS, fontSize: 24, letterSpacing: 10, color: LI }}>{label}</div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 340, height: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>
    <div style={{ position: "absolute", left: 80, right: 80, top: 1210, textAlign: "center" }}>
      <div style={{ fontFamily: IL, fontSize: 104, lineHeight: 1.04, letterSpacing: -5, color: "#fff" }}>
        {head.map((l) => <div key={l}>{l}</div>)}
        <div style={{ color: LI }}>{lime}</div>
      </div>
      <div style={{ marginTop: 30, fontFamily: IL, fontSize: 42, lineHeight: 1.3, color: "rgba(255,255,255,0.66)" }}>{sub}</div>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 1570, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ padding: "22px 46px", borderRadius: 60, background: LI, fontFamily: IS, fontSize: 36, color: "#0b0d0a" }}>Book a consultation</div>
      <div style={{ fontFamily: IL, fontSize: 28, letterSpacing: 2, color: dim }}>lynq.build/book</div>
    </div>
  </AbsoluteFill>
);

const Bar: React.FC<{ w: number | string; h?: number; o?: number; c?: string; mt?: number }> = ({ w, h = 14, o = 0.16, c, mt = 0 }) => (
  <div style={{ width: w, height: h, borderRadius: h, background: c || `rgba(255,255,255,${o})`, marginTop: mt }} />
);

/* START HERE: the five things, stacked like a deck. */
const SERVICES = ["Websites", "ERP and CRM", "AI automation", "Online booking", "Reels and ads"];
export const HlStart: React.FC = () => (
  <Shell label="LYNQ" head={["What we do."]} lime="One team." sub="Five services. Tap a highlight to see each.">
    <div style={{ width: 760 }}>
      {SERVICES.map((s, i) => (
        <div key={s} style={{ ...card, height: 124, marginTop: i ? 18 : 0, marginLeft: (i % 2) * 44, marginRight: ((i + 1) % 2) * 44, display: "flex", alignItems: "center", padding: "0 40px", gap: 30, borderColor: i === 0 ? LI : line }}>
          <span style={{ fontFamily: IS, fontSize: 28, color: LI, width: 46 }}>0{i + 1}</span>
          <span style={{ fontFamily: IL, fontSize: 52, letterSpacing: -1.5, color: "#fff", flex: 1 }}>{s}</span>
          <span style={{ fontFamily: IL, fontSize: 44, color: dim }}>→</span>
        </div>
      ))}
    </div>
  </Shell>
);

/* WEBSITES: a browser window with a finished page in it. */
export const HlWebsites: React.FC = () => (
  <Shell label="LYNQ" head={["Websites"]} lime="that sell." sub="We design, write and build it.">
    <div style={{ ...card, width: 860, height: 700, overflow: "hidden", background: "#f4f2ec", borderColor: "rgba(255,255,255,0.2)" }}>
      <div style={{ height: 70, background: "#17191a", display: "flex", alignItems: "center", padding: "0 26px", gap: 12 }}>
        {[0, 1, 2].map((d) => <div key={d} style={{ width: 16, height: 16, borderRadius: 8, background: "rgba(255,255,255,0.22)" }} />)}
        <div style={{ marginLeft: 20, flex: 1, height: 38, borderRadius: 19, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", padding: "0 22px", fontFamily: IL, fontSize: 22, color: dim }}>northsidebarbers.com</div>
      </div>
      <div style={{ padding: "34px 44px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: IS, fontSize: 26, letterSpacing: 5, color: "#141414" }}>NORTHSIDE</span>
        <div style={{ display: "flex", gap: 26 }}><Bar w={70} c="rgba(0,0,0,0.25)" /><Bar w={70} c="rgba(0,0,0,0.25)" /><Bar w={70} c="rgba(0,0,0,0.25)" /></div>
      </div>
      <div style={{ padding: "26px 44px 0", display: "flex", gap: 36 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: IL, fontSize: 76, lineHeight: 1.0, letterSpacing: -3.5, color: "#141414" }}>Fresh cuts.<br />No waiting.</div>
          <Bar w={280} c="rgba(0,0,0,0.22)" mt={34} /><Bar w={220} c="rgba(0,0,0,0.22)" mt={14} />
          <div style={{ marginTop: 40, display: "inline-block", padding: "20px 38px", borderRadius: 40, background: "#141414", fontFamily: IS, fontSize: 28, color: LI }}>Book now</div>
        </div>
        <div style={{ width: 300, height: 380, borderRadius: 22, background: "linear-gradient(160deg,#2b2f26 0%,#11130f 60%,#6f8f1f 140%)" }} />
      </div>
    </div>
  </Shell>
);

/* ERP AND CRM: a pipeline board with a few numbers on top. */
const COLS: [string, string[][]][] = [
  ["New", [["Kitchen refit", "Quote sent"], ["Office move", "Call booked"], ["Deck repair", "New"]]],
  ["In progress", [["Roof repair", "Crew on site"], ["Brand refresh", "Draft 2"]]],
  ["Done", [["Garden wall", "Paid"]]],
];
export const HlSystems: React.FC = () => (
  <Shell label="LYNQ" head={["ERP and CRM"]} lime="in one place." sub="Customers, jobs and reports.">
    <div style={{ ...card, width: 900, height: 700, padding: 34 }}>
      <div style={{ display: "flex", gap: 20 }}>
        {["Open jobs", "Waiting on reply", "Due this week"].map((t, i) => (
          <div key={t} style={{ flex: 1, borderRadius: 20, background: "rgba(255,255,255,0.045)", padding: "22px 24px" }}>
            <div style={{ fontFamily: IL, fontSize: 22, color: dim }}>{t}</div>
            <div style={{ marginTop: 16, display: "flex", alignItems: "flex-end", gap: 7, height: 46 }}>
              {[18, 30, 22, 38, 28, 46].map((h, k) => <div key={k} style={{ width: 16, height: h - i * 4 + (k % 2) * i * 6, borderRadius: 5, background: k === 5 ? LI : "rgba(255,255,255,0.2)" }} />)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 26 }}>
        {COLS.map(([name, cards], c) => (
          <div key={name} style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 12, height: 12, borderRadius: 6, background: c === 2 ? LI : "rgba(255,255,255,0.4)" }} />
              <span style={{ fontFamily: IS, fontSize: 24, color: "#fff" }}>{name}</span>
            </div>
            {cards.map(([t, s]) => (
              <div key={t} style={{ borderRadius: 18, background: "rgba(255,255,255,0.055)", border: `1.5px solid ${c === 2 ? "rgba(199,255,61,0.5)" : line}`, padding: "20px 20px", marginBottom: 14 }}>
                <div style={{ fontFamily: IL, fontSize: 27, color: "#fff" }}>{t}</div>
                <div style={{ marginTop: 10, fontFamily: IL, fontSize: 21, color: c === 2 ? LI : dim }}>{s}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  </Shell>
);

/* AI AUTOMATION: a late-night chat that ends in a booking. */
const CHAT: [boolean, string][] = [
  [false, "Hi, are you open Sunday?"],
  [true, "We are, 10 to 6. I have 2:30 free. Want it?"],
  [false, "Yes please"],
  [true, "Done. You're booked for Sunday 2:30."],
];
export const HlAi: React.FC = () => (
  <Shell label="LYNQ" head={["AI assistant"]} lime="that replies for you." sub="Answers, follow-ups and bookings.">
    <div style={{ ...card, width: 700, height: 720, padding: "34px 36px", borderRadius: 44 }}>
      <div style={{ textAlign: "center", fontFamily: IL, fontSize: 24, letterSpacing: 3, color: dim }}>TODAY 11:04 PM</div>
      {CHAT.map(([ai, t]) => (
        <div key={t} style={{ display: "flex", justifyContent: ai ? "flex-start" : "flex-end", marginTop: 26 }}>
          <div style={{ maxWidth: 500, padding: "24px 30px", borderRadius: 34, borderBottomLeftRadius: ai ? 8 : 34, borderBottomRightRadius: ai ? 34 : 8, background: ai ? LI : "rgba(255,255,255,0.09)", fontFamily: ai ? IS : IL, fontSize: 32, lineHeight: 1.25, color: ai ? "#0b0d0a" : "#fff" }}>{t}</div>
        </div>
      ))}
      <div style={{ marginTop: 30, display: "flex", alignItems: "center", gap: 12, fontFamily: IL, fontSize: 23, color: dim }}>
        <div style={{ width: 12, height: 12, borderRadius: 6, background: LI }} />Assistant · made-up shop
      </div>
    </div>
  </Shell>
);

/* BOOKING: a month, a picked day, a picked time, a tick. */
export const HlBooking: React.FC = () => (
  <Shell label="LYNQ" head={["Online booking"]} lime="open 24/7." sub="Customers book themselves.">
    <div style={{ ...card, width: 760, height: 720, padding: "36px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: IL, fontSize: 40, letterSpacing: -1, color: "#fff" }}>Pick a day</span>
        <span style={{ fontFamily: IL, fontSize: 30, color: dim }}>‹  ›</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12, marginTop: 28 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} style={{ textAlign: "center", fontFamily: IS, fontSize: 20, letterSpacing: 2, color: dim }}>{d}</div>)}
        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
          <div key={d} style={{ height: 66, borderRadius: 33, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: d === 18 ? IS : IL, fontSize: 28, background: d === 18 ? LI : "transparent", color: d === 18 ? "#0b0d0a" : d < 12 ? "rgba(255,255,255,0.28)" : "#fff" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 28 }}>
        {["10:00", "12:30", "2:30", "4:00"].map((t) => (
          <div key={t} style={{ flex: 1, height: 70, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: t === "2:30" ? IS : IL, fontSize: 28, border: `1.5px solid ${t === "2:30" ? LI : line}`, color: t === "2:30" ? LI : "#fff" }}>{t}</div>
        ))}
      </div>
      <div style={{ marginTop: 24, height: 84, borderRadius: 22, background: "rgba(199,255,61,0.12)", display: "flex", alignItems: "center", justifyContent: "center", gap: 18, fontFamily: IS, fontSize: 30, color: LI }}>
        <div style={{ width: 26, height: 14, borderLeft: `5px solid ${LI}`, borderBottom: `5px solid ${LI}`, transform: "rotate(-45deg)", marginTop: -8 }} />Booked for the 18th at 2:30
      </div>
    </div>
  </Shell>
);

/* REELS AND ADS: a phone playing a reel, with the ad button under it. */
export const HlReels: React.FC = () => (
  <Shell label="LYNQ" head={["Reels and ads"]} lime="done for you." sub="We script, build and post them.">
    <div style={{ position: "relative", width: 420, height: 760, borderRadius: 60, border: "10px solid #23261f", background: "linear-gradient(170deg,#1c2114 0%,#070807 55%,#3d5210 150%)", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 150, top: 16, width: 100, height: 26, borderRadius: 13, background: "#000" }} />
      <div style={{ position: "absolute", left: 30, top: 150, right: 30, fontFamily: IL, fontSize: 50, lineHeight: 1.05, letterSpacing: -2, color: "#fff" }}>I tried to give this shop <span style={{ color: LI }}>my money.</span></div>
      <div style={{ position: "absolute", left: 150, top: 380, width: 100, height: 100, borderRadius: 50, background: "rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 0, height: 0, borderTop: "20px solid transparent", borderBottom: "20px solid transparent", borderLeft: "32px solid #fff", marginLeft: 8 }} />
      </div>
      <div style={{ position: "absolute", right: 22, top: 420, display: "flex", flexDirection: "column", gap: 26, alignItems: "center" }}>
        {[0, 1, 2].map((k) => <div key={k} style={{ width: 44, height: 44, borderRadius: 22, border: "3px solid rgba(255,255,255,0.7)" }} />)}
      </div>
      <div style={{ position: "absolute", left: 28, bottom: 130 }}>
        <div style={{ fontFamily: IS, fontSize: 22, color: "#fff" }}>yourbusiness <span style={{ fontFamily: IL, color: dim }}>· Sponsored</span></div>
        <Bar w={230} mt={14} o={0.3} h={10} /><Bar w={170} mt={10} o={0.3} h={10} />
      </div>
      <div style={{ position: "absolute", left: 24, right: 24, bottom: 36, height: 70, borderRadius: 18, background: LI, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", fontFamily: IS, fontSize: 26, color: "#0b0d0a" }}><span>Book now</span><span>›</span></div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, background: "rgba(255,255,255,0.2)" }}><div style={{ width: "62%", height: 6, background: "#fff" }} /></div>
    </div>
  </Shell>
);

/* Covers: a small piece of each scene, centred so it survives the round crop. */
const G: Record<string, React.ReactNode> = {
  start: <div>{[0, 1, 2].map((i) => <div key={i} style={{ width: 250 - i * 0, height: 54, borderRadius: 16, marginTop: i ? 16 : 0, marginLeft: (i % 2) * 40, border: `8px solid ${i === 0 ? LI : "rgba(255,255,255,0.35)"}`, background: i === 0 ? LI : "transparent" }} />)}</div>,
  websites: <div style={{ width: 270, height: 200, borderRadius: 26, border: `10px solid ${LI}`, position: "relative" }}><div style={{ position: "absolute", left: 0, right: 0, top: 36, height: 10, background: LI }} /><div style={{ position: "absolute", left: 28, top: 76, width: 120, height: 16, borderRadius: 8, background: "#fff" }} /><div style={{ position: "absolute", left: 28, top: 118, width: 84, height: 34, borderRadius: 17, background: LI }} /></div>,
  systems: <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>{[3, 2, 1].map((n, c) => <div key={c}>{Array.from({ length: n }).map((_, k) => <div key={k} style={{ width: 76, height: 58, borderRadius: 14, marginBottom: 14, background: c === 2 ? LI : "transparent", border: `8px solid ${c === 2 ? LI : "rgba(255,255,255,0.45)"}` }} />)}</div>)}</div>,
  ai: <div style={{ width: 280 }}><div style={{ marginLeft: 90, width: 190, height: 70, borderRadius: 35, borderBottomRightRadius: 10, background: "rgba(255,255,255,0.3)" }} /><div style={{ marginTop: 20, width: 220, height: 80, borderRadius: 40, borderBottomLeftRadius: 10, background: LI }} /></div>,
  booking: <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 54px)", gap: 14 }}>{Array.from({ length: 12 }).map((_, i) => <div key={i} style={{ width: 54, height: 54, borderRadius: 27, background: i === 6 ? LI : "rgba(255,255,255,0.22)" }} />)}</div>,
  reels: <div style={{ width: 160, height: 270, borderRadius: 38, border: `10px solid ${LI}`, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 0, height: 0, borderTop: "36px solid transparent", borderBottom: "36px solid transparent", borderLeft: `58px solid ${LI}`, marginLeft: 14 }} /></div>,
};
export const HlCover2: React.FC<{ hl: string }> = ({ hl }) => (
  <AbsoluteFill style={{ background: "#040404", alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: 700, height: 700, borderRadius: 350, background: "radial-gradient(closest-side, rgba(199,255,61,0.14) 0%, rgba(199,255,61,0) 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>{G[hl]}</div>
  </AbsoluteFill>
);

export const HL2: [string, React.FC][] = [["start", HlStart], ["websites", HlWebsites], ["systems", HlSystems], ["ai", HlAi], ["booking", HlBooking], ["reels", HlReels]];
