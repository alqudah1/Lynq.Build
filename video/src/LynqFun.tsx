import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { BK, CARD, Kw, LI, LN, MU, MapCard, NewSite, OldSite, Phone, RED, Say, Street, Tag, WH, Walkers, fontFor } from "./lynq-story-kit";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ's lighter reels: a red-flag list, two POV memes and a "rate this reply". 9 to 12 seconds,
 * readable on mute, hook on screen at frame 0. Shops shown are made up and say so.
 */

const q = (f: string) => `'${f}'`;
const EN = "en" as const;

const FunFrame: React.FC<{ label: string; madeUp?: boolean; children: React.ReactNode }> = ({ label, madeUp, children }) => (
  <AbsoluteFill style={{ background: `radial-gradient(70% 45% at 50% 28%, #1e221d 0%, ${BK} 72%)` }}>
    <Fonts />
    {children}
    <div style={{ position: "absolute", left: 90, right: 90, top: 110, display: "flex", justifyContent: "space-between", fontFamily: q("JetBrains Mono"), fontSize: 26, letterSpacing: 4, color: MU }}>
      <span style={{ color: WH }}>LYNQ</span><span>{label}</span>
    </div>
    {madeUp && (
      <div style={{ position: "absolute", left: 0, right: 0, top: 165, display: "flex", justifyContent: "center" }}>
        <div style={{ padding: "8px 22px", borderRadius: 30, border: `1px solid ${LN}`, fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 3, color: MU }}>A MADE-UP SHOP · REAL PROBLEM</div>
      </div>
    )}
    <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={0.3} />
  </AbsoluteFill>
);

const TX: Record<string, string> = {
  search: "sami's bakery", shop: "Sami's Bakery", openNow: "Open · until 8 PM", closedNow: "Closed", directions: "Directions", call: "Call", website: "Website",
  oldTitle: "WELCOME TO SAMI'S BAKERY!!!", oldBody: "Site under construction. Please call us for the menu.", loading: "Loading",
  newTag: "Fresh bread from 7 AM. Order ahead, skip the line.", order: "Order ahead", hoursLabel: "HOURS", hours: "Every day · 7 AM to 8 PM", menuLabel: "MENU", menu: "Croissants|Sourdough loaf|Za'atar manakish|Cinnamon rolls",
};
const NEXT_DOOR: Record<string, string> = { ...TX, shop: "The place next door", newTag: "Hot from the oven. Order in two taps." };

/* ── 1. Red flags ────────────────────────────────────────────────────── */

const FLAGS: { title: string; body: React.ReactNode }[] = [
  { title: "Hours from 2019", body: <><div style={{ fontSize: 40, color: WH }}>Open Mon to Sun, 9 to 5</div><div style={{ marginTop: 14, fontSize: 30, color: MU }}>Last updated: March 2019</div></> },
  { title: "The menu is a PDF", body: <div style={{ display: "flex", alignItems: "center", gap: 30 }}><div style={{ width: 130, height: 160, borderRadius: 14, background: RED, color: WH, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q("Outfit Bold"), fontSize: 40 }}>PDF</div><div style={{ fontSize: 34, color: MU }}>menu_FINAL_v3.pdf<br />14.2 MB · downloading</div></div> },
  { title: "No button to call", body: <div style={{ fontSize: 22, color: "#55555c" }}>Contact us at the address below or send a letter. Phone: 416 5··· (see footer)</div> },
  { title: "Takes forever to load", body: <div style={{ display: "flex", alignItems: "center", gap: 30 }}><div style={{ width: 90, height: 90, borderRadius: 45, border: "10px solid #333", borderTopColor: WH }} className="spin" /><div style={{ fontSize: 38, color: MU }}>Loading...</div></div> },
  { title: "© 2017 at the bottom", body: <div style={{ fontFamily: "Times New Roman, serif", fontSize: 34, color: MU }}>Copyright © 2017 · Best viewed in Internet Explorer</div> },
];

