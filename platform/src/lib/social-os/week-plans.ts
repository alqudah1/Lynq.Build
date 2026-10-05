import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingChannelAccounts, marketingContentItems } from "@/db/schema";
import { createBrand, listBrands } from "./brands";
import { updateAccount } from "./connections";
import { createContentItem, getContentItemForUser, getVariantForUser, updateVariant, type SocialContentItem } from "./content";
import { regenerateVariantPart, zonedDateTimeToUtc } from "./studio";
import type { BrandProfileInput, SocialContentBrief, SocialContentKind, SocialOrganicPlatform, SocialVariantPlatformOptions } from "./validation";

/**
 * Week plans: a fixed, reviewed content plan that one click loads into the
 * Office as dated drafts — feed posts, stories (each tagged with the
 * highlight it belongs in) and reels (with the script to film) — for every
 * brand in the plan. Nothing is submitted, approved or published here: the
 * morning Telegram send and the owner's tap do that.
 *
 * Applying a plan twice is safe: every created item carries a marker in its
 * brief, and existing drafts are only re-dated while still drafts.
 */

type Db = NeonHttpDatabase<Record<string, unknown>>;

const PLAN_TZ = "America/Toronto";

export type PlanPillar = "PROOF" | "TEACH" | "OFFER" | "FOUNDER" | "BUILD" | "LEARN" | "HOW IT WORKS";

interface PlanBrandRef {
  /** Matches an existing brand by key or name; the profile is only used when none exists. */
  brandKey: string;
  matchName: RegExp;
  createWith?: BrandProfileInput;
}

interface PlanFeedPost {
  key: string;
  brand: PlanBrandRef;
  day: string; // YYYY-MM-DD, Toronto
  time: string; // HH:MM, Toronto
  pillar: PlanPillar;
  /** Story that re-shares this post 10 minutes later, and the highlight to file it under (null = 24h only). */
  storyHighlight: string | null;
  /** Schedule an existing draft instead of creating a new post. */
  existingContentItemId?: string;
  title?: string;
  kind?: SocialContentKind;
  platforms?: SocialOrganicPlatform[];
  hook?: string;
  body?: string;
  hashtags?: string[];
  callToAction?: string;
  creativeDirection?: string;
  /** No AI image: the owner uploads a real photo (founder posts). */
  realPhotoOnly?: boolean;
}

interface PlanReel {
  key: string;
  brand: PlanBrandRef;
  day: string;
  time: string;
  series: string;
  title: string;
  hook: string;
  body: string;
  hashtags: string[];
  callToAction: string;
  script: string;
  shots: { timing: string; visual: string; onScreenText?: string; audio?: string }[];
}

export interface WeekPlan {
  key: string;
  label: string;
  weekStart: string;
  feed: PlanFeedPost[];
  reels: PlanReel[];
  highlights: Record<string, string[]>;
}

const LYNQ: PlanBrandRef = { brandKey: "lynq", matchName: /^lynq\b/i };

const CODEIT_PROFILE: BrandProfileInput = {
  brandKey: "codeit",
  name: "CodeIt",
  positioning: "A free, browser-based coding studio for ages 5–18: kids describe a site, game or quiz, get a working first version, then edit it and see the code. Plus 31 beginner Python lessons and a Python playground that run with no AI involved.",
  audience: "Parents of kids aged 5–18 in Toronto and across Canada who want screen time that builds something; homeschool families; teachers looking for beginner Python.",
  voice: "Warm, plain-spoken, practical. Talks to parents, never down to kids. Short sentences, real examples, no hype.",
  visualRules: "Bright and clean: white or very light backgrounds, one bold orange accent (#F97316), Apple-style minimal product shots of laptops/tablets showing colourful kid-built games, quizzes and code. Lots of space. Never show children's faces; no stock-photo families; no AI-looking people.",
  productContext: "Free to start, no card required: 10 AI-assisted builds a month, 31 beginner Python lessons and the Python playground are free for everyone. Paid family plan: CA$12/month. Lead differentiator: comprehension is checked against the child's own project — questions are generated from their code, wrong options come from other real values in the same file, and only first-time-correct answers count.",
  claimsGuardrails: "Prices only in CAD (CA$12/month). Never claim Mustafa is a parent or homeschooler. No invented testimonials, user counts, results or partnerships. Example projects are labelled as examples.",
  callsToAction: ["Start free at codeitlearn.com", "Link in bio", "Save this for later"],
  approvedExamples: [],
  companyInfo: "CodeIt (codeitlearn.com), founded by Mustafa in Toronto. First workshop ran at Northcrest's Community Sundays.",
  brandStory: "Mustafa teaches kids to code and built the tool he wanted: start from the kid's own idea, build the first version with them, then make sure they understand every line.",
  writingStyle: "Lead with what the kid does, then why it matters to the parent. One idea per post. End with one clear next step.",
  visualIdentity: { colors: [{ name: "CodeIt orange", hex: "#F97316", role: "accent" }, { name: "White", hex: "#FFFFFF", role: "background" }, { name: "Ink", hex: "#111827", role: "text" }], typography: { heading: "Inter", body: "Inter" }, logoAssetIds: [], notes: "Orange is the only accent. Rounded, friendly UI shapes." },
  websites: ["https://codeitlearn.com"],
  competitors: ["CodeCombat", "Tynker", "Scratch"],
  contentPillars: ["BUILD — what kids make", "LEARN — parent tips and mini Python lessons", "HOW IT WORKS — the comprehension check", "OFFER — free to start, CA$12 family plan", "FOUNDER — Mustafa teaching"],
  preferredPlatforms: ["instagram", "facebook"],
  prohibitedLanguage: ["USD", "guaranteed", "genius"],
  neverClaim: ["that Mustafa is a parent", "that Mustafa homeschools", "user or student counts", "school partnerships"],
  geographicMarket: "Toronto / Canada",
  objectives: [],
};

