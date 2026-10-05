import React from "react";

/**
 * LYNQ post/video frames are rendered deterministically (Satori), not by an
 * image model. Before this module every LYNQ panel was the same frame — a
 * label, a headline and the brand card — which reads as a template no matter
 * what the copy says. The approved LYNQ posts are *scenes with a concept*
 * (a bottleneck, a door with light pouring out, a whiteboard with a sticky
 * note) plus a layered type system: small lockup top-left, one big line,
 * a quiet caption and little annotation labels pointing at the scene.
 *
 * The Creative Director prompt asks for a visual metaphor per panel using the
 * grammar parsed by `parseLynqVisualDirection`; this module draws it. Anything
 * older (or hand-edited) without a metaphor is inferred from the words so the
 * studio never falls back to the template look.
 */

export const LYNQ_SCENE_TOKENS = ["brand", "website", "portfolio", "systems", "office", "automation", "cta"] as const;
export type LynqScene = (typeof LYNQ_SCENE_TOKENS)[number];

export const LYNQ_METAPHORS = [
  "bottleneck",
  "open_door",
  "sticky_note",
  "broken_handoff",
  "spotlight",
  "blueprint",
  "signal",
  "stack",
  "path",
  "storefront",
  "cta",
] as const;
export type LynqMetaphor = (typeof LYNQ_METAPHORS)[number];

export const LYNQ_METAPHOR_GUIDE: Record<LynqMetaphor, string> = {
  bottleneck: "demand jammed before a narrow neck, one unit getting through — for friction, slow handoffs, lost leads",
  open_door: "a door ajar in a dark wall with light pouring onto the floor — for access, the first impression, an invitation",
  sticky_note: "a whiteboard of wireframes with one lime sticky note — for the plan, the one decision, the idea before the build",
  broken_handoff: "a chain of connected steps with one link broken — for disconnected systems, dropped follow-ups",
  spotlight: "one page lit by a single cone of light on a dark stage — for focus, a clear offer, one next step",
  blueprint: "a landing page drawn as a measured technical plan — for structure, craft, how a page is built",
  signal: "one clean line cutting through noisy ones — for clarity, message, cutting through",
  stack: "layered plates: the website on top, the systems underneath — for the operating layer behind the page",
  path: "a tangled route that resolves into one straight line to a target — for the customer journey, conversion",
  storefront: "the real website shown as a lit shop window at night — for the business customers actually meet",
  cta: "minimal closing frame with the call to action and lynq.build — final panel only",
};

const INK = "#f7f7f2";
const LIME = "#c8ff00";
const BG = "#050505";
const GREY = "#55554f";
const DIM = "#262624";

export interface LynqVisualDirection {
  scene: LynqScene | null;
  metaphor: LynqMetaphor | null;
  description: string;
  labels: string[];
}

/**
 * Parses `website: metaphor=open_door | Shop window at night | labels: offer; next step`.
 * Every part is optional so hand-written directions still work.
 */
