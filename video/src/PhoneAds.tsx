import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile } from "remotion";
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

/* ── CodeIt: teacher, parent, student. CodeIt is a website, so it's shown in a browser. ── */

const CREAM = "#fff4e6", BROWN = "#35220e", ORANGE = "#ff7a00";

const Clip: React.FC<{ src: string; from: number; to: number; video?: boolean }> = ({ src, from, to, video }) => {
  const { s, fps } = useT();
  if (s < from - 0.25 || s > to + 0.02) return null;
  const fade = from === 0 ? 1 : ramp(s, from - 0.25, from + 0.05);
  const k = ramp(s, from, to, 0, 1, (x) => x);
  // a still gets a slow push and a little handheld drift so it doesn't sit frozen
  const drift = video ? "" : ` translate(${Math.sin(s * 1.7) * 6}px, ${Math.cos(s * 1.3) * 5}px)`;
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${video ? 1 : 1.04 + k * 0.05})${drift}` };
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {video ? (
        <Sequence from={Math.round(Math.max(0, from - 0.25) * fps)} layout="none"><OffthreadVideo src={staticFile(src)} muted style={style} /></Sequence>
      ) : (
        <Img src={staticFile(src)} style={style} />
      )}
    </AbsoluteFill>
  );
};

const Who: React.FC<{ text: string; who: string; at: number; out: number }> = ({ text, who, at, out }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 13, stiffness: 190 });
  if (s < at || s > out + 0.2) return null;
  const gone = ramp(s, out, out + 0.2);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 1190, textAlign: "center", opacity: (1 - gone) * Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ display: "inline-block", padding: "8px 26px", borderRadius: 40, background: ORANGE, fontFamily: q("Nunito"), fontWeight: 900, fontSize: 30, letterSpacing: 3, color: "#fff" }}>{who}</div>
      <div style={{ marginTop: 16, fontFamily: q("Baloo 2"), fontWeight: 800, fontSize: 96, lineHeight: 1.05, color: "#fff", textShadow: "0 4px 22px rgba(0,0,0,0.7), 0 2px 5px rgba(0,0,0,0.55)" }}>{text}</div>
    </div>
  );
};

const IDEA = "a bunny that catches carrots at night";

/** The builder box from codeitlearn.com, redrawn sharp at video size. */
const Builder: React.FC<{ at: number }> = ({ at }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 15, stiffness: 150 });
  const typed = IDEA.slice(0, Math.max(0, Math.floor((s - at - 0.5) * 22)));
  const press = s > at + 2.6 && s < at + 2.85;
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top: 700, opacity: p, transform: `translateY(${(1 - p) * 80}px)` }}>
      <div style={{ borderRadius: "34px 34px 0 0", background: "#fff", border: `4px solid ${BROWN}`, borderBottom: "none", padding: "20px 28px", display: "flex", alignItems: "center", gap: 14 }}>
        {["#ff6b5e", "#ffc24a", "#5ad07a"].map((c) => <span key={c} style={{ width: 22, height: 22, borderRadius: 11, background: c }} />)}
        <div style={{ marginLeft: 14, flex: 1, padding: "10px 22px", borderRadius: 30, background: CREAM, fontFamily: q("Nunito"), fontWeight: 700, fontSize: 28, color: "#8a6f52" }}>codeitlearn.com</div>
      </div>
      <div style={{ background: CREAM, border: `4px solid ${BROWN}`, borderRadius: "0 0 34px 34px", padding: "40px 34px 44px" }}>
        <div style={{ fontFamily: q("Nunito"), fontWeight: 900, fontSize: 24, letterSpacing: 4, color: "#b4530a" }}>JAVASCRIPT GAMES</div>
        <div style={{ marginTop: 8, fontFamily: q("Baloo 2"), fontWeight: 800, fontSize: 70, lineHeight: 1.05, color: BROWN }}>Say a game. Get a game.</div>
        <div style={{ marginTop: 30, padding: "30px 30px 34px", borderRadius: 34, background: "#3a2410" }}>
          <div style={{ fontFamily: q("Nunito"), fontWeight: 800, fontSize: 24, letterSpacing: 4, color: "#d8c3a5" }}>WHAT DO YOU WANT TO BUILD?</div>
          <div style={{ marginTop: 18, padding: "26px 30px", minHeight: 62, borderRadius: 26, background: CREAM, border: "4px solid #c9962e", fontFamily: q("Nunito"), fontWeight: 800, fontSize: 40, color: BROWN }}>
            {typed}<span style={{ display: "inline-block", width: 4, height: 44, marginLeft: 3, background: BROWN, verticalAlign: "middle", opacity: Math.floor(s * 3) % 2 ? 1 : 0.15 }} />
          </div>
          <div style={{ marginTop: 22, display: "inline-block", padding: "20px 44px", borderRadius: 50, background: ORANGE, fontFamily: q("Baloo 2"), fontWeight: 800, fontSize: 42, color: BROWN, transform: `scale(${press ? 0.92 : 1})` }}>Build it →</div>
        </div>
      </div>
    </div>
  );
};

const KCard: React.FC<{ at: number; x: number; y: number; big: string; small: string; rot: number }> = ({ at, x, y, big, small, rot }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 11, stiffness: 190 });
  if (s < at) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, padding: "22px 34px", borderRadius: 30, background: "#fff", border: `4px solid ${BROWN}`, boxShadow: `0 10px 0 ${BROWN}`, opacity: Math.min(1, p * 1.5), transform: `scale(${0.6 + 0.4 * p}) rotate(${rot}deg)` }}>
      <div style={{ fontFamily: q("Baloo 2"), fontWeight: 800, fontSize: 60, lineHeight: 1, color: ORANGE }}>{big}</div>
      <div style={{ fontFamily: q("Nunito"), fontWeight: 800, fontSize: 30, color: BROWN }}>{small}</div>
    </div>
  );
};

export const CodeItEveryone: React.FC = () => {
  const { s } = useT();
  const site = ramp(s, 8.75, 9.1);
  const end = ramp(s, 13.6, 13.95);
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      <Fonts />
      <Clip src="ads/codeit-teacher.mp4" video from={0} to={3.0} />
      <Clip src="ads/codeit-dad.jpg" from={3.0} to={6.0} />
      <Clip src="ads/codeit-student.mp4" video from={6.0} to={9.0} />
      {s < 9.1 && <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 24%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)" }} />}
      <Who who="TEACHERS" text="For my class." at={0.25} out={2.8} />
      <Who who="PARENTS" text="For my kid." at={3.2} out={5.8} />
      <Who who="STUDENTS" text="For me." at={6.2} out={8.7} />
      {s < 9.0 && <Label text="CODEIT · AI-MADE PEOPLE" />}

      {s >= 8.75 && (
        <AbsoluteFill style={{ background: `radial-gradient(80% 50% at 50% 20%, #ffe7c7 0%, ${CREAM} 70%)`, opacity: site }}>
          <div style={{ position: "absolute", left: 60, right: 60, top: 250, textAlign: "center", fontFamily: q("Baloo 2"), fontWeight: 800, fontSize: 92, lineHeight: 1.05, color: BROWN }}>Type one sentence. <span style={{ color: ORANGE }}>Play your game.</span></div>
          <Builder at={9.1} />
          <KCard at={10.6} x={40} y={570} big="Free" small="to start" rot={-5} />
          <KCard at={11.4} x={700} y={610} big="5 to 18" small="all ages" rot={4} />
          <KCard at={12.2} x={560} y={1500} big="31" small="free Python lessons" rot={-3} />
        </AbsoluteFill>
      )}
      {s >= 13.6 && (
        <AbsoluteFill style={{ background: ORANGE, opacity: end, alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginTop: -200 }}>
            <div style={{ fontFamily: q("Baloo 2"), fontWeight: 800, fontSize: 150, lineHeight: 1, color: "#fff" }}>CodeIt</div>
            <div style={{ marginTop: 30, fontFamily: q("Baloo 2"), fontWeight: 800, fontSize: 84, color: BROWN }}>Everyone can code.</div>
            <div style={{ marginTop: 50, display: "inline-block", padding: "22px 54px", borderRadius: 60, background: "#fff", fontFamily: q("Nunito"), fontWeight: 900, fontSize: 48, color: BROWN }}>codeitlearn.com</div>
          </div>
        </AbsoluteFill>
      )}

      <Audio src={staticFile("sfx/codeit-bed.mp3")} volume={0.32} />
      {[0.25, 3.2, 6.2].map((a) => <Sfx key={a} at={a} src="pop.wav" volume={0.6} />)}
      <Sfx at={8.7} src="whoosh.wav" volume={0.5} />
      {Array.from({ length: 12 }, (_, i) => <Sfx key={i} at={9.6 + i * 0.14} src="click.wav" volume={0.35} />)}
      {[10.6, 11.4, 12.2].map((a) => <Sfx key={a} at={a} src="pop.wav" volume={0.6} />)}
      <Sfx at={13.6} src="ding.wav" volume={0.6} />
    </AbsoluteFill>
  );
};
