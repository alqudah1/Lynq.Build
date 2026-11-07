import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { BK, CARD, LI, LN, MU, RED, Say, Tag, Kw, WH } from "./lynq-story-kit";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * Demo-first LYNQ reels: the system itself on a phone screen, doing the job.
 * No presenter, no story to decode. Names and orders are made up and the frame says so.
 */

const q = (f: string) => `'${f}'`;
const EN = "en" as const;
const SANS = "Outfit Regular", BOLD = "Outfit Bold", MONO = "JetBrains Mono";

const Frame: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <AbsoluteFill style={{ background: `radial-gradient(70% 45% at 50% 28%, #1e221d 0%, ${BK} 72%)` }}>
    <Fonts />
    {children}
    <div style={{ position: "absolute", left: 90, right: 90, top: 110, display: "flex", justifyContent: "space-between", fontFamily: q(MONO), fontSize: 26, letterSpacing: 4, color: MU }}>
      <span style={{ color: WH }}>LYNQ</span><span>{label}</span>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 165, display: "flex", justifyContent: "center" }}>
      <div style={{ padding: "8px 22px", borderRadius: 30, border: `1px solid ${LN}`, fontFamily: q(MONO), fontSize: 22, letterSpacing: 3, color: MU }}>DEMO · MADE-UP NAMES</div>
    </div>
    <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={0.28} />
  </AbsoluteFill>
);

/** A big close-up phone. Its bottom runs off the frame, so the screen we use sits above the IG caption zone. */
const BigPhone: React.FC<{ children: React.ReactNode; scale?: number; y?: number; dim?: number; time?: string }> = ({ children, scale = 1, y = 0, dim = 0, time = "6:52" }) => (
  <div style={{ position: "absolute", left: 110, top: 500 + y, width: 860, height: 1600, borderRadius: 110, background: "#161618", boxShadow: "0 60px 140px rgba(0,0,0,0.75), inset 0 0 0 3px #2e2e33", transform: `scale(${scale})`, transformOrigin: "50% 0" }}>
    <div style={{ position: "absolute", inset: 22, borderRadius: 90, overflow: "hidden", background: "#000" }}>
      <div style={{ position: "absolute", left: 70, right: 70, top: 30, display: "flex", justifyContent: "space-between", fontFamily: q(BOLD), fontSize: 32, color: WH, zIndex: 3 }}>
        <span>{time}</span>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {[10, 16, 22, 28].map((h) => <span key={h} style={{ width: 7, height: h, borderRadius: 2, background: WH }} />)}
          <span style={{ marginLeft: 10, width: 54, height: 26, borderRadius: 8, border: `2px solid ${WH}`, padding: 3, boxSizing: "border-box" }}><span style={{ display: "block", width: "70%", height: "100%", borderRadius: 3, background: WH }} /></span>
        </span>
      </div>
      <div style={{ position: "absolute", left: 330, top: 26, width: 156, height: 46, borderRadius: 23, background: "#050506", zIndex: 4 }} />
      {children}
      {dim > 0 && <div style={{ position: "absolute", inset: 0, background: "#000", opacity: dim, zIndex: 5 }} />}
    </div>
  </div>
);

/* ── 1. Missed call, texted back ─────────────────────────────────────── */

const CallScreen: React.FC<{ endAt: number }> = ({ endAt }) => {
  const { s } = useT();
  const ended = s >= endAt;
  const pulse = ended ? 0 : (s * 1.2) % 1;
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#1b1f1a,#0b0c0b)" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 170, textAlign: "center" }}>
        <div style={{ position: "relative", width: 230, height: 230, margin: "0 auto" }}>
          {!ended && <div style={{ position: "absolute", inset: -60 * pulse, borderRadius: 400, border: `3px solid ${LI}`, opacity: 1 - pulse }} />}
          <div style={{ width: 230, height: 230, borderRadius: 115, background: "#3a3f37", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q(BOLD), fontSize: 110, color: WH }}>S</div>
        </div>
        <div style={{ marginTop: 40, fontFamily: q(SANS), fontSize: 66, color: WH }}>Sami's Bakery</div>
        <div style={{ marginTop: 14, fontFamily: q(SANS), fontSize: 38, color: ended ? RED : MU }}>{ended ? "No answer" : "calling…"}</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 760, display: "flex", justifyContent: "center" }}>
        <div style={{ width: 150, height: 150, borderRadius: 75, background: ended ? "#3a3f37" : RED, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 70, height: 26, borderRadius: 13, background: WH, transform: "rotate(-135deg)" }} />
        </div>
      </div>
    </div>
  );
};

