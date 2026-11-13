import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Fonts } from "./kit";

/*
 * LYNQ feed posts for Nov 13 to 18, replacing the dark product-photo cards that were too dim
 * to read in the feed. Same brand (near-black, white, one lime accent), but the message is big
 * enough to read at thumbnail size and each post shows the idea on a phone or as a clear list.
 * Wording comes from the Office week plan. Site mock-ups are made-up examples and say so.
 * 1080x1350 stills.
 */

const BK = "#0a0c0b", WH = "#f2f4eb", LI = "#d5fd71", MU = "#9ba48f", LN = "#2a3027", CARD = "#141814";
const O = "'Outfit Bold'", OR = "'Outfit Regular'";

const Shell: React.FC<{ kicker: string; children: React.ReactNode; note?: string }> = ({ kicker, children, note }) => (
  <AbsoluteFill style={{ background: BK, overflow: "hidden" }}>
    <Fonts />
    <div style={{ position: "absolute", left: -260, top: -320, width: 1100, height: 1100, borderRadius: 550, background: "radial-gradient(closest-side, rgba(213,253,113,0.13) 0%, rgba(213,253,113,0) 100%)" }} />
    <div style={{ position: "absolute", left: 70, top: 64, display: "flex", alignItems: "center", gap: 16 }}>
      <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 46, height: 46 }} />
      <span style={{ fontFamily: O, fontSize: 40, letterSpacing: 5, color: WH }}>LYNQ</span>
    </div>
    <div style={{ position: "absolute", right: 70, top: 76, fontFamily: OR, fontSize: 26, letterSpacing: 5, color: MU }}>{kicker}</div>
    {children}
    <div style={{ position: "absolute", left: 70, right: 70, bottom: 58, display: "flex", justifyContent: "space-between", fontFamily: OR, fontSize: 28, color: MU }}>
      <span>lynq.build</span><span>{note ?? ""}</span>
    </div>
  </AbsoluteFill>
);

const Head: React.FC<{ top?: number; size?: number; l1: string; l2?: string }> = ({ top = 180, size = 132, l1, l2 }) => (
  <div style={{ position: "absolute", left: 66, right: 60, top, fontFamily: O, fontSize: size, lineHeight: 0.96, letterSpacing: -size / 28, color: WH, whiteSpace: "nowrap" }}>
    {l1}{l2 && <><br /><span style={{ color: LI }}>{l2}</span></>}
  </div>
);

const Phone: React.FC<{ left: number; top: number; w?: number; h?: number; rot?: number; children: React.ReactNode }> = ({ left, top, w = 440, h = 720, rot = 0, children }) => (
  <div style={{ position: "absolute", left, top, width: w, height: h, transform: `rotate(${rot}deg)`, borderRadius: 64, background: "#050605", border: "3px solid #3a4136", boxShadow: "0 60px 120px rgba(0,0,0,0.7), inset 0 0 0 10px #111411", overflow: "hidden" }}>
    <div style={{ position: "absolute", left: "50%", top: 22, width: 110, height: 26, marginLeft: -55, borderRadius: 13, background: "#000" }} />
    <div style={{ position: "absolute", left: 14, right: 14, top: 14, bottom: 14, borderRadius: 50, overflow: "hidden" }}>{children}</div>
  </div>
);

/* Fri: the one sentence rule */
export const LynqOneSentence: React.FC = () => (
  <Shell kicker="OUR ONE RULE" note="Made-up example site">
    <Head l1="One screen." l2="One sentence." />
    <Phone left={560} top={470} rot={4}>
      <div style={{ position: "absolute", inset: 0, background: "#f6f3ec", padding: "86px 34px 0" }}>
        <div style={{ fontFamily: OR, fontSize: 22, letterSpacing: 4, color: "#7a7468" }}>NORTH ROOFING</div>
        <div style={{ marginTop: 26, fontFamily: O, fontSize: 62, lineHeight: 1.0, letterSpacing: -2, color: "#14140f" }}>We fix leaky roofs. Same day.</div>
        <div style={{ marginTop: 26, fontFamily: OR, fontSize: 26, lineHeight: 1.3, color: "#55514a" }}>For homes in your area.</div>
        <div style={{ marginTop: 34, padding: "22px 0", borderRadius: 40, background: "#14140f", textAlign: "center", fontFamily: O, fontSize: 30, color: "#fff" }}>Call now</div>
      </div>
    </Phone>
    <div style={{ position: "absolute", left: 70, top: 520, width: 440 }}>
      {[["What you do", true], ["Who it's for", true], ["How to get it", true]].map(([t], i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 34 }}>
          <div style={{ flex: "none", width: 60, height: 60, borderRadius: 30, background: LI, fontFamily: O, fontSize: 38, lineHeight: "60px", textAlign: "center", color: BK }}>✓</div>
          <div style={{ fontFamily: O, fontSize: 52, color: WH }}>{t as string}</div>
        </div>
      ))}
      <div style={{ marginTop: 30, fontFamily: OR, fontSize: 38, lineHeight: 1.25, color: MU }}>If a stranger can't say all three without scrolling, we rewrite the first line.</div>
    </div>
  </Shell>
);

