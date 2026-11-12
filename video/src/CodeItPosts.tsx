import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts } from "./kit";

/*
 * CodeIt feed posts, second look: bold colour-block posters built around the real product
 * (code, games, the parent view) and the real logo, instead of the mascot illustrations.
 * 1080x1350 stills. Every fact is from codeitlearn.com.
 */

const CORAL = "#ff7d59", YELLOW = "#fed340", CREAM = "#fff4e5", INK = "#16161d", BROWN = "#16161d";
const H = "'Baloo 2'", B = "'Nunito'", M = "'JetBrains Mono'";

const Frame: React.FC<{ bg: string; kicker: string; dark?: boolean; chip?: boolean; children: React.ReactNode }> = ({ bg, kicker, dark, chip, children }) => (
  <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
    <Fonts />
    <div style={{ position: "absolute", left: 70, top: 64, padding: "12px 28px", borderRadius: 40, background: dark ? "rgba(255,255,255,0.12)" : INK, fontFamily: B, fontWeight: 900, fontSize: 28, letterSpacing: 4, color: dark ? YELLOW : CREAM }}>{kicker}</div>
    {children}
    {chip && <div style={{ position: "absolute", left: 40, bottom: 30, width: 270, height: 190, borderRadius: 40, background: CREAM }} />}
    <Img src={staticFile("ads/codeit-logo.png")} style={{ position: "absolute", left: 56, bottom: 44, width: 230 }} />
    <div style={{ position: "absolute", right: 70, bottom: 78, padding: "16px 34px", borderRadius: 50, background: dark ? CREAM : INK, fontFamily: B, fontWeight: 900, fontSize: 34, color: dark ? INK : CREAM }}>codeitlearn.com</div>
  </AbsoluteFill>
);

const Head: React.FC<{ top: number; size?: number; color?: string; children: React.ReactNode }> = ({ top, size = 118, color = INK, children }) => (
  <div style={{ position: "absolute", left: 70, right: 70, top, fontFamily: H, fontWeight: 800, fontSize: size, lineHeight: 0.98, letterSpacing: -2, color }}>{children}</div>
);

const Star: React.FC<{ x: number; y: number; s?: number; c?: string }> = ({ x, y, s = 60, c = YELLOW }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" style={{ position: "absolute", left: x, top: y }}><path d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6 5.6 21.1 7 14 1.7 9l7.2-.9z" fill={c} /></svg>
);

/* 1. Change one number */
export const PostOneNumber: React.FC = () => (
  <Frame bg={INK} kicker="HOW KIDS LEARN HERE" dark>
    <Head top={150} color={CREAM}>Change <span style={{ color: YELLOW }}>one number.</span><br />See what breaks.</Head>
    <div style={{ position: "absolute", left: 70, top: 570, width: 560, borderRadius: 34, background: "#0d0d12", border: "3px solid #2e2e3a", padding: "30px 34px", fontFamily: M, fontSize: 36, lineHeight: 1.55, color: "#ececf2" }}>
      <div style={{ color: "#8b8b9c" }}>// game.js</div>
      <div><span style={{ color: CORAL }}>let</span> score = <span style={{ color: YELLOW }}>0</span></div>
      <div style={{ margin: "4px -14px", padding: "4px 14px", borderRadius: 12, background: "rgba(254,211,64,0.16)" }}><span style={{ color: CORAL }}>let</span> fallSpeed = <span style={{ textDecoration: "line-through", color: "#8b8b9c" }}>2</span> <span style={{ color: YELLOW, fontWeight: 800 }}>9</span></div>
      <div><span style={{ color: CORAL }}>let</span> lives = <span style={{ color: YELLOW }}>3</span></div>
    </div>
    <div style={{ position: "absolute", right: 70, top: 540, width: 330, height: 400, borderRadius: 34, background: "linear-gradient(180deg,#24325c,#3b2a6b)", border: `6px solid ${CREAM}`, overflow: "hidden" }}>
      <Star x={40} y={30} s={56} /><Star x={200} y={110} s={70} /><Star x={110} y={220} s={50} /><Star x={240} y={280} s={44} />
      {[40, 200, 110, 240].map((x, i) => <div key={i} style={{ position: "absolute", left: x + 22, top: [0, 70, 180, 250][i] - 60, width: 6, height: 70, borderRadius: 3, background: "rgba(254,211,64,0.35)" }} />)}
      <div style={{ position: "absolute", left: 105, bottom: 22, width: 120, height: 34, borderRadius: 17, background: CORAL }} />
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 985, fontFamily: B, fontWeight: 800, fontSize: 42, lineHeight: 1.25, color: "#ececf2" }}>Make it, play it, change it. That's how the code starts to make sense.</div>
  </Frame>
);