export function parseLynqVisualDirection(visual: string): LynqVisualDirection {
  const trimmed = visual.trim();
  const sceneMatch = trimmed.match(/^([a-z_]+)\s*:/i);
  const sceneCandidate = sceneMatch?.[1]?.toLowerCase();
  const scene = (LYNQ_SCENE_TOKENS as readonly string[]).includes(sceneCandidate ?? "") ? (sceneCandidate as LynqScene) : null;
  const metaphorMatch = trimmed.match(/metaphor\s*[=:]\s*([a-z_]+)/i);
  const metaphorCandidate = metaphorMatch?.[1]?.toLowerCase();
  const metaphor = (LYNQ_METAPHORS as readonly string[]).includes(metaphorCandidate ?? "") ? (metaphorCandidate as LynqMetaphor) : null;
  const labelsMatch = trimmed.match(/labels?\s*[=:]\s*([^|]+)/i);
  const labels = (labelsMatch?.[1] ?? "")
    .split(/[;·•]/)
    .map((label) => label.trim().replace(/[.]+$/, ""))
    .filter(Boolean)
    .slice(0, 3);
  const description = trimmed
    .replace(/^[a-z_]+\s*:/i, "")
    .replace(/metaphor\s*[=:]\s*[a-z_]+/i, "")
    .replace(/labels?\s*[=:]\s*[^|]+/i, "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  return { scene, metaphor, description, labels };
}

const KEYWORD_METAPHORS: Array<[RegExp, LynqMetaphor]> = [
  [/bottleneck|queue|backlog|jam|stuck|slow|wait/, "bottleneck"],
  [/door|open|enter|welcome|first impression|invite/, "open_door"],
  [/sticky|whiteboard|plan|sketch|idea|decide|decision/, "sticky_note"],
  [/handoff|hand-off|broken|gap|disconnect|dropped|missed|follow-up|follow up/, "broken_handoff"],
  [/spotlight|focus|one offer|clear offer|obvious|next step/, "spotlight"],
  [/blueprint|structure|layout|wireframe|how .*built|craft/, "blueprint"],
  [/noise|signal|clarity|clear message|cut through|say it/, "signal"],
  [/layer|stack|system|behind|operating|crm|workflow|office/, "stack"],
  [/path|journey|funnel|convert|route|customer walks|automation|automat/, "path"],
  [/website|landing|homepage|portfolio|site|work|storefront|page customers/, "storefront"],
];

const SCENE_DEFAULT_METAPHOR: Record<LynqScene, LynqMetaphor> = {
  brand: "signal",
  website: "storefront",
  portfolio: "storefront",
  systems: "stack",
  office: "blueprint",
  automation: "path",
  cta: "cta",
};

const VARIETY_ORDER: LynqMetaphor[] = ["storefront", "bottleneck", "open_door", "broken_handoff", "spotlight", "sticky_note", "stack", "path", "blueprint", "signal"];

/**
 * Picks a metaphor for every panel/shot of one package at once so a carousel
 * never repeats a scene unless the director explicitly asked for it.
 */
export function assignLynqMetaphors(items: Array<{ visual: string; onScreenText: string }>): LynqMetaphor[] {
  const count = items.length;
  const used = new Set<LynqMetaphor>();
  return items.map((item, index) => {
    const direction = parseLynqVisualDirection(item.visual);
    const text = `${item.visual} ${item.onScreenText}`.toLowerCase();
    const isFinal = count > 1 && index === count - 1;
    let choice: LynqMetaphor | null = direction.metaphor;
    if (!choice && (isFinal || direction.scene === "cta" || /\bcta\b|lynq\.build|book a|strategy call/.test(text))) choice = "cta";
    if (!choice) choice = KEYWORD_METAPHORS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
    if (!choice && direction.scene) choice = SCENE_DEFAULT_METAPHOR[direction.scene];
    if (!choice || (choice !== "cta" && used.has(choice) && !direction.metaphor)) {
      choice = VARIETY_ORDER.find((candidate) => !used.has(candidate)) ?? VARIETY_ORDER[index % VARIETY_ORDER.length];
    }
    used.add(choice);
    return choice;
  });
}

const DEFAULT_LABELS: Record<LynqMetaphor, string[]> = {
  bottleneck: ["Demand", "The handoff", "What gets through"],
  open_door: ["First impression", "What customers see"],
  sticky_note: ["The plan", "One decision"],
  broken_handoff: ["Enquiry", "The dropped step", "Follow-up"],
  spotlight: ["One clear offer", "The next step"],
  blueprint: ["Structure", "Call to action"],
  signal: ["Noise", "Your message"],
  stack: ["The website", "The systems behind it"],
  path: ["Where they start", "Where they convert"],
  storefront: ["The page customers meet"],
  cta: [],
};

type Anchor = { x: number; y: number; align: "left" | "right"; dark?: boolean };
const LABEL_ANCHORS: Record<LynqMetaphor, Anchor[]> = {
  bottleneck: [{ x: 7, y: 9, align: "left" }, { x: 62, y: 76, align: "left" }, { x: 94, y: 22, align: "right" }],
  open_door: [{ x: 7, y: 9, align: "left" }, { x: 94, y: 86, align: "right" }],
  sticky_note: [{ x: 92, y: 10, align: "right", dark: true }, { x: 9, y: 90, align: "left", dark: true }],
  broken_handoff: [{ x: 7, y: 12, align: "left" }, { x: 60, y: 76, align: "left" }, { x: 94, y: 12, align: "right" }],
  spotlight: [{ x: 7, y: 9, align: "left" }, { x: 94, y: 88, align: "right" }],
  blueprint: [{ x: 7, y: 9, align: "left" }, { x: 94, y: 88, align: "right" }],
  signal: [{ x: 7, y: 9, align: "left" }, { x: 94, y: 88, align: "right" }],
  stack: [{ x: 7, y: 9, align: "left" }, { x: 94, y: 88, align: "right" }],
  path: [{ x: 7, y: 9, align: "left" }, { x: 94, y: 88, align: "right" }],
  storefront: [{ x: 94, y: 93.5, align: "right" }],
  cta: [],
};

function seeded(seed: number) {
  let state = (seed * 9301 + 49297) % 233280;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function Bottleneck() {
  const random = seeded(7);
  const dots = Array.from({ length: 46 }, (_, index) => {
    const x = 90 + random() * 440;
    const spread = 1 - (x - 90) / 440;
    const y = 300 + (random() - 0.5) * (120 + spread * 300);
    return <circle key={index} cx={x} cy={y} r={random() > 0.7 ? 11 : 8} fill={INK} opacity={0.55 + random() * 0.35} />;
  });
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      <path d="M40 60 L560 60 C650 60 650 265 740 265 L920 265 L920 335 L740 335 C650 335 650 540 560 540 L40 540 Z" fill="#0c0c0b" stroke={GREY} strokeWidth="2" />
      {dots}
      <line x1="740" y1="300" x2="920" y2="300" stroke={LIME} strokeWidth="3" strokeDasharray="10 12" />
      <circle cx="668" cy="300" r="13" fill={LIME} />
      <circle cx="668" cy="300" r="30" fill="none" stroke={LIME} strokeWidth="2" opacity="0.5" />
    </svg>
  );
}

function OpenDoor() {
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      <defs>
        <linearGradient id="doorLight" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={LIME} stopOpacity="0.55" />
          <stop offset="1" stopColor={LIME} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="960" height="600" fill="#070707" />
      <line x1="0" y1="500" x2="960" y2="500" stroke={DIM} strokeWidth="2" />
      <rect x="350" y="70" width="230" height="430" fill="#111110" stroke={GREY} strokeWidth="3" />
      <polygon points="520,70 620,100 620,470 520,500" fill="#1a1a18" stroke={INK} strokeWidth="2" />
      <circle cx="600" cy="300" r="6" fill={INK} />
      <polygon points="353,500 517,500 900,580 60,580" fill="url(#doorLight)" />
      <rect x="353" y="73" width="164" height="427" fill={LIME} opacity="0.92" />
      <rect x="353" y="73" width="164" height="427" fill="#ffffff" opacity="0.18" />
    </svg>
  );
}

