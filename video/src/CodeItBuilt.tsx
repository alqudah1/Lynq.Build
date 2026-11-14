import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts, ramp, useSpringAt, useT } from "./kit";

/*
 * CodeIt reel, built the same way as the LYNQ money reel: everything is drawn here, nothing is
 * AI-made, no faces. A kid tells it in the first person: typed one sentence on codeitlearn.com,
 * got a game, opened the code, changed one number, and now the cat is far too fast.
 * Cream, yellow and coral only. No brown. 1080x1920, 17.5s. Silent build first.
 */

const CREAM = "#fff4e5", INK = "#16161d", CORAL = "#f0562d", YELLOW = "#fed340", SKY = "#bfe6ff";
const B = "'Baloo 2'", N = "'Nunito'", M = "'JetBrains Mono'";
const ss = (x: number) => x * x * (3 - 2 * x);
const IDEA = "a cat that catches falling fish";

// browser window on the canvas
const WX = 60, WY = 500, WW = 960, WH = 1130, BAR = 92;

const Cat: React.FC<{ x: number; lean: number }> = ({ x, lean }) => (
  <div style={{ position: "absolute", left: x - 80, bottom: 46, width: 160, height: 130, transform: `rotate(${lean}deg)`, transformOrigin: "50% 100%" }}>
    <div style={{ position: "absolute", left: 14, top: 0, width: 0, height: 0, borderLeft: "24px solid transparent", borderRight: "24px solid transparent", borderBottom: "44px solid #ff9a3d" }} />
    <div style={{ position: "absolute", right: 14, top: 0, width: 0, height: 0, borderLeft: "24px solid transparent", borderRight: "24px solid transparent", borderBottom: "44px solid #ff9a3d" }} />
    <div style={{ position: "absolute", left: 0, top: 26, width: 160, height: 104, borderRadius: 52, background: "#ff9a3d", border: `5px solid ${INK}`, boxSizing: "border-box" }} />
    <div style={{ position: "absolute", left: 44, top: 62, width: 16, height: 22, borderRadius: 10, background: INK }} />
    <div style={{ position: "absolute", right: 44, top: 62, width: 16, height: 22, borderRadius: 10, background: INK }} />
    <div style={{ position: "absolute", left: 70, top: 90, width: 20, height: 12, borderRadius: "0 0 12px 12px", background: INK }} />
  </div>
);

const Fish: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <div style={{ position: "absolute", left: x - 36, top: y, width: 72, height: 40 }}>
    <div style={{ position: "absolute", left: 0, top: 4, width: 54, height: 32, borderRadius: 18, background: "#3f7cff", border: `4px solid ${INK}`, boxSizing: "border-box" }} />
    <div style={{ position: "absolute", right: 0, top: 6, width: 0, height: 0, borderTop: "14px solid transparent", borderBottom: "14px solid transparent", borderRight: `24px solid #3f7cff` }} />
    <div style={{ position: "absolute", left: 12, top: 14, width: 7, height: 7, borderRadius: 4, background: INK }} />
  </div>
);