const FlagCard: React.FC<{ i: number; at: number; out: number }> = ({ i, at, out }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 14, stiffness: 170 });
  const stamp = useSpringAt(at + 0.55, { damping: 9, stiffness: 260 });
  if (s < at || s >= out) return null;
  const f = FLAGS[i];
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, top: 640, textAlign: "center", fontFamily: q("JetBrains Mono"), fontSize: 34, letterSpacing: 6, color: RED, opacity: sp }}>RED FLAG {i + 1}/5</div>
      <div style={{ position: "absolute", left: 80, right: 80, top: 720, textAlign: "center", fontFamily: q("Outfit Bold"), fontSize: 100, letterSpacing: -2, color: WH, opacity: sp, transform: `translateY(${(1 - sp) * 40}px)` }}>{f.title}</div>
      <div style={{ position: "absolute", left: 100, right: 100, top: 1000, padding: "60px 56px", borderRadius: 40, background: CARD, border: `1px solid ${LN}`, fontFamily: q("Outfit Regular"), opacity: sp, transform: `scale(${0.9 + sp * 0.1}) rotate(${i % 2 ? 1.5 : -1.5}deg)` }}>{f.body}</div>
      {s >= at + 0.55 && <div style={{ position: "absolute", right: 110, top: 930, width: 170, height: 170, borderRadius: 85, background: RED, color: WH, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 110, fontFamily: q("Outfit Bold"), transform: `scale(${stamp}) rotate(-12deg)`, boxShadow: "0 20px 50px rgba(255,90,95,0.4)" }}>✕</div>}
    </>
  );
};

export const RedFlags: React.FC = () => {
  const { s } = useT();
  const start = 0.5, each = 1.7;
  const end = start + each * 5;
  return (
    <FunFrame label="RED FLAGS">
      <style>{`.spin{transform:rotate(${s * 400}deg)}`}</style>
      <Say text="5 red flags on a local business website" at={-1} top={260} size={74} bold accent={["red", "flags"]} lang={EN} />
      {FLAGS.map((_, i) => <FlagCard key={i} i={i} at={i ? start + i * each : -1} out={start + (i + 1) * each} />)}
      {s >= end && (
        <>
          <Say text="How many does yours have?" at={end} top={700} size={100} bold accent={["yours"]} lang={EN} />
          <Tag text="Comment the number" at={end + 0.5} top={1080} lang={EN} />
          <Kw text="Free fix list · lynq.build/fix" at={end + 0.8} top={1240} lang={EN} />
        </>
      )}
      {FLAGS.map((_, i) => i === 0 ? null : <React.Fragment key={i}><Sfx at={start + i * each} src="whoosh.wav" volume={0.45} /><Sfx at={start + i * each + 0.55} src="thump.wav" volume={0.8} /></React.Fragment>)}
      <Sfx at={end} src="ding.wav" volume={0.6} />
    </FunFrame>
  );
};

/* ── 2. POV: the map says you're closed ──────────────────────────────── */

export const PovClosed: React.FC = () => {
  const { s } = useT();
  return (
    <FunFrame label="POV" madeUp>
      {s < 3.4 && (
        <>
          <Say text="POV: the map says you're closed." at={-1} top={250} size={74} bold accent={["closed"]} lang={EN} />
          <Phone at={-1} y={480}><MapCard status="closed" lang={EN} tx={TX} /></Phone>
        </>
      )}
      {s >= 3.4 && s < 7.0 && (
        <>
          <Street sign="open" pose="worried" />
          <Walkers from={3.4} n={4} />
          <Say text="You're open. They walk right past." at={3.45} top={250} size={74} bold accent={["past"]} lang={EN} />
        </>
      )}
      {s >= 7.0 && (
        <>
          <Say text="2 minute fix: update your hours." at={7.05} top={250} size={74} bold accent={["hours"]} lang={EN} />
          <Phone at={7.0} y={480}><MapCard status="editing" editAt={8.0} lang={EN} tx={TX} /></Phone>
          <Kw text="Free checklist · lynq.build/fix" at={8.5} top={1460} lang={EN} />
        </>
      )}
      <Sfx at={3.4} src="whoosh.wav" volume={0.5} />
      <Sfx at={7.0} src="whoosh.wav" volume={0.5} />
      <Sfx at={8.0} src="ding.wav" volume={0.6} />
    </FunFrame>
  );
};

/* ── 3. POV: you're hungry and the menu won't load ───────────────────── */

export const PovHungry: React.FC = () => {
  const { s } = useT();
  const swipe = ramp(s, 4.2, 4.7, 0, 1);
  return (
    <FunFrame label="POV" madeUp>
      {s < 4.7 && <Say text="POV: you're hungry and the menu won't load." at={-1} top={250} size={70} bold accent={["won't", "load"]} lang={EN} />}
      {s < 4.7 && <div style={{ position: "absolute", inset: 0, transform: `translateX(${-swipe * 1100}px) rotate(${-swipe * 8}deg)` }}><Phone at={-1} y={500}><OldSite loadingFrom={0.3} lang={EN} tx={TX} /></Phone></div>}
      {s >= 3.0 && s < 4.7 && <div style={{ position: "absolute", left: 0, right: 0, top: 1460, textAlign: "center", fontFamily: q("Outfit Regular"), fontSize: 50, color: MU }}>nope.</div>}
      {s >= 4.7 && (
        <>
          <Say text="So you order next door." at={4.75} top={250} size={80} bold accent={["next", "door"]} lang={EN} />
          <Phone at={4.7} y={500}><NewSite lang={EN} tx={NEXT_DOOR} pressAt={6.4} /></Phone>
        </>
      )}
      {s >= 7.2 && <Tag text="Don't be the slow one" at={7.2} top={1320} lang={EN} />}
      {s >= 7.6 && <Kw text="Test yours · lynq.build/fix" at={7.6} top={1450} lang={EN} />}
      <Sfx at={4.2} src="whoosh.wav" volume={0.6} />
      <Sfx at={6.4} src="click.wav" />
      <Sfx at={6.6} src="ding.wav" volume={0.6} />
    </FunFrame>
  );
};

