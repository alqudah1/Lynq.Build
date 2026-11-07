import React from "react";
import { AbsoluteFill, Audio, Img, staticFile } from "remotion";
import { BK, CARD, Kw, LI, LN, MU, Tag, WH } from "./lynq-story-kit";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * LYNQ ad, animated: Sam (made up) runs a small heating business. A family calls at 9:14 PM with no
 * heat, Sam's at dinner and misses it, his business texts back and books the job, and the heat is
 * back on that night. Stills are AI images (OpenArt), labeled on screen; the chat and the stat are ours.
 */

const q = (f: string) => `'${f}'`;
const EN = "en" as const;

type Shot = { src: string; from: number; to: number; zoom: [number, number]; focusY?: number; pan?: [number, number] };
const SHOTS: Shot[] = [
  { src: "lynq-sam/1-cold.jpg", from: 0, to: 2.8, zoom: [1.14, 1.04], focusY: 45 },
  { src: "lynq-sam/2-dinner.jpg", from: 2.8, to: 5.2, zoom: [1.02, 1.12], focusY: 45 },
  { src: "lynq-sam/3-ringing.jpg", from: 5.2, to: 8.4, zoom: [1.04, 1.2], focusY: 60 },
  { src: "lynq-sam/4-textback.jpg", from: 8.4, to: 12.6, zoom: [1.16, 1.04], focusY: 65 },
  { src: "lynq-sam/5-relief.jpg", from: 12.6, to: 15.0, zoom: [1.02, 1.12], focusY: 45 },
  { src: "lynq-sam/6-fixed.jpg", from: 15.0, to: 20.0, zoom: [1.12, 1.02], focusY: 50 },
];

const Still: React.FC<{ shot: Shot }> = ({ shot }) => {
  const { s } = useT();
  if (s < shot.from - 0.6 || s > shot.to + 0.01) return null;
  const k = ramp(s, shot.from - 0.6, shot.to, 0, 1, (x) => x);
  const z = shot.zoom[0] + (shot.zoom[1] - shot.zoom[0]) * k;
  const fadeIn = shot.from === 0 ? 1 : ramp(s, shot.from - 0.6, shot.from + 0.1);
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <Img src={staticFile(shot.src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z + (1 - fadeIn) * 0.06})`, transformOrigin: `50% ${shot.focusY ?? 50}%`, filter: `blur(${(1 - fadeIn) * 6}px)` }} />
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

const Stat: React.FC<{ at: number; out: number }> = ({ at, out }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 14, stiffness: 170 });
  if (s < at || s > out + 0.3) return null;
  const leave = ramp(s, out, out + 0.3);
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: 560, padding: "50px 46px", borderRadius: 44, background: "rgba(12,14,12,0.88)", border: `1px solid ${LN}`, boxShadow: "0 50px 120px rgba(0,0,0,0.7)", opacity: p * (1 - leave), transform: `scale(${0.92 + 0.08 * p})` }}>
      <div style={{ fontFamily: q("Outfit Bold"), fontSize: 170, lineHeight: 1, color: LI, letterSpacing: -5 }}>37.8%</div>
      <div style={{ marginTop: 20, fontFamily: q("Outfit Regular"), fontSize: 44, lineHeight: 1.2, color: WH }}>of calls to local businesses were answered by a live person.</div>
      <div style={{ marginTop: 22, fontFamily: q("JetBrains Mono"), fontSize: 21, letterSpacing: 2, color: MU }}>SOURCE: 411 LOCALS STUDY, 2024 · 85 BUSINESSES</div>
    </div>
  );
};

type Msg = { at: number; me?: boolean; text: string; label?: string };
const CHAT: Msg[] = [
  { at: 9.1, text: "Hi, sorry we missed your call! This is Sam's Heating. What's going on?", label: "AUTOMATIC TEXT" },
  { at: 10.2, me: true, text: "furnace stopped, kids are freezing" },
  { at: 11.3, text: "Booked ✓ Sam can be there by 10:30 tonight.", label: "AI REPLY" },
];

const Chat: React.FC<{ at: number; out: number }> = ({ at, out }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 15, stiffness: 160 });
  if (s < at || s > out + 0.3) return null;
  const leave = ramp(s, out, out + 0.3);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 470, padding: "30px 28px 34px", borderRadius: 44, background: "rgba(10,12,11,0.82)", border: `1px solid ${LN}`, boxShadow: "0 40px 100px rgba(0,0,0,0.6)", opacity: p * (1 - leave), transform: `translateY(${(1 - p) * 60}px)` }}>
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

export const LynqSamFilm: React.FC = () => {
  const { s } = useT();
  const dim = ramp(s, 6.4, 6.7) * (1 - ramp(s, 8.2, 8.5)) * 0.45;
  const end = ramp(s, 19.55, 20.0);
  return (
    <AbsoluteFill style={{ background: BK }}>
      <Fonts />
      {SHOTS.map((sh) => <Still key={sh.src} shot={sh} />)}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,6,5,0.6) 0%, rgba(5,6,5,0) 34%)" }} />
      <AbsoluteFill style={{ background: "#000", opacity: dim }} />

      <Line text="9:14 PM. Their furnace just died." at={0.1} out={2.5} accent={["furnace"]} />
      <Line text="Sam fixes furnaces. He just sat down for dinner." at={2.9} out={5.0} accent={["dinner."]} size={70} />
      <Line text="The phone rings. Nobody picks up." at={5.3} out={8.2} accent={["Nobody"]} />
      <Stat at={6.6} out={8.2} />
      <Line text="So his business texts back." at={8.5} out={12.4} accent={["texts", "back."]} />
      <Chat at={8.8} out={12.4} />
      <Line text="Help is booked. By text. In minutes." at={12.7} out={14.8} accent={["booked."]} />
      <Line text="He didn't answer the phone. His business did." at={15.2} size={78} accent={["business"]} />
      <Tag text="We set this up for trades" at={16.8} top={470} lang={EN} />
      <Kw text="Comment TEXTBACK" at={17.2} top={590} lang={EN} />

      <div style={{ position: "absolute", left: 90, right: 90, top: 120, display: "flex", justifyContent: "space-between", fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 3, color: "rgba(242,244,235,0.8)" }}>
        <span>LYNQ</span><span>AI-MADE IMAGES · MADE-UP STORY</span>
      </div>
      <AbsoluteFill style={{ background: BK, opacity: end }} />

      <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={0.3} />
      <Sfx at={2.3} src="whoosh.wav" volume={0.25} />
      <Sfx at={4.6} src="whoosh.wav" volume={0.25} />
      <Sfx at={5.3} src="ring.wav" volume={0.6} />
      <Sfx at={6.4} src="ring.wav" volume={0.6} />
      <Sfx at={8.0} src="whoosh.wav" volume={0.3} />
      {CHAT.map((m, i) => <Sfx key={i} at={m.at} src={m.me ? "click.wav" : "pop.wav"} volume={0.6} />)}
      <Sfx at={12.2} src="whoosh.wav" volume={0.25} />
      <Sfx at={12.8} src="ding.wav" volume={0.5} />
      <Sfx at={14.6} src="whoosh.wav" volume={0.25} />
      <Sfx at={16.8} src="pop.wav" volume={0.5} />
    </AbsoluteFill>
  );
};
