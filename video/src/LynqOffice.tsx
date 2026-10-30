import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, staticFile } from "remotion";
import { Fonts, Sfx, Words, ramp, useSpringAt, useT } from "./kit";

/**
 * LYNQ Office: how our content gets made. Plan, design, approve from your
 * phone, posted. The post images are real posts from our own plan.
 */
const BK = "#0b0b0c", WH = "#ffffff", LI = "#c7ff3d", MU = "#8a8a8f", LN = "#2a2a2e", CARD = "#141416";
const q = (f: string) => `'${f}'`;
const CODEIT = ["c0", "c1", "c2", "c3", "c4", "c5"];
const LYNQ = ["l0", "l1", "l2", "l3"];

const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; color?: string }> = ({ children, style, color = MU }) => <div style={{ position: "absolute", fontFamily: q("JetBrains Mono"), fontSize: 26, letterSpacing: 4, color, ...style }}>{children}</div>;

/** Step tag top-left: 01 PLAN etc. */
const StepTag: React.FC<{ n: string; name: string; at: number }> = ({ n, name, at }) => {
  const p = useSpringAt(at, { damping: 16, stiffness: 180 });
  return <div style={{ position: "absolute", left: 90, top: 250, display: "flex", alignItems: "center", gap: 18, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}><span style={{ fontFamily: q("JetBrains Mono"), fontSize: 30, color: LI }}>{n}</span><span style={{ fontFamily: q("Inter Light"), fontSize: 92, color: WH, letterSpacing: -3 }}>{name}</span></div>;
};

/** 01 Plan: a week of posts dropping into the calendar. */
const Plan: React.FC = () => {
  const { s } = useT();
  const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const chips: { d: number; row: number; brand: "L" | "C"; label: string }[] = [
    { d: 0, row: 0, brand: "L", label: "Reel" }, { d: 0, row: 1, brand: "C", label: "Post" }, { d: 1, row: 0, brand: "C", label: "Reel" }, { d: 1, row: 1, brand: "L", label: "Story" },
    { d: 2, row: 0, brand: "L", label: "Post" }, { d: 2, row: 1, brand: "C", label: "Quiz" }, { d: 3, row: 0, brand: "C", label: "Post" }, { d: 3, row: 1, brand: "L", label: "Reel" },
    { d: 4, row: 0, brand: "L", label: "Story" }, { d: 4, row: 1, brand: "C", label: "Reel" }, { d: 5, row: 0, brand: "C", label: "Comic" }, { d: 5, row: 1, brand: "L", label: "Post" },
    { d: 6, row: 0, brand: "L", label: "Post" }, { d: 6, row: 1, brand: "C", label: "Post" },
  ];
  const cw = 120, x0 = 100;
  return (
    <div style={{ position: "absolute", left: 0, top: 560, width: 1080, height: 900 }}>
      <div style={{ position: "absolute", left: 80, right: 80, top: 0, bottom: 0, borderRadius: 40, background: CARD, border: `1px solid ${LN}` }} />
      {days.map((d, i) => <Label key={d} style={{ left: x0 + 20 + i * cw, top: 50, fontSize: 22 }}>{d}</Label>)}
      {chips.map((c, i) => {
        const at = 1.7 + i * 0.12;
        const p = useSpringAt(at, { damping: 13, stiffness: 220 });
        const on = c.brand === "L";
        return (
          <div key={i} style={{ position: "absolute", left: x0 + 14 + c.d * cw, top: 110 + c.row * 210 + (1 - p) * -80, width: cw - 16, height: 190, borderRadius: 20, background: on ? "#1f1f22" : "#2a1c0f", border: `2px solid ${on ? "#3a3a40" : "#6a3a12"}`, opacity: Math.min(1, p * 1.4), padding: 14, boxSizing: "border-box" }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, background: on ? LI : "#ff8a1f" }} />
            <div style={{ fontFamily: q("Inter SemiBold"), fontSize: 22, color: WH, marginTop: 70 }}>{on ? "LYNQ" : "CodeIt"}</div>
            <div style={{ fontFamily: q("Inter Light"), fontSize: 22, color: MU }}>{c.label}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 120, right: 120, top: 560, height: 2, background: LN }} />
      <Label style={{ left: 120, top: 610 }}>TWO WEEKS, PLANNED</Label>
      <div style={{ position: "absolute", left: 120, top: 660, fontFamily: q("Inter Light"), fontSize: 48, color: WH, opacity: ramp(s, 3.0, 3.4) }}>A post a day, per brand.</div>
    </div>
  );
};

/** 02 Design: the real posts fan out. */
const Design: React.FC = () => {
  const { s } = useT();
  const imgs = [...CODEIT.slice(0, 4), "l0", "l1"];
  return (
    <div style={{ position: "absolute", left: 0, top: 520, width: 1080, height: 1100 }}>
      {imgs.map((im, i) => {
        const at = 4.7 + i * 0.14;
        const p = useSpringAt(at, { damping: 14, stiffness: 150 });
        const tall = im.startsWith("l");
        const w = tall ? 260 : 300, h = tall ? 462 : 300;
        const col = i % 3, row = Math.floor(i / 3);
        const x = 80 + col * 320 + (tall ? 20 : 0), y = 40 + row * 480 + (tall ? -60 : 0);
        return <Img key={im} src={staticFile(`office/${im}.jpg`)} style={{ position: "absolute", left: x, top: y + (1 - p) * 200, width: w, height: h, objectFit: "cover", borderRadius: 24, boxShadow: "0 40px 80px rgba(0,0,0,0.6)", opacity: Math.min(1, p * 1.5), transform: `rotate(${(i % 2 ? 1 : -1) * (2 + i)}deg) scale(${0.85 + p * 0.15 + ramp(s, 6.5, 8) * 0.04})` }} />;
      })}
    </div>
  );
};

/** 03 Approve: a phone with the approval message and one tap. */
const Approve: React.FC = () => {
  const { s } = useT();
  const phone = useSpringAt(8.2, { damping: 16, stiffness: 130 });
  const tapped = s > 9.9;
  const press = s > 9.8 && s < 10.0 ? 0.94 : 1;
  return (
    <div style={{ position: "absolute", left: 250, top: 480 + (1 - phone) * 1300, width: 580, height: 1180, borderRadius: 86, background: "#161618", boxShadow: "0 60px 120px rgba(0,0,0,0.7), inset 0 0 0 3px #2e2e33" }}>
      <div style={{ position: "absolute", left: 18, top: 18, right: 18, bottom: 18, borderRadius: 70, overflow: "hidden", background: "#0f0f11" }}>
        <div style={{ padding: "110px 34px 0" }}>
          <div style={{ fontFamily: q("JetBrains Mono"), fontSize: 20, letterSpacing: 3, color: MU }}>LYNQ OFFICE · 8:00 AM</div>
          <div style={{ marginTop: 22, borderRadius: 30, background: "#1c1c1f", padding: 22 }}>
            <Img src={staticFile("office/c0.jpg")} style={{ width: "100%", borderRadius: 18, display: "block" }} />
            <div style={{ fontFamily: q("Inter SemiBold"), fontSize: 28, color: WH, marginTop: 18 }}>CodeIt · tonight 7:30</div>
            <div style={{ fontFamily: q("Inter Light"), fontSize: 24, color: "#b4b4ba", marginTop: 6, lineHeight: 1.3 }}>Same game. One number changed…</div>
            <div style={{ display: "flex", gap: 14, marginTop: 22 }}>
              <div style={{ flex: 1, padding: "22px 0", borderRadius: 22, textAlign: "center", background: tapped ? LI : "#2a2a2e", color: tapped ? BK : WH, fontFamily: q("Inter SemiBold"), fontSize: 28, transform: `scale(${press})` }}>{tapped ? "Approved ✓" : "Approve"}</div>
              <div style={{ padding: "22px 26px", borderRadius: 22, background: "#2a2a2e", color: WH, fontFamily: q("Inter SemiBold"), fontSize: 28 }}>Edit</div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 230, top: 34, width: 120, height: 34, borderRadius: 17, background: "#050506" }} />
      {s > 9.3 && s < 10.3 && <div style={{ position: "absolute", left: 160, top: 1010 + Math.max(0, 9.8 - s) * 300, width: 90, height: 90, borderRadius: 45, background: "rgba(255,255,255,0.35)", border: "3px solid #fff", opacity: 1 - ramp(s, 10.0, 10.3) }} />}
    </div>
  );
};