/** The game the sentence made. `fast` is what happens after the number is changed. */
const Game: React.FC<{ from: number; fast?: boolean }> = ({ from, fast }) => {
  const { s } = useT();
  const t = Math.max(0, s - from);
  const H = WH - BAR - 96;
  const w = fast ? 11 : 1.5;
  const amp = fast ? 400 : 250;
  const x = WW / 2 + Math.sin(t * w) * amp;
  const lean = Math.cos(t * w) * (fast ? 16 : 5);
  const score = fast ? 3 + Math.floor(t * 7) : Math.floor(t / 1.3);
  return (
    <div style={{ position: "absolute", left: 0, top: 96, width: WW, height: H, overflow: "hidden", background: `linear-gradient(180deg, ${SKY} 0%, #e6f6ff 100%)` }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Fish key={i} x={110 + i * 185} y={((t * (fast ? 520 : 240) + i * 230) % (H + 60)) - 60} />
      ))}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 52, background: "#7ed957", borderTop: `5px solid ${INK}` }} />
      <Cat x={x} lean={lean} />
      {fast && [1, 2, 3].map((k) => <div key={k} style={{ position: "absolute", left: x - 80 - Math.cos(t * w) * k * 46, bottom: 60, width: 150, height: 100, borderRadius: 50, background: "#ff9a3d", opacity: 0.16 / k }} />)}
      <div style={{ position: "absolute", left: 30, top: 26, padding: "10px 26px", borderRadius: 30, background: "#fff", border: `4px solid ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 40, color: INK }}>Score {score}</div>
    </div>
  );
};

const Tabs: React.FC<{ on: "Play" | "Code" }> = ({ on }) => (
  <div style={{ position: "absolute", left: 0, top: 0, width: WW, height: 96, display: "flex", alignItems: "center", gap: 14, padding: "0 30px", boxSizing: "border-box", background: "#fff", borderBottom: `4px solid ${INK}` }}>
    {(["Play", "Code"] as const).map((t) => (
      <div key={t} style={{ padding: "10px 34px", borderRadius: 30, fontFamily: B, fontWeight: 800, fontSize: 36, background: t === on ? YELLOW : "transparent", border: `4px solid ${t === on ? INK : "transparent"}`, color: INK }}>{t}</div>
    ))}
    <div style={{ marginLeft: "auto", fontFamily: N, fontWeight: 800, fontSize: 28, color: "rgba(22,22,29,0.55)" }}>Cat and fish</div>
  </div>
);

const Builder: React.FC = () => {
  const { s } = useT();
  const typed = IDEA.slice(0, Math.max(0, Math.floor((s - 0.9) * 13)));
  const press = s > 3.9 && s < 4.15;
  const busy = ramp(s, 4.15, 4.4);
  return (
    <div style={{ padding: "54px 50px 0" }}>
      <div style={{ fontFamily: N, fontWeight: 900, fontSize: 28, letterSpacing: 5, color: CORAL }}>MAKE A GAME</div>
      <div style={{ marginTop: 10, fontFamily: B, fontWeight: 800, fontSize: 92, lineHeight: 1.0, color: INK }}>Say a game.<br />Get a game.</div>
      <div style={{ marginTop: 44, padding: "34px 34px 40px", borderRadius: 40, background: INK }}>
        <div style={{ fontFamily: N, fontWeight: 800, fontSize: 26, letterSpacing: 4, color: "rgba(255,255,255,0.7)" }}>WHAT DO YOU WANT TO BUILD?</div>
        <div style={{ marginTop: 20, padding: "30px 32px", minHeight: 150, borderRadius: 28, background: CREAM, border: `5px solid ${YELLOW}`, fontFamily: N, fontWeight: 800, fontSize: 50, lineHeight: 1.2, color: INK, boxSizing: "border-box" }}>
          {typed}<span style={{ display: "inline-block", width: 5, height: 52, marginLeft: 4, background: INK, verticalAlign: "middle", opacity: Math.floor(s * 3) % 2 ? 1 : 0.15 }} />
        </div>
        <div style={{ marginTop: 26, display: "inline-flex", alignItems: "center", gap: 16, padding: "22px 54px", borderRadius: 60, background: YELLOW, fontFamily: B, fontWeight: 800, fontSize: 50, color: INK, transform: `scale(${press ? 0.93 : 1})` }}>
          {busy > 0.5 ? "Building" + ".".repeat(1 + (Math.floor(s * 4) % 3)) : "Build it →"}
        </div>
      </div>
      <div style={{ marginTop: 44, fontFamily: N, fontWeight: 900, fontSize: 26, letterSpacing: 4, color: "rgba(22,22,29,0.5)" }}>OR START FROM ONE OF THESE</div>
      <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 16 }}>
        {["Space dodger", "Maze runner", "Pong", "Snake", "Brick breaker"].map((t, i) => (
          <span key={t} style={{ padding: "16px 30px", borderRadius: 40, background: i % 2 ? "#fff" : "#ffe9b0", border: `4px solid ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 36, color: INK }}>{t}</span>
        ))}
      </div>
    </div>
  );
};