function StickyNote() {
  const boxes: React.ReactNode[] = [];
  const grid = [
    [70, 70, 280, 60], [70, 150, 280, 160], [370, 70, 150, 240], [540, 70, 120, 60], [70, 340, 590, 70], [70, 430, 180, 110], [270, 430, 390, 110],
  ];
  grid.forEach(([x, y, w, h], index) => boxes.push(<rect key={index} x={x} y={y} width={w} height={h} fill="none" stroke="#8d8d87" strokeWidth="2.5" rx="3" />));
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      <rect x="20" y="20" width="920" height="560" fill="#ebebe6" stroke="#cfcfca" strokeWidth="4" rx="6" />
      {boxes}
      <line x1="90" y1="110" x2="300" y2="110" stroke="#8d8d87" strokeWidth="2.5" />
      <line x1="90" y1="190" x2="320" y2="190" stroke="#b2b2ac" strokeWidth="2" />
      <line x1="90" y1="215" x2="290" y2="215" stroke="#b2b2ac" strokeWidth="2" />
      <line x1="90" y1="240" x2="300" y2="240" stroke="#b2b2ac" strokeWidth="2" />
      <g transform="rotate(-6 760 240)">
        <rect x="640" y="130" width="240" height="230" fill="#000" opacity="0.18" transform="translate(10 14)" />
        <rect x="640" y="130" width="240" height="230" fill={LIME} />
      </g>
    </svg>
  );
}

