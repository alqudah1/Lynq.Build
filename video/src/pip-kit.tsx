import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile } from "remotion";
import { hero, item, pip } from "../../platform/src/lib/social-os/codeit-formats";
import { Fonts, Sfx, Words, ramp, useSpringAt, useT } from "./kit";

export const BROWN = "#35220e", ORANGE = "#ff7a00", ORANGE_T = "#d46500", YELLOW = "#f5d04a", MINT = "#3ddc97", NAVY = "#1d2654";
export const BALOO = "Baloo 2", NUNITO = "Nunito", MONO = "JetBrains Mono";
const q = (f: string) => `'${f}'`;

export const Svg: React.FC<{ w: number; h: number; vb: string; html: string; style?: React.CSSProperties }> = ({ w, h, vb, html, style }) => (
  <svg width={w} height={h} viewBox={vb} style={{ position: "absolute", overflow: "visible", ...style }} dangerouslySetInnerHTML={{ __html: html }} />
);

/** Pip, from the same drawing the cards use. `size` is the head width. */
export const Pip: React.FC<{ pose: "think" | "type" | "jump" | "cheer"; x: number; y: number; size: number; bounce?: number; tilt?: number }> = ({ pose, x, y, size, bounce = 0, tilt = 0 }) => {
  const r = size / 1.84;
  return <Svg w={size * 1.4} h={size * 1.9} vb={`${-r * 1.3} ${-r * 1.6} ${r * 2.6} ${r * 3.2}`} html={pip(0, 0, r, pose)} style={{ left: x - size * 0.7, top: y - size * 0.95 - bounce, transform: `rotate(${tilt}deg)`, transformOrigin: "50% 90%" }} />;
};

export const Backdrop: React.FC<{ dark?: number }> = ({ dark = 0 }) => {
  const { s } = useT();
  return (
    <AbsoluteFill style={{ background: "linear-gradient(170deg, #fff9f0 0%, #ffeedd 100%)" }}>
      <div style={{ position: "absolute", width: 720, height: 720, borderRadius: 360, right: -280 + Math.sin(s * 0.7) * 50, top: -160, background: ORANGE, opacity: 0.3, filter: "blur(120px)" }} />
      <div style={{ position: "absolute", width: 660, height: 660, borderRadius: 330, left: -280, top: 880 + Math.cos(s * 0.6) * 50, background: YELLOW, opacity: 0.42, filter: "blur(120px)" }} />
      <div style={{ position: "absolute", width: 720, height: 720, borderRadius: 360, right: -260, bottom: -280, background: MINT, opacity: 0.26, filter: "blur(130px)" }} />
      {dark > 0 && <AbsoluteFill style={{ background: "#17183d", opacity: dark }} />}
    </AbsoluteFill>
  );
};