/* 2. Three games, no typing */
export const PostThreeGames: React.FC = () => {
  const Tile: React.FC<{ x: number; bg: string; name: string; children: React.ReactNode }> = ({ x, bg, name, children }) => (
    <div style={{ position: "absolute", left: x, top: 520, width: 296 }}>
      <div style={{ height: 360, borderRadius: 30, background: bg, border: `6px solid ${INK}`, boxShadow: `0 12px 0 ${INK}`, position: "relative", overflow: "hidden" }}>{children}</div>
      <div style={{ marginTop: 34, fontFamily: H, fontWeight: 800, fontSize: 40, lineHeight: 1.02, color: INK, textAlign: "center" }}>{name}</div>
    </div>
  );
  return (
    <Frame bg={YELLOW} kicker="PLAY FIRST">
      <Head top={150}>3 games.<br />No typing.<br /><span style={{ color: "#e2552f" }}>No account.</span></Head>
      <Tile x={70} bg="linear-gradient(180deg,#24325c,#3b2a6b)" name="Catch the falling stars">
        <Star x={30} y={30} /><Star x={170} y={100} s={76} /><Star x={90} y={190} s={48} />
        <div style={{ position: "absolute", left: 88, bottom: 20, width: 110, height: 30, borderRadius: 15, background: CORAL }} />
      </Tile>
      <Tile x={392} bg="linear-gradient(180deg,#7ad0ff 0%,#7ad0ff 45%,#3fae5a 45%)" name="Penalty shootout">
        <div style={{ position: "absolute", left: 48, top: 70, width: 190, height: 110, border: "8px solid #fff", borderBottom: "none" }} />
        <div style={{ position: "absolute", left: 118, top: 232, width: 50, height: 50, borderRadius: 25, background: "#fff", border: `5px solid ${INK}` }} />
      </Tile>
      <Tile x={714} bg="linear-gradient(180deg,#0e0b1f,#261a44)" name="Dodge the asteroids">
        {[[40, 50, 70], [180, 120, 54], [90, 180, 40]].map(([x, y, s], i) => <div key={i} style={{ position: "absolute", left: x, top: y, width: s, height: s, borderRadius: "46% 54% 40% 60%", background: "#8d7a6a", border: "4px solid #5f5247" }} />)}
        <div style={{ position: "absolute", left: 122, bottom: 26, width: 0, height: 0, borderLeft: "26px solid transparent", borderRight: "26px solid transparent", borderBottom: `56px solid ${YELLOW}` }} />
      </Tile>
      <div style={{ position: "absolute", left: 70, right: 70, top: 1040, fontFamily: B, fontWeight: 800, fontSize: 42, lineHeight: 1.2, color: INK, textAlign: "center" }}>Then open the code and see what it's made of.</div>
    </Frame>
  );
};

/* 3. Parent view */
export const PostParentSentence: React.FC = () => (
  <Frame bg={CREAM} kicker="FOR PARENTS">
    <Head top={150}>Not a score.<br /><span style={{ color: CORAL }}>A sentence.</span></Head>
    <div style={{ position: "absolute", left: 70, right: 70, top: 470, borderRadius: 40, background: "#fff", border: `5px solid ${INK}`, boxShadow: `0 14px 0 ${INK}`, padding: "44px 48px" }}>
      <div style={{ fontFamily: B, fontWeight: 900, fontSize: 26, letterSpacing: 4, color: "#e2552f" }}>WHAT YOUR CHILD WORKED OUT</div>
      <div style={{ marginTop: 22, fontFamily: H, fontWeight: 700, fontSize: 60, lineHeight: 1.12, color: INK }}>"Worked out that <span style={{ background: YELLOW, padding: "0 12px", borderRadius: 12, fontFamily: M, fontSize: 50 }}>fallSpeed</span> controls how fast the stars drop."</div>
      <div style={{ marginTop: 26, fontFamily: B, fontWeight: 700, fontSize: 28, color: "#8b8b9c" }}>Example of the parent view</div>
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 975, fontFamily: B, fontWeight: 800, fontSize: 38, lineHeight: 1.25, color: BROWN }}>The questions come from their own project's code. Only a right answer on the first try counts.</div>
  </Frame>
);