const Code: React.FC = () => {
  const { s } = useT();
  const changed = s >= 10.7;
  const pop = useSpringAt(10.7, { damping: 8, stiffness: 200 });
  const sel = ramp(s, 9.7, 10.0) * (1 - ramp(s, 11.6, 11.9));
  const K = "#ff9ecb", Nn = "#fed340", V = "#9ad8ff", T = "#e9e9f2", G = "rgba(255,255,255,0.35)";
  const row = (n: number, kids: React.ReactNode) => (
    <div style={{ display: "flex", height: 78, alignItems: "center" }}><span style={{ width: 70, color: G }}>{n}</span>{kids}</div>
  );
  return (
    <div style={{ position: "absolute", left: 0, top: 96, width: WW, height: WH - BAR - 96, background: INK, padding: "44px 40px", boxSizing: "border-box", fontFamily: M, fontSize: 46, color: T }}>
      {row(1, <><span style={{ color: K }}>let</span>&nbsp;<span style={{ color: V }}>catSpeed</span>&nbsp;=&nbsp;
        <span style={{ display: "inline-block", minWidth: 40, textAlign: "center", padding: "0 12px", borderRadius: 12, background: `rgba(254,211,64,${0.28 * sel})`, outline: `4px solid rgba(254,211,64,${sel})`, color: Nn, transform: `scale(${changed ? 0.7 + 0.3 * pop : 1})` }}>{changed ? 9 : 3}</span>;</>)}
      {row(2, <><span style={{ color: K }}>let</span>&nbsp;<span style={{ color: V }}>fishFall</span>&nbsp;= <span style={{ color: Nn }}>&nbsp;2</span>;</>)}
      {row(3, null)}
      {row(4, <><span style={{ color: K }}>if</span>&nbsp;(cat.<span style={{ color: V }}>touches</span>(fish)) {"{"}</>)}
      {row(5, <>&nbsp;&nbsp;score = score +&nbsp;<span style={{ color: Nn }}>1</span>;</>)}
      {row(6, <>{"}"}</>)}
      <div style={{ position: "absolute", left: 40, bottom: 44, padding: "16px 30px", borderRadius: 24, background: "rgba(255,255,255,0.08)", fontFamily: N, fontWeight: 800, fontSize: 32, color: "rgba(255,255,255,0.75)", opacity: ramp(s, 9.3, 9.7) }}>This is the real code behind the game.</div>
    </div>
  );
};

const Say: React.FC<{ text: string; at: number; out: number; hot?: string[]; size?: number }> = ({ text, at, out, hot = [], size = 84 }) => {
  const { s, frame, fps } = useT();
  if (s < at || s > out + 0.3) return null;
  const gone = ramp(s, out, out + 0.3);
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top: 250, height: 220, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: size, lineHeight: 1.02, color: INK, opacity: 1 - gone }}>
      <div>
        {text.split(" ").map((w, i) => {
          const p = Math.max(0, Math.min(1, (frame - Math.round((at + i * 0.07) * fps)) / 6));
          return <span key={i} style={{ display: "inline-block", margin: "0 0.12em", opacity: p, transform: `translateY(${(1 - p) * 18}px) scale(${0.9 + 0.1 * p})`, color: hot.includes(w.replace(/[.,!?]/g, "")) ? CORAL : undefined }}>{w}</span>;
        })}
      </div>
    </div>
  );
};

