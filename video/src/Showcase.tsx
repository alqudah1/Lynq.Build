import React from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile } from "remotion";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * Showcase reels: what a LYNQ reel looks like, for three made-up businesses (a barber, a gym, a
 * cafe). Each is clearly tagged as a sample with a made-up brand, and ends on "Want one for your
 * business?". No real shops, people, logos or prices.
 */

const BK = "#0a0c0b", WH = "#f2f4eb", LI = "#d5fd71", MU = "#9ba48f";
const q = (f: string) => `'${f}'`;

const Svg: React.FC<{ html: string; style?: React.CSSProperties }> = ({ html, style }) => (
  <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", ...style }} dangerouslySetInnerHTML={{ __html: html }} />
);

/** Big kinetic word, slams in from scale. */
const Slam: React.FC<{ text: string; at: number; out?: number; top: number; size?: number; color?: string; font?: string; tracking?: number }> = ({ text, at, out, top, size = 170, color = WH, font = "Outfit Bold", tracking = -4 }) => {
  const { frame, fps, s } = useT();
  if (s < at || (out !== undefined && s > out + 0.2)) return null;
  const p = at < 0 ? 1 : spring({ frame: frame - Math.round(at * fps), fps, config: { damping: 11, stiffness: 260, mass: 0.6 } });
  const gone = out !== undefined ? ramp(s, out, out + 0.2) : 0;
  return <div style={{ position: "absolute", left: 60, right: 60, top, textAlign: "center", fontFamily: q(font), fontSize: size, lineHeight: 0.95, letterSpacing: tracking, color, opacity: (1 - gone) * Math.min(1, p * 1.5), transform: `scale(${1.4 - p * 0.4}) translateY(${gone * -40}px)` }}>{text}</div>;
};

const Line: React.FC<{ text: string; at: number; out?: number; top: number; size?: number; color?: string }> = ({ text, at, out, top, size = 56, color = WH }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 14, stiffness: 180 });
  const p = at < 0 ? 1 : sp;
  if (s < at || (out !== undefined && s > out + 0.2)) return null;
  const gone = out !== undefined ? ramp(s, out, out + 0.2) : 0;
  return <div style={{ position: "absolute", left: 80, right: 80, top, textAlign: "center", fontFamily: q("Outfit Regular"), fontSize: size, color, opacity: Math.min(1, p * 1.4) * (1 - gone), transform: `translateY(${(1 - p) * 30}px)` }}>{text}</div>;
};

/** The shared end card and the sample tag on every frame. */
const SampleFrame: React.FC<{ seconds: number; bg: string; accent: string; brand: string; children: React.ReactNode; endAt: number }> = ({ seconds, bg, accent, brand, children, endAt }) => {
  const { s } = useT();
  const end = useSpringAt(endAt, { damping: 16, stiffness: 140 });
  const btn = useSpringAt(endAt + 0.6, { damping: 10, stiffness: 220 });
  return (
    <AbsoluteFill style={{ background: bg }}>
      <Fonts />
      {s < endAt + 0.2 && <div style={{ position: "absolute", inset: 0, opacity: 1 - ramp(s, endAt, endAt + 0.3) }}>{children}</div>}
      {s >= endAt && (
        <AbsoluteFill style={{ background: BK, opacity: end }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 560, textAlign: "center", fontFamily: q("JetBrains Mono"), fontSize: 30, letterSpacing: 6, color: MU }}>SAMPLE REEL BY LYNQ</div>
          <div style={{ position: "absolute", left: 80, right: 80, top: 660, textAlign: "center", fontFamily: q("Outfit Regular"), fontSize: 108, letterSpacing: -3, lineHeight: 1.02, color: WH }}>Want one for your business?</div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1040, display: "flex", justifyContent: "center" }}><div style={{ padding: "34px 80px", borderRadius: 70, background: LI, fontFamily: q("Outfit Bold"), fontSize: 64, color: BK, transform: `scale(${btn})` }}>Comment REEL</div></div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 1240, textAlign: "center", fontFamily: q("Outfit Regular"), fontSize: 40, color: MU }}>Made for your shop, in your colours.</div>
        </AbsoluteFill>
      )}
      <div style={{ position: "absolute", left: 0, right: 0, top: 110, display: "flex", justifyContent: "center" }}>
        <div style={{ padding: "10px 26px", borderRadius: 30, background: "rgba(0,0,0,0.45)", border: `1px solid rgba(255,255,255,0.18)`, fontFamily: q("JetBrains Mono"), fontSize: 22, letterSpacing: 3, color: "#d4d4d8" }}>SAMPLE · {brand} IS A MADE-UP BRAND</div>
      </div>
      <div style={{ position: "absolute", left: 90, bottom: 95, fontFamily: q("JetBrains Mono"), fontSize: 24, letterSpacing: 4, color: s >= endAt ? MU : accent }}>LYNQ.BUILD</div>
      <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={(f) => interpolate(f, [0, seconds * 30 - 20, seconds * 30], [0.38, 0.38, 0], { extrapolateRight: "clamp" })} />
    </AbsoluteFill>
  );
};