/* 4. 31 lessons path */
export const PostLessons: React.FC = () => {
  const steps = ["variables", "strings", "if statements", "for loops"];
  return (
    <Frame bg={CORAL} kicker="PYTHON, STEP BY STEP" chip>
      <div style={{ position: "absolute", left: 60, top: 120, fontFamily: H, fontWeight: 800, fontSize: 420, lineHeight: 1, letterSpacing: -14, color: YELLOW }}>31</div>
      <div style={{ position: "absolute", left: 590, top: 250, right: 60, fontFamily: H, fontWeight: 800, fontSize: 92, lineHeight: 0.98, color: INK }}>Python lessons.</div>
      <div style={{ position: "absolute", left: 70, right: 70, top: 600, height: 10, borderRadius: 5, background: INK, opacity: 0.25, marginTop: 44 }} />
      {steps.map((t, i) => (
        <div key={t} style={{ position: "absolute", left: 70 + i * 240, top: 600, width: 220, textAlign: "center" }}>
          <div style={{ margin: "0 auto", width: 96, height: 96, borderRadius: 48, background: i === 0 ? YELLOW : CREAM, border: `6px solid ${INK}`, fontFamily: H, fontWeight: 800, fontSize: 50, lineHeight: "88px", color: INK }}>{i + 1}</div>
          <div style={{ marginTop: 18, fontFamily: M, fontWeight: 700, fontSize: 30, color: INK }}>{t}</div>
        </div>
      ))}
      <div style={{ position: "absolute", left: 70, right: 70, top: 850, display: "flex", gap: 22 }}>
        {["In the browser", "Nothing to install", "Run every line"].map((t) => <div key={t} style={{ flex: 1, padding: "26px 10px", borderRadius: 28, background: INK, fontFamily: B, fontWeight: 900, fontSize: 32, color: CREAM, textAlign: "center" }}>{t}</div>)}
      </div>
      <div style={{ position: "absolute", left: 70, right: 70, top: 1010, fontFamily: B, fontWeight: 800, fontSize: 42, lineHeight: 1.2, color: INK }}>Write it, run it, make the message yours.</div>
    </Frame>
  );
};

/* 5. The AI question */
export const PostAiQuestion: React.FC = () => (
  <Frame bg={INK} kicker="PARENTS ASK" dark>
    <Head top={150} size={104} color={CREAM}>"Can't my kid just let <span style={{ color: CORAL }}>AI</span> do it all?"</Head>
    {[
      ["1", "CodeIt builds the first version."],
      ["2", "Your kid changes it and plays it."],
      ["3", "Then it asks about their own code."],
    ].map(([n, t], i) => (
      <div key={n} style={{ position: "absolute", left: 70, right: 70, top: 490 + i * 140, display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ flex: "none", width: 96, height: 96, borderRadius: 28, background: i === 2 ? YELLOW : CREAM, fontFamily: H, fontWeight: 800, fontSize: 60, lineHeight: "100px", textAlign: "center", color: INK }}>{n}</div>
        <div style={{ fontFamily: B, fontWeight: 800, fontSize: 48, lineHeight: 1.1, color: i === 2 ? YELLOW : CREAM }}>{t}</div>
      </div>
    ))}
    <div style={{ position: "absolute", left: 70, right: 70, top: 950, fontFamily: H, fontWeight: 800, fontSize: 72, lineHeight: 1.05, color: CREAM }}>Only they can answer that part.</div>
  </Frame>
);

/* 6. Free plan */
export const PostFree: React.FC = () => (
  <Frame bg={CREAM} kicker="WHAT IT COSTS">
    <div style={{ position: "absolute", left: 60, top: 130, fontFamily: H, fontWeight: 800, fontSize: 330, lineHeight: 1, letterSpacing: -10, color: CORAL }}>Free.</div>
    {["No card", "No expiry", "10 assisted builds a month"].map((t, i) => (
      <div key={t} style={{ position: "absolute", left: 70, top: 520 + i * 118, display: "flex", alignItems: "center", gap: 26 }}>
        <div style={{ width: 76, height: 76, borderRadius: 38, background: YELLOW, border: `5px solid ${INK}`, fontFamily: H, fontWeight: 800, fontSize: 50, lineHeight: "70px", textAlign: "center", color: INK }}>✓</div>
        <div style={{ fontFamily: H, fontWeight: 800, fontSize: 68, color: INK }}>{t}</div>
      </div>
    ))}
    <div style={{ position: "absolute", left: 70, right: 70, top: 920, padding: "34px 40px", borderRadius: 34, background: INK }}>
      <div style={{ fontFamily: B, fontWeight: 900, fontSize: 26, letterSpacing: 4, color: YELLOW }}>WANT MORE?</div>
      <div style={{ marginTop: 6, fontFamily: B, fontWeight: 800, fontSize: 44, lineHeight: 1.15, color: CREAM }}>Family plan, CA$12/month. Cancel anytime.</div>
    </div>
  </Frame>
);