type Msg = { at: number; me?: boolean; text: string; label?: string };

const Bubble: React.FC<{ m: Msg }> = ({ m }) => {
  const { s } = useT();
  const typing = !m.me && s >= m.at - 0.7 && s < m.at;
  const show = useSpringAt(m.me ? m.at : m.at - 0.7, { damping: 16, stiffness: 180 });
  const pop = useSpringAt(m.at, { damping: 13, stiffness: 220 });
  if (s < (m.me ? m.at : m.at - 0.7)) return null;
  return (
    <div style={{ maxHeight: show * 360, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start", padding: "0 34px", marginTop: 16 }}>
      {typing ? (
        <div style={{ padding: "26px 34px", borderRadius: 40, background: "#262826", display: "flex", gap: 12 }}>
          {[0, 1, 2].map((i) => <span key={i} style={{ width: 16, height: 16, borderRadius: 8, background: MU, opacity: 0.4 + 0.6 * Math.abs(Math.sin(s * 6 + i)) }} />)}
        </div>
      ) : (
        <>
          <div style={{ maxWidth: 600, padding: "22px 32px", borderRadius: 40, background: m.me ? "#2f7cf6" : "#262826", fontFamily: q(SANS), fontSize: 38, lineHeight: 1.25, color: WH, transform: `scale(${0.85 + 0.15 * pop})`, transformOrigin: m.me ? "100% 100%" : "0 100%" }}>{m.text}</div>
          {m.label && <div style={{ marginTop: 8, fontFamily: q(MONO), fontSize: 22, letterSpacing: 2, color: LI, opacity: pop }}>{m.label}</div>}
        </>
      )}
    </div>
  );
};

const Thread: React.FC<{ msgs: Msg[]; chipAt: number }> = ({ msgs, chipAt }) => {
  const { s } = useT();
  const chip = useSpringAt(chipAt, { damping: 12, stiffness: 200 }) * (1 - ramp(s, chipAt + 2.0, chipAt + 2.4));
  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {/* the messages stack up from the bottom of the visible screen and push older ones up */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 1600 - 22 - 940, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        {msgs.map((m, i) => <Bubble key={i} m={m} />)}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 250, background: "linear-gradient(180deg,#0d0e0d 75%,rgba(13,14,13,0))", zIndex: 2 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 100, textAlign: "center" }}>
          <div style={{ width: 84, height: 84, borderRadius: 42, margin: "0 auto", background: "#3a3f37", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q(BOLD), fontSize: 40, color: WH }}>S</div>
          <div style={{ marginTop: 6, fontFamily: q(SANS), fontSize: 28, color: WH }}>Sami's Bakery</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 270, display: "flex", justifyContent: "center", zIndex: 2, opacity: chip, transform: `scale(${chip})` }}>
        <div style={{ padding: "10px 24px", borderRadius: 30, background: "rgba(213,253,113,0.12)", border: `1px solid ${LI}`, fontFamily: q(MONO), fontSize: 24, letterSpacing: 2, color: LI }}>8 SECONDS AFTER THE MISSED CALL</div>
      </div>
    </div>
  );
};