const CODEIT: PlanBrandRef = { brandKey: "codeit", matchName: /^code\s?it/i, createWith: CODEIT_PROFILE };

const CODEIT_TAGS = ["KidsCoding", "CodingForKids", "LearnToCode", "PythonForKids", "TorontoParents"];
const CODEIT_LOOK = "Bright white background, a single bold orange (#F97316) accent, Apple-style minimal product photography, soft daylight, lots of empty space. No people, no children's faces, no text other than what is described.";

export const WEEK_PLANS: WeekPlan[] = [
  {
    key: "2026-10-12",
    label: "Week of Oct 12 — LYNQ + CodeIt",
    weekStart: "2026-10-12",
    highlights: {
      LYNQ: ["START HERE", "WORK", "RESULTS", "PRICING", "BEHIND"],
      CodeIt: ["START HERE", "BUILDS", "LESSONS", "PRICING", "ABOUT"],
    },
    feed: [
      // LYNQ — the drafts already written for the growth plan, in grid order PROOF → TEACH → OFFER/FOUNDER.
      { key: "lynq-mon", brand: LYNQ, day: "2026-10-12", time: "12:15", pillar: "PROOF", storyHighlight: "WORK", existingContentItemId: "08cc2bdf-2a1d-4bb4-96dd-a2fa4cd7d9cf" },
      { key: "lynq-tue", brand: LYNQ, day: "2026-10-13", time: "07:30", pillar: "TEACH", storyHighlight: null, existingContentItemId: "cc06bc59-0da8-472c-8e8f-656bb1c6bf18" },
      { key: "lynq-wed", brand: LYNQ, day: "2026-10-14", time: "18:30", pillar: "OFFER", storyHighlight: "PRICING", existingContentItemId: "1f90bb0e-1a34-4afa-802b-f3cc408a0094" },
      { key: "lynq-thu", brand: LYNQ, day: "2026-10-15", time: "12:15", pillar: "PROOF", storyHighlight: "WORK", existingContentItemId: "320fbd5d-72ee-46b2-afee-ee9085845792" },
      { key: "lynq-fri", brand: LYNQ, day: "2026-10-16", time: "12:15", pillar: "TEACH", storyHighlight: null, existingContentItemId: "158518c1-68aa-4034-9fbc-b26952e580f6" },
      { key: "lynq-sat", brand: LYNQ, day: "2026-10-17", time: "10:00", pillar: "FOUNDER", storyHighlight: "BEHIND", existingContentItemId: "abdf136a-5299-48b9-8bb0-8eee0d43727a" },
      { key: "lynq-sun", brand: LYNQ, day: "2026-10-18", time: "12:15", pillar: "PROOF", storyHighlight: "WORK", existingContentItemId: "f0a766c4-c969-4734-8f80-1990e53385a2" },
      { key: "lynq-mon2", brand: LYNQ, day: "2026-10-19", time: "07:30", pillar: "TEACH", storyHighlight: null, existingContentItemId: "e6f22811-fb0f-4dd0-9c9b-e1fafed181a3" },

      // CodeIt — grid order BUILD → LEARN → HOW/OFFER/FOUNDER.
      {
        key: "codeit-mon", brand: CODEIT, day: "2026-10-12", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · Describe it. Play it.", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your kid types one sentence. A minute later, they're playing it.",
        body: "Your kid types one sentence. A minute later, they're playing it.\n\n\"A game where a cat catches falling pizza.\" That's all it takes for CodeIt to build a working first version.\n\nThen the real part starts: they change the speed, the colours, the score — and see the code behind every change.\n\nFree to start, no card needed. Ages 5–18.\nLink in bio → codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `A laptop on a clean white desk showing a bright, simple 2D browser game: a cartoon cat catching falling pizza slices, a score counter in the corner. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-tue", brand: CODEIT, day: "2026-10-13", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · 3 questions after screen time", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Not all screen time is the same. Here's how to tell the difference.",
        body: "Not all screen time is the same. Three questions to ask your kid tonight:\n\n1. \"What did you make?\" — watching vs. building.\n2. \"What would you change about it?\" — that's design thinking.\n3. \"Can you show me how it works?\" — if they can explain it, they learned it.\n\nCodeIt is built around question 3: after every build, kids answer questions about their own code.\n\nSave this for after dinner.",
        hashtags: CODEIT_TAGS, callToAction: "Save this for later",
        creativeDirection: `Overhead flat-lay on a white table: a tablet showing a colourful kid-made game next to three blank orange sticky notes in a row. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-wed", brand: CODEIT, day: "2026-10-14", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · The quiz comes from their own code", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Most coding apps check if the code runs. We check if your kid understands it.",
        body: "Most coding apps check whether the code runs. CodeIt checks whether your kid understands it.\n\nAfter a build, CodeIt asks questions generated from their own project file. The wrong answers come from other real values in that same file — so guessing doesn't work.\n\nOnly first-time-correct answers count.\n\nThat's the difference between copying and learning.\nTry it free → codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        creativeDirection: `Close-up of a laptop screen split in two: on the left a short block of code with one line highlighted in orange, on the right a clean multiple-choice card with four rounded answer buttons. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-thu", brand: CODEIT, day: "2026-10-15", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · Their favourite topic, as an app", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Whatever your kid can't stop talking about can become an app they built.",
        body: "Dinosaurs, football, Minecraft — whatever your kid can't stop talking about can become a quiz app they build themselves.\n\nThey describe it, CodeIt builds the first version, and then they make it theirs: new questions, new colours, a harder level.\n\nEvery change shows them the code behind it.\n\nAges 5–18. Free to start.",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `A tablet standing on a white table showing a bright quiz app with a friendly cartoon dinosaur and big rounded orange answer buttons (example project). ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-fri", brand: CODEIT, day: "2026-10-16", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Lesson 1: print()", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The first line of Python almost every coder writes.",
        body: "print(\"Hello!\")\n\nThat's the first line of Python almost every coder ever wrote. It tells the computer: show this on the screen.\n\nTry it with your kid: change \"Hello!\" to their name. Run it. That's programming.\n\nCodeIt has 31 beginner Python lessons and a Python playground — free for everyone, with no AI involved, so the learning is theirs.\n\nSave this and try it this weekend.",
        hashtags: CODEIT_TAGS, callToAction: "Save this for later",
        creativeDirection: `A minimal code editor window centred on white, one line of Python in large monospace type: print("Hello!"), an output panel below showing Hello!, and a rounded orange Run button. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-sat", brand: CODEIT, day: "2026-10-17", time: "10:00", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · Why I'm building CodeIt", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "I'm Mustafa. I teach kids to code — and I built the tool I wished I had.",
        body: "I'm Mustafa. I teach kids to code in Toronto, and I ran CodeIt's first workshop at Northcrest's Community Sundays.\n\nWhat I noticed: kids light up when they build something that's theirs — and tune out when it's another worksheet.\n\nSo CodeIt starts with their idea, builds the first version with them, then makes sure they understand every line.\n\nQuestions from parents are always welcome — comments are open.",
        hashtags: CODEIT_TAGS, callToAction: "Comments open",
        creativeDirection: "Real photo only: you teaching, the workshop room, or your laptop with CodeIt open. Upload it in LYNQ — no AI image for founder posts.",
        realPhotoOnly: true,
      },
      {
        key: "codeit-sun", brand: CODEIT, day: "2026-10-18", time: "10:00", pillar: "OFFER", storyHighlight: "PRICING",
        title: "CodeIt · Free to start, CA$12 for the family", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Free to start. No card. Here's exactly what's included.",
        body: "What's free, what's paid — no surprises:\n\nFree for everyone: 31 beginner Python lessons, the Python playground, and 10 AI-assisted builds a month. No card needed.\n\nFamily plan: CA$12/month.\n\nBuilt for ages 5–18.\nStart free → codeitlearn.com (link in bio)",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        creativeDirection: `Two clean rounded cards side by side on white, the right card outlined in orange; a laptop edge visible in the corner showing a colourful kid-built game. ${CODEIT_LOOK}`,
      },
    ],
    reels: [
      {
        key: "lynq-reel-tue", brand: LYNQ, day: "2026-10-13", time: "18:30", series: "Build in 10 days",
        title: "LYNQ Reel · Build in 10 days — Day 1–3",
        hook: "Day 1 of building a local business website in 10 days.",
        body: "Day 1 to Day 3 of a Launch Site.\n\nDay 1: the call. What the business sells, who calls, what they ask first.\nDay 2: the wireframe. Five pages, the booking button above the fold, hours and phone on every page.\nDay 3: real copy and real photos. No lorem ipsum, no stock smiles.\n\nDay 10 it goes live. Follow to watch the rest.\nWant yours built the same way? DM \"SITE\".",
        hashtags: ["WebDesign", "TorontoBusiness", "SmallBusiness", "GTA"], callToAction: "DM SITE",
        script: "Screen-record your real build. First frame: the project file with the business name and a big 'DAY 1'. Keep it 20–30 seconds. Voice or on-screen text only — no music-only cuts.",
        shots: [
          { timing: "0–3s", visual: "Figma/Notion page titled with the business name, 'DAY 1' on screen", onScreenText: "Day 1: the call" },
          { timing: "3–12s", visual: "Wireframe being laid out — booking button placed at the top", onScreenText: "Day 2: wireframe" },
          { timing: "12–24s", visual: "Real copy and photos dropping into the layout", onScreenText: "Day 3: real words, real photos" },
          { timing: "24–30s", visual: "Black end card", onScreenText: "Day 10: live. DM SITE" },
        ],
      },
      {
        key: "lynq-reel-thu", brand: LYNQ, day: "2026-10-15", time: "18:30", series: "Watch it work",
        title: "LYNQ Reel · Watch it work — approving a post from my phone",
        hook: "This is how my clients' posts go out.",
        body: "This is how LYNQ clients' posts go out.\n\nThe system drafts the post. My phone buzzes. I read the caption, check the image, tap one button — and it's live on Instagram and Facebook.\n\nNo logging into four apps. No forgetting to post on Thursday.\n\nIt's part of the Growth System: posts and reels every month, approved from your phone.\nDM \"GROW\" and I'll show you yours.",
        hashtags: ["SocialMediaMarketing", "TorontoBusiness", "SmallBusiness", "Automation"], callToAction: "DM GROW",
        script: "Screen-record your phone: the Telegram notification arriving, opening it, the image and caption, tapping ✅. Then cut to the Instagram profile with the new post. 15–20 seconds.",
        shots: [
          { timing: "0–3s", visual: "Phone lock screen: Telegram notification from the LYNQ bot", onScreenText: "My phone buzzes" },
          { timing: "3–10s", visual: "Telegram open: the post's image, caption and buttons", onScreenText: "I check it" },
          { timing: "10–13s", visual: "Thumb taps ✅ Post now", onScreenText: "One tap" },
          { timing: "13–20s", visual: "Instagram profile, the new post at the top", onScreenText: "Live. DM GROW" },
        ],
      },
      {
        key: "lynq-reel-sat", brand: LYNQ, day: "2026-10-17", time: "12:15", series: "60-second audit",
        title: "LYNQ Reel · 60-second audit — a GTA clinic site",
        hook: "60 seconds on a GTA clinic's website. Watch what it gets wrong.",
        body: "60-second audit: a GTA clinic website (name hidden).\n\nThe three things I check first on every clinic site:\n1. Can a patient on a phone find \"Book\" without scrolling?\n2. Are the hours and phone number on every page?\n3. Do the Google reviews show up on the site?\n\nWatch what this one gets wrong.\n\nWant a free 5-minute audit of your site? DM \"AUDIT\".",
        hashtags: ["WebDesign", "TorontoBusiness", "ClinicMarketing", "GTA"], callToAction: "DM AUDIT",
        script: "Screen-record a real GTA clinic site on a phone-sized window, name blurred. Walk the three checks in order and say what you find out loud. Keep claims to what is on screen. 30–40 seconds.",
        shots: [
          { timing: "0–3s", visual: "The clinic homepage on a phone frame, name blurred", onScreenText: "60-second audit" },
          { timing: "3–15s", visual: "Scrolling to find the Book button", onScreenText: "1. Where's 'Book'?" },
          { timing: "15–25s", visual: "Looking for hours/phone on an inner page", onScreenText: "2. Hours + phone" },
          { timing: "25–35s", visual: "Searching for reviews on the site", onScreenText: "3. Reviews" },
          { timing: "35–40s", visual: "Black end card", onScreenText: "Free audit: DM AUDIT" },
        ],
      },
      {
        key: "codeit-reel-tue", brand: CODEIT, day: "2026-10-13", time: "16:30", series: "Idea to game",
        title: "CodeIt Reel · Idea to game in 60 seconds",
        hook: "One sentence → a game → the code behind it.",
        body: "One sentence → a playable game → the code behind it. In under a minute.\n\nThis is CodeIt. Free to start for ages 5–18.\nLink in bio.",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        script: "Screen-record CodeIt: type a one-line game idea, the game appears, play it for a few seconds, change one value (speed or colour), then open the code view. 30–45 seconds.",
        shots: [
          { timing: "0–4s", visual: "Typing the idea into CodeIt", onScreenText: "One sentence…" },
          { timing: "4–15s", visual: "The game appears and is played", onScreenText: "…a real game" },
          { timing: "15–30s", visual: "Changing the speed or colour, game updates", onScreenText: "Make it theirs" },
          { timing: "30–40s", visual: "Code view with the changed line highlighted", onScreenText: "See the code" },
        ],
      },
      {
        key: "codeit-reel-thu", brand: CODEIT, day: "2026-10-15", time: "16:30", series: "Python in 20 seconds",
        title: "CodeIt Reel · Python in 20 seconds: print()",
        hook: "Your kid's first line of Python, in 20 seconds.",
        body: "Your kid's first line of Python, in 20 seconds.\n\nprint(\"Hello!\") → change it to their name → run it.\n\nSave this and try it tonight. 31 free lessons at codeitlearn.com.",
        hashtags: CODEIT_TAGS, callToAction: "Save this for later",
        script: "Screen-record the CodeIt Python playground: type print(\"Hello!\"), run, change to a name, run again. 15–20 seconds.",
        shots: [
          { timing: "0–5s", visual: "Typing print(\"Hello!\") in the playground", onScreenText: "Line 1 of Python" },
          { timing: "5–10s", visual: "Run → Hello! appears", onScreenText: "Run it" },
          { timing: "10–20s", visual: "Change to a name and run again", onScreenText: "Now make it yours" },
        ],
      },
      {
        key: "codeit-reel-sat", brand: CODEIT, day: "2026-10-17", time: "11:00", series: "The question after the build",
        title: "CodeIt Reel · The question after the build",
        hook: "Copying code is easy. Explaining it is learning.",
        body: "Copying code is easy. Explaining it is learning.\n\nAfter every build, CodeIt asks your kid questions about their own code — and the wrong answers come from their own project, so guessing doesn't work.\n\nTry it free → link in bio.",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        script: "Screen-record finishing a build in CodeIt, then the comprehension question appearing and being answered. 20–30 seconds.",
        shots: [
          { timing: "0–6s", visual: "A finished build running", onScreenText: "Built it?" },
          { timing: "6–18s", visual: "The question generated from that code appears", onScreenText: "Now explain it" },
          { timing: "18–28s", visual: "Answering correctly first time", onScreenText: "That's learning" },
        ],
      },
    ],
  },
];