/** Barber: a fade sweeping down the frame, scissors, walk-ins till 9. */
export const ShowcaseBarber: React.FC = () => {
  const { s } = useT();
  const sweep = 0.35 + ramp(s, 0, 1.4) * 0.65;
  const blade = Math.sin(s * 18) * 14;
  const lines = Array.from({ length: 24 }, (_, i) => `<rect x="0" y="${i * 80}" width="1080" height="${40 * (1 - i / 24) * sweep}" fill="#c9a227" opacity="${0.08 + (i / 24) * 0.25}"/>`).join("");
  const scissors = `<g transform="translate(500 ${1150 + Math.sin(s * 2) * 20}) rotate(${-20 + Math.sin(s * 1.3) * 6})"><g transform="rotate(${blade})"><path d="M0 0 L300 -24 L300 6 Z" fill="#e7e5e4"/><circle cx="-80" cy="-40" r="56" fill="none" stroke="#c9a227" stroke-width="22"/></g><g transform="rotate(${-blade})"><path d="M0 0 L300 24 L300 -6 Z" fill="#d6d3d1"/><circle cx="-80" cy="40" r="56" fill="none" stroke="#c9a227" stroke-width="22"/></g><circle r="14" fill="#1c1917"/></g>`;
  return (
    <SampleFrame seconds={11} bg="#141210" accent="#c9a227" brand="FADE & CO." endAt={7.6}>
      <Svg html={lines} />
      {s < 4.4 && <Svg html={scissors} />}
      <Slam text="FRESH" at={-1} out={1.5} top={360} />
      <Slam text="FADE." at={0.35} out={1.5} top={530} color="#c9a227" />
      <Slam text="NO" at={1.7} out={3.2} top={340} size={150} />
      <Slam text="WAITING." at={2.0} out={3.2} top={490} size={150} color="#c9a227" />
      <Slam text="FADE & CO." at={4.4} top={600} size={140} font="Outfit Bold" tracking={2} />
      <Line text="Walk-ins till 9 · Book in 2 taps" at={5.0} top={820} />
      <Line text="Every Friday · Kids cuts" at={5.7} top={900} color="#c9a227" size={48} />
      <Sfx at={0.0} src="thump.wav" />
      {[0.25, 0.5, 0.75, 1.0, 1.25, 1.9, 2.2, 2.5, 2.8].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.5} />)}
      <Sfx at={4.4} src="whoosh.wav" volume={0.6} />
      <Sfx at={8.2} src="pop.wav" />
    </SampleFrame>
  );
};