export const SeriesPill: React.FC<{ ep: number }> = ({ ep }) => (
  <div style={{ position: "absolute", top: 150, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 34px", borderRadius: 40, background: "rgba(255,122,0,0.13)", fontFamily: q(NUNITO), fontWeight: 800, fontSize: 28, letterSpacing: 5, color: ORANGE_T }}>
      <span style={{ width: 16, height: 16, borderRadius: 8, background: ORANGE, display: "inline-block" }} />
      PIP BUILDS A GAME · EP {ep} OF 5
    </div>
  </div>
);

/** 0.9 s title sting: series name and episode number slam in. */
export const Sting: React.FC<{ ep: number; title: string }> = ({ ep, title }) => {
  const { s } = useT();
  const a = useSpringAt(0, { damping: 11, stiffness: 240 });
  const b = useSpringAt(0.18, { damping: 10, stiffness: 260 });
  const out = ramp(s, 0.75, 0.95);
  if (s > 1.0) return null;
  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg,#ff9a3c,#ff6a00)", opacity: 1 - out, alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
      <div style={{ fontFamily: q(NUNITO), fontWeight: 900, fontSize: 44, letterSpacing: 10, color: "#fff", opacity: a, transform: `translateY(${(1 - a) * -60}px)` }}>PIP BUILDS A GAME</div>
      <div style={{ fontFamily: q(BALOO), fontWeight: 700, fontSize: 260, color: "#fff", lineHeight: 1, transform: `scale(${b})` }}>EP {ep}</div>
      <div style={{ fontFamily: q(BALOO), fontWeight: 700, fontSize: 80, color: "#fff2df", opacity: b }}>{title}</div>
    </AbsoluteFill>
  );
};

/** Bottom caption, big and centred. */
export const Caption: React.FC<{ text: string; at: number; out?: number; accent?: string[]; size?: number; top?: number }> = ({ text, at, out, accent = [], size = 96, top = 1640 }) => (
  <div style={{ position: "absolute", left: 60, right: 60, top, textAlign: "center" }}>
    <Words text={text} at={at} out={out} size={size} color={BROWN} accent={ORANGE} accentWords={accent} font={BALOO} weight={700} align="center" lineHeight={1.0} />
  </div>
);

export const TopLine: React.FC<{ text: string; at: number; out?: number; accent?: string[]; size?: number }> = ({ text, at, out, accent = [], size = 92 }) => (
  <div style={{ position: "absolute", left: 60, right: 60, top: 250, textAlign: "center" }}>
    <Words text={text} at={at} out={out} size={size} color={BROWN} accent={ORANGE} accentWords={accent} font={BALOO} weight={700} align="center" lineHeight={1.0} />
  </div>
);

/** A dark code window; `edits` swap a line's text at a time, with a typing cursor. */
export const CodeWindow: React.FC<{ at: number; lines: string[]; top?: number; highlight?: number; highlightAt?: number; edit?: { line: number; from: string; to: string; at: number }; bad?: boolean }> = ({ at, lines, top = 520, highlight, highlightAt = 0, edit, bad }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 15, stiffness: 150 });
  const glow = highlight !== undefined && s > highlightAt ? 0.6 + Math.sin((s - highlightAt) * 8) * 0.4 : 0;
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top, padding: "40px 46px 46px", borderRadius: 48, background: "linear-gradient(180deg,#33241a,#1f150d)", boxShadow: "0 40px 90px rgba(53,34,14,0.35)", opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 120}px) scale(${0.92 + p * 0.08})` }}>
      <div style={{ display: "flex", gap: 14, marginBottom: 34 }}>{["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 22, height: 22, borderRadius: 11, background: c }} />)}<span style={{ marginLeft: 20, fontFamily: q(MONO), fontSize: 30, color: "#b9a590" }}>pip_game.py</span></div>
      {lines.map((l, i) => {
        let text = l;
        let cursor = false;
        if (edit && edit.line === i && s >= edit.at) {
          const k = Math.min(1, (s - edit.at) / 0.6);
          const keep = l.length - edit.from.length;
          text = k < 0.5 ? l.slice(0, keep) + edit.from.slice(0, Math.ceil(edit.from.length * (1 - k * 2))) : l.slice(0, keep) + edit.to.slice(0, Math.ceil(edit.to.length * (k - 0.5) * 2));
          cursor = k < 1;
          if (k >= 1) text = l.slice(0, keep) + edit.to;
        }
        const hl = i === highlight && glow > 0;
        return (
          <div key={i} style={{ position: "relative", display: "flex", gap: 30, fontFamily: q(MONO), fontSize: 54, lineHeight: "92px", color: MINT, borderRadius: 18, padding: "0 18px", margin: "0 -18px", background: hl ? `rgba(${bad ? "255,90,95" : "255,122,0"},${0.18 + glow * 0.2})` : "transparent" }}>
            <span style={{ color: "#7d6a58", width: 34 }}>{i + 1}</span>
            <span style={{ whiteSpace: "pre" }}>{text}{cursor && <span style={{ display: "inline-block", width: 5, height: 60, background: ORANGE, marginLeft: 4, verticalAlign: "middle" }} />}</span>
          </div>
        );
      })}
    </div>
  );
};

const W = 980, H = 1340;
const RY = H - 420;
export const rocketX = (t: number) => W * 0.45 + Math.sin(t * 1.6) * W * 0.28 - 60;

/**
 * The game Pip is building, alive. Asteroids fall past the rocket (never into
 * it, except the one at `hitAt`); stars fall onto its path every 0.9 s when
 * `stars` is on; the score counts the way `score` says.
 */
export const Game: React.FC<{ t: number; crashAt?: number; hitAt?: number; hearts?: number; stars?: boolean; score?: "time" | "stuck" | "plus1" | "none"; style?: React.CSSProperties }> = ({ t, crashAt, hitAt, hearts, stars, score = "time", style }) => {
  const crashed = crashAt !== undefined && t >= crashAt;
  const ct = crashed ? t - crashAt! : 0;
  const rt = crashed ? crashAt! : t;
  const rx = rocketX(rt);
  const ry = RY + (crashed ? ct * ct * 900 : 0);
  const hitT = crashAt ?? hitAt;
  const rocks: string[] = [];
  for (let k = 0; k < 24; k++) {
    const tc = 0.6 + k * 0.75;
    const special = hitT !== undefined && Math.abs(tc - hitT) < 0.38;
    const tcx = special ? hitT! : tc;
    let x = special ? rocketX(hitT!) + 30 : rocketX(tc) + (k % 2 ? 340 : -340);
    if (!special) x = x < 20 ? x + 680 : x > W - 200 ? x - 680 : x;
    const y = RY + 40 + (t - tcx) * 700;
    if (y < -260 || y > H + 200 || (special && t > tcx + 0.05)) continue;
    rocks.push(`<g transform="translate(${x} ${y}) scale(1.7) rotate(${(t * 70 + k * 50) % 360} 55 0)">${item("asteroid", 0, 40)}</g>`);
  }
  const starTimes = stars ? Array.from({ length: 16 }, (_, k) => 0.8 + k * 0.9) : [];
  const collected = starTimes.filter((tc) => t >= tc && (!crashed || tc < crashAt!)).length;
  const starSvg = starTimes.map((tc) => {
    const x = rocketX(tc) + 60, y = RY + 30 + (t - tc) * 650;
    if (t >= tc) {
      const d = t - tc;
      return d < 0.35 ? `<circle cx="${x}" cy="${RY + 30}" r="${30 + d * 260}" fill="${YELLOW}" opacity="${0.7 * (1 - d / 0.35)}"/>` : "";
    }
    if (y < -120) return "";
    return `<path transform="translate(${x} ${y}) scale(2.2) rotate(${t * 90})" d="M0 -20 l6 13 14 1 -11 9 4 14 -13 -8 -13 8 4 -14 -11 -9 14 -1z" fill="${YELLOW}"/>`;
  }).join("");
  const sky = Array.from({ length: 46 }, (_, i) => `<circle cx="${(i * 157) % W}" cy="${(i * 97 + t * (50 + (i % 3) * 40)) % H}" r="${2 + (i % 3)}" fill="#fff" opacity="${0.3 + (i % 4) * 0.15}"/>`).join("");
  const flame = crashed ? "" : `<path d="M${rx + 92} ${ry + 240} Q${rx + 115} ${ry + 330 + Math.sin(t * 40) * 24} ${rx + 138} ${ry + 240} Z" fill="${YELLOW}"/>`;
  const hitFlash = hitAt !== undefined && t >= hitAt && t < hitAt + 0.6 && !crashed;
  const blinkHide = hitFlash && Math.floor((t - hitAt!) * 14) % 2 === 0;
  const boom = crashed && ct < 0.6 ? `<circle cx="${rx + 115}" cy="${RY + 60}" r="${60 + ct * 420}" fill="#fff" opacity="${0.85 * (1 - ct / 0.6)}"/>` : "";
  const shakeT = crashed ? ct : hitFlash ? t - hitAt! : 1;
  const shake = shakeT < 0.45 ? Math.sin(shakeT * 90) * 24 * (1 - shakeT / 0.45) : 0;
  const shown = score === "none" ? null : score === "time" ? Math.floor(rt * 3) : score === "stuck" ? (collected ? 1 : 0) : collected;
  const lives = hearts === undefined ? null : hitAt !== undefined && t >= hitAt ? hearts - 1 : hearts;
  return (
    <div style={{ position: "absolute", overflow: "hidden", borderRadius: 60, width: W, height: H, boxShadow: "0 40px 90px rgba(23,24,61,0.45)", ...style }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateX(${shake}px)` }}>
        <Svg w={W} h={H} vb={`0 0 ${W} ${H}`} html={`<defs><linearGradient id="ng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#30327a"/><stop offset="1" stop-color="#17183d"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#ng)"/>${sky}${starSvg}${rocks.join("")}${blinkHide ? "" : `${flame}<g transform="translate(${rx} ${ry}) scale(2.3) rotate(${crashed ? ct * 420 : Math.sin(rt * 1.6 + 1.57) * -12} 50 40)">${hero("rocket", 0, 0)}</g>`}${boom}`} style={{ left: 0, top: 0 }} />
      </div>
      {shown !== null && <div style={{ position: "absolute", right: 36, top: 36, padding: "14px 30px", borderRadius: 40, background: "rgba(255,255,255,0.16)", fontFamily: q(MONO), fontSize: 44, color: "#fff" }}>SCORE {shown}</div>}
      {lives !== null && <div style={{ position: "absolute", left: 36, top: 36, padding: "10px 26px", borderRadius: 40, background: "rgba(255,255,255,0.16)", fontSize: 50, color: "#ff5a6e", letterSpacing: 6 }}>{"♥".repeat(Math.max(0, lives))}<span style={{ opacity: 0.25 }}>{"♥".repeat(Math.max(0, (hearts ?? 0) - Math.max(0, lives)))}</span></div>}
    </div>
  );
};