export function getWeekPlan(key: string): WeekPlan | undefined {
  return WEEK_PLANS.find((p) => p.key === key);
}

/** The plan whose week contains (or comes right after) `now`, for the calendar's "Load week plan" button. */
export function currentWeekPlan(now: Date = new Date()): WeekPlan | undefined {
  const today = now.toISOString().slice(0, 10);
  return WEEK_PLANS.filter((p) => addDays(p.weekStart, 7) > today).sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0];
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function planInstant(day: string, time: string, plusMinutes = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(zonedDateTimeToUtc(y, m, d, hh, mm, PLAN_TZ).getTime() + plusMinutes * 60_000);
}

export function planMarker(planKey: string, entryKey: string): string {
  return `weekplan:${planKey}:${entryKey}`;
}

export interface WeekPlanReport {
  planKey: string;
  brands: { name: string; created: boolean; accountsLinked: string[] }[];
  scheduled: string[];
  created: string[];
  skipped: string[];
  needsYou: string[];
  imagesQueued: { contentItemId: string; igVariantId: string; copyTo: string[] }[];
}

async function findMarkedItem(db: Db, organizationId: string, marker: string): Promise<string | null> {
  const [row] = await db
    .select({ id: marketingContentItems.id })
    .from(marketingContentItems)
    .where(and(eq(marketingContentItems.organizationId, organizationId), isNull(marketingContentItems.archivedAt), sql`${marketingContentItems.brief}->>'researchNotes' like ${`%${marker}%`}`))
    .limit(1);
  return row?.id ?? null;
}