function BrokenHandoff() {
  const nodes = [110, 300, 490, 680, 860];
  const y = (index: number) => 300 + Math.sin(index * 1.2) * 70;
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      {nodes.slice(0, -1).map((x, index) => {
        const next = nodes[index + 1];
        if (index === 2) {
          return (
            <g key={index}>
              <line x1={x + 32} y1={y(index)} x2={x + 95} y2={y(index) + 6} stroke={GREY} strokeWidth="3" />
              <line x1={next - 95} y1={y(index + 1) - 6} x2={next - 32} y2={y(index + 1)} stroke={GREY} strokeWidth="3" />
              <polyline points={`${x + 110},${y(index) - 36} ${x + 128},${y(index) + 8} ${x + 100},${y(index) + 4} ${x + 118},${y(index) + 50}`} fill="none" stroke={LIME} strokeWidth="4" strokeLinejoin="round" />
            </g>
          );
        }
        return <line key={index} x1={x + 32} y1={y(index)} x2={next - 32} y2={y(index + 1)} stroke={GREY} strokeWidth="3" />;
      })}
      {nodes.map((x, index) => (
        <g key={x}>
          <circle cx={x} cy={y(index)} r="30" fill="#0d0d0c" stroke={index === 3 ? LIME : INK} strokeWidth={index === 3 ? 4 : 2.5} />
          <circle cx={x} cy={y(index)} r="7" fill={index === 3 ? LIME : INK} />
        </g>
      ))}
    </svg>
  );
}

function Spotlight() {
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      <defs>
        <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={LIME} stopOpacity="0.02" />
          <stop offset="1" stopColor={LIME} stopOpacity="0.32" />
        </linearGradient>
      </defs>
      <polygon points="470,-20 490,-20 760,470 200,470" fill="url(#cone)" />
      <ellipse cx="480" cy="470" rx="280" ry="46" fill={LIME} opacity="0.28" />
      <rect x="380" y="250" width="200" height="250" rx="6" fill="#f7f7f2" />
      <rect x="402" y="278" width="110" height="12" rx="3" fill="#111" />
      <rect x="402" y="300" width="150" height="7" rx="3" fill="#8d8d87" />
      <rect x="402" y="316" width="130" height="7" rx="3" fill="#8d8d87" />
      <rect x="402" y="332" width="140" height="7" rx="3" fill="#8d8d87" />
      <rect x="402" y="440" width="120" height="34" rx="17" fill="#050505" />
      <rect x="418" y="454" width="88" height="6" rx="3" fill={LIME} />
    </svg>
  );
}