/* Sat: six first screens */
export const LynqSixScreens: React.FC = () => {
  const rows = [["Kingsbridge", "Home builder and property manager"], ["Nasma", "Restaurant"], ["Finding Amy", "Photo booth events"], ["Arcubed Label", "Handmade bags, made to order"], ["House Deals Direct", "Owners and investors"], ["Kids Coding", "STEM school, ages 5 to 17"]];
  return (
    <Shell kicker="THE WORK" note="Every case is in our highlights">
      <Head l1="Six first" l2="screens." />
      <div style={{ position: "absolute", left: 70, right: 70, top: 470 }}>
        {rows.map(([n, w], i) => (
          <div key={n} style={{ display: "flex", alignItems: "baseline", gap: 26, padding: "24px 0", borderTop: `2px solid ${LN}` }}>
            <span style={{ flex: "none", width: 60, fontFamily: OR, fontSize: 28, color: i === 0 ? LI : MU }}>0{i + 1}</span>
            <span style={{ flex: "none", fontFamily: O, fontSize: 50, letterSpacing: -1, color: WH }}>{n}</span>
            <span style={{ fontFamily: OR, fontSize: 28, color: MU, whiteSpace: "nowrap", overflow: "hidden" }}>{w}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
};

/* Sun: before you hire */
export const LynqBeforeHire: React.FC = () => (
  <Shell kicker="BEFORE YOU HIRE">
    <Head l1="Before you" l2="hire anyone." />
    <div style={{ position: "absolute", left: 70, top: 470, fontFamily: OR, fontSize: 38, color: MU }}>Get a clear answer to:</div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 550 }}>
      {["Who owns the domain", "Who answers at 9pm", "Who fixes it after launch", "Is the quote in writing first"].map((t, i) => (
        <div key={t} style={{ display: "flex", alignItems: "center", gap: 28, padding: "26px 34px", marginBottom: 20, borderRadius: 34, background: CARD, border: `2px solid ${LN}` }}>
          <div style={{ flex: "none", width: 58, height: 58, borderRadius: 16, border: `4px solid ${LI}`, fontFamily: O, fontSize: 40, lineHeight: "50px", textAlign: "center", color: LI }}>{i < 3 ? "✓" : ""}</div>
          <div style={{ fontFamily: O, fontSize: 52, letterSpacing: -1, color: WH }}>{t}?</div>
        </div>
      ))}
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 1130, fontFamily: O, fontSize: 46, color: WH }}>Vague answer? <span style={{ color: LI }}>Keep looking.</span></div>
  </Shell>
);

/* Mon: send your link */
export const LynqSendLink: React.FC = () => (
  <Shell kicker="FREE THIS WEEK">
    <Head l1="Send your link." l2="Get three fixes." size={118} />
    <div style={{ position: "absolute", left: 70, right: 70, top: 480 }}>
      <div style={{ marginLeft: 220, padding: "30px 40px", borderRadius: 44, borderBottomRightRadius: 12, background: LI, fontFamily: O, fontSize: 60, color: BK, textAlign: "center" }}>DM AUDIT</div>
      <div style={{ marginTop: 26, marginRight: 120, padding: "34px 40px", borderRadius: 44, borderBottomLeftRadius: 12, background: CARD, border: `2px solid ${LN}` }}>
        {["Your call button is below the fold.", "The headline doesn't say what you do.", "Your hours are on a separate page."].map((t, i) => (
          <div key={t} style={{ display: "flex", gap: 22, padding: "14px 0", fontFamily: OR, fontSize: 38, lineHeight: 1.2, color: WH }}><span style={{ flex: "none", fontFamily: O, color: LI }}>{i + 1}</span><span>{t}</span></div>
        ))}
      </div>
    </div>
    <div style={{ position: "absolute", left: 70, right: 70, top: 1100, fontFamily: OR, fontSize: 38, lineHeight: 1.25, color: MU }}>We open it on a phone and reply with three fixes in plain words.</div>
  </Shell>
);