export const CodeItBuilt: React.FC = () => {
  const { s } = useT();
  const hookOut = ramp(s, 2.4, 2.8);
  const toGame = ramp(s, 5.0, 5.4, 0, 1, ss);
  const toCode = ramp(s, 8.9, 9.3, 0, 1, ss);
  const toFast = ramp(s, 12.3, 12.7, 0, 1, ss);
  const end = ramp(s, 15.0, 15.6, 0, 1, ss);
  const logo = useSpringAt(15.3, { damping: 12, stiffness: 140 });
  const shake = s > 12.7 && s < 15 ? Math.sin(s * 60) * 3 : 0;
  const float = Math.sin(s * 1.1) * 5;
  return (
    <AbsoluteFill style={{ background: CREAM, overflow: "hidden" }}>
      <Fonts />
      <div style={{ position: "absolute", left: -200, top: -160, width: 900, height: 900, borderRadius: 450, background: "radial-gradient(closest-side, rgba(254,211,64,0.55) 0%, rgba(254,211,64,0) 100%)" }} />
      <div style={{ position: "absolute", right: -260, bottom: -200, width: 900, height: 900, borderRadius: 450, background: "radial-gradient(closest-side, rgba(240,86,45,0.20) 0%, rgba(240,86,45,0) 100%)" }} />

      <Img src={staticFile("ads/codeit-logo.png")} style={{ position: "absolute", left: 60, top: 120, width: 190, opacity: 1 - end }} />
      <div style={{ position: "absolute", right: 60, top: 166, fontFamily: N, fontWeight: 900, fontSize: 22, letterSpacing: 4, color: "rgba(22,22,29,0.5)", opacity: 1 - end }}>MADE-UP STORY</div>

      {s < 2.9 && (
        <div style={{ position: "absolute", left: 60, right: 60, top: 258, textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: 124, lineHeight: 0.95, color: INK, opacity: 1 - hookOut, transform: `translateY(${-hookOut * 20}px)` }}>
          I typed <span style={{ color: CORAL }}>one sentence.</span>
        </div>
      )}
      <Say text="A cat that catches falling fish." at={2.9} out={4.9} hot={["cat", "fish"]} size={76} />
      <Say text="It made my game." at={5.4} out={8.7} hot={["my", "game"]} size={104} />
      <Say text="Then I changed one number." at={9.2} out={12.2} hot={["one", "number"]} />
      <Say text="Now my cat is way too fast." at={12.8} out={14.9} hot={["way", "too", "fast"]} />

      {/* the browser window */}
      <div style={{ position: "absolute", left: WX, top: WY, width: WW, height: WH, borderRadius: 44, background: "#fff", border: `5px solid ${INK}`, boxShadow: `0 16px 0 ${INK}`, overflow: "hidden", opacity: 1 - end, transform: `translate(${shake}px, ${float + end * 60}px) scale(${1 - end * 0.05})` }}>
        <div style={{ height: BAR, display: "flex", alignItems: "center", gap: 14, padding: "0 30px", borderBottom: `5px solid ${INK}`, background: "#fff" }}>
          {[CORAL, YELLOW, "#5ad07a"].map((c) => <span key={c} style={{ width: 24, height: 24, borderRadius: 12, background: c, border: `3px solid ${INK}` }} />)}
          <div style={{ marginLeft: 16, flex: 1, padding: "12px 26px", borderRadius: 30, background: CREAM, fontFamily: N, fontWeight: 800, fontSize: 30, color: "rgba(22,22,29,0.6)" }}>codeitlearn.com</div>
        </div>
        <div style={{ position: "relative", width: WW, height: WH - BAR, background: CREAM }}>
          <div style={{ position: "absolute", inset: 0, opacity: 1 - toGame, transform: `translateX(${-toGame * 80}px)` }}><Builder /></div>
          {s >= 5.0 && (
            <div style={{ position: "absolute", inset: 0, opacity: toGame, transform: `translateX(${(1 - toGame) * 120}px)` }}>
              <Tabs on={s >= 9.1 && s < 12.5 ? "Code" : "Play"} />
              {s < 9.3 && <div style={{ opacity: 1 - toCode }}><Game from={5.2} /></div>}
              {s >= 8.9 && s < 12.7 && <div style={{ opacity: toCode * (1 - toFast) }}><Code /></div>}
              {s >= 12.3 && <div style={{ opacity: toFast }}><Game from={12.5} fast /></div>}
            </div>
          )}
        </div>
      </div>

      {s >= 15.0 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: end }}>
          <div style={{ marginTop: -160, textAlign: "center", padding: "0 70px" }}>
            <Img src={staticFile("ads/codeit-logo.png")} style={{ width: 640, transform: `scale(${0.8 + 0.2 * logo})` }} />
            <div style={{ marginTop: 50, fontFamily: B, fontWeight: 800, fontSize: 96, lineHeight: 1.02, color: INK }}>They say a game.<br /><span style={{ color: CORAL }}>Then change the code.</span></div>
            <div style={{ marginTop: 50, display: "inline-block", padding: "24px 60px", borderRadius: 60, background: YELLOW, border: `5px solid ${INK}`, boxShadow: `0 10px 0 ${INK}`, fontFamily: B, fontWeight: 800, fontSize: 54, color: INK, opacity: ramp(s, 16.0, 16.4) }}>codeitlearn.com</div>
            <div style={{ marginTop: 30, fontFamily: N, fontWeight: 800, fontSize: 38, color: "rgba(22,22,29,0.6)", opacity: ramp(s, 16.2, 16.6) }}>Free to start</div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