const RESCHEDULABLE = new Set(["draft", "changes_requested"]);

/**
 * Loads a week plan into the organization as dated drafts. Returns what it
 * did, and which image generations the caller should run next (in the
 * background — they take ~15 s each) via `generatePlanImages`.
 */
export async function applyWeekPlan(db: Db, input: { organizationId: string; actorUserId: string; planKey: string }): Promise<WeekPlanReport> {
  const plan = getWeekPlan(input.planKey);
  if (!plan) throw new Error(`unknown week plan ${input.planKey}`);
  const report: WeekPlanReport = { planKey: plan.key, brands: [], scheduled: [], created: [], skipped: [], needsYou: [], imagesQueued: [] };

  // 1. Brands.
  const brands = await listBrands(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  const brandIds = new Map<string, string>();
  const refs = [...new Map([...plan.feed, ...plan.reels].map((e) => [e.brand.brandKey, e.brand])).values()];
  for (const ref of refs) {
    let brand = brands.find((b) => !b.archivedAt && (b.brandKey === ref.brandKey || ref.matchName.test(b.name)));
    let created = false;
    if (!brand && ref.createWith) {
      brand = await createBrand(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, brand: ref.createWith });
      created = true;
    }
    if (!brand) {
      report.skipped.push(`No ${ref.brandKey} brand in this workspace`);
      continue;
    }
    brandIds.set(ref.brandKey, brand.id);
    const accountsLinked: string[] = [];
    if (ref.createWith) {
      // Move any connected Instagram/Facebook account named like this brand onto it (e.g. a CodeIt page filed under LYNQ).
      const accounts = await db.select().from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.organizationId, input.organizationId), isNull(marketingChannelAccounts.archivedAt)));
      for (const a of accounts) {
        if (a.brandProfileId === brand.id || (a.platform !== "instagram" && a.platform !== "facebook") || a.accountKind === "paid") continue;
        if (!ref.matchName.test(a.displayName) && !ref.matchName.test(a.handle ?? "")) continue;
        await updateAccount(db, { organizationId: input.organizationId, channelAccountId: a.id, actorUserId: input.actorUserId, expectedRevision: a.revision, changes: { brandProfileId: brand.id } });
        accountsLinked.push(`${a.platform === "instagram" ? "Instagram" : "Facebook"} ${a.handle ? `@${a.handle.replace(/^@/, "")}` : a.displayName}`);
      }
      const alreadyOnBrand = accounts.filter((a) => a.brandProfileId === brand!.id && (a.platform === "instagram" || a.platform === "facebook")).length;
      if (!alreadyOnBrand && !accountsLinked.length) report.needsYou.push(`${brand.name} has no Instagram or Facebook account linked yet — connect it in Connections, then its posts can go out.`);
    }
    report.brands.push({ name: brand.name, created, accountsLinked });
  }

  // Accounts the brand's feed posts already use, so stories and reels go to the same place.
  const accountFor = new Map<string, string>();
  const noteAccounts = (brandKey: string, item: SocialContentItem) => {
    for (const v of item.variants) if (!v.archivedAt && v.channelAccountId && !accountFor.has(`${brandKey}|${v.platform}`)) accountFor.set(`${brandKey}|${v.platform}`, v.channelAccountId);
  };

  // 2. Feed posts (+ a story for each).
  for (const post of plan.feed) {
    const brandProfileId = brandIds.get(post.brand.brandKey);
    if (!brandProfileId) continue;
    const at = planInstant(post.day, post.time);
    let item: SocialContentItem | null = null;

    if (post.existingContentItemId) {
      try {
        item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: post.existingContentItemId, actorUserId: input.actorUserId });
      } catch {
        report.skipped.push(`${post.key}: draft ${post.existingContentItemId} not found`);
        continue;
      }
      if (item.archivedAt) {
        report.skipped.push(`${item.title}: archived`);
        continue;
      }
      let moved = 0;
      for (const v of item.variants) {
        if (v.archivedAt || !RESCHEDULABLE.has(v.status)) continue;
        if (v.scheduledFor?.getTime() === at.getTime()) continue;
        await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { scheduledFor: at } });
        moved++;
      }
      if (moved) report.scheduled.push(`${item.title} → ${post.day} ${post.time}`);
    } else {
      const marker = planMarker(plan.key, post.key);
      const existingId = await findMarkedItem(db, input.organizationId, marker);
      if (existingId) {
        item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingId, actorUserId: input.actorUserId });
      } else {
        const brief: SocialContentBrief = {
          kind: post.kind ?? "image_post",
          objective: post.pillar === "OFFER" ? "promotion" : post.pillar === "FOUNDER" ? "founder_voice" : post.pillar === "LEARN" || post.pillar === "TEACH" ? "education" : "engagement",
          audience: "",
          topic: `${post.pillar} post`,
          tone: "",
          callToAction: post.callToAction ?? "",
          creativeDirection: post.creativeDirection ?? "",
          hook: post.hook ?? "",
          script: "",
          shots: [],
          sourceText: "",
          keyPoints: [`Pillar: ${post.pillar}`, post.storyHighlight ? `Story highlight: ${post.storyHighlight}` : "Story: 24h only"],
          researchNotes: marker,
        };
        item = await createContentItem(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, brandProfileId, title: post.title ?? post.key, brief, platforms: post.platforms ?? ["instagram", "facebook"], scheduledFor: at });
        for (const v of item.variants) {
          await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { format: "image", hook: post.hook ?? "", body: post.body ?? "", hashtags: post.hashtags ?? [], callToAction: post.callToAction ?? "", scheduledFor: at } });
        }
        item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: item.id, actorUserId: input.actorUserId });
        report.created.push(`${item.title} · ${post.day} ${post.time}`);
      }
      const ig = item.variants.find((v) => v.platform === "instagram" && !v.archivedAt);
      if (post.realPhotoOnly) report.needsYou.push(`${item.title}: upload a real photo (founder posts don't use AI images).`);
      else if (ig && !ig.media.length) report.imagesQueued.push({ contentItemId: item.id, igVariantId: ig.id, copyTo: item.variants.filter((v) => v.id !== ig.id && !v.archivedAt && !v.media.length).map((v) => v.id) });
    }

    noteAccounts(post.brand.brandKey, item);

    // Story: re-shares the post's image 10 minutes after it goes out.
    const storyMarker = planMarker(plan.key, `${post.key}-story`);
    if (!(await findMarkedItem(db, input.organizationId, storyMarker))) {
      const highlight = post.storyHighlight;
      const story = await createContentItem(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        brandProfileId,
        title: `Story · ${item.title}${highlight ? ` → ${highlight}` : ""}`,
        brief: {
          kind: "story", objective: "engagement", audience: "", topic: `Story for "${item.title}"`, tone: "", callToAction: "", hook: "", script: "", shots: [], sourceText: "",
          creativeDirection: "Same image as the feed post.",
          keyPoints: [highlight ? `After it posts, add this story to the ${highlight} highlight (Instagram app → story → Highlight).` : "24-hour story only — no highlight."],
          researchNotes: storyMarker,
        },
        platforms: ["instagram"],
        scheduledFor: planInstant(post.day, post.time, 10),
      });
      const igStory = story.variants[0];
      const igFeed = item.variants.find((v) => v.platform === "instagram" && !v.archivedAt);
      if (igStory) {
        await updateVariant(db, { organizationId: input.organizationId, contentVariantId: igStory.id, actorUserId: input.actorUserId, expectedRevision: igStory.revision, changes: { format: "story", scheduledFor: planInstant(post.day, post.time, 10), ...(!igStory.channelAccountId && igFeed?.channelAccountId ? { channelAccountId: igFeed.channelAccountId } : {}), ...(igFeed?.media.length ? { media: igFeed.media.slice(0, 1).map((m) => ({ ...m, position: 0, role: "primary" as const })) } : {}) } });
        const queued = report.imagesQueued.find((q) => q.contentItemId === item!.id);
        if (queued) queued.copyTo.push(igStory.id);
      }
      report.created.push(`${story.title}`);
    }
  }

  // 3. Reels: separate from the grid (not shared to feed); the owner films them from the script.
  for (const reel of plan.reels) {
    const brandProfileId = brandIds.get(reel.brand.brandKey);
    if (!brandProfileId) continue;
    const marker = planMarker(plan.key, reel.key);
    if (await findMarkedItem(db, input.organizationId, marker)) continue;
    const at = planInstant(reel.day, reel.time);
    const item = await createContentItem(db, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      brandProfileId,
      title: reel.title,
      brief: {
        kind: "short_video_concept", objective: "awareness", audience: "", topic: `Reel series: ${reel.series}`, tone: "", callToAction: reel.callToAction,
        creativeDirection: "Real screen recording, filmed by you. First frame shows a real screen or business name — never a tagline.",
        hook: reel.hook, script: reel.script,
        shots: reel.shots.map((s) => ({ timing: s.timing, visual: s.visual, onScreenText: s.onScreenText ?? "", audio: s.audio ?? "" })),
        sourceText: "", keyPoints: [`Reel series: ${reel.series}`, "Reels stay off the grid (not shared to feed)."], researchNotes: marker,
      },
      platforms: ["instagram", "facebook"],
      scheduledFor: at,
    });
    for (const v of item.variants) {
      const platformOptions: SocialVariantPlatformOptions = v.platform === "instagram" ? { shareToFeed: false } : {};
      const account = v.channelAccountId ? undefined : accountFor.get(`${reel.brand.brandKey}|${v.platform}`);
      await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { format: v.platform === "instagram" ? "reel" : "video", hook: reel.hook, body: reel.body, hashtags: reel.hashtags, callToAction: reel.callToAction, platformOptions, scheduledFor: at, ...(account ? { channelAccountId: account } : {}) } });
    }
    report.created.push(`${reel.title} · ${reel.day} ${reel.time}`);
    report.needsYou.push(`${reel.title}: film it from the script and upload the video before ${reel.day}.`);
  }

  return report;
}

