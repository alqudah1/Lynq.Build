import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { BALOO, BROWN, MINT, MONO, NUNITO, ORANGE, ORANGE_T, Svg, YELLOW } from "./pip-kit";
import { Fonts, Sfx, Words, ramp, useSpringAt, useT } from "./kit";

/*
 * "Adam makes a game": a kid and his mom, drawn flat (no real children, no real brands). Each
 * episode opens on the kid's moment (for kids) and lands on the mom's side (for parents). The game
 * on Adam's tablet is a generic blocky game, not any real one.
 */

const q = (f: string) => `'${f}'`;
const SKIN_A = "#c98b62", SKIN_M = "#b97a52", HAIR = "#2a1b12", HOODIE = "#ff7a00", MOMTOP = "#3a5a8c";

type AdamPose = "play" | "wow" | "ask" | "wait";
/** Adam, 9. `x, y` is the point between his feet. */
export const Adam: React.FC<{ x: number; y: number; size?: number; pose: AdamPose; bob?: number }> = ({ x, y, size = 1, pose, bob = 0 }) => {
  const { s } = useT();
  const blink = Math.floor(s * 10) % 31 === 0;
  const eyeR = pose === "wow" ? 12 : 8;
  const eyes = blink ? `<path d="M-34 -300 h16 M18 -300 h16" stroke="${HAIR}" stroke-width="7" stroke-linecap="round"/>` : `<circle cx="-26" cy="-300" r="${eyeR}" fill="${HAIR}"/><circle cx="26" cy="-300" r="${eyeR}" fill="${HAIR}"/>`;
  const mouth = pose === "wow" ? `<ellipse cx="0" cy="-250" rx="14" ry="18" fill="#5a2a18"/>` : pose === "ask" ? `<path d="M-22 -254 Q0 -236 22 -254" stroke="#5a2a18" stroke-width="8" fill="none" stroke-linecap="round"/>` : pose === "wait" ? `<path d="M-16 -250 L16 -250" stroke="#5a2a18" stroke-width="8" stroke-linecap="round"/>` : `<path d="M-20 -254 Q0 -242 20 -254" stroke="#5a2a18" stroke-width="8" fill="none" stroke-linecap="round"/>`;
  const tablet = pose === "play" || pose === "wow" ? `<rect x="-90" y="-190" width="180" height="120" rx="16" fill="#1d2654" stroke="#111" stroke-width="6"/><rect x="-78" y="-178" width="156" height="96" rx="8" fill="#6fc3ff"/>` : "";
  const arms = pose === "ask"
    ? `<rect x="-128" y="-200" width="44" height="150" rx="22" fill="${HOODIE}" transform="rotate(10 -106 -190)"/><rect x="84" y="-230" width="44" height="150" rx="22" fill="${HOODIE}" transform="rotate(-140 106 -220)"/>`
    : pose === "wait" ? `<rect x="-128" y="-200" width="44" height="150" rx="22" fill="${HOODIE}" transform="rotate(8 -106 -190)"/><rect x="84" y="-200" width="44" height="150" rx="22" fill="${HOODIE}" transform="rotate(-8 106 -190)"/>`
    : `<rect x="-120" y="-190" width="44" height="120" rx="22" fill="${HOODIE}" transform="rotate(-40 -98 -180)"/><rect x="76" y="-190" width="44" height="120" rx="22" fill="${HOODIE}" transform="rotate(40 98 -180)"/>`;
  const html = `
    <rect x="-56" y="-60" width="46" height="60" rx="14" fill="#2d3550"/><rect x="10" y="-60" width="46" height="60" rx="14" fill="#2d3550"/>
    ${arms}
    <rect x="-100" y="-220" width="200" height="180" rx="60" fill="${HOODIE}"/>
    <path d="M-30 -220 Q0 -196 30 -220" stroke="#d46500" stroke-width="8" fill="none"/>
    <circle cx="0" cy="-290" r="82" fill="${SKIN_A}"/>
    <path d="M-84 -300 Q-86 -384 0 -388 Q86 -384 84 -300 Q74 -350 30 -352 Q40 -330 10 -340 Q-20 -360 -50 -340 Q-70 -330 -84 -300 Z" fill="${HAIR}"/>
    ${eyes}${mouth}${tablet}`;
  return <Svg w={10} h={10} vb="0 0 10 10" html={html} style={{ left: x, top: y - bob, transform: `scale(${size})`, transformOrigin: "0 0" }} />;
};