/* ── 4. Rate this reply ──────────────────────────────────────────────── */

const ReviewCard: React.FC<{ top: number }> = ({ top }) => (
  <div style={{ position: "absolute", left: 90, right: 90, top, padding: "36px 40px", borderRadius: 36, background: CARD, border: `1px solid ${LN}`, fontFamily: q("Outfit Regular"), color: WH }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30, color: MU }}><span>Dana K.</span><span style={{ color: "#fbbf24", letterSpacing: 4 }}>★<span style={{ color: "#3a3a40" }}>★★★★</span></span></div>
    <div style={{ marginTop: 16, fontSize: 44, lineHeight: 1.2 }}>"Waited 20 minutes for a coffee. Nobody even looked up."</div>
  </div>
);

const ReplyCard: React.FC<{ text: string; at: number; top: number; tone: "bad" | "good"; label: string }> = ({ text, at, top, tone, label }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 15, stiffness: 160 });
  if (s < at) return null;
  const typed = text.slice(0, Math.floor((s - at - 0.2) * 40));
  return (
    <div style={{ position: "absolute", left: 140, right: 90, top, padding: "32px 40px", borderRadius: 36, background: "#161a15", borderLeft: `6px solid ${tone === "bad" ? RED : LI}`, fontFamily: q("Outfit Regular"), color: WH, opacity: sp, transform: `translateY(${(1 - sp) * 40}px)` }}>
      <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 24, letterSpacing: 3, color: MU }}>{label}</div>
      <div style={{ marginTop: 12, fontSize: 42, lineHeight: 1.25, minHeight: 110 }}>{typed}</div>
    </div>
  );
};

const Score: React.FC<{ at: number; text: string; color: string; top: number }> = ({ at, text, color, top }) => {
  const p = useSpringAt(at, { damping: 9, stiffness: 240 });
  const { s } = useT();
  if (s < at) return null;
  return <div style={{ position: "absolute", right: 90, top, padding: "12px 34px", borderRadius: 30, background: color, fontFamily: q("Outfit Bold"), fontSize: 56, color: BK, transform: `scale(${p}) rotate(-6deg)` }}>{text}</div>;
};

export const RateReply: React.FC = () => {
  const { s } = useT();
  return (
    <FunFrame label="RATE THIS REPLY" madeUp>
      <Say text="Rate this reply from 1 to 10." at={-1} top={260} size={78} bold accent={["1", "10"]} lang={EN} />
      <ReviewCard top={470} />
      {s < 5.2 && (
        <>
          <ReplyCard text="Maybe come when we're not busy." at={0.4} top={860} tone="bad" label="REPLY A · FROM THE OWNER" />
          <Score at={3.4} text="1/10" color={RED} top={820} />
          {s >= 3.6 && <div style={{ position: "absolute", left: 0, right: 0, top: 1180, textAlign: "center", fontFamily: q("Outfit Regular"), fontSize: 48, color: MU }}>Every new customer reads that.</div>}
        </>
      )}
      {s >= 5.2 && (
        <>
          <ReplyCard text="That's on us, Dana. We changed how we run the morning rush. Come back, your coffee is on me." at={5.2} top={860} tone="good" label="REPLY B · FROM THE OWNER" />
          <Score at={8.0} text="10/10" color={LI} top={820} />
          {s >= 8.3 && <div style={{ position: "absolute", left: 0, right: 0, top: 1300, textAlign: "center", fontFamily: q("Outfit Regular"), fontSize: 48, color: WH }}>Same review. <span style={{ color: LI }}>Different shop.</span></div>}
          <Tag text="What would you give reply A? Comment it" at={8.8} top={1430} lang={EN} />
        </>
      )}
      <Sfx at={3.4} src="thump.wav" />
      <Sfx at={5.2} src="whoosh.wav" volume={0.5} />
      <Sfx at={8.0} src="ding.wav" />
    </FunFrame>
  );
};