/* ── Second set, so there are options to pick from ── */

const Bullet: React.FC<{ top: number; text: string; dark?: boolean }> = ({ top, text, dark }) => (
  <div style={{ position: "absolute", left: 70, right: 70, top, display: "flex", alignItems: "center", gap: 26 }}>
    <div style={{ flex: "none", width: 70, height: 70, borderRadius: 35, background: YELLOW, border: `5px solid ${INK}`, fontFamily: H, fontWeight: 800, fontSize: 46, lineHeight: "64px", textAlign: "center", color: INK }}>✓</div>
    <div style={{ fontFamily: H, fontWeight: 800, fontSize: 58, lineHeight: 1.05, color: dark ? CREAM : INK }}>{text}</div>
  </div>
);

/* 7. Say a game, get a game */
export const PostSayAGame: React.FC = () => (
  <Frame bg={CREAM} kicker="SAY A GAME. GET A GAME.">
    <Head top={150}>They describe it.<br /><span style={{ color: CORAL }}>Then make it theirs.</span></Head>
    <div style={{ position: "absolute", left: 70, right: 70, top: 600, padding: "30px 36px 34px", borderRadius: 40, background: INK }}>
      <div style={{ fontFamily: B, fontWeight: 900, fontSize: 26, letterSpacing: 4, color: "#c9c9d6" }}>WHAT DO YOU WANT TO BUILD?</div>
      <div style={{ marginTop: 20, padding: "28px 32px", borderRadius: 26, background: CREAM, border: `5px solid ${YELLOW}`, fontFamily: B, fontWeight: 800, fontSize: 46, color: INK }}>a cat that catches falling fish<span style={{ display: "inline-block", width: 5, height: 48, marginLeft: 4, background: INK, verticalAlign: "middle" }} /></div>
      <div style={{ marginTop: 26, display: "inline-block", padding: "20px 46px", borderRadius: 50, background: CORAL, fontFamily: H, fontWeight: 800, fontSize: 46, color: INK }}>Build it →</div>
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 1010, fontFamily: B, fontWeight: 800, fontSize: 38, lineHeight: 1.25, color: BROWN }}>CodeIt builds a first version. The changing, fixing and understanding is on them.</div>
  </Frame>
);

/* 8. Nothing to install */
export const PostNoInstall: React.FC = () => (
  <Frame bg={YELLOW} kicker="PARENTS ASK">
    <Head top={150} size={96}>"Do we need to install anything?"</Head>
    <div style={{ position: "absolute", left: 60, top: 400, fontFamily: H, fontWeight: 800, fontSize: 400, lineHeight: 1, letterSpacing: -12, color: INK }}>No.</div>
    <Bullet top={850} text="Runs in the browser" />
    <Bullet top={950} text="Nothing to download" />
    <Bullet top={1050} text="Needs internet" />
  </Frame>
);

/* 9. What they can build */
export const PostWhatTheyBuild: React.FC = () => {
  const Card: React.FC<{ x: number; rot: number; bg: string; name: string; children: React.ReactNode }> = ({ x, rot, bg, name, children }) => (
    <div style={{ position: "absolute", left: x, top: 540, width: 300, transform: `rotate(${rot}deg)` }}>
      <div style={{ height: 300, borderRadius: 30, background: bg, border: `6px solid ${INK}`, boxShadow: `0 12px 0 ${INK}`, position: "relative", overflow: "hidden" }}>{children}</div>
      <div style={{ marginTop: 30, fontFamily: H, fontWeight: 800, fontSize: 60, color: CREAM, textAlign: "center" }}>{name}</div>
    </div>
  );
  return (
    <Frame bg={CORAL} kicker="WHAT KIDS MAKE" chip>
      <Head top={150}>Built by a kid.<br /><span style={{ color: YELLOW }}>Not just played.</span></Head>
      <Card x={60} rot={-4} bg={CREAM} name="Websites">
        <div style={{ height: 50, background: INK }} /><div style={{ margin: "24px 24px 0", height: 80, borderRadius: 14, background: YELLOW }} /><div style={{ margin: "18px 24px 0", height: 20, borderRadius: 10, background: "#c9c9d6" }} /><div style={{ margin: "14px 24px 0", width: 150, height: 20, borderRadius: 10, background: "#c9c9d6" }} />
      </Card>
      <Card x={390} rot={2} bg="linear-gradient(180deg,#24325c,#3b2a6b)" name="Games">
        <Star x={40} y={30} /><Star x={170} y={90} s={76} /><div style={{ position: "absolute", left: 92, bottom: 22, width: 110, height: 30, borderRadius: 15, background: CORAL }} />
      </Card>
      <Card x={720} rot={-2} bg={YELLOW} name="Quizzes">
        <div style={{ position: "absolute", left: 0, right: 0, top: 30, textAlign: "center", fontFamily: H, fontWeight: 800, fontSize: 190, lineHeight: 1, color: INK }}>?</div>
      </Card>
      <div style={{ position: "absolute", left: 70, right: 70, top: 1000, fontFamily: B, fontWeight: 800, fontSize: 38, lineHeight: 1.2, color: INK }}>Real HTML, CSS and JavaScript they can open and edit.</div>
    </Frame>
  );
};