/* Tue: phone first */
export const LynqPhoneFirst: React.FC = () => (
  <Shell kicker="HOW WE DESIGN" note="Made-up example site">
    <Head l1="Phone" l2="first." size={170} />
    <Phone left={580} top={330} rot={5} w={420} h={760}>
      <div style={{ position: "absolute", inset: 0, background: "#f6f3ec", padding: "86px 30px 0" }}>
        <div style={{ fontFamily: O, fontSize: 54, lineHeight: 1.0, letterSpacing: -2, color: "#14140f" }}>Fresh cuts, no wait.</div>
        <div style={{ marginTop: 18, fontFamily: OR, fontSize: 26, color: "#55514a" }}>Open today until 8 pm</div>
        <div style={{ marginTop: 26, height: 250, borderRadius: 26, background: "linear-gradient(135deg,#d9d2c3,#bdb5a4)" }} />
      </div>
      <div style={{ position: "absolute", left: 22, right: 22, bottom: 30, padding: "26px 0", borderRadius: 44, background: LI, boxShadow: "0 0 50px rgba(213,253,113,0.6)", textAlign: "center", fontFamily: O, fontSize: 34, color: BK }}>Call · Book</div>
    </Phone>
    <div style={{ position: "absolute", left: 70, top: 600, width: 470 }}>
      {["Designed for a thumb", "Call button always on screen", "Hours next to the number"].map((t) => (
        <div key={t} style={{ display: "flex", gap: 22, marginBottom: 34, fontFamily: O, fontSize: 46, lineHeight: 1.08, color: WH }}><span style={{ flex: "none", color: LI }}>→</span><span>{t}</span></div>
      ))}
      <div style={{ marginTop: 16, fontFamily: OR, fontSize: 36, lineHeight: 1.25, color: MU }}>If it works on a phone, it works everywhere.</div>
    </div>
  </Shell>
);

/* Wed: A or B headline */
export const LynqAorB: React.FC = () => {
  const Card: React.FC<{ top: number; tag: string; text: string; win?: boolean }> = ({ top, tag, text, win }) => (
    <div style={{ position: "absolute", left: 70, right: 70, top, display: "flex", alignItems: "center", gap: 34, padding: "44px 44px", borderRadius: 44, background: win ? "#f6f3ec" : CARD, border: `3px solid ${win ? LI : LN}`, boxShadow: "none" }}>
      <div style={{ flex: "none", width: 110, height: 110, borderRadius: 55, background: win ? LI : "#20251f", fontFamily: O, fontSize: 70, lineHeight: "110px", textAlign: "center", color: win ? BK : MU }}>{tag}</div>
      <div style={{ fontFamily: O, fontSize: 64, lineHeight: 1.02, letterSpacing: -2, color: win ? "#14140f" : MU }}>{text}</div>
    </div>
  );
  return (
    <Shell kicker="A OR B, ROUND TWO">
      <Head l1="Which headline" l2="gets the booking?" size={104} />
      <Card top={470} tag="A" text="Welcome to our website" win />
      <Card top={760} tag="B" text="Burst pipe? Call now." win />
      <div style={{ position: "absolute", left: 70, right: 70, top: 1090, fontFamily: OR, fontSize: 40, color: MU }}>Comment A or B. We'll say why.</div>
    </Shell>
  );
};

/* ── Object set: one product-style photo on black, one hook that explains the object ──
 * The earlier object posts looked right but said nothing (a tiny ruler, tiny type). Rules applied here:
 * one object big enough to read as a thumbnail, a metaphor the headline solves in a second,
 * the business owner's problem in the headline, and one thing to do. */
