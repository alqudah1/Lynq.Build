import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile } from "remotion";
import { BK, CARD, Kw, LI, LN, MU, Tag, WH } from "./lynq-story-kit";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ ad, animated: Sam (made up) runs a small heating business. A family calls at 9:14 PM with no
 * heat, Sam's at dinner and misses it, his business texts back and books the job, and the heat is
 * back on that night. Stills are AI images (OpenArt), labeled on screen; the chat and the stat are ours.
 */

const q = (f: string) => `'${f}'`;
const EN = "en" as const;

type Shot = { src: string; video?: boolean; rate?: number; from: number; to: number; zoom: [number, number]; focusY?: number };
const SHOTS: Shot[] = [
  { src: "lynq-sam/2-dinner.jpg", from: 0, to: 3.4, zoom: [1.1, 1.0], focusY: 40 },
  { src: "lynq-sam/v1-cold.mp4", video: true, from: 3.4, to: 6.6, zoom: [1.06, 1.0], focusY: 45 },
  { src: "lynq-sam/v3-ringing.mp4", video: true, from: 6.6, to: 9.4, zoom: [1.0, 1.06], focusY: 60 },
  { src: "lynq-sam/v4-textback.mp4", video: true, rate: 0.85, from: 9.4, to: 14.0, zoom: [1.0, 1.04], focusY: 60 },
  { src: "lynq-sam/v5-relief.mp4", video: true, from: 14.0, to: 16.6, zoom: [1.0, 1.06], focusY: 45 },
  { src: "lynq-sam/2-dinner.jpg", from: 16.6, to: 19.4, zoom: [1.16, 1.24], focusY: 55 },
  { src: "lynq-sam/6-fixed.jpg", from: 19.4, to: 22.8, zoom: [1.12, 1.02], focusY: 50 },
];