const Notice: React.FC<{ at: number; title: string; body: string; app: string }> = ({ at, title, body, app }) => {
  const p = useSpringAt(at, { damping: 15, stiffness: 160 });
  const { s } = useT();
  if (s < at) return null;
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: 520 + (1 - p) * -260, padding: "30px 34px", borderRadius: 44, background: "rgba(38,42,37,0.96)", border: `1px solid ${LN}`, boxShadow: "0 40px 90px rgba(0,0,0,0.6)", opacity: p, display: "flex", gap: 26, zIndex: 9 }}>
      <div style={{ width: 92, height: 92, borderRadius: 24, background: LI, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q(BOLD), fontSize: 46, color: BK }}>✓</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: q(MONO), fontSize: 22, letterSpacing: 2, color: MU }}><span>{app}</span><span>now</span></div>
        <div style={{ marginTop: 6, fontFamily: q(BOLD), fontSize: 36, color: WH }}>{title}</div>
        <div style={{ marginTop: 4, fontFamily: q(SANS), fontSize: 32, color: MU }}>{body}</div>
      </div>
    </div>
  );
};

const TEXTBACK: Msg[] = [
  { at: 4.4, text: "Hi! Sorry we missed your call. This is Sami's Bakery. How can we help?", label: "AUTOMATIC TEXT" },
  { at: 6.0, me: true, text: "do you have croissants tomorrow morning?" },
  { at: 7.5, text: "We do! How many, and what time should they be ready?", label: "AI REPLY" },
  { at: 8.7, me: true, text: "2 dozen, 9am" },
  { at: 9.9, text: "Done ✓ 2 dozen croissants, ready tomorrow at 9:00 AM.", label: "AI REPLY" },
];

export const LynqTextBack: React.FC = () => {
  const { s } = useT();
  const call = s < 3.4;
  const away = ramp(s, 11.0, 11.6);
  return (
    <Frame label="MISSED CALL TEXT BACK">
      <BigPhone scale={1 - away * 0.12} y={away * 140} dim={away * 0.78}>
        {call ? <CallScreen endAt={2.2} /> : <Thread msgs={TEXTBACK} chipAt={3.6} />}
      </BigPhone>
      <Say text="6:52 PM. A customer calls your shop." at={0.1} out={2.1} size={72} accent={["6:52", "PM."]} lang={EN} top={270} />
      <Say text="No answer. Most people won't leave a voicemail." at={2.3} out={3.9} size={72} accent={["voicemail."]} lang={EN} top={270} />
      <Say text="Unless your shop texts back. On its own." at={4.0} out={10.8} size={72} accent={["texts", "back."]} lang={EN} top={270} />
      <Say text="That missed call is now an order." at={11.0} size={76} accent={["order."]} lang={EN} top={270} />
      <Notice at={11.4} app="ORDERS" title="New order from a missed call" body="2 dozen croissants · tomorrow 9:00 AM" />
      <Tag text="We build this for your business" at={12.4} top={1080} lang={EN} />
      <Kw text="Comment TEXTBACK" at={12.8} top={1220} lang={EN} />
      <Sfx at={0.2} src="ring.wav" volume={0.7} />
      <Sfx at={1.3} src="ring.wav" volume={0.7} />
      <Sfx at={2.2} src="thump.wav" volume={0.5} />
      {TEXTBACK.map((m, i) => <Sfx key={i} at={m.at} src={m.me ? "click.wav" : "pop.wav"} volume={0.6} />)}
      <Sfx at={11.4} src="ding.wav" volume={0.6} />
    </Frame>
  );
};

/* ── 2. A week of posts, approved in 20 seconds ──────────────────────── */

type Post = { at: number; tapAt: number; title: string; sub: string; bg: string; ink: string; caption: string };
const POSTS: Post[] = [
  { at: 0.6, tapAt: 2.0, title: "OUT OF THE OVEN AT 7", sub: "every morning", bg: "linear-gradient(140deg,#f2c27b,#c9772f)", ink: "#2a1606", caption: "Croissants come out at 7. Come early, they go fast." },
  { at: 2.6, tapAt: 3.8, title: "SATURDAY ONLY", sub: "buy 6, get 1", bg: "linear-gradient(140deg,#f6e7d2,#e4c9a3)", ink: "#3b2410", caption: "Saturday only: buy 6, the 7th is on us." },
  { at: 4.4, tapAt: 5.5, title: "THE OVEN STARTS AT 4 AM", sub: "so you don't have to", bg: "linear-gradient(140deg,#3b2a1c,#14100b)", ink: "#f6dcb4", caption: "Our day starts at 4 so yours can start with a croissant." },
];