type MomPose = "calm" | "think" | "worried" | "smile";
/** Adam's mom. `x, y` is the point between her feet. */
export const Mom: React.FC<{ x: number; y: number; size?: number; pose: MomPose }> = ({ x, y, size = 1, pose }) => {
  const { s } = useT();
  const blink = Math.floor(s * 10) % 41 === 0;
  const eyes = blink ? `<path d="M-38 -432 h18 M20 -432 h18" stroke="${HAIR}" stroke-width="7" stroke-linecap="round"/>` : `<circle cx="-30" cy="-432" r="9" fill="${HAIR}"/><circle cx="30" cy="-432" r="9" fill="${HAIR}"/>`;
  const brows = pose === "worried" || pose === "think" ? `<path d="M-46 -458 L-16 -470 M46 -458 L16 -470" stroke="${HAIR}" stroke-width="8" stroke-linecap="round"/>` : `<path d="M-46 -462 L-16 -464 M46 -462 L16 -464" stroke="${HAIR}" stroke-width="8" stroke-linecap="round"/>`;
  const mouth = pose === "smile" ? `<path d="M-30 -384 Q0 -356 30 -384" stroke="#5a2a18" stroke-width="8" fill="none" stroke-linecap="round"/>` : pose === "worried" ? `<path d="M-24 -374 Q0 -388 24 -374" stroke="#5a2a18" stroke-width="8" fill="none" stroke-linecap="round"/>` : `<path d="M-20 -380 L20 -380" stroke="#5a2a18" stroke-width="8" stroke-linecap="round"/>`;
  const hand = pose === "think" ? `<rect x="60" y="-330" width="48" height="170" rx="24" fill="${MOMTOP}" transform="rotate(-160 84 -320)"/>` : `<rect x="100" y="-310" width="48" height="210" rx="24" fill="${MOMTOP}" transform="rotate(-6 124 -300)"/>`;
  const html = `
    <rect x="-70" y="-90" width="60" height="90" rx="16" fill="#242a38"/><rect x="10" y="-90" width="60" height="90" rx="16" fill="#242a38"/>
    <rect x="-148" y="-310" width="48" height="210" rx="24" fill="${MOMTOP}" transform="rotate(6 -124 -300)"/>${hand}
    <rect x="-112" y="-330" width="224" height="260" rx="70" fill="${MOMTOP}"/>
    <circle cx="0" cy="-420" r="88" fill="${SKIN_M}"/>
    <path d="M-92 -420 Q-96 -520 0 -524 Q96 -520 92 -420 Q80 -480 0 -486 Q-80 -480 -92 -420 Z" fill="${HAIR}"/>
    <circle cx="0" cy="-534" r="40" fill="${HAIR}"/>
    ${brows}${eyes}${mouth}`;
  return <Svg w={10} h={10} vb="0 0 10 10" html={html} style={{ left: x, top: y, transform: `scale(${size})`, transformOrigin: "0 0" }} />;
};

/** The living room: cream wall, window, couch, rug. */
const Room: React.FC = () => {
  const html = `<rect width="1080" height="1920" fill="#fff6ec"/>
    <rect x="620" y="420" width="330" height="380" rx="20" fill="#cfe9ff" stroke="#f1dfc6" stroke-width="18"/><path d="M785 420 V800 M620 610 H950" stroke="#f1dfc6" stroke-width="12"/>
    <rect x="0" y="1380" width="1080" height="540" fill="#f6e3c8"/>
    <ellipse cx="540" cy="1560" rx="460" ry="80" fill="#ffd9b0"/>
    <rect x="70" y="1040" width="620" height="300" rx="70" fill="#ffb366"/><rect x="40" y="1140" width="680" height="260" rx="60" fill="#ff9a3c"/>`;
  return <Svg w={1080} h={1920} vb="0 0 1080 1920" html={html} style={{ left: 0, top: 0 }} />;
};

