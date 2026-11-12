import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts } from "./kit";

/*
 * CodeIt feed posts, third look. No brown. Each post borrows a format people already know
 * (a text thread, an arcade screen, an achievement pop-up, a wanted poster, a search bar,
 * a recipe card) instead of being a headline on a colour. 1080x1350 stills.
 */

const CORAL = "#ff7d59", YELLOW = "#fed340", INDIGO = "#221a5b", SKY = "#8fd3ff", MINT = "#b9f3d0", LILAC = "#ece6ff", WHITE = "#ffffff";
const H = "'Baloo 2'", B = "'Nunito'", M = "'JetBrains Mono'";

const Foot: React.FC<{ dark?: boolean; note?: string }> = ({ dark, note }) => (
  <>
    <Img src={staticFile("ads/codeit-logo.png")} style={{ position: "absolute", left: 56, bottom: 44, width: 230 }} />
    <div style={{ position: "absolute", right: 70, bottom: 78, padding: "16px 34px", borderRadius: 50, background: dark ? WHITE : INDIGO, fontFamily: B, fontWeight: 900, fontSize: 34, color: dark ? INDIGO : WHITE }}>codeitlearn.com</div>
    {note && <div style={{ position: "absolute", right: 74, bottom: 40, fontFamily: B, fontWeight: 700, fontSize: 22, color: dark ? "rgba(255,255,255,0.6)" : "rgba(34,26,91,0.55)" }}>{note}</div>}
  </>
);

/* A. The text thread */
export const PostThread: React.FC = () => {
  const Bub: React.FC<{ me?: boolean; top: number; children: React.ReactNode }> = ({ me, top, children }) => (
    <div style={{ position: "absolute", top, left: me ? undefined : 90, right: me ? 90 : undefined, maxWidth: 720, padding: "24px 36px", borderRadius: 44, borderBottomLeftRadius: me ? 44 : 12, borderBottomRightRadius: me ? 12 : 44, background: me ? "#2f7bff" : WHITE, fontFamily: B, fontWeight: 700, fontSize: 48, lineHeight: 1.2, color: me ? WHITE : INDIGO, boxShadow: "0 8px 24px rgba(34,26,91,0.10)" }}>{children}</div>
  );
  return (
    <AbsoluteFill style={{ background: LILAC }}>
      <Fonts />
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center", fontFamily: B, fontWeight: 900, fontSize: 34, color: "rgba(34,26,91,0.55)" }}>Today 8:47 PM</div>
      <Bub me top={150}>Dinner. Now please 🍝</Bub>
      <Bub top={290}>5 more minutes</Bub>
      <Bub me top={430}>What are you even doing</Bub>
      <Bub top={570}>fixing my game. the cat falls way too fast</Bub>
      <Bub top={770}>ok I changed fallSpeed. come see</Bub>
      <Bub me top={910}>...you MADE this?</Bub>
      <div style={{ position: "absolute", left: 70, right: 70, top: 1050, textAlign: "center", fontFamily: H, fontWeight: 800, fontSize: 58, color: INDIGO }}>The good kind of "5 more minutes".</div>
      <Foot note="Made-up chat" />
    </AbsoluteFill>
  );
};

/* B. Arcade screen */
export const PostArcade: React.FC = () => (
  <AbsoluteFill style={{ background: "#120c3a" }}>
    <Fonts />
    <AbsoluteFill style={{ background: "radial-gradient(60% 40% at 50% 42%, rgba(143,211,255,0.28) 0%, rgba(18,12,58,0) 70%)" }} />
    <div style={{ position: "absolute", left: 90, right: 90, top: 110, height: 860, borderRadius: 60, border: `10px solid ${SKY}`, boxShadow: `0 0 60px ${SKY}, inset 0 0 60px rgba(143,211,255,0.35)`, background: "#0a0726", overflow: "hidden" }}>
      {Array.from({ length: 43 }, (_, i) => <div key={i} style={{ position: "absolute", left: 0, right: 0, top: i * 20, height: 2, background: "rgba(255,255,255,0.04)" }} />)}
      <div style={{ position: "absolute", left: 0, right: 0, top: 60, display: "flex", justifyContent: "space-between", padding: "0 50px", fontFamily: M, fontWeight: 800, fontSize: 34, color: SKY }}><span>1UP</span><span>HI-SCORE</span></div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 250, textAlign: "center", fontFamily: M, fontWeight: 800, fontSize: 150, lineHeight: 1, letterSpacing: 4, color: YELLOW, textShadow: `0 0 30px ${YELLOW}` }}>INSERT</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 410, textAlign: "center", fontFamily: M, fontWeight: 800, fontSize: 190, lineHeight: 1, letterSpacing: 4, color: CORAL, textShadow: `0 0 34px ${CORAL}` }}>IDEA</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 660, textAlign: "center", fontFamily: M, fontWeight: 800, fontSize: 46, color: WHITE }}>▶ PRESS START</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 760, textAlign: "center", fontFamily: M, fontSize: 30, color: SKY }}>NO COINS NEEDED · FREE TO START</div>
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 1010, textAlign: "center", fontFamily: H, fontWeight: 800, fontSize: 60, lineHeight: 1.05, color: WHITE }}>They say the game. Then they build it.</div>
    <Foot dark />
  </AbsoluteFill>
);