/** Pops `game` in at `at`, shrunk to fit above the caption. */
export const GameIn: React.FC<{ at: number; out: number; scale?: number; top?: number; children: (t: number) => React.ReactNode }> = ({ at, out, scale = 0.98, top = 260, children }) => {
  const { s } = useT();
  const p = useSpringAt(at, { damping: 16, stiffness: 130 });
  if (s < at || s >= out + 0.25) return null;
  const leave = ramp(s, out, out + 0.25);
  return <div style={{ position: "absolute", left: 50, top, width: W, height: H, transformOrigin: "50% 0%", transform: `scale(${(0.6 + p * 0.4) * scale * (1 - leave * 0.2)})`, opacity: Math.min(1, p * 1.5) * (1 - leave) }}>{children(s - at)}</div>;
};

/** The cliffhanger: what's next, and the follow button. */
export const NextUp: React.FC<{ at: number; line1: string; line2: string; cta?: string; pose?: "think" | "cheer" }> = ({ at, line1, line2, cta = "Follow so you don't miss it", pose = "think" }) => {
  const { s } = useT();
  const p = useSpringAt(at + 0.5, { damping: 14, stiffness: 140 });
  if (s < at) return null;
  return (
    <>
      <div style={{ position: "absolute", left: 60, right: 60, top: 300, textAlign: "center" }}>
        <Words text={line1} at={at} size={84} color={BROWN} font={BALOO} weight={700} align="center" />
        <Words text={line2} at={at + 0.25} size={128} color={ORANGE} font={BALOO} weight={700} align="center" lineHeight={1.0} />
      </div>
      <Pip pose={pose} x={540} y={1010 + (1 - p) * 500} size={440} bounce={pose === "cheer" ? Math.abs(Math.sin(s * 5)) * 30 : 0} />
      <div style={{ position: "absolute", left: 90, right: 90, top: 1480, padding: "40px 0", borderRadius: 80, background: "linear-gradient(135deg,#ff9a3c,#ff6a00)", boxShadow: "0 24px 50px rgba(255,106,0,0.35)", textAlign: "center", fontFamily: q(NUNITO), fontWeight: 900, fontSize: 54, color: "#fff", opacity: p, transform: `translateY(${(1 - p) * 60}px)` }}>{cta}</div>
    </>
  );
};

export const Footer: React.FC = () => <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, textAlign: "center", fontFamily: q(NUNITO), fontWeight: 800, fontSize: 32, color: ORANGE_T, opacity: 0.85 }}>codeitlearn.com</div>;

/** The shared frame: fonts, backdrop, music, sting, pill and footer around an episode. */
export const Episode: React.FC<{ ep: number; title: string; children: React.ReactNode; seconds: number }> = ({ ep, title, children, seconds }) => {
  const { s } = useT();
  return (
    <AbsoluteFill>
      <Fonts />
      <Backdrop />
      {s > 0.9 && <SeriesPill ep={ep} />}
      {children}
      <Footer />
      <Sting ep={ep} title={title} />
      <Audio src={staticFile("sfx/codeit-bed.mp3")} volume={(f) => interpolate(f, [0, 20, seconds * 30 - 30, seconds * 30], [0, 0.32, 0.32, 0], { extrapolateRight: "clamp" })} />
      <Sfx at={0} src="whoosh.wav" volume={0.6} />
      <Sfx at={0.2} src="thump.wav" />
    </AbsoluteFill>
  );
};