/** The kitchen table where Mom works. */
const Kitchen: React.FC = () => {
  const html = `<rect width="1080" height="1920" fill="#fdf1e2"/>
    
    <rect x="0" y="1420" width="1080" height="500" fill="#efd9bc"/>
    <rect x="80" y="1260" width="920" height="40" rx="16" fill="#c88a4f"/><rect x="140" y="1300" width="30" height="300" fill="#b07436"/><rect x="910" y="1300" width="30" height="300" fill="#b07436"/>`;
  return <Svg w={1080} h={1920} vb="0 0 1080 1920" html={html} style={{ left: 0, top: 0 }} />;
};

/** A generic blocky game on a big tablet screen: blocks, a little block hero hopping. */
const BlockGame: React.FC<{ at: number; popAt?: number }> = ({ at, popAt }) => {
  const { s } = useT();
  const t = s - at;
  const sp = useSpringAt(at, { damping: 15, stiffness: 140 });
  const p = at < 0 ? 1 : sp;
  const hop = Math.abs(Math.sin(t * 4)) * 60;
  const scroll = (t * 120) % 120;
  const blocks = Array.from({ length: 12 }, (_, i) => `<rect x="${i * 120 - scroll}" y="520" width="118" height="118" fill="${i % 3 ? "#7bd06b" : "#5fb44f"}"/><rect x="${i * 120 - scroll}" y="638" width="118" height="80" fill="#a8743f"/>`).join("");
  const towers = `<rect x="${620 - scroll / 2}" y="300" width="118" height="220" fill="#c9c9d6"/><rect x="${620 - scroll / 2}" y="260" width="118" height="40" fill="#e05656"/><rect x="${160 - scroll / 3}" y="400" width="80" height="120" fill="#c9c9d6"/>`;
  const hero = `<g transform="translate(330 ${400 - hop})"><rect x="0" y="0" width="70" height="70" fill="#ffd36b"/><rect x="0" y="70" width="70" height="60" fill="#4b7bff"/><rect x="14" y="20" width="12" height="12" fill="#222"/><rect x="44" y="20" width="12" height="12" fill="#222"/></g>`;
  const popped = popAt !== undefined && s >= popAt;
  const pp = useSpringAt(popAt ?? 99, { damping: 10, stiffness: 220 });
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: 470, height: 760, borderRadius: 50, background: "#1d2654", padding: 22, boxShadow: "0 40px 90px rgba(53,34,14,0.3)", opacity: p, transform: `scale(${0.9 + p * 0.1})` }}>
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 32, overflow: "hidden", background: "linear-gradient(#8fd3ff,#cdeeff)" }}>
        <Svg w={856} h={716} vb="0 0 856 716" html={towers + blocks + hero} style={{ left: 0, top: 0 }} />
        {popped && (
          <div style={{ position: "absolute", left: 50, right: 50, top: 150, padding: "34px 36px", borderRadius: 30, background: "#fff", boxShadow: "0 20px 50px rgba(0,0,0,0.3)", transform: `scale(${pp})`, textAlign: "center" }}>
            <div style={{ fontFamily: q(NUNITO), fontWeight: 800, fontSize: 28, letterSpacing: 4, color: ORANGE_T }}>DID YOU KNOW?</div>
            <div style={{ fontFamily: q(BALOO), fontWeight: 800, fontSize: 60, lineHeight: 1.05, color: BROWN, marginTop: 10 }}>A real person <span style={{ color: ORANGE }}>made</span> this game.</div>
          </div>
        )}
      </div>
    </div>
  );
};