const ObjPost: React.FC<{ img: string; l1: string; l2: string; sub: string; cta: string; size?: number; drop?: number }> = ({ img, l1, l2, sub, cta, size = 150, drop = 0 }) => (
  <AbsoluteFill style={{ background: drop ? "#020202" : "#0b0b0c", overflow: "hidden" }}>
    <Fonts />
    <Img src={staticFile(`lynq-obj/${img}.jpg`)} style={{ position: "absolute", left: -4, top: drop, width: 1088, height: 1350, objectFit: "cover", filter: "contrast(1.08) brightness(1.12)" }} />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(8,8,9,0.72) 0%, rgba(8,8,9,0.2) 34%, rgba(8,8,9,0) 50%, rgba(8,8,9,0) 78%, rgba(8,8,9,0.7) 100%)" }} />
    <div style={{ position: "absolute", left: 70, top: 64, display: "flex", alignItems: "center", gap: 16 }}>
      <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 44, height: 44 }} />
      <span style={{ fontFamily: O, fontSize: 38, letterSpacing: 5, color: WH }}>LYNQ</span>
    </div>
    <div style={{ position: "absolute", left: 66, right: 60, top: 170, fontFamily: O, fontSize: size, lineHeight: 0.94, letterSpacing: -size / 26, color: "#fff", whiteSpace: "nowrap" }}>{l1}<br /><span style={{ color: LI }}>{l2}</span></div>
    <div style={{ position: "absolute", left: 70, width: 760, top: 170 + size * 1.88 + 34, fontFamily: OR, fontSize: 44, lineHeight: 1.2, color: "rgba(255,255,255,0.86)" }}>{sub}</div>
    <div style={{ position: "absolute", right: 70, bottom: 70, padding: "22px 40px", borderRadius: 60, background: LI, fontFamily: O, fontSize: 38, color: "#0b0b0c" }}>{cta}</div>
    <div style={{ position: "absolute", left: 70, bottom: 86, fontFamily: OR, fontSize: 28, color: "rgba(255,255,255,0.6)" }}>lynq.build</div>
  </AbsoluteFill>
);

export const LynqObjStopwatch: React.FC = () => <ObjPost img="stopwatch" l1="5 seconds." l2="Then they leave." sub="Can a stranger tell what you sell from your first screen?" cta="Comment your one sentence" size={126} />;
export const LynqObjSign: React.FC = () => <ObjPost img="sign" l1="Your sign" l2="is blank." sub="That's your website to a stranger who can't tell what you sell." cta="Comment your one sentence" size={132} drop={150} />;

/** Today's post, polished: the whole sign in frame, lit so it reads, a lime cursor waiting on the blank board. */
export const LynqSignV2: React.FC = () => (
  <AbsoluteFill style={{ background: "#030303", overflow: "hidden" }}>
    <Fonts />
    {/* soft stage light behind the sign */}
    <div style={{ position: "absolute", left: 140, top: 380, width: 900, height: 900, borderRadius: 450, background: "radial-gradient(closest-side, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0) 100%)" }} />
    <Img src={staticFile("lynq-obj/sign.jpg")} style={{ position: "absolute", left: 48, top: 170, width: 984, height: 1221, objectFit: "cover", filter: "brightness(1.9) contrast(1.12)", mixBlendMode: "screen", WebkitMaskImage: "radial-gradient(ellipse 62% 60% at 52% 58%, #000 55%, transparent 100%)", maskImage: "radial-gradient(ellipse 62% 60% at 52% 58%, #000 55%, transparent 100%)" }} />
    {/* floor glow and the lime dot's light */}
    <div style={{ position: "absolute", left: 180, top: 1090, width: 760, height: 150, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)" }} />
    {/* the cursor: the board is waiting for one sentence */}
    <div style={{ position: "absolute", left: 452, top: 640, width: 7, height: 74, borderRadius: 4, background: LI, boxShadow: `0 0 26px ${LI}`, transform: "skewY(2deg) rotate(1.5deg)" }} />
    <AbsoluteFill style={{ background: "linear-gradient(90deg, #030303 0%, #030303 4%, rgba(3,3,3,0) 26%, rgba(3,3,3,0) 76%, #030303 96%, #030303 100%)" }} />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(3,3,3,0) 0%, rgba(3,3,3,0) 84%, #030303 97%, #030303 100%)" }} />

    <div style={{ position: "absolute", left: 70, top: 64, display: "flex", alignItems: "center", gap: 16 }}>
      <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 44, height: 44 }} />
      <span style={{ fontFamily: "'Inter SemiBold'", fontSize: 34, letterSpacing: 7, color: WH }}>LYNQ</span>
    </div>
    <div style={{ position: "absolute", right: 70, top: 76, fontFamily: "'Inter SemiBold'", fontSize: 22, letterSpacing: 6, color: LI }}>THE ONE SENTENCE RULE</div>
    <div style={{ position: "absolute", left: 64, right: 60, top: 160, fontFamily: "'Inter Light'", fontSize: 150, lineHeight: 0.98, letterSpacing: -8, color: "#fff", whiteSpace: "nowrap" }}>Your sign<br /><span style={{ color: LI }}>is blank.</span></div>
    <div style={{ position: "absolute", left: 74, top: 470, fontFamily: "'Inter Light'", fontSize: 38, letterSpacing: -0.5, color: "rgba(255,255,255,0.78)" }}>That's your website to a stranger.</div>

    <div style={{ position: "absolute", left: 70, right: 70, bottom: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: "'Inter Light'", fontSize: 28, color: "rgba(255,255,255,0.6)" }}>lynq.build</span>
      <span style={{ padding: "16px 32px", borderRadius: 50, border: `2px solid ${LI}`, fontFamily: "'Inter SemiBold'", fontSize: 27, color: LI }}>Comment your one sentence →</span>
    </div>
  </AbsoluteFill>
);