function Blueprint() {
  const verticals = Array.from({ length: 24 }, (_, index) => <line key={`v${index}`} x1={index * 40} y1="0" x2={index * 40} y2="600" stroke="#161615" strokeWidth="1" />);
  const horizontals = Array.from({ length: 15 }, (_, index) => <line key={`h${index}`} x1="0" y1={index * 40} x2="960" y2={index * 40} stroke="#161615" strokeWidth="1" />);
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      {verticals}
      {horizontals}
      <rect x="250" y="50" width="460" height="500" fill="#070707" stroke={INK} strokeWidth="2" />
      <line x1="250" y1="110" x2="710" y2="110" stroke={INK} strokeWidth="1.5" />
      <rect x="272" y="72" width="70" height="16" fill={INK} />
      <rect x="560" y="72" width="130" height="16" fill="none" stroke={GREY} strokeWidth="1.5" />
      <rect x="290" y="160" width="260" height="34" fill="none" stroke={INK} strokeWidth="1.5" />
      <rect x="290" y="206" width="200" height="34" fill="none" stroke={INK} strokeWidth="1.5" />
      <rect x="290" y="270" width="150" height="40" rx="20" fill={LIME} />
      <rect x="290" y="350" width="400" height="160" fill="none" stroke={GREY} strokeWidth="1.5" strokeDasharray="6 6" />
      <line x1="230" y1="50" x2="230" y2="550" stroke={LIME} strokeWidth="1.5" />
      <line x1="222" y1="50" x2="238" y2="50" stroke={LIME} strokeWidth="1.5" />
      <line x1="222" y1="550" x2="238" y2="550" stroke={LIME} strokeWidth="1.5" />
      <line x1="250" y1="30" x2="710" y2="30" stroke={LIME} strokeWidth="1.5" />
      <line x1="250" y1="22" x2="250" y2="38" stroke={LIME} strokeWidth="1.5" />
      <line x1="710" y1="22" x2="710" y2="38" stroke={LIME} strokeWidth="1.5" />
      <circle cx="440" cy="290" r="18" fill="none" stroke={LIME} strokeWidth="1.5" />
      <line x1="458" y1="290" x2="740" y2="290" stroke={LIME} strokeWidth="1.5" strokeDasharray="4 6" />
    </svg>
  );
}

function Signal() {
  const random = seeded(3);
  const noise = Array.from({ length: 16 }, (_, line) => {
    const points = Array.from({ length: 25 }, (_, index) => `${index * 40},${80 + line * 28 + (random() - 0.5) * 90}`).join(" ");
    return <polyline key={line} points={points} fill="none" stroke="#2b2b29" strokeWidth="2" />;
  });
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      {noise}
      <path d="M0 330 C 240 330, 300 240, 480 240 S 720 330, 960 300" fill="none" stroke={LIME} strokeWidth="5" strokeLinecap="round" />
      <circle cx="480" cy="240" r="9" fill={LIME} />
    </svg>
  );
}

function Stack() {
  const plate = (y: number, stroke: string, fill: string, width = 2) => <polygon points={`200,${y} 620,${y - 130} 900,${y - 40} 480,${y + 90}`} fill={fill} stroke={stroke} strokeWidth={width} />;
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      {plate(470, GREY, "#0b0b0a")}
      {plate(380, GREY, "#0f0f0e")}
      {plate(290, LIME, "#141413", 3)}
      <polygon points="300,290 600,197 750,245 450,338" fill="#f7f7f2" />
      <polygon points="330,284 420,256 450,266 360,294" fill="#111" />
      <polygon points="330,300 490,250 520,260 360,310" fill="#8d8d87" />
      <polygon points="470,322 540,300 575,311 505,333" fill={LIME} />
      <line x1="480" y1="560" x2="480" y2="380" stroke={LIME} strokeWidth="1.5" strokeDasharray="4 6" />
      <line x1="480" y1="470" x2="480" y2="290" stroke={LIME} strokeWidth="1.5" strokeDasharray="4 6" />
    </svg>
  );
}

function Path() {
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      <path d="M40 420 C 120 120, 200 520, 260 300 S 330 100, 360 320 S 420 540, 470 300 C 500 160, 520 300, 560 300" fill="none" stroke={GREY} strokeWidth="4" strokeLinecap="round" />
      <line x1="560" y1="300" x2="800" y2="300" stroke={LIME} strokeWidth="5" strokeLinecap="round" />
      <circle cx="40" cy="420" r="10" fill={INK} />
      <circle cx="850" cy="300" r="50" fill="none" stroke={INK} strokeWidth="2" />
      <circle cx="850" cy="300" r="30" fill="none" stroke={INK} strokeWidth="2" />
      <circle cx="850" cy="300" r="11" fill={LIME} />
    </svg>
  );
}