/** A speech bubble. */
const Bubble: React.FC<{ text: string; at: number; x: number; y: number; w?: number; tail?: "left" | "right" | "down"; size?: number; out?: number }> = ({ text, at, x, y, w = 640, tail = "down", size = 60, out }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 11, stiffness: 220 });
  if (s < at || (out !== undefined && s > out)) return null;
  const tailStyle: React.CSSProperties = tail === "down" ? { left: 80, bottom: -30, borderTop: "34px solid #fff", borderLeft: "24px solid transparent", borderRight: "24px solid transparent" } : tail === "left" ? { left: -30, top: 40, borderRight: "34px solid #fff", borderTop: "22px solid transparent", borderBottom: "22px solid transparent" } : { right: -30, top: 40, borderLeft: "34px solid #fff", borderTop: "22px solid transparent", borderBottom: "22px solid transparent" };
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, padding: "28px 36px", borderRadius: 40, background: "#fff", boxShadow: "0 18px 40px rgba(53,34,14,0.15)", fontFamily: q(BALOO), fontWeight: 700, fontSize: size, lineHeight: 1.08, color: BROWN, transform: `scale(${p})`, transformOrigin: tail === "down" ? "15% 100%" : "0 30%" }}>
      {text}
      <div style={{ position: "absolute", width: 0, height: 0, ...tailStyle }} />
    </div>
  );
};

/** Mom's laptop with search results that are all huge tutorials. */
const Search: React.FC<{ at: number }> = ({ at }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 15, stiffness: 140 });
  const typed = "how do kids make a game".slice(0, Math.max(0, Math.floor((s - at - 0.3) * 22)));
  const results = [["Game development full course", "3:12:45"], ["Learn C++ in 40 hours", "40:02:11"], ["Python for beginners · part 1 of 12", "2:58:30"], ["Complete game dev roadmap", "5:41:07"]];
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: 430, height: 760, borderRadius: 34, background: "#fff", boxShadow: "0 40px 90px rgba(53,34,14,0.22)", padding: "40px 40px", opacity: sp, transform: `translateY(${(1 - sp) * 80}px)` }}>
      <div style={{ padding: "22px 30px", borderRadius: 40, background: "#f3eee6", fontFamily: q(NUNITO), fontSize: 38, color: BROWN }}>{typed}<span style={{ opacity: Math.floor(s * 3) % 2 ? 1 : 0.2 }}>|</span></div>
      {results.map(([t, d], i) => {
        const rp = ramp(s, at + 1.2 + i * 0.3, at + 1.5 + i * 0.3);
        return (
          <div key={t} style={{ display: "flex", gap: 24, alignItems: "center", marginTop: 26, opacity: rp, transform: `translateX(${(1 - rp) * 60}px)` }}>
            <div style={{ width: 210, height: 118, borderRadius: 14, background: "#2b2b2e", position: "relative", flex: "none" }}>
              <div style={{ position: "absolute", right: 8, bottom: 8, padding: "2px 10px", borderRadius: 6, background: "rgba(0,0,0,0.8)", fontFamily: q(MONO), fontSize: 24, color: "#fff" }}>{d}</div>
            </div>
            <div style={{ fontFamily: q(NUNITO), fontWeight: 700, fontSize: 36, color: BROWN, lineHeight: 1.15 }}>{t}</div>
          </div>
        );
      })}
    </div>
  );
};

const Top: React.FC<{ text: string; at: number; accent?: string[]; out?: number }> = ({ text, at, accent = [], out }) => (
  <div style={{ position: "absolute", left: 60, right: 60, top: 230, textAlign: "center" }}>
    <Words text={text} at={at} out={out} size={78} color={BROWN} accent={ORANGE} accentWords={accent} font={BALOO} weight={800} align="center" lineHeight={1.0} />
  </div>
);

