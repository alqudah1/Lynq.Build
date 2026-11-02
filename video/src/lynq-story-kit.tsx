import React from "react";
import { AbsoluteFill, Audio, Sequence, spring, staticFile, useVideoConfig } from "remotion";
import { VOICE } from "./voice-manifest";
import { Fonts, Sfx, ramp, useSpringAt, useT } from "./kit";

/*
 * Kit for "The shop nobody could find": a made-up bakery owner, Sami, and the four fixes that bring
 * customers back. Everything is drawn here (no photos, no real businesses, no real people), and every
 * frame carries a "made-up shop" tag so nobody takes it for a real case study.
 */

export const BK = "#0b0b0c", WH = "#ffffff", LI = "#c7ff3d", MU = "#8a8a8f", LN = "#2a2a2e", CARD = "#141416", RED = "#ff5a5f", GREEN = "#4ade80", BREAD = "#d9a25b";
export type Lang = "en" | "ar";
const q = (f: string) => `'${f}'`;
export const fontFor = (lang: Lang, weight: "light" | "bold" = "light") => (lang === "ar" ? (weight === "bold" ? "IBM Plex Sans Arabic SemiBold" : "IBM Plex Sans Arabic") : weight === "bold" ? "Inter SemiBold" : "Inter Light");

export const Svg: React.FC<{ w: number; h: number; vb: string; html: string; style?: React.CSSProperties }> = ({ w, h, vb, html, style }) => (
  <svg width={w} height={h} viewBox={vb} style={{ position: "absolute", overflow: "visible", ...style }} dangerouslySetInnerHTML={{ __html: html }} />
);