/* C. Achievement unlocked */
export const PostAchievements: React.FC = () => {
  const Toast: React.FC<{ top: number; rot: number; x: number; icon: string; title: string; bg: string }> = ({ top, rot, x, icon, title, bg }) => (
    <div style={{ position: "absolute", left: x, top, width: 860, transform: `rotate(${rot}deg)`, display: "flex", alignItems: "center", gap: 30, padding: "28px 36px", borderRadius: 40, background: WHITE, border: `6px solid ${INDIGO}`, boxShadow: `0 12px 0 ${INDIGO}` }}>
      <div style={{ flex: "none", width: 120, height: 120, borderRadius: 34, background: bg, fontSize: 70, lineHeight: "120px", textAlign: "center" }}>{icon}</div>
      <div>
        <div style={{ fontFamily: B, fontWeight: 900, fontSize: 26, letterSpacing: 4, color: CORAL }}>ACHIEVEMENT UNLOCKED</div>
        <div style={{ fontFamily: H, fontWeight: 800, fontSize: 60, lineHeight: 1.05, color: INDIGO }}>{title}</div>
      </div>
    </div>
  );
  return (
    <AbsoluteFill style={{ background: SKY }}>
      <Fonts />
      <div style={{ position: "absolute", left: 70, right: 70, top: 70, fontFamily: H, fontWeight: 800, fontSize: 104, lineHeight: 1, color: INDIGO }}>Tonight's wins.</div>
      <Toast top={240} x={70} rot={-2} icon="🐛" bg={MINT} title="Fixed my own bug" />
      <Toast top={450} x={150} rot={1.5} icon="⚡" bg={YELLOW} title="Made the cat faster" />
      <Toast top={660} x={90} rot={-1} icon="🧠" bg={LILAC} title="Explained my code" />
      <Toast top={870} x={140} rot={2} icon="🏆" bg="#ffd0c2" title="Showed the whole family" />
      <Foot />
    </AbsoluteFill>
  );
};

/* D. Wanted poster */
export const PostWanted: React.FC = () => (
  <AbsoluteFill style={{ background: YELLOW }}>
    <Fonts />
    <div style={{ position: "absolute", left: 60, right: 60, top: 56, bottom: 250, borderRadius: 30, border: `10px solid ${INDIGO}`, background: WHITE }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 96, textAlign: "center", fontFamily: H, fontWeight: 800, fontSize: 210, lineHeight: 1, letterSpacing: 10, color: INDIGO }}>WANTED</div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 310, textAlign: "center", fontFamily: B, fontWeight: 900, fontSize: 40, letterSpacing: 8, color: CORAL }}>THE BUG ON LINE 7</div>
    <div style={{ position: "absolute", left: 150, right: 150, top: 400, height: 380, borderRadius: 26, background: INDIGO, padding: "30px 40px", fontFamily: M, fontSize: 38, lineHeight: 1.5, color: "#cfd3ff" }}>
      <div><span style={{ color: "#7f86c9" }}>5 </span>if (cat.touches(fish)) {"{"}</div>
      <div><span style={{ color: "#7f86c9" }}>6 </span>  score = score + 1</div>
      <div style={{ margin: "0 -16px", padding: "0 16px", borderRadius: 10, background: "rgba(255,125,89,0.3)" }}><span style={{ color: "#7f86c9" }}>7 </span>  fish.speed = <span style={{ color: CORAL, fontWeight: 800 }}>900</span> 🐛</div>
      <div><span style={{ color: "#7f86c9" }}>8 </span>{"}"}</div>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 830, textAlign: "center", fontFamily: H, fontWeight: 800, fontSize: 64, color: INDIGO }}>Reward: the game works.</div>
    <div style={{ position: "absolute", left: 120, right: 120, top: 930, textAlign: "center", fontFamily: B, fontWeight: 800, fontSize: 38, lineHeight: 1.25, color: "rgba(34,26,91,0.75)" }}>Finding it themselves is the lesson.</div>
    <Foot />
  </AbsoluteFill>
);