/** Gym: rep counter, heavy hits, first class on us. */
export const ShowcaseGym: React.FC = () => {
  const { s } = useT();
  const reps = Math.min(12, Math.floor(s * 4.2) + 1);
  const pulse = 1 + Math.max(0, Math.sin(s * Math.PI * 4.2)) * 0.04;
  const bars = Array.from({ length: 9 }, (_, i) => `<rect x="${90 + i * 104}" y="${1500 - (s < 3.2 ? 140 + ((i * 53 + Math.floor(s * 8) * 37) % 260) : 120)}" width="70" height="${s < 3.2 ? 140 + ((i * 53 + Math.floor(s * 8) * 37) % 260) : 120}" rx="12" fill="${i % 3 === 0 ? "#ff3b30" : "#262c23"}"/>`).join("");
  return (
    <SampleFrame seconds={11} bg="#0e0e10" accent="#ff3b30" brand="IRON 6AM" endAt={7.6}>
      <Svg html={bars} />
      {s < 3.3 && <div style={{ position: "absolute", left: 0, right: 0, top: 420, textAlign: "center", fontFamily: q("Outfit Bold"), fontSize: 520, lineHeight: 1, color: WH, transform: `scale(${pulse})` }}>{reps}</div>}
      {s < 3.3 && <Line text="reps before your coffee" at={0.3} top={960} size={52} color={MU} />}
      <Slam text="6 AM." at={3.4} out={5.1} top={430} size={220} color="#ff3b30" />
      <Slam text="NO EXCUSES." at={3.9} out={5.1} top={680} size={130} />
      <Slam text="IRON 6AM" at={5.3} top={560} size={170} tracking={6} />
      <Line text="Classes every morning" at={5.9} top={790} />
      <Line text="Your first class is on us" at={6.5} top={870} color="#ff3b30" />
      {[0, 0.24, 0.48, 0.72, 0.96, 1.2, 1.44, 1.68, 1.92, 2.16, 2.4, 2.64].map((t) => <Sfx key={t} at={t} src="thump.wav" volume={0.5} />)}
      <Sfx at={3.4} src="whoosh.wav" volume={0.7} />
      <Sfx at={5.3} src="thump.wav" />
      <Sfx at={8.2} src="pop.wav" />
    </SampleFrame>
  );
};

/** Cafe: steam curling off a cup, a latte-art heart drawing itself, order ahead. */
export const ShowcaseCafe: React.FC = () => {
  const { s } = useT();
  const draw = ramp(s, 0.2, 2.4);
  const steam = [0, 1, 2].map((i) => `<path d="M${470 + i * 70} 900 q-40 -80 0 -160 q40 -80 0 -160" stroke="#f5efe6" stroke-width="16" fill="none" stroke-linecap="round" opacity="${0.25 + 0.2 * Math.sin(s * 2 + i)}" transform="translate(${Math.sin(s * 1.6 + i) * 16} ${-((s * 60 + i * 40) % 120)})"/>`).join("");
  const heartLen = 1400;
  const cup = `<ellipse cx="540" cy="1080" rx="330" ry="110" fill="#6b4226"/><ellipse cx="540" cy="1060" rx="300" ry="92" fill="#c8a27a"/>
    <path d="M540 1120 C430 1060 420 980 480 975 C515 972 535 1000 540 1020 C545 1000 565 972 600 975 C660 980 650 1060 540 1120 Z" fill="none" stroke="#f5efe6" stroke-width="14" stroke-dasharray="${heartLen}" stroke-dashoffset="${heartLen * (1 - draw)}" transform="translate(0 -20)"/>
    <path d="M210 1080 q0 300 330 300 q330 0 330 -300" fill="#f5efe6"/><path d="M870 1120 q120 0 120 90 q0 90 -140 90" stroke="#f5efe6" stroke-width="40" fill="none"/>`;
  return (
    <SampleFrame seconds={11} bg="#1a120c" accent="#e7c9a9" brand="LITTLE CUP" endAt={7.6}>
      {s < 4.6 && <><Svg html={steam} /><Svg html={cup} /></>}
      <Line text="Slow mornings," at={-1} out={2.2} top={330} size={88} />
      <Line text="made fast." at={0.5} out={2.2} top={430} size={88} color="#e7c9a9" />
      <Line text="Order ahead. Skip the line." at={2.5} out={4.4} top={360} size={72} />
      <Slam text="LITTLE CUP" at={4.7} top={600} size={150} font="Outfit Regular" tracking={8} color="#f5efe6" />
      <Line text="Open 7 till 7 · Order from your phone" at={5.4} top={820} size={50} />
      <Line text="Your usual, ready when you walk in" at={6.1} top={900} size={46} color="#e7c9a9" />
      <Sfx at={0.2} src="whoosh.wav" volume={0.35} />
      <Sfx at={2.4} src="ding.wav" volume={0.5} />
      <Sfx at={4.7} src="pop.wav" volume={0.6} />
      <Sfx at={8.2} src="pop.wav" />
    </SampleFrame>
  );
};