/*
 * Week of Nov 14: one object on black per day, each one a sale the owner never sees leaving.
 * Same build as the blank sign: Inter Light headline, one lime line, small lime label, no glow.
 */
const WeekObj: React.FC<{ img: string; label: string; l1: string; l2: string; sub: string; cta: string; size?: number }> = ({ img, label, l1, l2, sub, cta, size = 132 }) => (
  <AbsoluteFill style={{ background: "#030303", overflow: "hidden" }}>
    <Fonts />
    <Img src={staticFile(`lynq-obj/${img}.jpg`)} style={{ position: "absolute", left: 0, top: 50, width: 1080, height: 1341, objectFit: "cover", filter: "brightness(1.35) contrast(1.1)", mixBlendMode: "screen", WebkitMaskImage: "radial-gradient(ellipse 66% 56% at 50% 60%, #000 55%, transparent 100%)", maskImage: "radial-gradient(ellipse 66% 56% at 50% 60%, #000 55%, transparent 100%)" }} />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(3,3,3,0) 0%, rgba(3,3,3,0) 86%, #030303 98%, #030303 100%)" }} />
    <div style={{ position: "absolute", left: 70, top: 64, display: "flex", alignItems: "center", gap: 16 }}>
      <Img src={staticFile("ads/lynq-logo.svg")} style={{ width: 44, height: 44 }} />
      <span style={{ fontFamily: "'Inter SemiBold'", fontSize: 34, letterSpacing: 7, color: "#fff" }}>LYNQ</span>
    </div>
    <div style={{ position: "absolute", right: 70, top: 76, fontFamily: "'Inter SemiBold'", fontSize: 22, letterSpacing: 6, color: "#C7FF3D" }}>{label}</div>
    <div style={{ position: "absolute", left: 64, right: 60, top: 170, fontFamily: "'Inter Light'", fontSize: size, lineHeight: 1.0, letterSpacing: -size / 19, color: "#fff", whiteSpace: "nowrap" }}>{l1}<br /><span style={{ color: "#C7FF3D" }}>{l2}</span></div>
    <div style={{ position: "absolute", left: 72, top: 170 + size * 2 + 40, fontFamily: "'Inter Light'", fontSize: 38, letterSpacing: -0.5, color: "rgba(255,255,255,0.78)" }}>{sub}</div>
    <div style={{ position: "absolute", left: 70, right: 70, bottom: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: "'Inter Light'", fontSize: 28, color: "rgba(255,255,255,0.6)" }}>lynq.build</span>
      <span style={{ padding: "16px 32px", borderRadius: 50, border: "2px solid #C7FF3D", fontFamily: "'Inter SemiBold'", fontSize: 27, color: "#C7FF3D" }}>{cta}</span>
    </div>
  </AbsoluteFill>
);

export const LynqWkPadlock: React.FC = () => <WeekObj img="padlock" label="OPEN, BUT CLOSED" l1="Open sign." l2="Locked door." sub="A website with no way to book or buy." cta="Try booking on yours →" size={150} />;
export const LynqWkChair: React.FC = () => <WeekObj img="chair" label="THE EMPTY SLOT" l1="Someone wanted" l2="this appointment." sub="They couldn't book it, so they booked elsewhere." cta="Who filled it instead? →" size={118} />;
export const LynqWkHourglass: React.FC = () => <WeekObj img="hourglass" label="THE SLOW SITE" l1="They'll wait" l2="this long." sub="Then they tap back and pick the next one." cta="Time yours on your phone →" size={150} />;
export const LynqWkBottle: React.FC = () => <WeekObj img="bottle" label="THE CONTACT FORM" l1="How your contact" l2="form feels." sub="Sent. Then silence. A fast reply wins the job." cta="How fast do you reply? →" size={118} />;
export const LynqWkCups: React.FC = () => <WeekObj img="cups" label="BOOKING" l1="Your booking" l2="system?" sub="If booking means calling you, many just don't." cta="Let them book online →" size={150} />;
export const LynqWkBasket: React.FC = () => <WeekObj img="basket" label="THE ALMOST SALE" l1="They filled it." l2="Then they left." sub="One confusing step at checkout is enough." cta="Walk through your checkout →" size={136} />;
