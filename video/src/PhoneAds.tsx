import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, staticFile } from "remotion";
import { BK, LI, LN, MU, Tag, WH } from "./lynq-story-kit";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * "Hold up the phone" ads, after the Mimo format: a person shows the result to camera, then a
 * close-up of the phone with what it means popping out as cards, then one plain brand card.
 * People are AI-made (labeled on screen); the shop is made up. The phone screen in the close-up
 * is our own UI, drawn here and slotted behind the cut-out phone photo.
 */

const q = (f: string) => `'${f}'`;
const EN = "en" as const;

const Caption: React.FC<{ text: string; at: number; out: number; top?: number; size?: number; accent?: string[] }> = ({ text, at, out, top = 1200, size = 64, accent = [] }) => {
  const { s, frame, fps } = useT();
  if (s < at || s > out + 0.25) return null;
  const gone = ramp(s, out, out + 0.25);
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top, textAlign: "center", fontFamily: q("Outfit Bold"), fontSize: size, lineHeight: 1.12, color: "#fff", opacity: 1 - gone, textShadow: "0 3px 18px rgba(0,0,0,0.75), 0 1px 4px rgba(0,0,0,0.6)" }}>
      {text.split(" ").map((w, i) => {
        const p = Math.max(0, Math.min(1, (frame - Math.round((at + i * 0.09) * fps)) / 5));
        return <span key={i} style={{ display: "inline-block", margin: "0 0.12em", opacity: p, transform: `translateY(${(1 - p) * 18}px)`, color: accent.includes(w.replace(/[.,!?]/g, "")) ? LI : undefined }}>{w}</span>;
      })}
    </div>
  );
};

const Label: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: "absolute", left: 0, right: 0, top: 118, textAlign: "center", fontFamily: q("JetBrains Mono"), fontSize: 21, letterSpacing: 3, color: "rgba(255,255,255,0.85)", textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>{text}</div>
);

/** A white info card that pops out beside the phone. */
const Card: React.FC<{ at: number; x: number; y: number; big: string; small: string; icon: string }> = ({ at, x, y, big, small, icon }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 12, stiffness: 190 });
  if (s < at) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, padding: "24px 30px", borderRadius: 26, background: "#fff", boxShadow: "0 24px 60px rgba(0,0,0,0.28)", display: "flex", alignItems: "center", gap: 22, opacity: Math.min(1, p * 1.5), transform: `scale(${0.6 + 0.4 * p})`, transformOrigin: "50% 50%" }}>
      <div style={{ width: 70, height: 70, borderRadius: 18, background: BK, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q("Outfit Bold"), fontSize: 38, color: LI }}>{icon}</div>
      <div>
        <div style={{ fontFamily: q("Outfit Bold"), fontSize: 44, lineHeight: 1.05, color: "#141614", letterSpacing: -0.5 }}>{big}</div>
        <div style={{ marginTop: 4, fontFamily: q("Outfit Regular"), fontSize: 28, color: "#6b7166" }}>{small}</div>
      </div>
    </div>
  );
};

/* ── The made-up shop's website, drawn at phone size ─────────────────── */

const TILES: [string, string][] = [
  ["Cedar & Smoke", "linear-gradient(150deg,#e9d5b7,#b98a57)"],
  ["Fig Leaf", "linear-gradient(150deg,#dfe6d3,#8fa37a)"],
  ["Sea Salt", "linear-gradient(150deg,#dbe7ea,#8fb0b8)"],
  ["Vanilla Oak", "linear-gradient(150deg,#f3e6cf,#d2ab72)"],
  ["Wild Lavender", "linear-gradient(150deg,#e6def0,#a391c2)"],
  ["Amber Noir", "linear-gradient(150deg,#e8c9a0,#7a4a22)"],
];