const Still: React.FC<{ shot: Shot }> = ({ shot }) => {
  const { s, fps } = useT();
  if (s < shot.from - 0.6 || s > shot.to + 0.01) return null;
  const k = ramp(s, shot.from - 0.6, shot.to, 0, 1, (x) => x);
  const z = shot.zoom[0] + (shot.zoom[1] - shot.zoom[0]) * k;
  const fadeIn = shot.from === 0 ? 1 : ramp(s, shot.from - 0.6, shot.from + 0.1);
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z + (1 - fadeIn) * 0.06})`, transformOrigin: `50% ${shot.focusY ?? 50}%`, filter: `blur(${(1 - fadeIn) * 6}px)` };
  const startAt = Math.max(0, shot.from - 0.6);
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      {shot.video ? (
        <Sequence from={Math.round(startAt * fps)} layout="none">
          <OffthreadVideo src={staticFile(shot.src)} muted playbackRate={shot.rate ?? 1} style={style} />
        </Sequence>
      ) : (
        <Img src={staticFile(shot.src)} style={style} />
      )}
    </AbsoluteFill>
  );
};

/** Words over the picture, top of frame, in the LYNQ type. */
const Line: React.FC<{ text: string; at: number; out?: number; accent?: string[]; size?: number; top?: number }> = ({ text, at, out, accent = [], size = 74, top = 250 }) => {
  const { frame, fps, s } = useT();
  if (s < at || (out !== undefined && s > out + 0.3)) return null;
  const gone = out !== undefined ? ramp(s, out, out + 0.25) : 0;
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top, textAlign: "center", fontFamily: q("Outfit Bold"), fontSize: size, lineHeight: 1.08, letterSpacing: -1.5, color: WH, opacity: 1 - gone, transform: `translateY(${-gone * 24}px)`, textShadow: "0 4px 26px rgba(0,0,0,0.7), 0 2px 6px rgba(0,0,0,0.55)" }}>
      {text.split(" ").map((w, i) => {
        const d = frame - Math.round((at + i * 0.07) * fps);
        const p = Math.max(0, Math.min(1, d / 6));
        return <span key={i} style={{ display: "inline-block", margin: "0 0.12em", opacity: p, transform: `translateY(${(1 - p) * 26}px)`, color: accent.includes(w.replace(/[.,!?]/g, "")) ? LI : undefined }}>{w}</span>;
      })}
    </div>
  );
};

type Msg = { at: number; me?: boolean; text: string; label?: string };
const CHAT: Msg[] = [
  { at: 10.4, text: "Hi, sorry we missed your call! This is Sam's Heating. What's going on?", label: "AUTOMATIC TEXT" },
  { at: 11.5, me: true, text: "furnace stopped, kids are freezing" },
  { at: 12.5, text: "Booked ✓ Sam can be there by 10:30 tonight.", label: "AI REPLY" },
];

const Chat: React.FC<{ at: number; out: number }> = ({ at, out }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 15, stiffness: 160 });
  if (s < at || s > out + 0.3) return null;
  const leave = ramp(s, out, out + 0.3);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 560, padding: "30px 28px 34px", borderRadius: 44, background: "rgba(10,12,11,0.82)", border: `1px solid ${LN}`, boxShadow: "0 40px 100px rgba(0,0,0,0.6)", opacity: p * (1 - leave), transform: `translateY(${(1 - p) * 60}px)` }}>
      <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 3, color: MU, marginBottom: 6 }}>8 SECONDS AFTER THE MISSED CALL</div>
      {CHAT.map((m, i) => {
        const b = ramp(s, m.at, m.at + 0.25);
        if (s < m.at) return null;
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start", marginTop: 18, opacity: b, transform: `translateY(${(1 - b) * 20}px)` }}>
            <div style={{ maxWidth: 700, padding: "20px 28px", borderRadius: 34, background: m.me ? "#2f7cf6" : "#262826", fontFamily: q("Outfit Regular"), fontSize: 38, lineHeight: 1.25, color: WH }}>{m.text}</div>
            {m.label && <div style={{ marginTop: 6, fontFamily: q("JetBrains Mono"), fontSize: 20, letterSpacing: 2, color: LI }}>{m.label}</div>}
          </div>
        );
      })}
    </div>
  );
};

/** The booking lands on Sam's phone as a notification, so the viewer sees how he knows. */
const Booking: React.FC<{ at: number; out: number }> = ({ at, out }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 15, stiffness: 170 });
  if (s < at || s > out + 0.3) return null;
  const leave = ramp(s, out, out + 0.3);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 470, padding: "30px 32px", borderRadius: 44, background: "rgba(18,21,18,0.94)", border: `1px solid ${LN}`, boxShadow: "0 40px 100px rgba(0,0,0,0.6)", display: "flex", gap: 26, opacity: p * (1 - leave), transform: `translateY(${(1 - p) * -80}px)` }}>
      <div style={{ width: 96, height: 96, borderRadius: 24, background: LI, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q("Outfit Bold"), fontSize: 48, color: BK }}>✓</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 2, color: MU }}><span>SAM'S HEATING · JOBS</span><span>9:16 PM</span></div>
        <div style={{ marginTop: 8, fontFamily: q("Outfit Bold"), fontSize: 40, color: WH }}>New job booked by text</div>
        <div style={{ marginTop: 6, fontFamily: q("Outfit Regular"), fontSize: 34, lineHeight: 1.3, color: MU }}>No heat, 2 kids home · tonight 10:30 PM</div>
      </div>
    </div>
  );
};

/** The last beat: the brand, what it does, one sourced number. */
const EndCard: React.FC<{ at: number }> = ({ at }) => {
  const { s } = useT();
  const p = ramp(s, at - 0.4, at + 0.2);
  if (s < at - 0.4) return null;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(70% 45% at 50% 30%, #1e221d 0%, ${BK} 72%)`, opacity: p }}>
      <div style={{ position: "absolute", top: 300, left: 80, right: 80, textAlign: "center" }}>
        <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 30, letterSpacing: 10, color: MU }}>LYNQ</div>
        <div style={{ marginTop: 40, fontFamily: q("Outfit Bold"), fontSize: 92, lineHeight: 1.05, letterSpacing: -2, color: WH }}>Missed calls, <span style={{ color: LI }}>answered.</span></div>
        <div style={{ marginTop: 28, fontFamily: q("Outfit Regular"), fontSize: 44, lineHeight: 1.25, color: MU }}>We set up text back for your business, so the next job doesn&apos;t go to someone else.</div>
        <div style={{ margin: "56px auto 0", maxWidth: 820, padding: "30px 34px", borderRadius: 30, border: `1px solid ${LN}`, background: CARD, textAlign: "left" }}>
          <div style={{ fontFamily: q("Outfit Regular"), fontSize: 34, lineHeight: 1.3, color: WH }}><span style={{ color: LI, fontFamily: q("Outfit Bold") }}>37.8%</span> of calls to local businesses were answered by a live person.</div>
          <div style={{ marginTop: 12, fontFamily: q("JetBrains Mono"), fontSize: 19, letterSpacing: 2, color: MU }}>411 LOCALS STUDY, 2024 · 85 BUSINESSES</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const LynqSamFilm: React.FC = () => {
  const { s } = useT();
  return (
    <AbsoluteFill style={{ background: BK }}>
      <Fonts />
      {SHOTS.map((sh) => <Still key={sh.src + sh.from} shot={sh} />)}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,6,5,0.6) 0%, rgba(5,6,5,0) 34%)" }} />

      <Line text="This is Sam. He fixes furnaces." at={0.1} out={1.5} accent={["Sam."]} />
      <Line text="9 PM. He finally sat down for dinner." at={1.85} out={3.1} accent={["dinner."]} size={70} />
      <Line text="Across town, a family's furnace just died." at={3.5} out={4.9} accent={["furnace"]} size={70} />
      <Line text="They call Sam." at={5.25} out={6.3} accent={["Sam."]} size={84} />
      <Line text="His phone rings. Nobody picks up." at={6.7} out={9.1} accent={["Nobody"]} />
      <Line text="So his business texts them back." at={9.5} out={13.7} accent={["texts", "back."]} />
      <Chat at={9.9} out={13.7} />
      <Line text="Booked for 10:30 tonight." at={14.1} out={16.3} accent={["Booked"]} size={80} />
      <Line text="And Sam gets the booking on his phone." at={16.7} out={19.1} accent={["booking"]} size={70} />
      <Booking at={17.3} out={19.1} />
      <Line text="He finishes dinner and goes to fix it." at={19.5} out={21.0} size={70} />
      <Line text="He missed the call. Not the job." at={21.35} out={22.6} accent={["Not", "job."]} size={78} />
      <EndCard at={22.8} />
      {s >= 23.2 && <Tag text="Comment TEXTBACK" at={23.2} top={1230} lang={EN} />}
      {s >= 23.6 && <Kw text="See how it works for your business" at={23.6} top={1350} lang={EN} />}
      <div style={{ position: "absolute", left: 90, right: 90, top: 120, display: "flex", justifyContent: "space-between", fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 3, color: "rgba(242,244,235,0.8)" }}>
        <span>LYNQ</span><span>AI-MADE IMAGES · MADE-UP STORY</span>
      </div>

      <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={0.3} />
      <Sfx at={3.0} src="whoosh.wav" volume={0.25} />
      <Sfx at={6.2} src="whoosh.wav" volume={0.25} />
      <Sfx at={6.7} src="ring.wav" volume={0.6} />
      <Sfx at={7.8} src="ring.wav" volume={0.65} />
      <Sfx at={8.9} src="ring.wav" volume={0.65} />
      {CHAT.map((m, i) => <Sfx key={i} at={m.at} src={m.me ? "click.wav" : "pop.wav"} volume={0.6} />)}
      <Sfx at={13.6} src="whoosh.wav" volume={0.25} />
      <Sfx at={14.1} src="ding.wav" volume={0.5} />
      <Sfx at={16.2} src="whoosh.wav" volume={0.25} />
      <Sfx at={17.3} src="ding.wav" volume={0.6} />
      <Sfx at={19.0} src="whoosh.wav" volume={0.25} />
      <Sfx at={22.4} src="whoosh.wav" volume={0.35} />
      <Sfx at={23.2} src="pop.wav" volume={0.5} />
    </AbsoluteFill>
  );
};