/* 10. Teachers */
export const PostTeachers: React.FC = () => (
  <Frame bg={INK} kicker="FOR TEACHERS" dark>
    <div style={{ position: "absolute", left: 60, top: 120, fontFamily: H, fontWeight: 800, fontSize: 420, lineHeight: 1, letterSpacing: -14, color: CORAL }}>12</div>
    <div style={{ position: "absolute", left: 560, top: 230, right: 60, fontFamily: H, fontWeight: 800, fontSize: 88, lineHeight: 0.98, color: CREAM }}>coding lesson plans.</div>
    <Bullet top={640} text="For your classroom" dark />
    <Bullet top={750} text="Runs in the browser" dark />
    <Bullet top={860} text="Free to start" dark />
    <div style={{ position: "absolute", left: 70, right: 70, top: 1000, fontFamily: B, fontWeight: 800, fontSize: 42, lineHeight: 1.2, color: "#ececf2" }}>Find them under "Teach a class".</div>
  </Frame>
);

/* 11. First Python program */
export const PostFirstProgram: React.FC = () => (
  <Frame bg={CREAM} kicker="LESSON ONE">
    <Head top={150}>Their first<br /><span style={{ color: CORAL }}>Python program.</span></Head>
    <div style={{ position: "absolute", left: 70, right: 70, top: 480, borderRadius: 34, background: INK, overflow: "hidden" }}>
      <div style={{ padding: "30px 36px", fontFamily: M, fontSize: 44, lineHeight: 1.5, color: "#ececf2" }}>
        <div><span style={{ color: YELLOW }}>print</span>(<span style={{ color: CORAL }}>"Hello, I made this!"</span>)</div>
      </div>
      <div style={{ padding: "22px 36px 30px", background: "#0d0d12", fontFamily: M, fontSize: 40, color: "#9be28a" }}><span style={{ color: "#8b8b9c" }}>&gt; </span>Hello, I made this!</div>
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 800, display: "flex", gap: 22 }}>
      {["Write it", "Run it", "Make it yours"].map((t, i) => <div key={t} style={{ flex: 1, padding: "30px 10px", borderRadius: 28, background: i === 2 ? CORAL : YELLOW, border: `5px solid ${INK}`, fontFamily: H, fontWeight: 800, fontSize: 36, whiteSpace: "nowrap", color: INK, textAlign: "center" }}>{t}</div>)}
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 1000, fontFamily: B, fontWeight: 800, fontSize: 42, lineHeight: 1.25, color: BROWN }}>No AI in the lessons. Just them and the code.</div>
  </Frame>
);

/* 12. Private by default */
export const PostPrivate: React.FC = () => (
  <Frame bg={YELLOW} kicker="FOR PARENTS">
    <Head top={150}>Under 13?<br />You hold the keys.</Head>
    <svg width={300} height={300} viewBox="0 0 24 24" style={{ position: "absolute", right: 80, top: 470 }}><rect x="4" y="10" width="16" height="11" rx="3" fill={INK} /><path d="M8 10V7a4 4 0 018 0v3" fill="none" stroke={INK} strokeWidth="2.6" /><circle cx="12" cy="15.5" r="1.8" fill={YELLOW} /></svg>
    <div style={{ position: "absolute", left: 70, width: 600, top: 500, fontFamily: B, fontWeight: 800, fontSize: 48, lineHeight: 1.22, color: INK }}>A parent creates a private profile for them.</div>
    <Bullet top={830} text="Managed by you" />
    <Bullet top={935} text="Can't publish publicly" />
    <Bullet top={1040} text="No install, no card" />
  </Frame>
);