const Frame: React.FC<{ ep: number; children: React.ReactNode }> = ({ ep, children }) => (
  <AbsoluteFill>
    <Fonts />
    {children}
    <div style={{ position: "absolute", top: 140, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 30px", borderRadius: 40, background: "rgba(255,255,255,0.85)", fontFamily: q(NUNITO), fontWeight: 800, fontSize: 26, letterSpacing: 4, color: ORANGE_T }}>
        <span style={{ width: 14, height: 14, borderRadius: 7, background: ORANGE, display: "inline-block" }} />ADAM MAKES A GAME · EP {ep}
      </div>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, textAlign: "center", fontFamily: q(NUNITO), fontWeight: 800, fontSize: 30, color: ORANGE_T, opacity: 0.85 }}>codeitlearn.com</div>
    <Audio src={staticFile("sfx/codeit-bed.mp3")} volume={0.28} />
  </AbsoluteFill>
);

/** Episode 1: the pop-up. Adam wants to make a game; every answer Mom finds is a 3 hour tutorial. */
export const AdamEp1: React.FC = () => {
  const { s } = useT();
  return (
    <Frame ep={1}>
      {s < 7.0 && <Room />}
      {s < 3.6 && (
        <>
          <Top text="Adam plays games every day." at={-1} accent={["every", "day"]} />
          <BlockGame at={-1} popAt={1.4} />
          <Adam x={540} y={1560} size={1.15} pose={s < 1.6 ? "play" : "wow"} bob={s < 1.4 ? Math.abs(Math.sin(s * 5)) * 6 : 0} />
          {s >= 1.6 && <div style={{ position: "absolute", left: 640, top: 1080, fontFamily: q(BALOO), fontWeight: 800, fontSize: 120, color: ORANGE, transform: `rotate(12deg) scale(${Math.min(1, (s - 1.6) * 5)})` }}>!</div>}
        </>
      )}
      {s >= 3.6 && s < 7.0 && (
        <>
          <Top text="Then he asked the big question." at={3.6} accent={["big", "question"]} />
          <Adam x={330} y={1560} size={1.15} pose="ask" />
          <Bubble text="Mom… how do people MAKE games?" at={4.0} x={100} y={700} w={760} size={70} />
          <Mom x={860} y={1640} size={1.0} pose="calm" />
        </>
      )}
      {s >= 7.0 && s < 11.6 && (
        <>
          <Kitchen />
          <Top text="Every answer was a 3 hour tutorial." at={7.0} accent={["3", "hour"]} />
          <Search at={7.0} />
          <Mom x={540} y={1760} size={0.95} pose={s < 9.5 ? "think" : "worried"} />
        </>
      )}
      {s >= 11.6 && (
        <>
          <Room />
          <Top text="She didn't want to say no." at={11.6} accent={["no"]} />
          <Adam x={330} y={1560} size={1.15} pose="wait" />
          <Bubble text="…so can I?" at={11.9} x={120} y={820} w={420} size={70} />
          <Mom x={860} y={1640} size={1.0} pose="worried" />
          {s >= 13.6 && (
            <div style={{ position: "absolute", left: 0, right: 0, top: 1660, display: "flex", justifyContent: "center", transform: `scale(${Math.min(1, (s - 13.6) * 4)})` }}>
              <div style={{ padding: "22px 46px", borderRadius: 60, background: "linear-gradient(135deg,#ff9a3c,#ff6a00)", fontFamily: q(NUNITO), fontWeight: 900, fontSize: 40, color: "#fff" }}>Parents: what would you say? Ep 2 tomorrow</div>
            </div>
          )}
        </>
      )}
      <Sfx at={1.4} src="pop.wav" />
      <Sfx at={1.6} src="ding.wav" volume={0.6} />
      <Sfx at={3.6} src="whoosh.wav" volume={0.5} />
      <Sfx at={4.0} src="pop.wav" volume={0.7} />
      <Sfx at={7.0} src="whoosh.wav" volume={0.5} />
      {[8.2, 8.5, 8.8, 9.1].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.5} />)}
      <Sfx at={11.6} src="whoosh.wav" volume={0.5} />
      <Sfx at={13.6} src="thump.wav" volume={0.7} />
    </Frame>
  );
};