/** Runs the queued image generations one at a time, then copies each image onto the post's Facebook version and its story. Best-effort. */
export async function generatePlanImages(db: Db, input: { organizationId: string; actorUserId: string; queue: WeekPlanReport["imagesQueued"] }): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const job of input.queue) {
    try {
      await regenerateVariantPart(db, { organizationId: input.organizationId, contentVariantId: job.igVariantId, actorUserId: input.actorUserId, part: "image" });
      const item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: job.contentItemId, actorUserId: input.actorUserId });
      const ig = item.variants.find((v) => v.id === job.igVariantId);
      const media = ig?.media.slice(0, 1).map((m) => ({ ...m, position: 0, role: "primary" as const })) ?? [];
      if (!media.length) throw new Error("no image attached");
      for (const targetId of job.copyTo) {
        // Story variants live on their own item; re-read each target for its current revision.
        const target = await getVariantRevision(db, input.organizationId, input.actorUserId, targetId);
        if (target && !target.media.length) await updateVariant(db, { organizationId: input.organizationId, contentVariantId: targetId, actorUserId: input.actorUserId, expectedRevision: target.revision, changes: { media } });
      }
      done++;
    } catch (err) {
      failed++;
      console.error("[week-plan] image generation failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    }
  }
  return { done, failed };
}