/* E. Search bar */
export const PostSearch: React.FC = () => (
  <AbsoluteFill style={{ background: WHITE }}>
    <Fonts />
    <AbsoluteFill style={{ background: `radial-gradient(70% 40% at 80% 0%, ${LILAC} 0%, rgba(255,255,255,0) 70%), radial-gradient(60% 40% at 0% 100%, ${MINT} 0%, rgba(255,255,255,0) 70%)` }} />
    <div style={{ position: "absolute", left: 70, right: 70, top: 130, borderRadius: 60, background: WHITE, border: `6px solid ${INDIGO}`, boxShadow: "0 20px 50px rgba(34,26,91,0.15)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "34px 44px", borderBottom: "3px solid #e3e0f5" }}>
        <svg width={54} height={54} viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="7" fill="none" stroke={INDIGO} strokeWidth="2.6" /><path d="M16 16l5.5 5.5" stroke={INDIGO} strokeWidth="2.6" strokeLinecap="round" /></svg>
        <div style={{ fontFamily: B, fontWeight: 800, fontSize: 52, color: INDIGO }}>can my kid make a<span style={{ display: "inline-block", width: 5, height: 54, marginLeft: 6, background: CORAL, verticalAlign: "middle" }} /></div>
      </div>
      {["game", "website", "quiz", "Python program"].map((t, i) => (
        <div key={t} style={{ padding: "26px 44px 26px 122px", background: i === 0 ? LILAC : WHITE, fontFamily: B, fontWeight: 700, fontSize: 44, whiteSpace: "nowrap", color: "rgba(34,26,91,0.6)" }}>can my kid make a <b style={{ color: INDIGO, fontWeight: 900 }}>{t}</b></div>
      ))}
    </div>
    <div style={{ position: "absolute", left: 70, top: 730, fontFamily: H, fontWeight: 800, fontSize: 330, lineHeight: 1, letterSpacing: -10, color: CORAL }}>Yes.</div>
    <div style={{ position: "absolute", left: 640, right: 60, top: 840, fontFamily: B, fontWeight: 800, fontSize: 42, lineHeight: 1.2, color: INDIGO }}>All four. In the browser. Free to start.</div>
    <Foot />
  </AbsoluteFill>
);

/* F. Recipe card */
export const PostRecipe: React.FC = () => (
  <AbsoluteFill style={{ background: MINT }}>
    <Fonts />
    <div style={{ position: "absolute", left: 70, right: 70, top: 70, bottom: 250, borderRadius: 36, background: WHITE, border: `6px solid ${INDIGO}`, boxShadow: `0 14px 0 ${INDIGO}`, transform: "rotate(-1.2deg)", overflow: "hidden" }}>
      <div style={{ padding: "34px 50px 26px", background: CORAL }}>
        <div style={{ fontFamily: B, fontWeight: 900, fontSize: 28, letterSpacing: 6, color: INDIGO }}>RECIPE CARD</div>
        <div style={{ fontFamily: H, fontWeight: 800, fontSize: 104, lineHeight: 1, color: WHITE }}>One homemade game</div>
      </div>
      <div style={{ padding: "30px 50px", fontFamily: B, fontWeight: 800, fontSize: 44, lineHeight: 1.2, color: INDIGO }}>
        <div style={{ fontFamily: B, fontWeight: 900, fontSize: 26, letterSpacing: 5, color: CORAL, marginBottom: 6 }}>INGREDIENTS</div>
        {["1 idea (the weirder the better)", "1 sentence to describe it", "A handful of “what if I change this?”", "1 kid who won't come to dinner"].map((t) => (
          <div key={t} style={{ display: "flex", gap: 20, padding: "12px 0", borderBottom: "3px dashed #d8d4f0" }}><span style={{ color: CORAL }}>●</span><span>{t}</span></div>
        ))}
        <div style={{ marginTop: 26, display: "flex", gap: 20 }}>
          {[["PREP", "1 sentence"], ["TOOLS", "A browser"], ["COST", "Free to start"]].map(([k, v]) => (
            <div key={k} style={{ flex: 1, padding: "16px 10px", borderRadius: 22, background: YELLOW, textAlign: "center" }}><div style={{ fontWeight: 900, fontSize: 22, letterSpacing: 4 }}>{k}</div><div style={{ fontFamily: H, fontWeight: 800, fontSize: 36 }}>{v}</div></div>
          ))}
        </div>
      </div>
    </div>
    <Foot />
  </AbsoluteFill>
);