/** A line that pops in word by word. Works for English and Arabic (right to left). */
export const Say: React.FC<{ text: string; at: number; out?: number; size?: number; color?: string; accent?: string[]; lang: Lang; top: number; bold?: boolean; align?: "center" | "start" }> = ({ text, at, out, size = 84, color = WH, accent = [], lang, top, bold, align = "center" }) => {
  const { frame, fps, s } = useT();
  const gone = out !== undefined ? ramp(s, out, out + 0.25) : 0;
  if (out !== undefined && s > out + 0.3) return null;
  const words = text.split(" ");
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", left: 80, right: 80, top, textAlign: align === "center" ? "center" : lang === "ar" ? "right" : "left", fontFamily: q(fontFor(lang, bold ? "bold" : "light")), fontSize: lang === "ar" ? size * 0.92 : size, lineHeight: lang === "ar" ? 1.35 : 1.08, letterSpacing: lang === "ar" ? 0 : -2, color, opacity: 1 - gone, transform: `translateY(${-gone * 30}px)` }}>
      {words.map((w, i) => {
        const p = at < 0 ? 1 : spring({ frame: frame - Math.round((at + i * 0.08) * fps), fps, config: { damping: 12, stiffness: 220, mass: 0.6 } });
        const hit = accent.includes(w.replace(/[.,!?؟،:]/g, ""));
        return <span key={i} style={{ display: "inline-block", margin: "0 0.12em", opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 36}px)`, color: hit ? LI : undefined }}>{w}</span>;
      })}
    </div>
  );
};

/** Sami, the made-up owner. Flat shapes only. `x, y` is the point between his feet. */
export const Sami: React.FC<{ x: number; y: number; size?: number; pose?: "neutral" | "worried" | "happy" | "phone" | "busy"; bob?: number }> = ({ x, y, size = 1, pose = "neutral", bob = 0 }) => {
  const { s } = useT();
  const blink = Math.floor(s * 10) % 37 === 0;
  const eyeY = -352;
  const brows = pose === "worried" || pose === "busy" ? `<path d="M-48 -392 L-18 -382 M48 -392 L18 -382" stroke="#1c1a19" stroke-width="9" stroke-linecap="round"/>` : `<path d="M-48 -386 L-18 -388 M48 -386 L18 -388" stroke="#1c1a19" stroke-width="9" stroke-linecap="round"/>`;
  const mouth = pose === "happy" ? `<path d="M-34 -300 Q0 -266 34 -300" stroke="#3a1d12" stroke-width="9" fill="none" stroke-linecap="round"/>` : pose === "worried" || pose === "busy" ? `<path d="M-26 -290 Q0 -306 26 -290" stroke="#3a1d12" stroke-width="9" fill="none" stroke-linecap="round"/>` : `<path d="M-24 -296 L24 -296" stroke="#3a1d12" stroke-width="9" stroke-linecap="round"/>`;
  const eyes = blink ? `<path d="M-38 ${eyeY} h18 M20 ${eyeY} h18" stroke="#1c1a19" stroke-width="7" stroke-linecap="round"/>` : `<circle cx="-30" cy="${eyeY}" r="9" fill="#1c1a19"/><circle cx="30" cy="${eyeY}" r="9" fill="#1c1a19"/>`;
  const wave = pose === "busy" ? Math.sin(s * 14) * 18 : 0;
  const armL = pose === "happy" ? `<rect x="-168" y="-250" width="52" height="190" rx="26" fill="#2b2f3a" transform="rotate(${30 + Math.sin(s * 6) * 6} -142 -240)"/>` : `<rect x="-160" y="-230" width="52" height="200" rx="26" fill="#2b2f3a" transform="rotate(${8 + wave} -134 -220)"/>`;
  const armR = pose === "phone"
    ? `<rect x="108" y="-250" width="52" height="170" rx="26" fill="#2b2f3a" transform="rotate(-150 134 -240)"/><rect x="40" y="-430" width="62" height="110" rx="12" fill="#050506" stroke="#444" stroke-width="4"/>`
    : pose === "happy" ? `<rect x="116" y="-250" width="52" height="190" rx="26" fill="#2b2f3a" transform="rotate(${-30 - Math.sin(s * 6) * 6} 142 -240)"/>` : `<rect x="108" y="-230" width="52" height="200" rx="26" fill="#2b2f3a" transform="rotate(${-8 - wave} 134 -220)"/>`;
  const html = `
    <rect x="-70" y="-60" width="56" height="60" rx="14" fill="#1b1d24"/><rect x="14" y="-60" width="56" height="60" rx="14" fill="#1b1d24"/>
    ${armL}${armR}
    <rect x="-125" y="-260" width="250" height="230" rx="70" fill="#2b2f3a"/>
    <path d="M-86 -236 H86 V-40 Q0 -20 -86 -40 Z" fill="#f2efe8"/>
    <path d="M-86 -236 L-40 -262 M86 -236 L40 -262" stroke="${LI}" stroke-width="12" stroke-linecap="round"/>
    <rect x="-34" y="-282" width="68" height="40" rx="16" fill="#b97a52"/>
    <circle cx="0" cy="-350" r="96" fill="#c98b62"/>
    <path d="M-96 -360 Q-92 -452 0 -456 Q92 -452 96 -360 Q70 -410 0 -412 Q-70 -410 -96 -360 Z" fill="#1c1a19"/>
    <circle cx="-96" cy="-344" r="16" fill="#b97a52"/><circle cx="96" cy="-344" r="16" fill="#b97a52"/>
    ${brows}${eyes}${mouth}`;
  return <Svg w={10} h={10} vb="0 0 10 10" html={html} style={{ left: x, top: y - bob, transform: `scale(${size})`, transformOrigin: "0 0" }} />;
};

/** Inside the bakery: shelves of bread, the counter, and Sami behind it. */
export const Bakery: React.FC<{ pose?: "neutral" | "worried" | "happy" | "phone" | "busy"; sign?: "open" | "closed"; children?: React.ReactNode; top?: number }> = ({ pose = "neutral", sign = "open", children, top = 0 }) => {
  const { s } = useT();
  const loaves = Array.from({ length: 10 }, (_, i) => {
    const row = i < 5 ? 0 : 1, col = i % 5;
    return `<ellipse cx="${180 + col * 180}" cy="${row ? 700 : 520}" rx="62" ry="34" fill="${BREAD}"/><path d="M${150 + col * 180} ${(row ? 700 : 520) - 6} q14 -14 28 0 m10 0 q14 -14 28 0" stroke="#a8713a" stroke-width="6" fill="none"/>`;
  }).join("");
  const html = `
    <rect x="80" y="420" width="920" height="420" rx="30" fill="${CARD}" stroke="${LN}" stroke-width="2"/>
    <rect x="110" y="556" width="860" height="10" fill="#2e2e33"/><rect x="110" y="736" width="860" height="10" fill="#2e2e33"/>
    ${loaves}`;
  return (
    <div style={{ position: "absolute", left: 0, top, width: 1080, height: 1920 }}>
      <Svg w={1080} h={1920} vb="0 0 1080 1920" html={html} style={{ left: 0, top: 0 }} />
      <Sign at={0} state={sign} x={790} y={330} />
      <Sami x={540} y={1330} size={1.05} pose={pose} bob={pose === "happy" ? Math.abs(Math.sin(s * 5)) * 14 : 0} />
      <div style={{ position: "absolute", left: 60, right: 60, top: 1240, height: 260, borderRadius: 30, background: "#1a1a1d", boxShadow: "0 -20px 60px rgba(0,0,0,0.5)", borderTop: `6px solid ${LI}` }} />
      {children}
    </div>
  );
};

/** The hanging OPEN / CLOSED sign. */
export const Sign: React.FC<{ at: number; state: "open" | "closed"; x: number; y: number }> = ({ state, x, y }) => {
  const { s } = useT();
  const sway = Math.sin(s * 2.2) * 3;
  const open = state === "open";
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `rotate(${sway}deg)`, transformOrigin: "50% -60px" }}>
      <Svg w={240} h={200} vb="0 0 240 200" html={`<path d="M60 0 L120 -60 L180 0" stroke="#55555b" stroke-width="5" fill="none"/>`} style={{ left: 0, top: 0 }} />
      <div style={{ width: 240, height: 100, borderRadius: 16, background: open ? LI : "#2a2a2e", color: open ? BK : MU, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: q("JetBrains Mono"), fontSize: 46, letterSpacing: 6 }}>{open ? "OPEN" : "CLOSED"}</div>
    </div>
  );
};

/** A phone that slides up, with whatever screen it is given. */
export const Phone: React.FC<{ at: number; out?: number; children: React.ReactNode; x?: number; y?: number; scale?: number; shake?: boolean }> = ({ at, out, children, x = 250, y = 470, scale = 1, shake }) => {
  const { s } = useT();
  const sp = useSpringAt(at, { damping: 16, stiffness: 130 });
  const p = at < 0 ? 1 : sp;
  if (s < at || (out !== undefined && s > out + 0.3)) return null;
  const leave = out !== undefined ? ramp(s, out, out + 0.3) : 0;
  const jig = shake ? Math.sin(s * 70) * 6 : 0;
  return (
    <div style={{ position: "absolute", left: x + jig, top: y + (1 - p) * 1300 + leave * 1300, width: 580, height: 1180, borderRadius: 86, background: "#161618", boxShadow: "0 60px 120px rgba(0,0,0,0.7), inset 0 0 0 3px #2e2e33", transform: `scale(${scale})`, transformOrigin: "50% 0" }}>
      <div style={{ position: "absolute", left: 18, top: 18, right: 18, bottom: 18, borderRadius: 70, overflow: "hidden", background: "#0f0f11" }}>{children}</div>
      <div style={{ position: "absolute", left: 230, top: 34, width: 120, height: 34, borderRadius: 17, background: "#050506" }} />
    </div>
  );
};

const stars = (n: number, size = 30) => Array.from({ length: 5 }, (_, i) => <span key={i} style={{ color: i < Math.round(n) ? "#fbbf24" : "#3a3a40", fontSize: size }}>★</span>);

/** A maps-style search result for the shop (generic, no real map brand). */
export const MapCard: React.FC<{ status: "closed" | "open" | "editing"; rating?: number; reviews?: number; lang: Lang; tx: Record<string, string>; editAt?: number }> = ({ status, rating = 3.1, reviews = 27, lang, tx, editAt = 0 }) => {
  const { s } = useT();
  const blink = status === "closed" ? 0.55 + Math.sin(s * 8) * 0.45 : 1;
  const edited = status === "editing" && s > editAt;
  const isOpen = status === "open" || edited;
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ padding: "120px 30px 0", fontFamily: q(fontFor(lang)) }}>
      <div style={{ borderRadius: 40, background: "#1c1c1f", padding: "22px 28px", color: MU, fontSize: 28 }}>🔍 {tx.search}</div>
      <div style={{ height: 300, marginTop: 24, borderRadius: 30, background: "repeating-linear-gradient(45deg,#17171a 0 30px,#1b1b1f 30px 60px)", position: "relative" }}>
        <div style={{ position: "absolute", left: "46%", top: 110, width: 50, height: 50, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)", background: RED }} />
      </div>
      <div style={{ marginTop: 24, borderRadius: 30, background: "#1c1c1f", padding: 28 }}>
        <div style={{ fontFamily: q(fontFor(lang, "bold")), fontSize: 40, color: WH }}>{tx.shop}</div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, color: "#d4d4d8", fontSize: 28 }}><span>{rating.toFixed(1)}</span>{stars(rating)}<span style={{ color: MU }}>({reviews})</span></div>
        <div style={{ marginTop: 18, fontFamily: q(fontFor(lang, "bold")), fontSize: 38, color: isOpen ? GREEN : RED, opacity: isOpen ? 1 : blink }}>{isOpen ? tx.openNow : tx.closedNow}</div>
        <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
          {[tx.directions, tx.call, tx.website].map((b) => <div key={b} style={{ flex: 1, padding: "18px 0", borderRadius: 24, background: "#2a2a2e", textAlign: "center", color: WH, fontSize: 24 }}>{b}</div>)}
        </div>
      </div>
    </div>
  );
};

/** The old website: tiny type, a broken picture, and a spinner that never finishes. */
export const OldSite: React.FC<{ loadingFrom?: number; lang: Lang; tx: Record<string, string> }> = ({ loadingFrom, lang, tx }) => {
  const { s } = useT();
  const loading = loadingFrom !== undefined && s >= loadingFrom;
  const secs = loading ? Math.min(9, Math.floor((s - loadingFrom!) * 2.2) + 1) : 0;
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", inset: 0, background: "#f4f4f0", padding: "120px 30px 0", fontFamily: "Times New Roman, serif", color: "#222" }}>
      <div style={{ fontSize: 34, color: "#1d3fbf", textDecoration: "underline", fontWeight: 700 }}>{tx.oldTitle}</div>
      <div style={{ marginTop: 20, width: 220, height: 160, border: "3px solid #999", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60, color: "#c00" }}>✕</div>
      <div style={{ marginTop: 20, fontSize: 22, lineHeight: 1.3 }}>{tx.oldBody}</div>
      <div style={{ marginTop: 30, fontSize: 18, color: "#777" }}>© 2014</div>
      {loading && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,12,0.72)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30 }}>
          <div style={{ width: 110, height: 110, borderRadius: 55, border: "10px solid #333", borderTopColor: WH, transform: `rotate(${s * 400}deg)` }} />
          <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 44, color: WH }}>{tx.loading} {secs}s</div>
        </div>
      )}
    </div>
  );
};

/** The new website: loads at once, hours, menu and one button. */
export const NewSite: React.FC<{ lang: Lang; tx: Record<string, string>; scrollAt?: number; pressAt?: number }> = ({ lang, tx, scrollAt = 99, pressAt }) => {
  const { s } = useT();
  const scroll = ramp(s, scrollAt, scrollAt + 1.6) * 380;
  const pressed = pressAt !== undefined && s > pressAt && s < pressAt + 0.25;
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", inset: 0, background: "#0f0f11", fontFamily: q(fontFor(lang)), color: WH }}>
      <div style={{ transform: `translateY(${-scroll}px)` }}>
        <div style={{ height: 520, background: `radial-gradient(80% 70% at 50% 60%, #3a2a17 0%, #141416 75%)`, position: "relative", paddingTop: 120 }}>
          <Svg w={540} h={400} vb="0 0 540 400" html={`<ellipse cx="270" cy="270" rx="170" ry="80" fill="${BREAD}"/><path d="M170 255 q25 -25 50 0 m20 0 q25 -25 50 0 m20 0 q25 -25 50 0" stroke="#a8713a" stroke-width="10" fill="none"/>`} style={{ left: 0, top: 40 }} />
          <div style={{ position: "absolute", left: 30, right: 30, bottom: 30, fontFamily: q(fontFor(lang, "bold")), fontSize: 52 }}>{tx.shop}</div>
        </div>
        <div style={{ padding: 30 }}>
          <div style={{ fontSize: 32, color: "#d4d4d8" }}>{tx.newTag}</div>
          <div style={{ display: "flex", gap: 14, marginTop: 26 }}>
            <div style={{ flex: 1, padding: "26px 0", borderRadius: 26, background: LI, color: BK, textAlign: "center", fontFamily: q(fontFor(lang, "bold")), fontSize: 34, transform: pressed ? "scale(0.94)" : "none" }}>{tx.order}</div>
            <div style={{ flex: 1, padding: "26px 0", borderRadius: 26, background: "#2a2a2e", textAlign: "center", fontSize: 34 }}>{tx.call}</div>
          </div>
          <div style={{ marginTop: 34, fontFamily: q("JetBrains Mono"), fontSize: 24, letterSpacing: 3, color: MU }}>{tx.hoursLabel}</div>
          <div style={{ marginTop: 10, fontSize: 32 }}>{tx.hours}</div>
          <div style={{ marginTop: 34, fontFamily: q("JetBrains Mono"), fontSize: 24, letterSpacing: 3, color: MU }}>{tx.menuLabel}</div>
          {tx.menu.split("|").map((m) => <div key={m} style={{ marginTop: 14, padding: "20px 24px", borderRadius: 20, background: "#1c1c1f", fontSize: 30 }}>{m}</div>)}
        </div>
      </div>
    </div>
  );
};

/** Reviews screen: the rating, the bad review, and (from `replyAt`) the owner's reply typing out. */
export const Reviews: React.FC<{ rating: number; lang: Lang; tx: Record<string, string>; replyAt?: number }> = ({ rating, lang, tx, replyAt }) => {
  const { s } = useT();
  const reply = replyAt !== undefined && s >= replyAt ? tx.reply.slice(0, Math.floor((s - replyAt) * 34)) : "";
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ padding: "120px 30px 0", fontFamily: q(fontFor(lang)), color: WH }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ fontFamily: q("Inter SemiBold"), fontSize: 120, color: WH }}>{rating.toFixed(1)}</div>
        <div>{stars(rating, 44)}<div style={{ color: MU, fontSize: 26 }}>{tx.reviewsCount}</div></div>
      </div>
      <div style={{ marginTop: 30, borderRadius: 30, background: "#1c1c1f", padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28 }}><span style={{ fontFamily: q(fontFor(lang, "bold")) }}>{tx.reviewer}</span><span>{stars(1, 26)}</span></div>
        <div style={{ marginTop: 14, fontSize: 30, lineHeight: 1.35, color: "#d4d4d8" }}>{tx.badReview}</div>
        <div style={{ marginTop: 14, fontSize: 24, color: reply ? MU : RED }}>{tx.noReply}</div>
        {reply && <div style={{ marginTop: 20, padding: 22, borderRadius: 22, background: "#222226", borderInlineStart: `6px solid ${LI}`, fontSize: 28, lineHeight: 1.35 }}><div style={{ color: LI, fontSize: 22, marginBottom: 8 }}>{tx.ownerLabel}</div>{reply}</div>}
      </div>
    </div>
  );
};