/** 04 Posted: the profile grid fills in. */
const Posted: React.FC = () => {
  const grid = ["c3", "c4", "c5", "c0", "c1", "c2", "c3", "c4", "c0"];
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 26, marginBottom: 34 }}>
        <div style={{ width: 110, height: 110, borderRadius: 55, background: "#ff8a1f" }} />
        <div><div style={{ fontFamily: q("Inter SemiBold"), fontSize: 40, color: WH }}>codeitlearn</div><div style={{ fontFamily: q("Inter Light"), fontSize: 28, color: MU }}>A post a day. Made and scheduled by LYNQ Office.</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {grid.map((im, i) => {
          const p = useSpringAt(11.2 + i * 0.09, { damping: 14, stiffness: 220 });
          return <Img key={i} src={staticFile(`office/${im}.jpg`)} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", opacity: Math.min(1, p * 1.4), transform: `scale(${0.7 + p * 0.3})` }} />;
        })}
      </div>
    </div>
  );
};

export const LynqOffice: React.FC = () => {
  const { s } = useT();
  const end = useSpringAt(13.4, { damping: 18, stiffness: 120 });
  const button = useSpringAt(14.3, { damping: 10, stiffness: 220 });
  const progress = Math.min(1, s / 16);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 25% 12%, #1d1d21 0%, ${BK} 60%)` }}>
      <Fonts />
      {s < 1.6 && (
        <div style={{ position: "absolute", left: 90, right: 90, top: 640 }}>
          <Words text="This post was" at={0.05} size={88} color={WH} font="Inter Light" weight={300} letterSpacing={-3} out={1.35} />
          <Words text="planned, designed" at={0.3} size={88} color={WH} font="Inter Light" weight={300} letterSpacing={-3} out={1.35} />
          <Words text="and scheduled" at={0.55} size={88} color={WH} font="Inter Light" weight={300} letterSpacing={-3} out={1.35} />
          <Words text="by one system." at={0.8} size={88} color={LI} font="Inter Light" weight={300} letterSpacing={-3} out={1.35} />
        </div>
      )}
      {s >= 1.5 && s < 4.5 && <><StepTag n="01" name="Plan" at={1.5} /><Plan /></>}
      {s >= 4.5 && s < 8.1 && <><StepTag n="02" name="Design" at={4.5} /><Design /></>}
      {s >= 8.1 && s < 11.0 && <><StepTag n="03" name="Approve, by phone" at={8.1} /><Approve /></>}
      {s >= 11.0 && s < 13.4 && <><StepTag n="04" name="Posted" at={11.0} /><Posted /></>}
      {s >= 13.4 && (
        <div style={{ position: "absolute", left: 90, right: 90, top: 600, opacity: end }}>
          <Words text="We set this up" at={13.45} size={110} color={WH} font="Inter Light" weight={300} letterSpacing={-3} />
          <Words text="for your business." at={13.75} size={110} color={WH} font="Inter Light" weight={300} letterSpacing={-3} />
          <div style={{ height: 70 }} />
          <div style={{ display: "inline-block", padding: "34px 70px", borderRadius: 70, background: LI, fontFamily: q("Inter SemiBold"), fontSize: 64, color: BK, transform: `scale(${button})` }}>DM OFFICE</div>
          <div style={{ fontFamily: q("Inter Light"), fontSize: 44, color: MU, marginTop: 40 }}>Plans, posts and replies, done for you.</div>
        </div>
      )}
      <Label style={{ left: 90, top: 120 }} color={WH}>LYNQ</Label>
      <Label style={{ right: 90, top: 120 }}>LYNQ OFFICE · BEHIND THE POSTS</Label>
      <div style={{ position: "absolute", left: 90, right: 90, bottom: 170, height: 2, background: LN }}><div style={{ width: `${progress * 100}%`, height: 2, background: LI }} /></div>
      <Label style={{ left: 90, bottom: 110 }}>LYNQ.BUILD</Label>
      <Audio src={staticFile("sfx/lynq-bed.mp3")} volume={(f) => interpolate(f, [0, 15, 450, 480], [0, 0.35, 0.35, 0], { extrapolateRight: "clamp" })} />
      <Sfx at={0.05} src="thump.wav" />
      {[1.5, 4.5, 8.1, 11.0, 13.4].map((t) => <Sfx key={t} at={t} src="whoosh.wav" volume={0.6} />)}
      <Sfx at={9.85} src="click.wav" />
      <Sfx at={9.9} src="ding.wav" volume={0.6} />
      <Sfx at={14.3} src="pop.wav" />
    </AbsoluteFill>
  );
};