function Cta() {
  return (
    <svg viewBox="0 0 960 600" width="100%" height="100%">
      <circle cx="480" cy="300" r="200" fill="none" stroke={DIM} strokeWidth="2" />
      <circle cx="480" cy="300" r="200" fill="none" stroke={LIME} strokeWidth="4" strokeDasharray="314 942" strokeLinecap="round" transform="rotate(-90 480 300)" />
      <line x1="380" y1="300" x2="580" y2="300" stroke={INK} strokeWidth="6" strokeLinecap="round" />
      <polyline points="520,240 580,300 520,360" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Storefront({ screen }: { screen: string }) {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", position: "relative", background: "#0a0a09", border: `1px solid ${DIM}` }}>
      <div style={{ display: "flex", position: "absolute", left: "0", right: "0", top: "0", height: "9%", background: "#161615", borderBottom: `3px solid ${LIME}` }} />
      <div style={{ display: "flex", position: "absolute", left: "7%", right: "7%", top: "15%", bottom: "9%", background: "#111", border: `2px solid ${GREY}`, boxShadow: `0 0 90px rgba(200,255,0,0.14)`, overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={screen} alt="Real LYNQ website work" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        <div style={{ display: "flex", position: "absolute", left: "0", top: "0", width: "100%", height: "100%", background: "linear-gradient(160deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 38%)" }} />
      </div>
      <div style={{ display: "flex", position: "absolute", left: "0", right: "0", bottom: "0", height: "9%", background: "#0d0d0c", borderTop: `1px solid ${DIM}` }} />
      <div style={{ display: "flex", position: "absolute", left: "7%", top: "11%", padding: "4px 10px", background: LIME, color: BG, fontSize: "13px", fontWeight: 800, letterSpacing: "0.16em" }}>OPEN</div>
    </div>
  );
}

export function LynqSceneArt({ metaphor, screen }: { metaphor: LynqMetaphor; screen: string }) {
  switch (metaphor) {
    case "bottleneck": return <Bottleneck />;
    case "open_door": return <OpenDoor />;
    case "sticky_note": return <StickyNote />;
    case "broken_handoff": return <BrokenHandoff />;
    case "spotlight": return <Spotlight />;
    case "blueprint": return <Blueprint />;
    case "signal": return <Signal />;
    case "stack": return <Stack />;
    case "path": return <Path />;
    case "storefront": return <Storefront screen={screen} />;
    case "cta": return <Cta />;
  }
}

export function lynqLabelsFor(metaphor: LynqMetaphor, provided: string[]) {
  const all = provided.length ? provided : DEFAULT_LABELS[metaphor];
  // The sticky note shows its first label as the note itself; only the rest are pinned around it.
  const labels = metaphor === "sticky_note" ? all.slice(1) : all;
  return LABEL_ANCHORS[metaphor].slice(0, labels.length).map((anchor, index) => ({ ...anchor, text: labels[index] }));
}

export interface LynqFrameInput {
  assets: { logo: string; website: string; portfolio: string };
  scene: LynqScene;
  metaphor: LynqMetaphor;
  headline: string;
  caption: string;
  labels: string[];
  index: number;
  count: number;
  callToAction: string;
  /** true = 1080×1350 post panel, false = 720×1280 video frame */
  square: boolean;
}

/**
 * The LYNQ frame: lockup top-left, one big line, the scene with annotation
 * labels, a quiet caption, and a minimal lynq.build sign-off.
 */
export function LynqFrame({ assets, scene, metaphor, headline, caption, labels, index, count, callToAction, square }: LynqFrameInput) {
  const s = square ? 1 : 0.72;
  const px = (value: number) => `${Math.round(value * s)}px`;
  const line = metaphor === "cta" ? callToAction : headline;
  const bigSize = line.length > 90 ? 56 : line.length > 60 ? 66 : 80;
  const placed = lynqLabelsFor(metaphor, labels);
  const screen = scene === "portfolio" ? assets.portfolio : assets.website;
  const sticky = metaphor === "sticky_note" ? (labels[0] ?? DEFAULT_LABELS.sticky_note[0]) : null;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: `${px(56)} ${px(60)} ${px(44)}`, background: BG, color: INK, fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: px(16) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assets.logo} alt="LYNQ" style={{ width: px(118), height: px(48), objectFit: "contain", objectPosition: "left", filter: "brightness(0) invert(1)" }} />
          <span style={{ width: "1px", height: px(26), background: GREY }} />
          <span style={{ color: "#8f8f89", fontSize: px(16), letterSpacing: "0.22em", fontWeight: 700 }}>{scene === "cta" || metaphor === "cta" ? "NEXT STEP" : scene === "portfolio" ? "SELECTED WORK" : scene === "systems" || scene === "automation" || scene === "office" ? "THE SYSTEM BEHIND IT" : "WEBSITES & LANDING PAGES"}</span>
        </div>
        {count > 1 ? <span style={{ color: LIME, fontWeight: 800, fontSize: px(18), letterSpacing: "0.14em" }}>{String(index + 1).padStart(2, "0")} — {String(count).padStart(2, "0")}</span> : null}
      </div>

      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: px(30) }}>
        <div style={{ display: "flex", maxWidth: "94%", fontSize: px(bigSize), lineHeight: 0.98, fontWeight: 800, letterSpacing: "-0.045em" }}>{line}</div>

        <div style={{ display: "flex", position: "relative", width: "100%", height: px(600), overflow: "hidden" }}>
          <LynqSceneArt metaphor={metaphor} screen={screen} />
          {sticky ? (
            <div style={{ display: "flex", position: "absolute", left: "67.5%", top: "25%", width: "22%", height: "34%", transform: "rotate(-6deg)", alignItems: "center", justifyContent: "center", textAlign: "center", padding: px(14), color: BG, fontSize: px(sticky.length > 22 ? 22 : 28), lineHeight: 1.1, fontWeight: 800, letterSpacing: "-0.02em" }}>{sticky}</div>
          ) : null}
          {placed.map((label) => (
            <div key={label.text} style={{ display: "flex", position: "absolute", top: `${label.y}%`, ...(label.align === "left" ? { left: `${label.x}%` } : { right: `${100 - label.x}%` }), alignItems: "center", gap: px(10), flexDirection: label.align === "left" ? "row" : "row-reverse" }}>
              <span style={{ width: px(8), height: px(8), borderRadius: "99px", background: LIME, boxShadow: `0 0 0 ${px(4)} rgba(200,255,0,0.18)` }} />
              <span style={{ width: px(28), height: "1px", background: label.dark ? "#3a3a37" : "#8f8f89" }} />
              <span style={{ fontSize: px(15), letterSpacing: "0.16em", fontWeight: 700, color: label.dark ? "#1a1a18" : INK, background: label.dark ? "rgba(235,235,230,0.85)" : "rgba(5,5,5,0.72)", padding: `${px(5)} ${px(9)}` }}>{label.text.toUpperCase()}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", maxWidth: "78%", fontSize: px(22), lineHeight: 1.4, color: "#9a9a94" }}>{caption}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: px(22), borderTop: `1px solid ${DIM}`, fontSize: px(16), letterSpacing: "0.14em" }}>
        <span style={{ color: "#6f6f69" }}>{metaphor === "cta" ? callToAction.toUpperCase() : "WEBSITES → SYSTEMS → GROWTH"}</span>
        <span style={{ color: LIME, fontWeight: 800 }}>LYNQ.BUILD</span>
      </div>
    </div>
  );
}