const PostCard: React.FC<{ p: Post }> = ({ p }) => {
  const { s } = useT();
  const sp = useSpringAt(p.at, { damping: 16, stiffness: 170 });
  if (s < p.at) return null;
  const ok = s >= p.tapAt;
  const tap = s >= p.tapAt - 0.25 && s < p.tapAt + 0.3;
  return (
    <div style={{ maxHeight: sp * 520, overflow: "hidden", padding: "0 34px", marginTop: 18 }}>
      <div style={{ display: "flex", gap: 22, padding: 20, borderRadius: 36, background: "#1a1c19", border: `1px solid ${LN}` }}>
        <div style={{ width: 230, height: 230, borderRadius: 22, background: p.bg, flexShrink: 0, padding: 20, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div style={{ fontFamily: q(BOLD), fontSize: 30, lineHeight: 1.0, color: p.ink }}>{p.title}</div>
          <div style={{ marginTop: 6, fontFamily: q(SANS), fontSize: 20, color: p.ink, opacity: 0.8 }}>{p.sub}</div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: q(MONO), fontSize: 20, letterSpacing: 2, color: MU }}>INSTAGRAM + FACEBOOK</div>
          <div style={{ marginTop: 8, fontFamily: q(SANS), fontSize: 30, lineHeight: 1.25, color: WH, flex: 1 }}>{p.caption}</div>
          <div style={{ position: "relative", display: "flex", gap: 14 }}>
            <div style={{ padding: "12px 26px", borderRadius: 30, background: ok ? "rgba(213,253,113,0.14)" : LI, border: ok ? `1px solid ${LI}` : "none", fontFamily: q(BOLD), fontSize: 28, color: ok ? LI : BK, transform: `scale(${tap ? 0.92 : 1})` }}>{ok ? "Approved ✓" : "Approve"}</div>
            {!ok && <div style={{ padding: "12px 26px", borderRadius: 30, border: `1px solid ${LN}`, fontFamily: q(SANS), fontSize: 28, color: MU }}>Edit</div>}
            {tap && <div style={{ position: "absolute", left: 50, top: 0, width: 70, height: 70, borderRadius: 35, background: "rgba(255,255,255,0.35)", transform: `scale(${1 + (s - p.tapAt + 0.25) * 2})`, opacity: 1 - (s - p.tapAt + 0.25) * 1.8 }} />}
          </div>
        </div>
      </div>
    </div>
  );
};