/** Calls: an incoming call shaking, and a missed-call count climbing. */
export const Calls: React.FC<{ from: number; lang: Lang; tx: Record<string, string> }> = ({ from, lang, tx }) => {
  const { s } = useT();
  const n = Math.max(0, Math.min(9, Math.floor((s - from) * 2.4) + 1));
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ padding: "160px 30px 0", fontFamily: q(fontFor(lang)), color: WH, textAlign: "center" }}>
      <div style={{ fontSize: 30, color: MU }}>{tx.incoming}</div>
      <div style={{ marginTop: 20, fontFamily: q(fontFor(lang, "bold")), fontSize: 50 }}>{tx.unknown}</div>
      <div style={{ margin: "60px auto 0", width: 160, height: 160, borderRadius: 80, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 80, transform: `rotate(${Math.sin(s * 40) * 12}deg)` }}>📞</div>
      <div style={{ marginTop: 80, padding: 28, borderRadius: 30, background: "#1c1c1f", fontSize: 34, color: RED }}>{tx.missed} ×{n}</div>
    </div>
  );
};

/** Orders: notifications stacking up, quietly. */
export const Orders: React.FC<{ from: number; lang: Lang; tx: Record<string, string> }> = ({ from, lang, tx }) => {
  const items = tx.orders.split("|");
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ padding: "130px 26px 0", fontFamily: q(fontFor(lang)), color: WH }}>
      {items.map((o, i) => {
        const p = useSpringAt(from + i * 0.7, { damping: 13, stiffness: 200 });
        return (
          <div key={i} style={{ marginBottom: 18, padding: "24px 26px", borderRadius: 28, background: "#1c1c1f", opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * -60}px) scale(${0.9 + p * 0.1})` }}>
            <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 20, letterSpacing: 2, color: LI }}>{tx.newOrder}</div>
            <div style={{ marginTop: 8, fontSize: 30 }}>{o}</div>
          </div>
        );
      })}
    </div>
  );
};

/** People walking along the street. `enter` makes them turn in at the door. */
export const Walkers: React.FC<{ from: number; n?: number; enter?: boolean; y?: number }> = ({ from, n = 4, enter, y = 1300 }) => {
  const { s } = useT();
  const html = Array.from({ length: n }, (_, i) => {
    const t = s - from - i * 0.8;
    if (t < 0) return "";
    const x = enter ? Math.min(560, -120 + t * 520) : -120 + t * 420;
    const fade = enter && x >= 560 ? Math.max(0, 1 - (t - 680 / 520) * 3) : 1;
    if (x > 1200 || fade <= 0) return "";
    const step = Math.sin(t * 10) * 10;
    const sc = 0.85 + (i % 3) * 0.12;
    return `<g transform="translate(${x} ${y + (i % 2) * 40}) scale(${sc})" opacity="${0.85 * fade}"><circle cx="0" cy="-250" r="46" fill="#3a3a40"/><rect x="-56" y="-196" width="112" height="150" rx="40" fill="#2e2e33"/><rect x="-46" y="-56" width="34" height="${70 + step}" rx="14" fill="#26262a"/><rect x="12" y="-56" width="34" height="${70 - step}" rx="14" fill="#26262a"/></g>`;
  }).join("");
  return <Svg w={1080} h={1920} vb="0 0 1080 1920" html={html} style={{ left: 0, top: 0 }} />;
};

/** The shop from the street: awning, window with Sami inside, the door and its sign. */
export const Street: React.FC<{ sign: "open" | "closed"; pose?: "neutral" | "worried" | "happy" }> = ({ sign, pose = "neutral" }) => {
  const stripes = Array.from({ length: 9 }, (_, i) => `<rect x="${110 + i * 96}" y="420" width="48" height="110" fill="${i % 2 ? "#1f1f22" : "#e8e6df"}"/>`).join("");
  const html = `<rect x="80" y="400" width="920" height="900" rx="24" fill="#18181b"/>${stripes}<path d="M110 530 h862 l-30 40 h-802 z" fill="#2a2a2e"/>
    <rect x="130" y="640" width="500" height="460" rx="18" fill="#1d2230" stroke="#33333a" stroke-width="6"/>
    <rect x="700" y="640" width="240" height="660" rx="16" fill="#26262a" stroke="#33333a" stroke-width="6"/><circle cx="910" cy="980" r="12" fill="${LI}"/>
    <rect x="0" y="1300" width="1080" height="400" fill="#121214"/><rect x="0" y="1300" width="1080" height="8" fill="#2a2a2e"/>`;
  return (
    <>
      <Svg w={1080} h={1920} vb="0 0 1080 1920" html={html} style={{ left: 0, top: 0 }} />
      <div style={{ position: "absolute", left: 130, top: 640, width: 500, height: 460, overflow: "hidden", borderRadius: 18 }}><Sami x={250} y={600} size={0.62} pose={pose} /></div>
      <div style={{ position: "absolute", left: 152, top: 590, fontFamily: q("JetBrains Mono"), fontSize: 30, letterSpacing: 6, color: WH }}>SAMI'S BAKERY</div>
      <div style={{ transform: "scale(0.7)", transformOrigin: "820px 760px" }}><Sign at={0} state={sign} x={700} y={720} /></div>
    </>
  );
};

/** The shared frame: background, the made-up tag, the series label, music, and a progress line. */
export const StoryFrame: React.FC<{ ep: number; seconds: number; lang: Lang; tx: Record<string, string>; children: React.ReactNode }> = ({ ep, seconds, lang, tx, children }) => {
  const { s } = useT();
  const { fps } = useVideoConfig();
  const voice = VOICE[`lynq-story-${ep}${lang === "ar" ? "-ar" : ""}`] ?? [];
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 25% 12%, #1d1d21 0%, ${BK} 60%)` }}>
      <Fonts />
      {children}
      <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", left: 90, right: 90, top: 110, display: "flex", justifyContent: "space-between", fontFamily: q(lang === "ar" ? fontFor(lang) : "JetBrains Mono"), fontSize: 26, letterSpacing: lang === "ar" ? 0 : 4, color: MU }}>
        <span style={{ color: WH }}>LYNQ</span><span>{tx.series} · {ep}/5</span>
      </div>
      <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", left: 0, right: 0, top: 165, display: "flex", justifyContent: "center" }}>
        <div style={{ padding: "8px 22px", borderRadius: 30, border: `1px solid ${LN}`, fontFamily: q(lang === "ar" ? fontFor(lang) : "JetBrains Mono"), fontSize: 22, letterSpacing: lang === "ar" ? 0 : 3, color: MU }}>{tx.madeUp}</div>
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, bottom: 150, height: 2, background: LN }}><div style={{ width: `${Math.min(1, s / seconds) * 100}%`, height: 2, background: LI }} /></div>
      <div style={{ position: "absolute", left: 90, bottom: 95, fontFamily: q("JetBrains Mono"), fontSize: 24, letterSpacing: 4, color: MU }}>LYNQ.BUILD</div>
      {voice.length > 0 && <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", left: 0, right: 0, top: 215, textAlign: "center", fontFamily: q(fontFor(lang)), fontSize: 20, color: MU }}>{tx.aiVoice}</div>}
      {voice.map((v) => <Sequence key={v.src} from={Math.round(v.at * fps)} layout="none"><Audio src={staticFile(v.src)} volume={1} /></Sequence>)}
      <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={voice.length ? 0.16 : 0.3} />
    </AbsoluteFill>
  );
};

/** Small pill over the action (no dead end card). */
export const Tag: React.FC<{ text: string; at: number; top: number; lang: Lang }> = ({ text, at, top, lang }) => {
  const p = useSpringAt(at, { damping: 12, stiffness: 200 });
  const { s } = useT();
  if (s < at) return null;
  return <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center", opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}><div dir={lang === "ar" ? "rtl" : "ltr"} style={{ padding: "20px 46px", borderRadius: 60, background: LI, fontFamily: q(fontFor(lang, "bold")), fontSize: 40, color: BK }}>{text}</div></div>;
};

export { Sfx, ramp, useSpringAt, useT };