async function getVariantRevision(db: Db, organizationId: string, actorUserId: string, contentVariantId: string) {
  try {
    return await getVariantForUser(db, { organizationId, contentVariantId, actorUserId });
  } catch {
    return null;
  }
}

export interface WeekPlanEntryStatus {
  key: string;
  kind: "post" | "story" | "reel";
  brand: string;
  day: string;
  time: string;
  title: string;
  pillar: string | null;
  highlight: string | null;
  contentItemId: string | null;
  /** Lowest-progress status across the entry's platform versions. */
  status: string | null;
  needs: "video" | "photo" | "image" | "account" | null;
}

const PROGRESS = ["draft", "changes_requested", "generating", "ready_for_review", "approved", "scheduled", "publishing", "published", "failed", "rejected"];

/** Live checklist for a plan: what's loaded, what's done, and what still needs the owner (a video, a photo, an account). */
export async function getWeekPlanStatus(db: Db, input: { organizationId: string; actorUserId: string; planKey: string }): Promise<{ loaded: boolean; entries: WeekPlanEntryStatus[] }> {
  const plan = getWeekPlan(input.planKey);
  if (!plan) return { loaded: false, entries: [] };
  const entries: WeekPlanEntryStatus[] = [];
  let anyLoaded = false;
  const load = async (id: string | null) => {
    if (!id) return null;
    try {
      return await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: id, actorUserId: input.actorUserId });
    } catch {
      return null;
    }
  };
  const summarize = (item: SocialContentItem | null, kind: WeekPlanEntryStatus["kind"], realPhoto = false): Pick<WeekPlanEntryStatus, "status" | "needs" | "contentItemId"> => {
    if (!item) return { status: null, needs: null, contentItemId: null };
    const live = item.variants.filter((v) => !v.archivedAt);
    const status = live.map((v) => v.status as string).sort((a, b) => PROGRESS.indexOf(a) - PROGRESS.indexOf(b))[0] ?? null;
    const missingMedia = live.some((v) => !v.media.length && v.platform !== "linkedin");
    const missingAccount = live.some((v) => !v.channelAccountId);
    const needs = missingAccount ? "account" : missingMedia ? (kind === "reel" ? "video" : realPhoto ? "photo" : "image") : null;
    return { status, needs, contentItemId: item.id };
  };
  // One query for every item the plan created, then load them in parallel.
  const marked = await db
    .select({ id: marketingContentItems.id, marker: sql<string>`${marketingContentItems.brief}->>'researchNotes'` })
    .from(marketingContentItems)
    .where(and(eq(marketingContentItems.organizationId, input.organizationId), isNull(marketingContentItems.archivedAt), sql`${marketingContentItems.brief}->>'researchNotes' like ${`weekplan:${plan.key}:%`}`));
  const idFor = new Map(marked.map((m) => [m.marker, m.id]));
  const ids = new Set<string>([...idFor.values(), ...plan.feed.flatMap((p) => (p.existingContentItemId ? [p.existingContentItemId] : []))]);
  const items = new Map((await Promise.all([...ids].map(async (id) => [id, await load(id)] as const))).filter((e): e is readonly [string, SocialContentItem] => Boolean(e[1])));
  const get = (id: string | null | undefined) => (id ? items.get(id) ?? null : null);
  anyLoaded = marked.length > 0;
  for (const post of plan.feed) {
    const item = get(post.existingContentItemId ?? idFor.get(planMarker(plan.key, post.key)));
    const storyItem = get(idFor.get(planMarker(plan.key, `${post.key}-story`)));
    const brand = post.brand.createWith?.name ?? "LYNQ";
    entries.push({ key: post.key, kind: "post", brand, day: post.day, time: post.time, title: item?.title ?? post.title ?? post.key, pillar: post.pillar, highlight: null, ...summarize(item, "post", post.realPhotoOnly) });
    entries.push({ key: `${post.key}-story`, kind: "story", brand, day: post.day, time: post.time, title: storyItem?.title ?? `Story · ${item?.title ?? post.title ?? post.key}`, pillar: null, highlight: post.storyHighlight, ...summarize(storyItem, "story", post.realPhotoOnly) });
  }
  for (const reel of plan.reels) {
    const item = get(idFor.get(planMarker(plan.key, reel.key)));
    entries.push({ key: reel.key, kind: "reel", brand: reel.brand.createWith?.name ?? "LYNQ", day: reel.day, time: reel.time, title: reel.title, pillar: reel.series, highlight: null, ...summarize(item, "reel") });
  }
  entries.sort((a, b) => `${a.day} ${a.time} ${a.kind}`.localeCompare(`${b.day} ${b.time} ${b.kind}`));
  return { loaded: anyLoaded, entries };
}