const ShopSite: React.FC<{ scroll: number }> = ({ scroll }) => (
  <div style={{ width: 431, height: 943, overflow: "hidden", background: "#faf6ef", fontFamily: q("Outfit Regular"), color: "#2b2118" }}>
    <div style={{ height: 96, paddingTop: 50, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "50px 22px 0", background: "#faf6ef", position: "relative", zIndex: 2 }}>
      <span style={{ fontFamily: q("Outfit Bold"), fontSize: 22, letterSpacing: 1 }}>EMBER &amp; OAK</span>
      <span style={{ fontSize: 15, padding: "6px 14px", borderRadius: 20, background: "#2b2118", color: "#faf6ef" }}>Cart · 0</span>
    </div>
    <div style={{ transform: `translateY(${-scroll}px)` }}>
      <div style={{ height: 330, margin: "10px 16px 0", borderRadius: 22, background: "linear-gradient(160deg,#f1d9b5 0%,#c98f56 60%,#8a5a2e 100%)", padding: 24, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        <div style={{ fontFamily: q("Outfit Bold"), fontSize: 40, lineHeight: 1.02, color: "#fff" }}>Hand-poured candles.</div>
        <div style={{ marginTop: 8, fontSize: 17, color: "rgba(255,255,255,0.9)" }}>Small batches, made at home.</div>
        <div style={{ marginTop: 16, alignSelf: "flex-start", padding: "10px 22px", borderRadius: 24, background: "#fff", fontFamily: q("Outfit Bold"), fontSize: 17 }}>Shop now</div>
      </div>
      <div style={{ margin: "22px 18px 10px", fontFamily: q("Outfit Bold"), fontSize: 22 }}>Best sellers</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 16px" }}>
        {TILES.map(([name, bg]) => (
          <div key={name}>
            <div style={{ height: 170, borderRadius: 16, background: bg, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
              <div style={{ width: 62, height: 84, borderRadius: "8px 8px 12px 12px", background: "rgba(255,255,255,0.88)", marginBottom: 18, boxShadow: "0 8px 18px rgba(0,0,0,0.15)" }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 16 }}>{name}</div>
            <div style={{ fontSize: 13, color: "#8a7a68", marginBottom: 8 }}>Add to cart</div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const EndCard: React.FC<{ at: number }> = ({ at }) => {
  const { s } = useT();
  const p = ramp(s, at - 0.35, at + 0.15);
  if (s < at - 0.35) return null;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(70% 45% at 50% 30%, #1e221d 0%, ${BK} 72%)`, opacity: p }}>
      <div style={{ position: "absolute", top: 420, left: 80, right: 80, textAlign: "center" }}>
        <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 30, letterSpacing: 10, color: MU }}>LYNQ</div>
        <div style={{ marginTop: 44, fontFamily: q("Outfit Bold"), fontSize: 100, lineHeight: 1.04, letterSpacing: -2, color: WH }}>Bring your idea <span style={{ color: LI }}>to life.</span></div>
        <div style={{ marginTop: 34, fontFamily: q("Outfit Regular"), fontSize: 44, lineHeight: 1.25, color: MU }}>Your website. Your ads. Your first customers.</div>
      </div>
    </AbsoluteFill>
  );
};

export const LynqIdea: React.FC = () => {
  const { s } = useT();
  const cut = 4.0;
  const handIn = ramp(s, cut - 0.3, cut + 0.1);
  const zoom = 1.06 - ramp(s, cut, 9.8, 0, 0.06, (x) => x);
  return (
    <AbsoluteFill style={{ background: BK }}>
      <Fonts />
      {s < cut + 0.15 && (
        <AbsoluteFill>
          <OffthreadVideo src={staticFile("ads/lynq-woman.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      )}
      {s >= cut - 0.3 && s < 10.2 && (
        <AbsoluteFill style={{ opacity: handIn, transform: `scale(${zoom})`, transformOrigin: "50% 62%" }}>
          <div style={{ position: "absolute", left: 318, top: 745, width: 443, height: 955, overflow: "hidden", borderRadius: 40, background: "#faf6ef" }}>
            <div style={{ transform: `scale(${443 / 431})`, transformOrigin: "0 0" }}><ShopSite scroll={ramp(s, 5.0, 9.6, 0, 300, (x) => x)} /></div>
          </div>
          <Img src={staticFile("ads/lynq-hand.png")} style={{ position: "absolute", left: 0, top: -7, width: 1080, height: 1934 }} />
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 26%)" }} />

      <Caption text="I had an idea." at={0.2} out={1.7} />
      <Caption text="Now it's a real business." at={2.0} out={3.7} accent={["real", "business."]} />
      <Caption text="LYNQ built everything." at={4.3} out={9.7} top={300} size={82} accent={["LYNQ"]} />
      <Card at={5.2} x={40} y={690} big="Website" small="built from scratch" icon="↗" />
      <Card at={6.4} x={560} y={1040} big="Ads" small="that bring customers" icon="◎" />
      <Card at={7.6} x={90} y={1330} big="One team" small="for all of it" icon="✓" />
      <EndCard at={10.0} />
      {s >= 10.5 && <Tag text="Comment IDEA" at={10.5} top={1180} lang={EN} />}
      {s < 10.0 && <Label text="LYNQ · AI-MADE PERSON · MADE-UP SHOP" />}

      <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={0.3} />
      <Sfx at={3.8} src="whoosh.wav" volume={0.4} />
      <Sfx at={5.2} src="pop.wav" volume={0.6} />
      <Sfx at={6.4} src="pop.wav" volume={0.6} />
      <Sfx at={7.6} src="pop.wav" volume={0.6} />
      <Sfx at={9.7} src="whoosh.wav" volume={0.35} />
      <Sfx at={10.5} src="ding.wav" volume={0.5} />
    </AbsoluteFill>
  );
};