const Chat: React.FC = () => (
  <div style={{ position: "absolute", inset: 0, background: "#000" }}>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 1600 - 22 - 940, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "0 34px" }}>
        <div style={{ display: "inline-block", padding: "20px 30px", borderRadius: 36, background: "#262826", fontFamily: q(SANS), fontSize: 34, color: WH }}>Good morning. This week's 3 posts are ready.</div>
      </div>
      {POSTS.map((p) => <PostCard key={p.title} p={p} />)}
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 210, background: "linear-gradient(180deg,#0d0e0d 75%,rgba(13,14,13,0))" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 104, textAlign: "center", fontFamily: q(SANS), fontSize: 30, color: WH }}>Content assistant <span style={{ color: MU, fontSize: 24 }}>· bot</span></div>
    </div>
  </div>
);

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const Week: React.FC<{ at: number }> = ({ at }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 16, stiffness: 140 });
  if (s < at) return null;
  const slots: Record<number, string> = { 1: "linear-gradient(140deg,#f2c27b,#c9772f)", 3: "linear-gradient(140deg,#3b2a1c,#14100b)", 5: "linear-gradient(140deg,#f6e7d2,#e4c9a3)" };
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 540, padding: "36px 30px", borderRadius: 44, background: CARD, border: `1px solid ${LN}`, opacity: sp, transform: `translateY(${(1 - sp) * 120}px)` }}>
      <div style={{ fontFamily: q(MONO), fontSize: 24, letterSpacing: 4, color: MU }}>THIS WEEK · SCHEDULED</div>
      <div style={{ marginTop: 28, display: "flex", gap: 12 }}>
        {DAYS.map((d, i) => {
          const pop = ramp(s, at + 0.4 + i * 0.12, at + 0.7 + i * 0.12);
          return (
            <div key={d} style={{ flex: 1, height: 330, borderRadius: 20, background: "#0e100e", border: `1px solid ${LN}`, padding: 10, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontFamily: q(MONO), fontSize: 20, color: slots[i] ? WH : MU }}>{d}</div>
              {slots[i] && <div style={{ marginTop: 18, width: "100%", aspectRatio: "1", borderRadius: 12, background: slots[i], transform: `scale(${pop})` }} />}
              {slots[i] && <div style={{ marginTop: 14, fontFamily: q(MONO), fontSize: 18, color: LI, opacity: pop }}>9:00</div>}
              {slots[i] && <div style={{ marginTop: 8, display: "flex", gap: 6, opacity: pop }}>{["IG", "FB"].map((n) => <span key={n} style={{ fontFamily: q(MONO), fontSize: 15, color: MU, border: `1px solid ${LN}`, borderRadius: 8, padding: "2px 6px" }}>{n}</span>)}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 34, padding: "22px 26px", borderRadius: 26, background: "#0e100e", border: `1px solid ${LN}`, opacity: ramp(s, at + 2.4, at + 2.8) }}>
        <div style={{ fontFamily: q(MONO), fontSize: 20, letterSpacing: 2, color: MU }}>NEW COMMENT · REPLY DRAFTED</div>
        <div style={{ marginTop: 10, fontFamily: q(SANS), fontSize: 32, color: WH }}>"are you open sunday?"</div>
        <div style={{ marginTop: 8, fontFamily: q(SANS), fontSize: 32, color: LI }}>→ "Yes! 8 to 2 on Sundays. See you there."</div>
      </div>
    </div>
  );
};

export const LynqSocialWeek: React.FC = () => {
  const { s } = useT();
  const phoneOut = ramp(s, 6.4, 7.0);
  return (
    <Frame label="AI SOCIAL MEDIA MANAGER">
      {s < 7.0 && (
        <div style={{ opacity: 1 - phoneOut, transform: `translateY(${phoneOut * 300}px)` }}>
          <BigPhone time="8:00"><Chat /></BigPhone>
        </div>
      )}
      <Week at={6.8} />
      <Say text="Monday, 8 AM. Your posts for the week are ready." at={0.1} out={3.0} size={70} accent={["ready."]} lang={EN} top={270} />
      <Say text="You read them. You tap approve. That's it." at={3.2} out={6.4} size={70} accent={["approve."]} lang={EN} top={270} />
      <Say text="They go out all week, on Instagram and Facebook." at={6.6} out={9.3} size={68} accent={["all", "week,"]} lang={EN} top={270} />
      <Say text="It drafts the easy replies too. You approve those as well." at={9.5} out={11.6} size={64} accent={["replies"]} lang={EN} top={270} />
      <Say text="20 seconds of your Monday." at={11.8} size={84} accent={["20", "seconds"]} lang={EN} top={270} />
      <Tag text="We build this for your business" at={12.3} top={1300} lang={EN} />
      <Kw text="Comment SOCIAL" at={12.7} top={1420} lang={EN} />
      <Sfx at={0.6} src="pop.wav" volume={0.5} />
      {POSTS.map((p) => <Sfx key={p.title} at={p.tapAt} src="click.wav" volume={0.7} />)}
      {POSTS.slice(1).map((p) => <Sfx key={p.title + "in"} at={p.at} src="pop.wav" volume={0.45} />)}
      <Sfx at={6.6} src="whoosh.wav" volume={0.6} />
      <Sfx at={9.3} src="ding.wav" volume={0.5} />
    </Frame>
  );
};
