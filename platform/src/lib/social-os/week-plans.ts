import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingChannelAccounts, marketingContentItems, socialAssets, socialContentVariants } from "@/db/schema";
import { archiveAsset, createUploadedAsset, resolveAssetBytes, resolveAssetRow } from "./assets";
import { composeStoryCard, type StoryBrand } from "./story-card";
import { cardKey, composeCodeItCard, type CodeItCard } from "./codeit-card";
import { composeStory, needsSticker, stickerInstructions, storyKey, type StorySpec } from "./story-original";
import { createBrand, listBrands, updateBrand } from "./brands";
import { updateAccount } from "./connections";
import { archiveContentItem, createContentItem, getContentItemForUser, getVariantForUser, updateContentItem, updateVariant, type SocialContentItem } from "./content";
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
  /** The visual system the plan is built on; written onto the brand on every load so image prompts and the plan agree. */
  visual?: { visualRules: string; notes: string };
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
  /** Instagram caption. */
  body?: string;
  /** Shorter Facebook caption (Facebook rewards fewer hashtags and no links). Falls back to `body`. */
  facebookBody?: string;
  hashtags?: string[];
  callToAction?: string;
  creativeDirection?: string;
  /** Rendered card (no AI image): the CodeIt story card drawn from this spec. */
  card?: CodeItCard;
  /** No AI image: the owner uploads a real photo or screenshot. */
  realPhotoOnly?: boolean;
  /** What to upload when realPhotoOnly (shown in the checklist and the morning reminder). */
  uploadNote?: string;
  /** Used when `existingContentItemId` isn't in this workspace (e.g. drafts made on a preview database). */
  fallback?: Omit<PlanFeedPost, "key" | "brand" | "day" | "time" | "pillar" | "storyHighlight" | "existingContentItemId" | "fallback">;
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
  facebookBody?: string;
  hashtags: string[];
  callToAction: string;
  script: string;
  shots: { timing: string; visual: string; onScreenText?: string; audio?: string }[];
  /** The owner already sent this reel's video to the Telegram bot: attach the newest Telegram video in the workspace when the reel has none. */
  videoFromTelegram?: boolean;
  /** A rendered reel bundled in src/assets/reels (see reel-render.ts): uploaded once and attached when the reel has no video. */
  videoFile?: string;
  /**
   * AI video, ready to make: the prompt is stored as the reel's art direction so
   * Studio → Make video uses it. Nothing is generated (or spent) until the owner
   * presses Make video.
   */
  aiVideo?: { prompt: string; seconds: 5 | 8 | 10 };
}

/**
 * A story made only for stories (not a re-share of a feed post). Stories
 * with a poll, quiz or slider sticker are posted by the owner from the app
 * (Instagram's API can't add stickers): they are sent to Telegram in the
 * morning with the exact sticker text and never published by the Office.
 * The rest go through approval and publish like any post.
 */
export interface PlanStory {
  key: string;
  brand: PlanBrandRef;
  day: string;
  time: string;
  /** Highlight to file it under once it's up (null = 24 hours only). */
  highlight: string | null;
  spec: StorySpec;
  /** `object` stories: the feed post whose image is the hero. */
  photoFrom?: string;
}

/** A text post for Mustafa's personal LinkedIn (no images: founder text posts, 800–1,000 characters, no links). */
interface PlanLinkedIn {
  key: string;
  brand: PlanBrandRef;
  day: string;
  time: string;
  pillar: PlanPillar;
  title: string;
  body: string;
}

export interface WeekPlan {
  key: string;
  label: string;
  weekStart: string;
  feed: PlanFeedPost[];
  reels: PlanReel[];
  linkedin: PlanLinkedIn[];
  /** Stories made only for stories. */
  stories?: PlanStory[];
  highlights: Record<string, string[]>;
  /** Entry keys removed from the plan: their loaded drafts (and stories) are archived on the next load. */
  retired?: string[];
}

const LYNQ_VISUAL_RULES = "Product photography, Teenage Engineering and Bang & Olufsen spirit: one real object on matte near-black, hard light from the upper left, acid lime #C7FF3D exactly once as a small detail, thin white editorial type or no text. No mascot, no character, no robot, no figure of any kind, no people, no scenes, no gradients, no clip-art. No reference images: ignore any earlier LYNQ visuals, the look starts from this description alone.";
const LYNQ: PlanBrandRef = { brandKey: "lynq", matchName: /^lynq\b/i, visual: { visualRules: LYNQ_VISUAL_RULES, notes: "Near-black #0B0B0C background, white type, lime #C7FF3D once per image. No mascot." } };
const LYNQ_TAGS = ["SmallBusiness", "WebDesign", "LYNQ"];
const LYNQ_LOOK = "LYNQ's look, in the spirit of Teenage Engineering and Bang & Olufsen product photography: a single real object shot like a premium product on a plain matte near-black studio background, centred, with generous empty space around it; one hard directional light from the upper left giving crisp edges and one clean shadow; matte materials, no scene, no environment, no mascot, no people, no faces, no clip-art, no gradients. Acid lime appears exactly once per image as a small detail on the object (a tag, a glow, a switch, a thread). Text, when asked for, is one short line in thin white editorial type with generous letter spacing, set small and well inside the frame; otherwise no text at all. Square frame, everything inside a 12% safe margin, nothing touching any edge. The grid must read as one series: same background tone, same light, same framing every time. Reference images show only the brand colours; ignore any character, scene or rendering style in them.";
const HONEST_CARD = "Honest design card: no website screens, no logos, no people or faces — it must never pass for the client's real site, premises or customers.";

const CODEIT_VISUAL_RULES = "Flat 2D vector illustration, Toca Boca and Headspace spirit: bold rounded shapes, one or two flat colours per image from cream #FFF6EC, orange #F97316, navy #1E2A44, sky blue and mint; no 3D, no clay, no gradients, no desk scenes. The round orange mascot in a yellow hoodie appears in about half the images, drawn flat; the rest use one big flat object as the hero. Chunky rounded navy or orange headline only where asked; no names or signatures. Never a real child or a real face.";
const CODEIT_PROFILE: BrandProfileInput = {
  brandKey: "codeit",
  name: "CodeIt",
  positioning: "A free, browser-based coding studio for ages 5–18: kids describe a site, game or quiz, get a working first version, then edit it and see the code. Plus 31 beginner Python lessons and a Python playground that run with no AI involved.",
  audience: "Parents of kids aged 5–18 in Toronto and across Canada who want screen time that builds something; homeschool families; teachers looking for beginner Python.",
  voice: "Warm, playful, plain-spoken. Talks to parents, never down to kids. Short sentences, real examples, a little humour, no hype.",
  visualRules: CODEIT_VISUAL_RULES,
  productContext: "Free to start, no card required: 10 AI-assisted builds a month, 31 beginner Python lessons and the Python playground are free for everyone. Paid family plan: CA$12/month. Lead differentiator: comprehension is checked against the child's own project — questions are generated from their code, wrong options come from other real values in the same file, and only first-time-correct answers count.",
  claimsGuardrails: "Prices only in CAD (CA$12/month). Never claim Mustafa is a parent or homeschooler. No invented testimonials, user counts, results or partnerships. Example projects are labelled as examples.",
  callsToAction: ["Start free at codeitlearn.com", "Link in bio", "Save this for later"],
  approvedExamples: [],
  companyInfo: "CodeIt (codeitlearn.com), founded by Mustafa in Toronto. First workshop ran at Northcrest's Community Sundays.",
  brandStory: "Mustafa teaches kids to code and built the tool he wanted: start from the kid's own idea, build the first version with them, then make sure they understand every line.",
  writingStyle: "Lead with what the kid does, then why it matters to the parent. One idea per post. End with one clear next step.",
  visualIdentity: { colors: [{ name: "CodeIt orange", hex: "#F97316", role: "accent" }, { name: "Cream", hex: "#FFF6EC", role: "background" }, { name: "Navy", hex: "#1E2A44", role: "text" }], typography: { heading: "Baloo 2", body: "Nunito" }, logoAssetIds: [], notes: "The mascot is flat and appears in about half the visuals, never in a desk scene." },
  websites: ["https://codeitlearn.com"],
  competitors: ["CodeCombat", "Tynker", "Scratch"],
  contentPillars: ["BUILD — what kids make", "LEARN — parent tips and mini Python lessons", "HOW IT WORKS — the comprehension check", "OFFER — free to start, CA$12 family plan", "FOUNDER — Mustafa teaching"],
  preferredPlatforms: ["instagram", "facebook"],
  prohibitedLanguage: ["USD", "guaranteed", "genius"],
  neverClaim: ["that Mustafa is a parent", "that Mustafa homeschools", "user or student counts", "school partnerships"],
  geographicMarket: "Toronto / Canada",
  objectives: [],
};

const CODEIT: PlanBrandRef = { brandKey: "codeit", matchName: /^code\s?it/i, createWith: CODEIT_PROFILE, visual: { visualRules: CODEIT_VISUAL_RULES, notes: "The mascot is flat and appears in about half the visuals, never in a desk scene." } };

const CODEIT_TAGS = ["KidsWhoCode", "PythonForKids", "ParentingTips"];
const CODEIT_LOOK = "CodeIt's look, in the spirit of Toca Boca and Headspace: flat 2D vector illustration with bold simple rounded shapes, thick clean outlines or no outlines, no 3D, no clay, no gradients, no photo textures. One or two flat background colours per image chosen from cream #FFF6EC, CodeIt orange #F97316, navy #1E2A44, sky blue and mint; big playful composition with one clear idea and lots of breathing room. The CodeIt mascot (round orange fluffy character in a yellow hoodie) appears in about half the images as a flat illustrated character, never in a desk scene; the other images use big flat objects (a laptop, a dinosaur, a pizza slice, a rocket, a speech bubble) as the hero. Headline only where described, in chunky rounded navy or orange type, well inside the frame; no names, no signatures, no other text. Square frame, everything inside a 12% safe margin. Never show a real child, never a real face. Reference images show only the mascot's colours and proportions; do not copy their 3D rendering or their desk scenes.";

export const WEEK_PLANS: WeekPlan[] = [
  {
    key: "2026-10-12",
    label: "Oct 11 to Oct 21 — LYNQ + CodeIt, one post a day each",
    weekStart: "2026-10-11",
    retired: ["lynq-wed", "lynq-sat", "lynq-mon", "codeit-mon", "lynq-mon-r", "lynq-reel-tue"],
    highlights: {
      // LYNQ: each client keeps its own highlight (the profile already has KINGSBRIDGE, NASMA, AMY); series get one each.
      LYNQ: ["START HERE", "KINGSBRIDGE", "NASMA", "AMY", "ARCUBED", "FIX THIS", "WHAT YOU GET", "OFFICE", "BEHIND"],
      CodeIt: ["START HERE", "BUILDS", "LESSONS", "ASK THE TEACHER", "FREE", "ABOUT"],
    },
    feed: [
      // ── LYNQ — grid rows read PROOF → TEACH → OFFER/FOUNDER. Series names repeat every week so people learn them.
      {
        key: "lynq-intro", brand: LYNQ, day: "2026-10-12", time: "12:15", pillar: "FOUNDER", storyHighlight: "START HERE",
        title: "LYNQ · BUILT BY LYNQ — What we build", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Built by LYNQ. Four businesses, one standard.",
        body: "Built by LYNQ.\n\nKingsbridge Group. Custom homes and property management. A site that earns an owner's trust and answers a tenant at midnight, on the same page.\n\nNasma. A restaurant. Menu, hours and a table booked in ten seconds on a phone.\n\nFinding Amy. Photo booth rentals. One clear path from \"that looks fun\" to \"is my date free?\"\n\nArcubed Label. Handmade crochet bags. A store that takes the order so the maker can keep making.\n\nLYNQ designs and builds websites, the systems behind them, and the automation that keeps a business answering when nobody is at the desk. Each one built for that business, quoted in writing, looked after once it is live.\n\nIf your site is not doing its job, DM \"AUDIT\" for a free five minute review.",
        facebookBody: "Built by LYNQ.\n\nKingsbridge Group, custom homes and property management. Nasma, a restaurant. Finding Amy, photo booth rentals. Arcubed Label, handmade crochet bags.\n\nLYNQ designs and builds websites, the systems behind them, and the automation that keeps a business answering. Built for your business, quoted in writing, looked after once it is live.\n\nIf your site is not doing its job, message us for a free five minute review.",
        hashtags: LYNQ_TAGS, callToAction: "DM AUDIT",
        creativeDirection: `Four small objects in a neat row on the black studio floor, evenly spaced, each with the same hard light and shadow: a brass house key, a brass reservation bell, a folded square of deep velvet, a small handmade crochet tote; one acid-lime thread runs along the floor linking all four. One line of thin white type above them: "Built by LYNQ". ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-tue", brand: LYNQ, day: "2026-10-08", time: "07:30", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · FIX THIS — Your menu is a PDF", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Your menu is a PDF. That's costing you tables.",
        body: "FIX THIS: your menu is a PDF.\n\nOn a phone, a PDF menu opens tiny, loads slowly, and makes people pinch and zoom. Someone hungry at 6:40pm doesn't zoom. They go back and tap the next restaurant.\n\nThe fix takes an afternoon:\n1. A real menu page (text, not a file)\n2. A booking button at the top of every page\n3. Hours and phone number you can see without scrolling\n\nSave this for your next website update, or send it to the restaurant owner who needs it.",
        facebookBody: "FIX THIS: your menu is a PDF.\n\nOn a phone it opens tiny and slow. A hungry customer doesn't zoom. They book somewhere else.\n\nThe fix: a real menu page, a booking button at the top, and hours you can see without scrolling.\n\nKnow a restaurant owner who needs this? Share it with them.",
        hashtags: ["RestaurantMarketing", "WebDesign", "SmallBusiness"], callToAction: "Save this",
        creativeDirection: `A real paper restaurant menu folded down into a tiny unreadable square, sitting on a giant phone screen like a postage stamp; a lime magnifying glass hovers over it. "FIX THIS" small in lime, "Your menu is a PDF." large in white. ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-offer-2", brand: LYNQ, day: "2026-10-11", time: "12:15", pillar: "OFFER", storyHighlight: "WHAT YOU GET",
        title: "LYNQ · WHAT YOU GET — A site that answers", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your site is open 24/7. Is anyone home?",
        body: "Your site is open 24/7. Is anyone home?\n\nAt 11pm a customer taps your site. What happens next decides whether they book or move on.\n\nA LYNQ site answers for you:\n1. Phone and book button first, before anything else\n2. Found on Google, because the profile is done properly\n3. A reply by text and email in under a minute\n4. Kept running after launch, not handed over and forgotten\n\nNo packages, no hourly meter. A written quote for your business, then we build it.\n\nDM \"SITE\" and we will tell you what yours would take.",
        facebookBody: "Your site is open 24/7. Is anyone home?\n\nA LYNQ site answers for you: phone and book button first, found on Google, a reply in under a minute, and kept running after launch. No packages. A written quote for your business.\n\nMessage us to see what yours would take.",
        hashtags: LYNQ_TAGS, callToAction: "DM SITE",
        creativeDirection: `A matte black telephone handset lying on the black studio floor, cord coiled neatly, hard light from the upper left; its tiny indicator light glows acid lime. One line of thin white type: "Open 24/7". ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-thu", brand: LYNQ, day: "2026-10-14", time: "12:15", pillar: "PROOF", storyHighlight: "NASMA",
        title: "LYNQ · PROOF 02 — Nasma", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Hungry people give a restaurant site ten seconds. Nasma uses them well.",
        body: "People open a restaurant's website for three things: the menu, the hours, and a way to book.\n\nEverything else is decoration.\n\nFor Nasma, a restaurant, we started with those three, then made the whole thing look as good as the food.\n\nOwn a restaurant? DM \"AUDIT\" for a free five minute review of your site.",
        facebookBody: "Diners open a restaurant's website for three things: the menu, the hours, and a way to book. For Nasma we started there, then made it look as good as the food.\n\nWant a free 5 minute review of your restaurant's site? Send us a message.",
        hashtags: ["RestaurantMarketing", "WebDesign", "SmallBusiness"], callToAction: "DM AUDIT",
        creativeDirection: `A brass reservation bell, polished, centred on the black studio floor, hard light from the upper left and one clean shadow; a single acid-lime glint on its button. One line of thin white type: "Menu. Hours. Book." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-fri", brand: LYNQ, day: "2026-10-13", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · FIX THIS — 5 empty fields on your Google profile", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Half of your Google profile is empty. It is the first thing customers see.",
        body: "FIX THIS: your Google Business Profile.\n\nBefore anyone sees your website, they see this. And most local businesses leave half of it empty:\n\n1. Business description\n2. Services (with prices if you can)\n3. Hours, including holidays\n4. Photos of the real place and real work\n5. A booking or website link\n\nIt's free, it takes an hour, and it's often the first impression you make.\n\nSave this and do it this weekend.",
        facebookBody: "Before anyone sees your website, they see your Google Business Profile. Five fields most owners leave empty: description, services, hours (holidays too), real photos, and a booking link.\n\nFree, one hour, and often your first impression. Worth doing this weekend.",
        hashtags: ["GoogleBusinessProfile", "LocalSEO", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Save this",
        creativeDirection: `A plain matte black index card standing upright on the black studio floor like a product, half of it printed with crisp white form lines and half left blank; one acid-lime pin holds it. One line of thin white type: "Half of you is missing". ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-founder-2", brand: LYNQ, day: "2026-10-15", time: "12:15", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · FOUNDER — The 9pm test", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "We fill in contact forms at 9pm to see who answers. Almost nobody does.",
        body: "We have a habit. When we look at a local business website, we fill in the contact form at 9pm and wait.\n\nMost of the time, nothing. A reply the next afternoon at best. By then the person who needed a plumber, a table or an appointment has already booked with someone else.\n\nThat's why every LYNQ site replies on its own. Form in, text and email out, with the booking link, in under a minute. Then the owner follows up in the morning like normal.\n\nIt is also how we run LYNQ itself. Every post you see here was drafted, checked and approved from a phone before it went out. Nothing ships without a human saying yes.\n\nQuestions about your site? The comments are open.",
        facebookBody: "We fill in local business contact forms at 9pm to see who answers. Almost nobody does. By the next afternoon the customer has booked with someone else.\n\nSo every LYNQ site replies on its own, by text and email, in under a minute. The owner follows up in the morning.\n\nQuestions about your site? The comments are open.",
        hashtags: ["Founder", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comments open",
        creativeDirection: `A smartphone lying face-down on the black studio floor, hard light from the upper left, a thin acid-lime line of light leaking from under one edge. One line of thin white type: "9:04 pm". ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-sun", brand: LYNQ, day: "2026-10-18", time: "12:15", pillar: "PROOF", storyHighlight: "AMY",
        title: "LYNQ · PROOF 03 — Finding Amy", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "An events site has one job: answer \"is my date free?\" before they ask.",
        body: "An events business needs its website to do exactly one thing: get the date request.\n\nFinding Amy rents photo booths for events. Their customers want to see the booth at a real party, see what's included, and ask about their date, fast.\n\nSo the whole site walks that one path.\n\nWant your site built around the one thing that pays you? DM \"AUDIT\".",
        facebookBody: "An events business needs its website to do one thing: get the date request. We built Finding Amy's site around that one path. See the booth, see what's included, ask about your date.\n\nWant yours built around the one thing that pays you? Send us a message.",
        hashtags: ["EventPlanning", "WebDesign", "SmallBusiness"], callToAction: "DM AUDIT",
        creativeDirection: `A small desk calendar standing on the black studio floor, matte black pages, one date circled in acid lime, hard light from the upper left and one clean shadow. One line of thin white type: "Is my date free?" ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-mon2", brand: LYNQ, day: "2026-10-17", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · FIX THIS — Slow replies lose the job", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "They filled in your form. They also filled in two others. First reply wins.",
        body: "FIX THIS: slow replies.\n\nSomeone fills in your contact form. They also filled in two others.\n\nThe business that answers first usually gets the job. At 9pm, that's rarely you.\n\nThe fix isn't working later. It's an instant reply: a text and an email that go out the moment the form is sent, with your booking link inside.\n\nThat's what our Lead Engine sets up.\n\nSend this to a business owner who's always \"getting back to people.\"",
        facebookBody: "Someone fills in your contact form, and two others. The business that answers first usually gets the job.\n\nThe fix isn't working later. It's an instant text and email the moment the form is sent, with your booking link inside. That's what our Lead Engine sets up.",
        hashtags: ["SmallBusinessTips", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Send to a business owner",
        creativeDirection: `Three identical white paper airplanes in a row on the black studio floor, hard light from the upper left; the first one is acid lime and sits one body length ahead of the other two. One line of thin white type: "First reply wins". ${LYNQ_LOOK}`,
      },

      // ── CodeItLearn — keeps the mascot world from the existing grid. Rows read BUILD → LEARN → HOW/FOUNDER/OFFER.
      {
        key: "codeit-mon-r", brand: CODEIT, day: "2026-10-11", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · One sentence in. One game out.", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your kid types one sentence. A minute later, they're playing it.",
        body: "\"A game where a cat catches falling pizza.\"\n\nThat one sentence is all it takes. CodeIt builds a working first version, and then the real part starts.\n\nYour kid makes it faster. Changes the colours. Adds a score. And every change shows them the code behind it.\n\nStart with their idea, end with their code.\n\nFree to start, no card needed. Ages 5 to 18.\nLink in bio: codeitlearn.com",
        facebookBody: "\"A game where a cat catches falling pizza.\"\n\nOne sentence, and CodeIt builds a working first version. Then your kid makes it faster, changes the colours, adds a score, and sees the code behind every change.\n\nFree to start, no card needed, ages 5 to 18: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `Flat vector: a huge speech bubble in cream on an orange background containing a tiny pizza slice and a cat; from the bubble a simple arrow points to a bold flat game screen shape in navy showing the same cat and pizza as big simple shapes. No mascot. Headline "One sentence in. One game out." in chunky cream type. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-tue", brand: CODEIT, day: "2026-10-08", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Same 20 minutes.", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Same 20 minutes of screen time. Two very different kids at the end of it.",
        body: "Same 20 minutes. Same screen.\n\nOne kid watched someone else play a game.\nOne kid made one.\n\nScreen time isn't the problem. Passive screen time is. Three questions that tell you which kind it was:\n\n1. \"What did you make?\"\n2. \"What would you change about it?\"\n3. \"Can you show me how it works?\"\n\nIf they can answer number 3, they learned something.\n\nSave this for after dinner tonight.",
        facebookBody: "Same 20 minutes, same screen: one kid watched a game, one kid made one.\n\nThree questions that tell you which kind of screen time it was:\n1. What did you make?\n2. What would you change?\n3. Can you show me how it works?\n\nIf they can answer number 3, they learned something.",
        hashtags: ["ScreenTime", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        creativeDirection: `Flat vector, split exactly in half: left side navy with the mascot slumped on a flat sofa shape holding a tablet, right side orange with the mascot standing proudly on a flat block tower; a single flat clock shape centred on the dividing line. Headline "Same 20 minutes." in chunky cream type. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-wed", brand: CODEIT, day: "2026-10-10", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · We prove it.", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Kids can code. We prove it. Here's how.",
        body: "Our bio says \"Kids can code. We prove it.\" This is the proof part.\n\nA lot of coding apps only check whether the code runs. That's easy to fake. Copy, paste, done.\n\nCodeIt checks whether your kid understands it. After a build, it asks questions made from their own project. The wrong answers come from other real values in that same file, so guessing doesn't work. Only answers that are right the first time count.\n\nCopying isn't learning. Explaining is.\n\nTry it free, link in bio.",
        facebookBody: "A lot of coding apps only check whether the code runs. CodeIt checks whether your kid understands it.\n\nAfter each build, it asks questions made from their own project. The wrong answers come from their own code too, so guessing doesn't work.\n\nKids can code. We prove it. Try it free: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        creativeDirection: `Flat vector on mint: one giant magnifying glass shape in navy over a single line of simple code blocks in orange, a big flat check mark in cream inside the lens. No mascot. Headline "We prove it." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-thu", brand: CODEIT, day: "2026-10-14", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · Their obsession, their app", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Whatever your kid won't stop talking about can become an app they built.",
        body: "Dinosaurs. Football. Minecraft. Their favourite snack.\n\nWhatever your kid won't stop talking about can become a quiz app they built themselves.\n\nThey describe it. CodeIt builds the first version. Then they make it theirs with new questions, new colours, a harder level, and they see the code behind every change.\n\nWhat would your kid build first? (Example project shown.)\n\nAges 5 to 18. Free to start.",
        facebookBody: "Dinosaurs, football, Minecraft, whatever your kid won't stop talking about can become a quiz app they build themselves. They describe it, CodeIt builds the first version, and they make it theirs.\n\nWhat would your kid build first?",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `Flat vector on sky blue: one enormous flat green dinosaur shape filling the frame, and on its back a small navy tablet showing three big rounded orange answer buttons; the mascot sits on the dinosaur holding the tablet. Headline "Their obsession, their app." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-fri", brand: CODEIT, day: "2026-10-20", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Lesson 1 of 31: make the computer say your name", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "The first line of Python almost every coder ever wrote. Try it with your kid tonight.",
        body: "Lesson 1 of 31: print()\n\nprint(\"Hello!\")\n\nThat's the first line of Python almost every coder ever wrote. It tells the computer: show this on the screen.\n\nTry it with your kid tonight. Change \"Hello!\" to their name. Press run. That's programming.\n\nAll 31 beginner lessons and the Python playground are free for everyone, with no AI involved, so the learning is theirs.\n\nSave this for the weekend.",
        facebookBody: "Lesson 1 of 31: print(\"Hello!\")\n\nThe first line of Python almost every coder wrote. Try it tonight. Change \"Hello!\" to your kid's name and press run.\n\nAll 31 beginner lessons and the Python playground are free at codeitlearn.com.",
        hashtags: ["LearnPython", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        creativeDirection: `Flat vector on cream: a giant flat orange megaphone shape, and bursting out of it the word "Hello!" in huge chunky navy type with three small flat stars. No mascot. Headline "Lesson 1 of 31" small in orange. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-sat", brand: CODEIT, day: "2026-10-12", time: "19:30", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · Why I'm building CodeIt", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your idea first. The moment that made CodeIt.",
        body: "Your idea first.\n\nAt CodeIt's first workshop, at Northcrest's Community Sundays, nobody wanted the example project. Every kid wanted their own thing: a cat that catches pizza, a quiz about their brother, a page for the lemonade stand.\n\nKids light up when they build something that is theirs, and tune out when it is another worksheet.\n\nSo that is how CodeIt works. It starts with the kid's idea, builds the first version with them, then makes sure they understand every line.\n\nFree to start, no card needed. Ages 5 to 18.\nLink in bio: codeitlearn.com",
        facebookBody: "Your idea first.\n\nAt CodeIt's first workshop, nobody wanted the example project. Every kid wanted their own thing. Kids light up when they build something that is theirs.\n\nSo CodeIt starts with the kid's idea, builds the first version with them, and makes sure they understand every line.\n\nFree to start, no card needed. Ages 5 to 18: codeitlearn.com",
        hashtags: ["EdTech", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        creativeDirection: `Flat vector on cream: a big orange lightbulb shape whose filament is a tiny flat dinosaur; three small flat arrows run from the bulb to a simple navy laptop shape. No mascot. Headline "Your idea first." in chunky navy type. No names, no signature, no real people. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-sun", brand: CODEIT, day: "2026-10-13", time: "19:30", pillar: "OFFER", storyHighlight: "FREE",
        title: "CodeIt · Free means free", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Free to start. No card. Here's exactly what's included.",
        body: "\"Free\" usually means \"free until we ask for your card.\" Not with CodeIt.\n\nFree for everyone:\n✓ 31 beginner Python lessons\n✓ The Python playground\n✓ 10 AI assisted builds a month\nNo card needed.\n\nFamily plan: CA$12/month.\n\nBuilt for ages 5 to 18.\nStart free at codeitlearn.com (link in bio)",
        facebookBody: "Free for everyone: 31 beginner Python lessons, the Python playground, and 10 AI assisted builds a month. No card needed.\n\nFamily plan: CA$12/month. Ages 5 to 18.\n\nStart free: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        creativeDirection: `Flat vector on orange: a giant cream price-tag shape with nothing written on it but a big flat zero, the mascot peeking from behind it with a thumbs up; a tiny crossed-out credit card shape in the corner. Headline "Free means free." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "lynq-w2-arcubed", brand: LYNQ, day: "2026-10-21", time: "12:15", pillar: "PROOF", storyHighlight: "ARCUBED",
        title: "LYNQ · PROOF 04 — Arcubed Label", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Every bag is made by hand. Every order used to be, too.",
        body: "Every bag is made by hand. Every order used to be, too.\n\nColour? Size? Deposit? Delivery? Arcubed Label answered all of it in DMs, one bag at a time, while the crochet hook sat waiting.\n\nNow the store does the talking. Pick the bag, pick the colour, order. The order lands in a list, not a chat. The hands go back to the hook.\n\nBuilt end to end by LYNQ for a maker who would rather be making.\n\nIf you sell something you make, your site should take the order so you can keep making. DM \"AUDIT\" and we'll show you where yours drops the thread.",
        facebookBody: "Every bag is made by hand. Every order used to be, too.\n\nArcubed Label answered colour, size, deposit and delivery in DMs, one bag at a time. Now the store does the talking: pick the bag, pick the colour, order. The order lands in a list, not a chat.\n\nBuilt end to end by LYNQ. Sell something you make? Message us and we'll show you where your site drops the thread.",
        hashtags: ["Handmade", "Ecommerce", "WebDesign", "SmallBusiness"], callToAction: "DM AUDIT",
        creativeDirection: `One handmade crochet tote in natural undyed cotton, standing upright and centred on the black studio floor, hard light from the upper left, a single acid-lime paper order tag tied to its handle. No text. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-w2-office", brand: LYNQ, day: "2026-10-19", time: "12:15", pillar: "OFFER", storyHighlight: "OFFICE",
        title: "LYNQ · LYNQ OFFICE — Your business on one screen", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Six logins to run one small business. That is where the hours go.",
        body: "Count the logins you open to run your business. Email, invoices, the booking tool, the spreadsheet, two social apps.\n\nThat's where the hours go. Not into the work, into moving between the tools.\n\nLYNQ Office puts it on one screen: your customers, your projects, what needs you today, and automations that do the repeat work. Posts go out after you approve them from your phone. Leads get a reply before you've seen them.\n\nIt's built per business, so there's no price list. We look at what you run, then quote it in writing.\n\nDM \"OFFICE\" and I'll walk you through it.",
        facebookBody: "Count the logins you open to run your business. That's where the hours go, into moving between tools.\n\nLYNQ Office puts it on one screen: customers, projects, what needs you today, and automations that do the repeat work. Built per business, quoted in writing.\n\nMessage us and we'll walk you through it.",
        hashtags: ["BusinessAutomation", ...LYNQ_TAGS.slice(0, 2)], callToAction: "DM OFFICE",
        creativeDirection: `One slim matte black tablet standing upright on the black studio floor like a product, hard light from the upper left, its edge trimmed with a thin acid-lime line; beside it, six small dull grey keys scattered loose. One line of thin white type: "One screen". ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-w2-twocities", brand: LYNQ, day: "2026-10-20", time: "12:15", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · BEHIND — How we work", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "No packages. No hourly meter. Here is how LYNQ works.",
        body: "No packages. No hourly meter.\n\nEvery business we work with gets the same three questions first: how do customers find you, what do they need to do once they land, and who answers when they reach out at 9pm.\n\nThe answers become the build. A written quote for your business, not a menu of tiers. Then we design it, build it, connect the systems behind it, and keep it running once it is live.\n\nKingsbridge Group, Nasma, Finding Amy and Arcubed Label were all built this way. Different businesses, same standard.\n\nIf you want to know what yours would take, DM \"SITE\".",
        facebookBody: "No packages. No hourly meter.\n\nEvery business we work with gets the same three questions first: how do customers find you, what do they need to do once they land, and who answers when they reach out at 9pm. The answers become the build, with a written quote for your business.\n\nWant to know what yours would take? Send us a message.",
        hashtags: ["WebDesign", "SmallBusiness", "LYNQ"], callToAction: "DM AUDIT",
        creativeDirection: `A matte black clipboard lying on the black studio floor holding one white sheet with three short printed lines and a single acid-lime tick beside the third; hard light from the upper left. One line of thin white type: "Three questions first." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "codeit-w2-askteacher", brand: CODEIT, day: "2026-10-15", time: "19:30", pillar: "LEARN", storyHighlight: "ASK THE TEACHER",
        title: "CodeIt · Ask the teacher: does my kid still need coding if AI writes it?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "\"Do kids still need to learn coding if AI can write it?\" I teach this. Here's my honest answer.",
        body: "ASK THE TEACHER: \"Do kids still need to learn coding if AI can write it?\"\n\nI teach kids to code, so I get this one a lot. Honest answer: yes, but a different version of it.\n\nWhen AI writes the first draft, the skill moves to:\n1. Saying clearly what you want\n2. Reading what came back\n3. Spotting the line that's wrong\n\nThat's exactly what a kid does in CodeIt. Describe the game, get a version, change it, see the code, answer questions about it.\n\nGot a question for the teacher? Put it in the comments and I'll answer it in a post.",
        facebookBody: "\"Do kids still need to learn coding if AI can write it?\" I teach kids to code. Honest answer: yes, a different version of it. Saying clearly what you want, reading what came back, spotting the line that's wrong.\n\nGot a question for the teacher? Ask in the comments.",
        hashtags: ["AIForKids", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        creativeDirection: `Flat vector on navy: a huge cream question mark shape, and a small flat robot shape and a small flat child-sized backpack shape (no child) sitting on its curve. No mascot. Headline "Still need coding?" in chunky orange type. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-w2-question", brand: CODEIT, day: "2026-10-17", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · The question after the build", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The game works. Now one question: what makes the character jump?",
        body: "The game works. Now comes the part most apps skip.\n\nOne question, made from your kid's own code: \"What makes the character jump?\"\n\nThe answer options aren't random. They're other real values from their project, so a guess looks just as plausible as the right answer. Only a first time right answer counts.\n\nThat's how we know they understood it, not just ran it.\n\nKids can code. We prove it. Free to start, link in bio.",
        facebookBody: "The game works. Now one question, made from your kid's own code: what makes the character jump? The wrong answers come from their own project, so guessing doesn't work.\n\nThat's how we know they understood it. Free to start: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `Flat vector on orange: a big flat cream quiz card with a bold navy question "What makes the character jump?" and three rounded navy answer buttons, a tiny flat pixel character mid-jump above it. No mascot. Headline "Prove it." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-w2-sunday", brand: CODEIT, day: "2026-10-18", time: "10:00", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · What a room full of kids taught me", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The first CodeIt workshop taught me more than any plan did.",
        body: "The first CodeIt workshop was at Northcrest's Community Sundays. A room, some laptops, kids who'd never written a line of code.\n\nWhat I learned in two hours:\n\nNobody wanted the example project. Every kid wanted their own thing: a cat game, a quiz about their brother, a page for their lemonade stand.\n\nSo that's what CodeIt became. It starts with the kid's idea, not ours.\n\nRun a community program or a school club and want a session? Message us. The tool is free, and so is the first session.",
        facebookBody: "The first CodeIt workshop was at Northcrest's Community Sundays. What I learned: nobody wanted the example project. Every kid wanted their own thing.\n\nSo that's what CodeIt became. It starts with the kid's idea, not ours.\n\nRun a community program or school club? Message us. The tool is free, and so is the first session.",
        hashtags: ["KidsCoding", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        creativeDirection: `Flat vector on mint: a row of five simple flat laptop shapes in navy, each screen a different tiny flat project (a cat, a quiz card, a lemonade cup, a rocket, a star); the mascot stands at the end of the row pointing at them. No real people, no faces. Headline "Your idea first." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-w2-challenge", brand: CODEIT, day: "2026-10-21", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · October challenge: a game about your favourite snack", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "October challenge: build a game about your favourite snack. Free to enter, free to build.",
        body: "OCTOBER CHALLENGE: build a game about your favourite snack.\n\nPizza that falls from the sky. A samosa that has to dodge the fork. Popcorn you catch in a bucket. Any snack, any idea.\n\nHow it works:\n1. Your kid describes the game in one sentence on codeitlearn.com\n2. CodeIt builds the first version\n3. They change one thing and make it theirs\n\nSend us the game (no faces needed, just the screen) and we'll share our favourites with first name and age, with your permission.\n\nFree to enter, free to build. Ages 5 to 18.",
        facebookBody: "OCTOBER CHALLENGE: build a game about your favourite snack. Your kid describes it in one sentence on codeitlearn.com, CodeIt builds the first version, they make it theirs.\n\nSend us the game (just the screen, no faces) and we'll share our favourites with your permission. Free to enter, free to build.",
        hashtags: ["KidsChallenge", ...CODEIT_TAGS.slice(0, 2)], callToAction: "Start free at codeitlearn.com",
        creativeDirection: `Flat vector on orange: a big flat gold trophy shape holding a giant pizza slice, confetti as simple flat triangles, the mascot hugging the trophy. Headline "October challenge" in chunky cream type. ${CODEIT_LOOK}`,
      },
    ],
    reels: [
      {
        key: "lynq-reel-tue", brand: LYNQ, day: "2026-10-09", time: "18:30", series: "BUILD LOG",
        title: "LYNQ Reel · BUILD LOG — Day 1 of 10",
        hook: "I'm building a local business a website in 10 days. This is Day 1.",
        body: "BUILD LOG, Day 1 of 10.\n\nDay 1 isn't design. It's one question: what does the person visiting this site actually want to do?\n\nBook. Call. Get a quote. Everything we build after today serves that one answer.\n\nFollow to watch the next 9 days.\nWant yours built the same way? DM \"SITE\".",
        facebookBody: "BUILD LOG, Day 1 of 10: before any design, one question. What does the visitor actually want to do? Book, call, or get a quote. Everything after today serves that answer. Follow along for the next 9 days.",
        hashtags: LYNQ_TAGS, callToAction: "DM SITE",
        script: "Screen-record a real build you're doing now (e.g. Chris Property Buyers, with his OK; blur the name if not). First frame: the project file with a big 'DAY 1/10' — no logo intro. 20–30 seconds, your voice or on-screen text, original audio.",
        shots: [
          { timing: "0–2s", visual: "Project board with 'DAY 1/10' and the business type", onScreenText: "Day 1 of 10" },
          { timing: "2–12s", visual: "Writing the one question on a sticky note or doc", onScreenText: "What does the visitor want to DO?" },
          { timing: "12–24s", visual: "Rough wireframe with the booking button placed first", onScreenText: "Book. Call. Quote." },
          { timing: "24–30s", visual: "Black end card", onScreenText: "Day 2 tomorrow · DM SITE" },
        ],
      },
      {
        key: "lynq-reel-thu", brand: LYNQ, day: "2026-10-16", time: "18:30", series: "WATCH IT WORK",
        title: "LYNQ Reel · WATCH IT WORK — one tap, live",
        hook: "This post went live because I tapped one button on my phone.",
        body: "WATCH IT WORK: this post went live because I tapped one button.\n\nThe system drafts it. My phone buzzes. I read the caption, check the image, tap ✅, and it's on Instagram and Facebook.\n\nNo logging into four apps. No \"I'll post Thursday\" that turns into next month.\n\nIt's what our Growth System sets up for clients.\nDM \"GROW\" and I'll show you how it would work for you.",
        facebookBody: "This post went live because I tapped one button on my phone. The system drafts it, I check it, one tap, and it's on Instagram and Facebook. It's what our Growth System sets up for clients. Message us to see how it would work for you.",
        hashtags: ["SocialMediaMarketing", ...LYNQ_TAGS.slice(0, 2)], callToAction: "DM GROW",
        script: "Screen-record your phone for real: the Telegram notification from the LYNQ bot, opening it, the image and caption, your thumb tapping ✅. Cut to the Instagram profile with this post at the top. 12–20 seconds. This reel is literally true — film it the morning it goes out.",
        shots: [
          { timing: "0–2s", visual: "Lock screen: Telegram notification from the LYNQ bot", onScreenText: "My phone just buzzed" },
          { timing: "2–8s", visual: "The post's image, caption and buttons in Telegram", onScreenText: "I check it" },
          { timing: "8–11s", visual: "Thumb taps ✅", onScreenText: "One tap" },
          { timing: "11–18s", visual: "Instagram profile with the new post on top", onScreenText: "Live. DM GROW" },
        ],
      },
      {
        key: "lynq-reel-sat", brand: LYNQ, day: "2026-10-09", time: "18:30", series: "FIX THIS",
        title: "LYNQ Reel · FIX THIS — 60 seconds on a clinic's website",
        hook: "60 seconds on a clinic's website. Watch where the bookings leak.",
        body: "FIX THIS: 60 seconds on a clinic's website (name hidden).\n\nThe three things I check first on every clinic site:\n1. Can a patient on a phone find \"Book\" without scrolling?\n2. Are the hours and phone number on every page?\n3. Do the Google reviews show up on the site?\n\nWatch what this one gets wrong.\n\nWant me to do yours? DM \"AUDIT\". It's free.",
        facebookBody: "60 seconds on a clinic's website: can a patient find \"Book\" without scrolling, are hours and phone on every page, do the reviews show up? Watch what this one gets wrong. Want a free review of yours? Send us a message.",
        hashtags: ["ClinicMarketing", ...LYNQ_TAGS], callToAction: "DM AUDIT",
        script: "Screen-record a real clinic site in a phone-sized window, name and logo blurred. Walk the three checks in order and say what you actually find. Only claim what's on screen. 30–45 seconds.",
        shots: [
          { timing: "0–2s", visual: "Clinic homepage on a phone frame, name blurred, timer '0:60'", onScreenText: "60-second audit" },
          { timing: "2–15s", visual: "Scrolling to find the Book button", onScreenText: "1. Where's 'Book'?" },
          { timing: "15–27s", visual: "Inner page — looking for hours/phone", onScreenText: "2. Hours + phone" },
          { timing: "27–38s", visual: "Searching for reviews on the site", onScreenText: "3. Reviews" },
          { timing: "38–45s", visual: "Black end card", onScreenText: "Free audit · DM AUDIT" },
        ],
      },
      {
        key: "codeit-reel-tue", brand: CODEIT, day: "2026-10-12", time: "16:30", series: "IDEA TO GAME",
        title: "CodeIt Reel · Idea to game in under a minute",
        hook: "Type a sentence. Get a game. Then see the code.",
        body: "One sentence becomes a playable game, and then you see the code behind it. Under a minute.\n\nWhat should we build next? Drop your kid's wildest game idea below and we'll build one of them on camera.\n\nCodeIt is free to start for ages 5 to 18. Link in bio.",
        facebookBody: "One sentence becomes a playable game, then the code behind it, in under a minute. What should we build next? Tell us your kid's wildest game idea and we'll build one on camera.",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        script: "Screen-record CodeIt for real: first frame is the idea being typed (no intro). Game appears, play 3 seconds, change one value (speed or colour), open the code view. 25–40 seconds, original audio or voice-over.",
        shots: [
          { timing: "0–3s", visual: "Typing the idea into CodeIt", onScreenText: "One sentence…" },
          { timing: "3–14s", visual: "The game appears and is played", onScreenText: "…a real game" },
          { timing: "14–28s", visual: "Changing speed or colour, game updates live", onScreenText: "Make it yours" },
          { timing: "28–38s", visual: "Code view with the changed line highlighted", onScreenText: "Now see the code" },
        ],
      },
      {
        key: "codeit-reel-thu", brand: CODEIT, day: "2026-10-09", time: "16:30", series: "PYTHON IN 20 SECONDS",
        title: "CodeIt Reel · Python in 20 seconds: print()",
        hook: "Your kid's first line of Python, in 20 seconds.",
        body: "Your kid's first line of Python, in 20 seconds.\n\nType print(\"Hello!\"), change it to their name, run it.\n\nSend this to a parent who keeps saying \"I don't know anything about coding.\" Neither did anyone, before line 1.\n\n31 free lessons at codeitlearn.com.",
        facebookBody: "Your kid's first line of Python in 20 seconds: print(\"Hello!\"), change it to their name, press run. 31 free lessons at codeitlearn.com.",
        hashtags: ["LearnPython", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        script: "Screen-record the CodeIt Python playground: type print(\"Hello!\"), run, change to a name, run again. 15–20 seconds, big readable font.",
        shots: [
          { timing: "0–4s", visual: "Typing print(\"Hello!\")", onScreenText: "Line 1 of Python" },
          { timing: "4–9s", visual: "Run → Hello! appears", onScreenText: "Run it" },
          { timing: "9–18s", visual: "Change to a name, run again", onScreenText: "Now make it yours" },
        ],
      },
      {
        key: "codeit-reel-sat", brand: CODEIT, day: "2026-10-19", time: "16:30", series: "WE PROVE IT",
        title: "CodeIt Reel · The question after the build",
        hook: "Copying code is easy. Explaining it is learning.",
        body: "Copying code is easy. Explaining it is learning.\n\nAfter every build, CodeIt asks your kid about their own code. The wrong answers come from their own project, so guessing doesn't work.\n\nKids can code. We prove it.\nTry it free, link in bio.",
        facebookBody: "Copying code is easy. Explaining it is learning. After every build, CodeIt asks your kid about their own code, so guessing doesn't work. Kids can code. We prove it.",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        script: "Screen-record finishing a build in CodeIt, then the comprehension question appearing and being answered right first time. 20–30 seconds.",
        shots: [
          { timing: "0–5s", visual: "A finished build running", onScreenText: "Built it?" },
          { timing: "5–17s", visual: "The question generated from that code appears", onScreenText: "Now explain it" },
          { timing: "17–27s", visual: "Answering correctly first time", onScreenText: "We prove it." },
        ],
      },
      {
        key: "lynq-reel-maze", brand: LYNQ, day: "2026-10-21", time: "18:30", series: "FIX THIS", videoFromTelegram: true,
        title: "LYNQ Reel · Not a maze — the arrow finds the Book button",
        hook: "Your customer came to book, not solve a maze.",
        body: "Your customer came to book, not solve a maze.\n\nA clear website helps people understand what you offer, find what they need, and take the next step.\n\nLYNQ. Built to move businesses forward.\n\nDM \"REBUILD\" and we will send you the before and after of your own homepage.",
        facebookBody: "Your customer came to book, not solve a maze.\n\nA clear website helps people understand what you offer, find what they need, and take the next step.\n\nLYNQ. Built to move businesses forward.\n\nMessage us and we will send you the before and after of your own homepage.",
        hashtags: LYNQ_TAGS, callToAction: "DM REBUILD",
        script: "Animated: a single arrow travels through a cluttered homepage, hits dead ends, then the page clears and the arrow lands on the Book button. 15 to 25 seconds, no voice needed.",
        shots: [{ timing: "0-3s", visual: "Arrow enters a cluttered page", onScreenText: "Your customer came to book", audio: "" }, { timing: "3-15s", visual: "Dead ends, back-tracking", onScreenText: "not solve a maze", audio: "" }, { timing: "15-25s", visual: "Page clears, arrow lands on Book", onScreenText: "LYNQ", audio: "" }],
      },
      {
        key: "lynq-w2-reel-rebuilt", brand: LYNQ, day: "2026-10-12", time: "18:30", series: "REBUILT",
        title: "LYNQ Reel · REBUILT — a plumber's homepage in 10 minutes",
        hook: "I rebuilt a plumber's homepage in 10 minutes. Here's what changed.",
        body: "REBUILT: a plumber's homepage in 10 minutes (name hidden).\n\nWhat changed:\n1. \"Call now\" at the top, not under three paragraphs\n2. Service area and hours on the first screen\n3. The Google reviews they already had, finally on the site\n\nOld on the left, new on the right at the end.\n\nWant yours done? DM \"REBUILD\" and I'll send you the before and after of your own homepage.",
        facebookBody: "I rebuilt a plumber's homepage in 10 minutes. Call now at the top, service area and hours on the first screen, their Google reviews on the site. Old and new side by side at the end. Want yours? Send us a message.",
        hashtags: ["Plumbers", ...LYNQ_TAGS.slice(0, 2)], callToAction: "DM REBUILD",
        script: "Screen-record the rebuild as a timelapse: the real homepage (name and logo blurred) on the left, a blank page on the right that fills in. Speed up to 30 to 45 seconds. Freeze on old vs new for the last 4 seconds. Say the three changes out loud while they appear. Only show what you really built.",
        shots: [
          { timing: "0–2s", visual: "Old homepage on a phone frame, name blurred, timer reads 10:00", onScreenText: "Rebuilt in 10 minutes" },
          { timing: "2–12s", visual: "Call button dragged to the top of the new page", onScreenText: "1. Call now, first" },
          { timing: "12–22s", visual: "Service area and hours added to the first screen", onScreenText: "2. Area and hours" },
          { timing: "22–32s", visual: "Google reviews block drops in", onScreenText: "3. Reviews they already had" },
          { timing: "32–38s", visual: "Old left, new right, side by side", onScreenText: "Before and after · DM REBUILD" },
        ],
      },
      {
        key: "lynq-w2-reel-fixthis-restaurant", brand: LYNQ, day: "2026-10-19", time: "18:30", series: "FIX THIS",
        title: "LYNQ Reel · FIX THIS — a restaurant's site on a phone, 60 seconds",
        hook: "60 seconds on a restaurant's website, on a phone, hungry. Watch where I give up.",
        body: "FIX THIS: 60 seconds on a restaurant's website (name hidden), on a phone, hungry.\n\nI'm looking for three things: the menu, the hours, a way to book. Watch where I give up.\n\nThe fixes are small: a real menu page instead of a PDF, hours on the first screen, a book button that stays on screen.\n\nOwn a restaurant? DM \"AUDIT\" and I'll do yours. It's free.",
        facebookBody: "60 seconds on a restaurant's website, on a phone, hungry. Menu, hours, book. Watch where I give up. Own a restaurant? Send us a message for a free review of your site.",
        hashtags: ["RestaurantMarketing", "WebDesign", "SmallBusiness"], callToAction: "DM AUDIT",
        script: "Screen-record a real restaurant site in a phone frame, name blurred. Narrate as a hungry customer: find the menu, find the hours, try to book. Stop the clock where it breaks. 30 to 45 seconds. Only claim what's on screen.",
        shots: [
          { timing: "0–2s", visual: "Restaurant homepage on a phone, name blurred, timer 0:60", onScreenText: "I'm hungry. 60 seconds." },
          { timing: "2–18s", visual: "Hunting for the menu, PDF opens tiny", onScreenText: "1. Where's the menu?" },
          { timing: "18–30s", visual: "Scrolling for hours", onScreenText: "2. Are you open?" },
          { timing: "30–42s", visual: "Looking for a book button, ends on the fix list", onScreenText: "3. Can I book? · DM AUDIT" },
        ],
      },
      {
        key: "codeit-w2-reel-input", brand: CODEIT, day: "2026-10-16", time: "16:30", series: "PYTHON IN 20 SECONDS",
        title: "CodeIt Reel · Python in 20 seconds: input()",
        hook: "Lesson 2 of 31: the computer asks your kid a question. 20 seconds.",
        body: "Lesson 2 of 31: input()\n\nname = input(\"What's your name?\")\nprint(\"Hi \" + name)\n\nTwo lines, and the computer talks back. Kids love this one because it's the first time the program waits for them.\n\nTry it tonight in the free playground at codeitlearn.com. Change the question to anything.\n\nSend this to a parent who thinks coding is too hard for a 7 year old.",
        facebookBody: "Lesson 2 of 31: input(). Two lines and the computer asks your kid a question, then answers back. Try it tonight in the free playground at codeitlearn.com.",
        hashtags: ["LearnPython", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        script: "Screen-record the CodeIt Python playground: type the two lines, run, type a name when it asks, see the reply. 15 to 20 seconds, big readable font, no intro.",
        shots: [
          { timing: "0–5s", visual: "Typing name = input(\"What's your name?\")", onScreenText: "Lesson 2 of 31" },
          { timing: "5–10s", visual: "Typing print(\"Hi \" + name) and pressing run", onScreenText: "Run it" },
          { timing: "10–18s", visual: "The program asks, a name is typed, it replies Hi", onScreenText: "It talks back" },
        ],
      },
    ],
    linkedin: [
      {
        key: "lynq-li-tue", brand: LYNQ, day: "2026-10-13", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — The 9pm test",
        body: "I have a habit that annoys business owners until it helps them.\n\nWhen I look at a local business website, I fill in the contact form at 9pm. Then I wait.\n\nMost of the time, nothing happens. Sometimes a reply arrives the next afternoon. By then the person who needed a plumber, a table or an appointment has already booked with whoever answered first.\n\nThis isn't a design problem. The site can be beautiful. It's a response problem, and it happens after hours, when the owner is the one person who can't be at a keyboard.\n\nSo every site LYNQ builds replies on its own. Form in, text and email out within a minute, with the booking link inside. The owner follows up in the morning, like normal, except the customer already feels looked after.\n\nWe run LYNQ the same way. Every post goes out only after a human approves it from a phone. The automation does the waiting. People make the decisions.\n\nIf you run a service business: fill in your own contact form tonight at 9pm. What happens?",
      },
      {
        key: "lynq-li-thu", brand: LYNQ, day: "2026-10-08", time: "08:15", pillar: "TEACH",
        title: "LinkedIn · Mustafa — The 3 checks I run on every local business site",
        body: "I review a lot of local business websites. Before design, before SEO, I check three things, and plenty of sites miss at least one.\n\n1. Can a customer on a phone find the main action without scrolling?\nBook, call, get a quote. If it's below three paragraphs of \"welcome to our family business,\" most visitors never see it.\n\n2. Are the hours and phone number on every page?\nNot just the contact page. People land on inner pages from Google.\n\n3. Does the site show proof that already exists?\nMost businesses have Google reviews. Very few show them on their own website, where the decision actually happens.\n\nNone of these need a redesign. All three can usually be fixed in an afternoon.\n\nIf you own or market a local business, run these three on your own site today. If you want a second pair of eyes, send me a message and I'll do a free 5-minute review.",
      },
      {
        key: "codeit-li-wed", brand: CODEIT, day: "2026-10-09", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — What kids actually need to learn now",
        body: "I teach kids to code in Toronto. A question I hear from parents: \"Does my kid still need to learn coding if AI can write it?\"\n\nMy honest answer: they need it more, just a different version of it.\n\nWhen AI writes the first draft, the valuable skills move:\n1. Saying clearly what you want\n2. Reading code someone (or something) else wrote\n3. Predicting what it will do before you run it\n4. Finding the line that's wrong when the result isn't what you asked for\n\nThat's what I built CodeIt around. A kid describes a game, gets a working first version, then changes it and sees the code behind every change. After each build, CodeIt asks them questions made from their own project. The wrong answers come from that same file, so you can't guess your way through.\n\nTyping code was never the point. Understanding it is.\n\nTeachers and parents: how are you thinking about this?",
      },
      {
        key: "codeit-li-fri", brand: CODEIT, day: "2026-10-14", time: "08:15", pillar: "HOW IT WORKS",
        title: "LinkedIn · Mustafa — Why our quiz questions come from the kid's own code",
        body: "A lot of coding platforms for kids check one thing: does the code run?\n\nThe problem is that \"it runs\" is easy to fake. Copy, paste, green tick. The platform reports progress. The kid learned nothing.\n\nWhen I designed CodeIt's comprehension checks, I set three rules:\n\n1. Questions are generated from the child's own project file, not a generic question bank.\n2. The wrong answer options come from other real values in that same file, so every option looks plausible to someone who didn't read the code.\n3. Only first-time-correct answers count toward progress.\n\nThe result is slower-looking progress and much more honest progress. A parent can trust that \"done\" means understood.\n\nCodeIt is free to start for ages 5 to 18. The 31 beginner Python lessons and the playground are free for everyone, and the family plan is CA$12/month.\n\nIf you build learning products: how do you measure understanding rather than completion?",
      },
      {
        key: "lynq-w2-li-price", brand: LYNQ, day: "2026-10-15", time: "08:15", pillar: "OFFER",
        title: "LinkedIn · Mustafa — Why LYNQ doesn't have a price list",
        body: "People ask me for LYNQ's price list. We don't have one, and it's on purpose.\n\nA price list means the product is fixed before we've seen the business. A five page site for a dental clinic and a five page site for a tiling contractor look the same on a menu and are nothing alike in practice. One needs online booking that talks to the clinic's software. The other needs a quote form that replies in a minute because the customer is standing in a half tiled bathroom.\n\nSo we do it the slow way. We look at how the business actually gets customers today, what the site has to do about that, and what can be automated so the owner isn't the bottleneck. Then we write a quote for that work, in plain language, before anything starts. No hourly meter, no surprise invoice.\n\nIt costs us a conversation up front. It saves the client from paying for a package they only needed half of.\n\nIf you're a business owner comparing quotes right now: ask each one what they'll change for your business specifically. The answer tells you a lot.",
      },
      {
        key: "lynq-w2-li-cities", brand: LYNQ, day: "2026-10-20", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — What LYNQ actually builds",
        body: "People ask what LYNQ does. The short answer is websites. The honest answer is longer.\n\nA website that looks good and does nothing is a brochure. We build the part that works: found on Google, answers in under a minute, gets the booking or the order. The design sits on top of that, not instead of it.\n\nFor a property management company, that meant one page that wins an owner's trust and calms a tenant with a leak at midnight. For a restaurant, it meant the menu, the hours and a table booked in ten seconds on a phone. For a maker selling handmade bags, it meant a store that takes the order so she can stop answering DMs and get back to the hook.\n\nSame rules every time. Found. Answers. Converts. Everything else is taste.\n\nWe don't sell packages and we don't run an hourly meter. You get a written quote for your business, we build it, and we look after it once it's live.\n\nIf you run a business and want an honest look at your site, send me a message. Five minutes, no pitch.",
      },
      {
        key: "codeit-w2-li-guilt", brand: CODEIT, day: "2026-10-16", time: "08:15", pillar: "LEARN",
        title: "LinkedIn · Mustafa — Screen time isn't the problem",
        body: "Most of the parents I talk to feel guilty about screen time. Almost all of them allow it anyway. The guilt doesn't change the hours. It just makes them feel worse about the hours.\n\nHere is what I've seen teaching kids to code: the screen was never the variable. What the kid does on it is.\n\nTwenty minutes watching someone else play a game and twenty minutes making one look identical from the kitchen. They are not. One ends with a kid who can tell you what they built, what they'd change, and how it works. The other ends with a kid who needs the next video.\n\nThree questions that tell you which one just happened, no app required:\n1. What did you make?\n2. What would you change about it?\n3. Can you show me how it works?\n\nIf they can answer the third one, that was a good twenty minutes.\n\nI built CodeIt so the answer to all three is easy. A kid describes a game, gets a working version, changes it, and sees the code. Free to start, ages 5 to 18.\n\nParents and teachers: what do you ask after screen time?",
      },
      {
        key: "codeit-w2-li-workshop", brand: CODEIT, day: "2026-10-21", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — What the first workshop changed",
        body: "CodeIt's first workshop ran at Northcrest's Community Sundays in Toronto. I walked in with a plan and an example project. The plan lasted about ten minutes.\n\nNobody wanted the example. Every kid wanted their own thing. A cat game. A quiz about a little brother. A page for a lemonade stand. The energy in the room came entirely from ownership, and it disappeared the moment I tried to steer everyone back to the same exercise.\n\nSo I stopped steering. Each kid described what they wanted, we built a first version together, and then they changed it. Faster. Different colours. A harder level. Every change showed them the code that made it happen.\n\nThat afternoon became the product. CodeIt starts from the kid's idea, builds the first version with them, and then checks that they understood it with questions made from their own code.\n\nIf you run a community program, a library session or a school club in the GTA and want a hands on coding session, message me. The tool is free, and so is the first session.",
      },
    ],
  },
  {
    key: "2026-11-02",
    label: "Oct 22 to Nov 4 — LYNQ + CodeIt, one post a day each",
    weekStart: "2026-10-22",
    retired: ["n-codeit-free", "n-codeit-askteacher"],
    highlights: {
      LYNQ: ["START HERE", "KINGSBRIDGE", "NASMA", "AMY", "ARCUBED", "HOUSE DEALS", "KIDS CODING", "FIX THIS", "WHAT YOU GET", "OFFICE", "BEHIND"],
      CodeIt: ["START HERE", "BUILDS", "LESSONS", "ASK THE TEACHER", "FREE", "ABOUT", "QUIZ", "PIP"],
    },
    feed: [
      {
        key: "n-lynq-google", brand: LYNQ, day: "2026-10-22", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · FIX THIS — 5 empty fields on your Google profile", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Half of your Google profile is empty. It is the first thing customers see.",
        body: "FIX THIS: your Google Business Profile.\n\nBefore anyone sees your website, they see this. And most local businesses leave half of it empty:\n\n1. Business description\n2. Services (with prices if you can)\n3. Hours, including holidays\n4. Photos of the real place and real work\n5. A booking or website link\n\nIt's free, it takes an hour, and it's often the first impression you make.\n\nSave this and do it this weekend.",
        facebookBody: "Before anyone sees your website, they see your Google Business Profile. Five fields most owners leave empty: description, services, hours (holidays too), real photos, and a booking link.\n\nFree, one hour, and often your first impression. Worth doing this weekend.",
        hashtags: ["GoogleBusinessProfile", "LocalSEO", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Save this",
        creativeDirection: `A plain matte black index card standing upright on the black studio floor like a product, half of it printed with crisp white form lines and half left blank; one acid-lime pin holds it. One line of thin white type: "Half of you is missing". ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-office", brand: LYNQ, day: "2026-10-23", time: "12:15", pillar: "OFFER", storyHighlight: "OFFICE",
        title: "LYNQ · LYNQ OFFICE — Your business on one screen", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Six logins to run one small business. That is where the hours go.",
        body: "Count the logins you open to run your business. Email, invoices, the booking tool, the spreadsheet, two social apps.\n\nThat's where the hours go. Not into the work, into moving between the tools.\n\nLYNQ Office puts it on one screen: your customers, your projects, what needs you today, and automations that do the repeat work. Posts go out after you approve them from your phone. Leads get a reply before you've seen them.\n\nIt's built per business, so there's no price list. We look at what you run, then quote it in writing.\n\nDM \"OFFICE\" and we will walk you through it.",
        facebookBody: "Count the logins you open to run your business. That's where the hours go, into moving between tools.\n\nLYNQ Office puts it on one screen: customers, projects, what needs you today, and automations that do the repeat work. Built per business, quoted in writing.\n\nMessage us and we'll walk you through it.",
        hashtags: ["BusinessAutomation", ...LYNQ_TAGS.slice(0, 2)], callToAction: "DM OFFICE",
        creativeDirection: `One slim matte black tablet standing upright on the black studio floor like a product, hard light from the upper left, its edge trimmed with a thin acid-lime line; beside it, six small dull grey keys scattered loose. One line of thin white type: "One screen". ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-amy", brand: LYNQ, day: "2026-10-24", time: "12:15", pillar: "PROOF", storyHighlight: "AMY",
        title: "LYNQ · PROOF 03 — Finding Amy", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "An events site has one job: answer \"is my date free?\" before they ask.",
        body: "An events business needs its website to do exactly one thing: get the date request.\n\nFinding Amy rents photo booths for events. Their customers want to see the booth at a real party, see what's included, and ask about their date, fast.\n\nSo the whole site walks that one path.\n\nWant your site built around the one thing that pays you? DM \"AUDIT\".",
        facebookBody: "An events business needs its website to do one thing: get the date request. We built Finding Amy's site around that one path. See the booth, see what's included, ask about your date.\n\nWant yours built around the one thing that pays you? Send us a message.",
        hashtags: ["EventPlanning", "WebDesign", "SmallBusiness"], callToAction: "DM AUDIT",
        creativeDirection: `A small desk calendar standing on the black studio floor, matte black pages, one date circled in acid lime, hard light from the upper left and one clean shadow. One line of thin white type: "Is my date free?" ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-9pm", brand: LYNQ, day: "2026-10-26", time: "12:15", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · FOUNDER — The 9pm test", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "We fill in contact forms at 9pm to see who answers. Almost nobody does.",
        body: "We have a habit. When we look at a local business website, we fill in the contact form at 9pm and wait.\n\nMost of the time, nothing. A reply the next afternoon at best. By then the person who needed a plumber, a table or an appointment has already booked with someone else.\n\nThat's why every LYNQ site replies on its own. Form in, text and email out, with the booking link, in under a minute. Then the owner follows up in the morning like normal.\n\nIt is also how we run LYNQ itself. Every post you see here was drafted, checked and approved from a phone before it went out. Nothing ships without a human saying yes.\n\nQuestions about your site? The comments are open.",
        facebookBody: "We fill in local business contact forms at 9pm to see who answers. Almost nobody does. By the next afternoon the customer has booked with someone else.\n\nSo every LYNQ site replies on its own, by text and email, in under a minute. The owner follows up in the morning.\n\nQuestions about your site? The comments are open.",
        hashtags: ["Founder", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comments open",
        creativeDirection: `A smartphone lying face-down on the black studio floor, hard light from the upper left, a thin acid-lime line of light leaking from under one edge. One line of thin white type: "9:04 pm". ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-call", brand: LYNQ, day: "2026-10-27", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · FIX THIS — Can they call you in three seconds?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Open your site on your phone. Count to three. Can they call you yet?",
        body: "FIX THIS: the three second test.\n\nOpen your own website on your phone. Count to three. In that time a customer should be able to do one thing: call you, or book.\n\nIf the phone number is in the footer, under the slideshow, behind a menu, you failed the test. So does most of your competition.\n\nThe fix is small:\n1. A call button that stays on screen on mobile\n2. The booking link in the first screen, not the third\n3. Hours next to the number, so nobody calls a closed shop\n\nTry it now on your site, then send this to an owner who needs it.",
        facebookBody: "The three second test: open your website on your phone and count to three. Can a customer call you or book yet? If the number is in the footer, under the slideshow or behind a menu, you failed. The fix: a call button that stays on screen, the booking link in the first screen, hours next to the number. Try it on your site now.",
        hashtags: LYNQ_TAGS, callToAction: "Save this",
        creativeDirection: `A matte black stopwatch lying on the black studio floor, hard light from the upper left, its single hand pointing at three; the tiny tick mark at three is acid lime. One line of thin white type: "Three seconds." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-arcubed", brand: LYNQ, day: "2026-10-28", time: "12:15", pillar: "PROOF", storyHighlight: "ARCUBED",
        title: "LYNQ · PROOF 04 — Arcubed Label", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Every bag is made by hand. Every order used to be, too.",
        body: "Every bag is made by hand. Every order used to be, too.\n\nColour? Size? Deposit? Delivery? Arcubed Label answered all of it in DMs, one bag at a time, while the crochet hook sat waiting.\n\nNow the store does the talking. Pick the bag, pick the colour, order. The order lands in a list, not a chat. The hands go back to the hook.\n\nBuilt end to end by LYNQ for a maker who would rather be making.\n\nIf you sell something you make, your site should take the order so you can keep making. DM \"AUDIT\" and we'll show you where yours drops the thread.",
        facebookBody: "Every bag is made by hand. Every order used to be, too.\n\nArcubed Label answered colour, size, deposit and delivery in DMs, one bag at a time. Now the store does the talking: pick the bag, pick the colour, order. The order lands in a list, not a chat.\n\nBuilt end to end by LYNQ. Sell something you make? Message us and we'll show you where your site drops the thread.",
        hashtags: ["Handmade", "Ecommerce", "WebDesign", "SmallBusiness"], callToAction: "DM AUDIT",
        creativeDirection: `One handmade crochet tote in natural undyed cotton, standing upright and centred on the black studio floor, hard light from the upper left, a single acid-lime paper order tag tied to its handle. No text. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-review", brand: LYNQ, day: "2026-10-30", time: "12:15", pillar: "OFFER", storyHighlight: "WHAT YOU GET",
        title: "LYNQ · WHAT YOU GET — The free five minute review", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The free five minute review. Here is exactly what we check.",
        body: "People ask what the free review actually is. Here it is.\n\nWe open your site on a phone, like a customer would, and check five things:\n1. Can they call or book in the first screen\n2. Does Google show the right hours, photos and link\n3. What happens when someone fills in your form at 9pm\n4. Does the site load before they give up\n5. Does it say what you do in one sentence\n\nYou get the answers in a short message, with what we would fix first. No pitch, no price list, no pressure.\n\nIf you want it, DM \"AUDIT\".",
        facebookBody: "The free five minute review, exactly as we do it: can they call or book in the first screen, does Google show the right hours and photos, what happens to your form at 9pm, does the site load before they give up, does it say what you do in one sentence. Answers in a short message, no pitch. Message us for yours.",
        hashtags: LYNQ_TAGS, callToAction: "DM AUDIT",
        creativeDirection: `A matte black magnifying glass lying on the black studio floor, hard light from the upper left and one clean shadow; the rim of the lens is a thin acid-lime ring. One line of thin white type: "Five minutes." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-howwework", brand: LYNQ, day: "2026-10-31", time: "12:15", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · BEHIND — How we work", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "No packages. No hourly meter. Here is how LYNQ works.",
        body: "No packages. No hourly meter.\n\nEvery business we work with gets the same three questions first: how do customers find you, what do they need to do once they land, and who answers when they reach out at 9pm.\n\nThe answers become the build. A written quote for your business, not a menu of tiers. Then we design it, build it, connect the systems behind it, and keep it running once it is live.\n\nKingsbridge Group, Nasma, Finding Amy and Arcubed Label were all built this way. Different businesses, same standard.\n\nIf you want to know what yours would take, DM \"SITE\".",
        facebookBody: "No packages. No hourly meter.\n\nEvery business we work with gets the same three questions first: how do customers find you, what do they need to do once they land, and who answers when they reach out at 9pm. The answers become the build, with a written quote for your business.\n\nWant to know what yours would take? Send us a message.",
        hashtags: ["WebDesign", "SmallBusiness", "LYNQ"], callToAction: "DM AUDIT",
        creativeDirection: `A matte black clipboard lying on the black studio floor holding one white sheet with three short printed lines and a single acid-lime tick beside the third; hard light from the upper left. One line of thin white type: "Three questions first." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-hours", brand: LYNQ, day: "2026-11-01", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · FIX THIS — Your hours are wrong on Google", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Google says you are open. Your door says you are closed. Guess who they blame.",
        body: "FIX THIS: your hours on Google.\n\nSomeone drives over because Google said open until 8. The door is locked at 6. They do not blame Google. They leave a one star review and go to the place next door.\n\nTen minutes fixes it:\n1. Open your Google Business Profile\n2. Set the real hours, including the day you close early\n3. Add holiday hours now, not the night before\n4. Match the hours on your website to the same numbers\n\nDo it today. It is the cheapest review protection there is.",
        facebookBody: "Google says open until 8, the door is locked at 6, and the customer blames you, not Google. Ten minutes fixes it: set the real hours on your Google Business Profile, add holiday hours now, and match the hours on your website. Cheapest review protection there is.",
        hashtags: LYNQ_TAGS, callToAction: "Save this",
        creativeDirection: `A small matte black "CLOSED" door sign hanging on a thin chain, isolated on the black studio floor, hard light from the upper left; the hook it hangs from is acid lime. One line of thin white type: "Open until 8?" ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-lynq-includes", brand: LYNQ, day: "2026-11-03", time: "12:15", pillar: "OFFER", storyHighlight: "WHAT YOU GET",
        title: "LYNQ · WHAT YOU GET — What a LYNQ site includes", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "A LYNQ site is not a brochure. Here is what comes with it.",
        body: "A LYNQ site is not a brochure. Here is what every one comes with.\n\n1. Found: Google Business Profile done properly, the site built so it ranks for what you actually sell\n2. Answers: every form and message gets a reply by text and email in under a minute, day or night\n3. Converts: call, book or buy in the first screen on a phone\n4. Kept: hosting, updates and fixes stay with us after launch\n\nDesigned for your business, quoted in writing before anything starts. No packages, no hourly meter.\n\nDM \"SITE\" and we will tell you what yours would take.",
        facebookBody: "A LYNQ site is not a brochure. Every one comes with: found on Google, answers every message in under a minute, call or book in the first screen, and kept running after launch. Designed for your business, quoted in writing. Message us to see what yours would take.",
        hashtags: LYNQ_TAGS, callToAction: "DM SITE",
        creativeDirection: `Four small matte black cubes in a tight square on the black studio floor, hard light from the upper left, each cube with one tiny engraved white icon (a pin, a speech bubble, a phone, a wrench); one acid-lime line runs around all four. One line of thin white type: "What you get." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "n-codeit-idea", brand: CODEIT, day: "2026-10-22", time: "19:30", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · Why I'm building CodeIt", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your idea first. The moment that made CodeIt.",
        body: "Your idea first.\n\nAt CodeIt's first workshop, at Northcrest's Community Sundays, nobody wanted the example project. Every kid wanted their own thing: a cat that catches pizza, a quiz about their brother, a page for the lemonade stand.\n\nKids light up when they build something that is theirs, and tune out when it is another worksheet.\n\nSo that is how CodeIt works. It starts with the kid's idea, builds the first version with them, then makes sure they understand every line.\n\nFree to start, no card needed. Ages 5 to 18.\nLink in bio: codeitlearn.com",
        facebookBody: "Your idea first.\n\nAt CodeIt's first workshop, nobody wanted the example project. Every kid wanted their own thing. Kids light up when they build something that is theirs.\n\nSo CodeIt starts with the kid's idea, builds the first version with them, and makes sure they understand every line.\n\nFree to start, no card needed. Ages 5 to 18: codeitlearn.com",
        hashtags: ["EdTech", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        creativeDirection: `Flat vector on cream: a big orange lightbulb shape whose filament is a tiny flat dinosaur; three small flat arrows run from the bulb to a simple navy laptop shape. No mascot. Headline "Your idea first." in chunky navy type. No names, no signature, no real people. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-question", brand: CODEIT, day: "2026-10-23", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · The question after the build", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The game works. Now one question: what makes the character jump?",
        body: "The game works. Now comes the part most apps skip.\n\nOne question, made from your kid's own code: \"What makes the character jump?\"\n\nThe answer options aren't random. They're other real values from their project, so a guess looks just as plausible as the right answer. Only a first time right answer counts.\n\nThat's how we know they understood it, not just ran it.\n\nKids can code. We prove it. Free to start, link in bio.",
        facebookBody: "The game works. Now one question, made from your kid's own code: what makes the character jump? The wrong answers come from their own project, so guessing doesn't work.\n\nThat's how we know they understood it. Free to start: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        card: { eyebrow: "We prove it", headline: "The game works.", sub: "Now, one question.", rows: [[0, 1], [2]], steps: [
          { label: "Their game", panel: { type: "game", hero: "cat", item: "pizza", score: "12" } },
          { label: "Their code", panel: { type: "code", lines: ["cat = Cat()", "pizza.fall()", "jump = 8", "cat.move_up(jump)"], highlight: 2 } },
          { label: "The question, made from line 3", panel: { type: "question", prompt: "What makes the cat jump?", options: ["jump = 5", "jump = 8", "jump = 12"], correct: 1 } },
        ], takeaway: "Wrong answers come from their own code. Only a first try counts.", tryThis: "Try tonight: ask your kid what makes their character move. If they can answer, they learned it." },
        creativeDirection: `Flat vector on orange: a big flat cream quiz card with a bold navy question "What makes the character jump?" and three rounded navy answer buttons, a tiny flat pixel character mid-jump above it. No mascot. Headline "Prove it." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-challenge", brand: CODEIT, day: "2026-10-26", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · October challenge: a game about your favourite snack", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "October challenge: build a game about your favourite snack. Free to enter, free to build.",
        body: "OCTOBER CHALLENGE: build a game about your favourite snack.\n\nPizza that falls from the sky. A samosa that has to dodge the fork. Popcorn you catch in a bucket. Any snack, any idea.\n\nHow it works:\n1. Your kid describes the game in one sentence on codeitlearn.com\n2. CodeIt builds the first version\n3. They change one thing and make it theirs\n\nSend us the game (no faces needed, just the screen) and we'll share our favourites with first name and age, with your permission.\n\nFree to enter, free to build. Ages 5 to 18.",
        facebookBody: "OCTOBER CHALLENGE: build a game about your favourite snack. Your kid describes it in one sentence on codeitlearn.com, CodeIt builds the first version, they make it theirs.\n\nSend us the game (just the screen, no faces) and we'll share our favourites with your permission. Free to enter, free to build.",
        hashtags: ["KidsChallenge", ...CODEIT_TAGS.slice(0, 2)], callToAction: "Start free at codeitlearn.com",
        card: { eyebrow: "October challenge", headline: "A game about", sub: "your favourite snack.", rows: [[0], [1, 2]], steps: [
          { label: "Your kid types", panel: { type: "input", text: "a bunny that catches falling carrots" } },
          { label: "CodeIt builds it", panel: { type: "game", hero: "bunny", item: "carrot", score: "7" } },
          { label: "They make it theirs", panel: { type: "code", lines: ["speed = 4", "speed = 9", "# harder. theirs."], strike: 0, highlight: 1 } },
        ], takeaway: "Send us the game (just the screen) and we share our favourites, with your permission.", tryThis: "Free to enter, free to build, ages 5 to 18. Until Oct 31 at codeitlearn.com." },
        creativeDirection: `Flat vector on orange: a big flat gold trophy shape holding a giant pizza slice, confetti as simple flat triangles, the mascot hugging the trophy. Headline "October challenge" in chunky cream type. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-lesson1", brand: CODEIT, day: "2026-10-25", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Lesson 1 of 31: make the computer say your name", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "The first line of Python almost every coder ever wrote. Try it with your kid tonight.",
        body: "Lesson 1 of 31: print()\n\nprint(\"Hello!\")\n\nThat's the first line of Python almost every coder ever wrote. It tells the computer: show this on the screen.\n\nTry it with your kid tonight. Change \"Hello!\" to their name. Press run. That's programming.\n\nAll 31 beginner lessons and the Python playground are free for everyone, with no AI involved, so the learning is theirs.\n\nSave this for the weekend.",
        facebookBody: "Lesson 1 of 31: print(\"Hello!\")\n\nThe first line of Python almost every coder wrote. Try it tonight. Change \"Hello!\" to your kid's name and press run.\n\nAll 31 beginner lessons and the Python playground are free at codeitlearn.com.",
        hashtags: ["LearnPython", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        card: { eyebrow: "Lesson 1 of 31 · Python", headline: "Make the computer", sub: "say your name.", steps: [
          { label: "Type one line", panel: { type: "code", lines: ['print("Hello, Sara!")'] } },
          { label: "Press run", panel: { type: "run" } },
          { label: "The computer answers", panel: { type: "terminal", text: "Hello, Sara!" } },
        ], takeaway: "Change the name. Change the message. That is programming.", tryThis: "Free playground, no account, no AI: codeitlearn.com. Five minutes tonight." },
        creativeDirection: `Flat vector on cream: a giant flat orange megaphone shape, and bursting out of it the word "Hello!" in huge chunky navy type with three small flat stars. No mascot. Headline "Lesson 1 of 31" small in orange. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-workshop", brand: CODEIT, day: "2026-10-27", time: "19:30", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · What a room full of kids taught me", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The first CodeIt workshop taught me more than any plan did.",
        body: "The first CodeIt workshop was at Northcrest's Community Sundays. A room, some laptops, kids who'd never written a line of code.\n\nWhat I learned in two hours:\n\nNobody wanted the example project. Every kid wanted their own thing: a cat game, a quiz about their brother, a page for their lemonade stand.\n\nSo that's what CodeIt became. It starts with the kid's idea, not ours.\n\nRun a community program or a school club and want a session? Message us. The tool is free, and so is the first session.",
        facebookBody: "The first CodeIt workshop was at Northcrest's Community Sundays. What I learned: nobody wanted the example project. Every kid wanted their own thing.\n\nSo that's what CodeIt became. It starts with the kid's idea, not ours.\n\nRun a community program or school club? Message us. The tool is free, and so is the first session.",
        hashtags: ["KidsCoding", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        card: { eyebrow: "The first workshop", headline: "Nobody wanted", sub: "the example project.", steps: [
          { label: "What we planned", panel: { type: "input", text: "a ball that bounces" } },
          { label: "What the kids typed", panel: { type: "text", lines: ["a cat game", "a quiz about my brother", "a page for my lemonade stand"] } },
          { label: "So CodeIt starts here", panel: { type: "terminal", text: "your idea first" } },
        ], takeaway: "Kids light up when they build something that is theirs.", tryThis: "Run a community program or a school club? Message us. The tool is free, and so is the first session." },
        creativeDirection: `Flat vector on mint: a row of five simple flat laptop shapes in navy, each screen a different tiny flat project (a cat, a quiz card, a lemonade cup, a rocket, a star); the mascot stands at the end of the row pointing at them. No real people, no faces. Headline "Your idea first." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-ask-age", brand: CODEIT, day: "2026-11-03", time: "19:30", pillar: "LEARN", storyHighlight: "ASK THE TEACHER",
        title: "CodeIt · Ask the teacher: is six too young for real code?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Is six too young for real code? The honest answer from someone who teaches it.",
        body: "ASK THE TEACHER: is six too young for real code?\n\nNo. Six is too young for a blank editor and a textbook. It is not too young to type \"a cat that jumps over pizza\", see it happen, and change one thing.\n\nWhat a six year old gets out of it:\n1. The idea that the computer does exactly what you tell it\n2. One change at a time: faster, bigger, a different colour\n3. The habit of asking what makes it do that\n\nWhat they do not need yet: syntax drills, typing speed, or a certificate.\n\nThat is why CodeIt starts from the kid's idea and reads the code back to them one line at a time. Free to start, ages 5 to 18. Link in bio.",
        facebookBody: "Is six too young for real code? Too young for a blank editor, not too young to type a cat that jumps over pizza, see it happen and change one thing. CodeIt starts from the kid's idea and reads the code back one line at a time. Free to start, ages 5 to 18: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        card: { eyebrow: "Ask the teacher", headline: "Is six too young", sub: "for real code?", rows: [[0, 1], [2]], steps: [
          { label: "Too young for this", panel: { type: "code", lines: ["def main():", "    pass", "# a blank editor"] } },
          { label: "Not too young for this", panel: { type: "input", text: "a cat that jumps over pizza" } },
          { label: "And then one change", panel: { type: "code", lines: ["jump = 8", "jump = 12", "# higher!"], strike: 0, highlight: 1 } },
        ], takeaway: "Six is too young for a textbook. Not for an idea they can change.", tryThis: "CodeIt reads the code back one line at a time. Free to start, ages 5 to 18." },
        creativeDirection: `Flat vector on sky blue: one giant flat cream number 6 with a tiny flat orange cat sitting on top of it, a small flat laptop at its base. No mascot. Headline "Too young?" in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-halloween", brand: CODEIT, day: "2026-10-31", time: "10:00", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · Halloween build: a ghost who steals candy", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Tonight's plan: a ghost steals the candy, your kid writes the game.",
        body: "Halloween build, tonight, before the doorbell starts.\n\nType one sentence on codeitlearn.com: \"A game where a ghost steals candy from a bowl and you have to tap it away.\"\n\nCodeIt builds the first version. Your kid makes the ghost faster, changes the candy, adds a score. Every change shows the code behind it.\n\nTwenty minutes, one game, and they can explain how it works.\n\nFree to start, no card. Ages 5 to 18. Link in bio.",
        facebookBody: "Halloween build before the doorbell starts: type one sentence on codeitlearn.com, a ghost steals candy and you tap it away. CodeIt builds the first version, your kid makes it theirs and sees the code. Free to start, ages 5 to 18.",
        hashtags: ["Halloween", ...CODEIT_TAGS.slice(0, 2)], callToAction: "Link in bio",
        card: { eyebrow: "Halloween build", headline: "A ghost steals the candy.", sub: "Your kid writes the game.", rows: [[0], [1, 2]], steps: [
          { label: "Type one sentence tonight", panel: { type: "input", text: "a ghost that steals candy from a bowl" } },
          { label: "CodeIt builds it", panel: { type: "game", hero: "ghost", item: "candy", score: "13" } },
          { label: "Make the ghost faster", panel: { type: "code", lines: ["ghost_speed = 3", "ghost_speed = 7", "# spookier."], strike: 0, highlight: 1 } },
        ], takeaway: "Twenty minutes, one game, and they can explain how it works.", tryThis: "Before the doorbell starts: codeitlearn.com, free, no card, ages 5 to 18." },
        creativeDirection: `Flat vector on navy: a big round cream ghost shape with two dot eyes holding a flat orange candy bucket, three flat candies flying out; the mascot peeks from the bottom corner with a tiny witch hat. Headline "Boo. Build." in chunky orange type. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-wrong", brand: CODEIT, day: "2026-10-30", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · Why the wrong answers come from their own code", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Our quiz has no trick questions. The wrong answers are just their other code.",
        body: "Most kids' coding quizzes can be guessed. One answer looks like code, the others look silly.\n\nCodeIt does it differently. After a build, the question is made from your kid's own project, and the wrong answers are other real values from the same file. Speed 5, speed 8, speed 12. All look right. Only one is the line that makes the character jump.\n\nSo a guess scores like a guess, and a real answer scores like a real answer. Only a first time right answer counts.\n\nThat is the whole idea: kids can code, and we can show you they understood it.\n\nFree to start, link in bio.",
        facebookBody: "Most kids' coding quizzes can be guessed. In CodeIt the question comes from your kid's own project and the wrong answers are other real values from the same file, so a guess scores like a guess. Only a first time right answer counts. Free to start: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        card: { eyebrow: "How it works", headline: "No trick questions.", sub: "Just their other code.", rows: [[0, 1], [2]], steps: [
          { label: "Their code", panel: { type: "code", lines: ["speed = 5", "lives = 3", "jump = 8"], highlight: 2 } },
          { label: "The question", panel: { type: "text", lines: ["Which line makes", "the character jump?"] } },
          { label: "The wrong answers are real values from the same file", panel: { type: "question", prompt: "Pick the line", options: ["speed = 5", "lives = 3", "jump = 8"], correct: 2 } },
        ], takeaway: "A guess scores like a guess. Only a first time right answer counts.", tryThis: "Kids can code. We can show you they understood it. Free to start at codeitlearn.com." },
        creativeDirection: `Flat vector on cream: three big rounded navy answer buttons stacked, each with a flat number (5, 8, 12), the middle one outlined in orange with a flat orange checkmark; a tiny flat pixel character mid-jump beside them. No mascot. Headline "No trick questions." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-family", brand: CODEIT, day: "2026-11-02", time: "19:30", pillar: "OFFER", storyHighlight: "FREE",
        title: "CodeIt · The family plan, in one picture", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Free covers a lot. CA$12/month covers the rest, for the whole family.",
        body: "Free covers a lot: 31 Python lessons, the playground, and 10 AI assisted builds a month. No card.\n\nThe family plan is for when one kid builds ten games in a weekend and the other one wants a turn.\n\nCA$12/month, one plan, every kid in the house:\n1. More builds each month\n2. Separate projects for each child\n3. The same comprehension check on every build\n\nStart free, upgrade only if they run out of builds. Ages 5 to 18.\nLink in bio: codeitlearn.com",
        facebookBody: "Free covers 31 Python lessons, the playground and 10 builds a month, no card. The family plan is CA$12/month for every kid in the house: more builds, separate projects, the same comprehension check. Start free at codeitlearn.com and upgrade only if they run out of builds.",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        card: { eyebrow: "Free, then the family plan", headline: "One plan.", sub: "Every kid in the house.", steps: [
          { label: "Free, for everyone", panel: { type: "text", lines: ["31 Python lessons", "The playground", "10 builds a month. No card."] } },
          { label: "Family plan, CA$12/month", panel: { type: "text", lines: ["More builds each month", "Separate projects per child", "The same check on every build"] } },
        ], takeaway: "Start free. Upgrade only if they run out of builds.", tryThis: "Ages 5 to 18, in the browser, nothing to install: codeitlearn.com" },
        creativeDirection: `Flat vector on mint: one big flat orange house shape with three round cream windows, a tiny flat laptop in each window; the mascot waves from the door. Headline "One plan. Every kid." in chunky navy type. ${CODEIT_LOOK}`,
      },
      {
        key: "n-codeit-bughunt", brand: CODEIT, day: "2026-11-01", time: "10:00", pillar: "TEACH", storyHighlight: "QUIZ",
        title: "CodeIt · Bug hunt: the ghost won't move", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The ghost won't move. One of these three lines is the reason.",
        body: "Bug hunt. The ghost won't move.\n\n1. ghost.x = 100\n2. speed = 0\n3. ghost.x += speed\n\nOne of these lines is the bug. Read them out loud with your kid and see who spots it first.\n\nComment the line number. The answer is in tomorrow's story.\n\nFinding a bug is half of coding, and on CodeIt kids fix their own games the same way.",
        facebookBody: "Bug hunt: the ghost won't move. Line 1: ghost.x = 100. Line 2: speed = 0. Line 3: ghost.x += speed. Which line is the bug? Comment the number, the answer is in tomorrow's story.",
        hashtags: CODEIT_TAGS, callToAction: "Comment the line number",
        card: { eyebrow: "Bug hunt", headline: "The ghost won't move.", sub: "Find the bug.", steps: [], format: {
          kind: "bug", hero: "ghost", item: "candy", symptom: "STUCK",
          code: ["ghost.x = 100", "speed = 0", "ghost.x += speed"], question: "Which line is the bug?",
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "n-codeit-pip-loop", brand: CODEIT, day: "2026-11-04", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "PIP",
        title: "CodeIt · Pip learns a loop", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Pip wanted to jump three times. Pip typed it three times.",
        body: "Pip wanted to jump three times.\n\nSo Pip typed jump() three times. It worked, but imagine a hundred jumps.\n\nThen Pip found the loop: repeat 3: jump()\nSame jumps, one line.\n\nThat is what a loop is. Ask your kid tonight: what would you want to repeat a hundred times in a game?\n\nCodeIt shows the code behind every change, loops included. Free to start, ages 5 to 18.",
        facebookBody: "Pip wanted to jump three times, so Pip typed jump() three times. Then Pip found the loop: repeat 3: jump(). Same jumps, one line. That is a loop. Ask your kid what they would repeat a hundred times in a game.",
        hashtags: CODEIT_TAGS, callToAction: "Save this",
        card: { eyebrow: "Pip learns a loop", headline: "Jump. Jump. Jump.", sub: "Or one loop.", steps: [], format: { kind: "comic", panels: [
          { pose: "think", bubble: "I want to\njump 3 times", caption: "Pip has a plan" },
          { pose: "type", code: "jump() jump() jump()", caption: "Typing it 3 times" },
          { pose: "type", code: "repeat 3: jump()", caption: "Or one loop" },
          { pose: "jump", jumps: 3, caption: "Same jumps, less typing" },
        ] } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "n-codeit-start", brand: CODEIT, day: "2026-10-28", time: "19:30", pillar: "OFFER", storyHighlight: "START HERE",
        title: "CodeIt · One line, two games", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Same game. One number changed.",
        body: "Same game. One number changed.\n\nTop: speed = 2. The cat strolls over to the pizza.\nBottom: speed = 20. The cat is gone before you blink.\n\nThat one line is the whole difference, and on CodeIt your kid finds it themselves. They type one sentence like \"a game where a cat catches falling pizza\", get a working game, then change it and see the code behind every change.\n\nTonight, ask them: what number would you change first?\n\nFree to start, no card, nothing to install. Ages 5 to 18.\nLink in bio.",
        facebookBody: "Same game, one number changed. With speed = 2 the cat strolls to the pizza. With speed = 20 it is gone before you blink. On CodeIt kids type one sentence, get a working game, then change it and see the code behind every change. Free to start, no card, nothing to install. Ages 5 to 18.",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        card: { eyebrow: "One line, two games", headline: "Which cat", sub: "would your kid make?", steps: [], format: {
          kind: "split", hero: "cat", item: "pizza",
          top: { code: "speed = 2", caption: "Strolling cat" },
          bottom: { code: "speed = 20", caption: "Zoomy cat" },
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "n-codeit-threeq", brand: CODEIT, day: "2026-10-29", time: "19:30", pillar: "LEARN", storyHighlight: "ASK THE TEACHER",
        title: "CodeIt · Three questions after screen time", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Three questions that tell you if the last twenty minutes were worth it.",
        body: "Twenty minutes watching someone play a game and twenty minutes making one look identical from the kitchen. They are not.\n\nThree questions that tell you which one just happened, no app needed:\n1. What did you make?\n2. What would you change about it?\n3. Can you show me how it works?\n\nIf they can answer the third one, that was a good twenty minutes.\n\nCodeIt is built so the answer to all three is easy: describe a game, get a working version, change it, see the code.\n\nSave this for tonight.",
        facebookBody: "Twenty minutes watching a game and twenty minutes making one look the same from the kitchen. Three questions tell you which one happened: what did you make, what would you change, can you show me how it works. If they can answer the third one, that was a good twenty minutes.",
        hashtags: CODEIT_TAGS, callToAction: "Save this",
        card: { eyebrow: "Ask the teacher", headline: "Was that screen time", sub: "worth it?", steps: [
          { label: "Three questions, no app needed", panel: { type: "text", lines: ["1. What did you make?", "2. What would you change about it?", "3. Can you show me how it works?"] } },
          { label: "If they can answer the third one", panel: { type: "terminal", text: "that was a good twenty minutes" } },
        ], takeaway: "Watching a game and making one look the same from the kitchen. They are not.", tryThis: "CodeIt is built so all three are easy: describe, build, change, see the code. Free to start." },
        creativeDirection: `Flat vector on cream: three big rounded speech bubbles in orange, navy and mint stacked diagonally, each with a flat number 1, 2, 3; the mascot sits at the bottom holding a tiny flat laptop. Headline "Ask these three." in chunky navy type. ${CODEIT_LOOK}`,
      },
    ],
    reels: [
      {
        key: "n-lynq-reel-rebuilt", brand: LYNQ, day: "2026-10-25", time: "18:30", series: "REBUILT",
        title: "LYNQ Reel · REBUILT — a plumber's homepage in 10 minutes",
        hook: "I rebuilt a plumber's homepage in 10 minutes. Here's what changed.",
        body: "REBUILT: a plumber's homepage in 10 minutes (name hidden).\n\nWhat changed:\n1. \"Call now\" at the top, not under three paragraphs\n2. Service area and hours on the first screen\n3. The Google reviews they already had, finally on the site\n\nOld on the left, new on the right at the end.\n\nWant yours done? DM \"REBUILD\" and I'll send you the before and after of your own homepage.",
        facebookBody: "I rebuilt a plumber's homepage in 10 minutes. Call now at the top, service area and hours on the first screen, their Google reviews on the site. Old and new side by side at the end. Want yours? Send us a message.",
        hashtags: ["Plumbers", ...LYNQ_TAGS.slice(0, 2)], callToAction: "DM REBUILD",
        script: "Screen-record the rebuild as a timelapse: the real homepage (name and logo blurred) on the left, a blank page on the right that fills in. Speed up to 30 to 45 seconds. Freeze on old vs new for the last 4 seconds. Say the three changes out loud while they appear. Only show what you really built.",
        shots: [
          { timing: "0–2s", visual: "Old homepage on a phone frame, name blurred, timer reads 10:00", onScreenText: "Rebuilt in 10 minutes" },
          { timing: "2–12s", visual: "Call button dragged to the top of the new page", onScreenText: "1. Call now, first" },
          { timing: "12–22s", visual: "Service area and hours added to the first screen", onScreenText: "2. Area and hours" },
          { timing: "22–32s", visual: "Google reviews block drops in", onScreenText: "3. Reviews they already had" },
          { timing: "32–38s", visual: "Old left, new right, side by side", onScreenText: "Before and after · DM REBUILD" },
        ],
      },
      {
        key: "n-lynq-reel-restaurant", brand: LYNQ, day: "2026-10-29", time: "18:30", series: "FIX THIS",
        title: "LYNQ Reel · FIX THIS — a restaurant's site on a phone, 60 seconds",
        hook: "60 seconds on a restaurant's website, on a phone, hungry. Watch where I give up.",
        body: "FIX THIS: 60 seconds on a restaurant's website (name hidden), on a phone, hungry.\n\nI'm looking for three things: the menu, the hours, a way to book. Watch where I give up.\n\nThe fixes are small: a real menu page instead of a PDF, hours on the first screen, a book button that stays on screen.\n\nOwn a restaurant? DM \"AUDIT\" and I'll do yours. It's free.",
        facebookBody: "60 seconds on a restaurant's website, on a phone, hungry. Menu, hours, book. Watch where I give up. Own a restaurant? Send us a message for a free review of your site.",
        hashtags: ["RestaurantMarketing", "WebDesign", "SmallBusiness"], callToAction: "DM AUDIT",
        script: "Screen-record a real restaurant site in a phone frame, name blurred. Narrate as a hungry customer: find the menu, find the hours, try to book. Stop the clock where it breaks. 30 to 45 seconds. Only claim what's on screen.",
        shots: [
          { timing: "0–2s", visual: "Restaurant homepage on a phone, name blurred, timer 0:60", onScreenText: "I'm hungry. 60 seconds." },
          { timing: "2–18s", visual: "Hunting for the menu, PDF opens tiny", onScreenText: "1. Where's the menu?" },
          { timing: "18–30s", visual: "Scrolling for hours", onScreenText: "2. Are you open?" },
          { timing: "30–42s", visual: "Looking for a book button, ends on the fix list", onScreenText: "3. Can I book? · DM AUDIT" },
        ],
      },
      {
        key: "n-lynq-reel-watch", brand: LYNQ, day: "2026-11-02", time: "18:30", series: "WATCH IT WORK",
        title: "LYNQ Reel · WATCH IT WORK — one tap, live",
        hook: "This post went live because I tapped one button on my phone.",
        body: "WATCH IT WORK: this post went live because I tapped one button.\n\nThe system drafts it. My phone buzzes. I read the caption, check the image, tap approve, and it's on Instagram and Facebook.\n\nNo logging into four apps. No \"I'll post Thursday\" that turns into next month.\n\nIt's what our Growth System sets up for clients.\nDM \"GROW\" and we will show you how it would work for you.",
        facebookBody: "This post went live because I tapped one button on my phone. The system drafts it, I check it, one tap, and it's on Instagram and Facebook. It's what our Growth System sets up for clients. Message us to see how it would work for you.",
        hashtags: ["SocialMediaMarketing", ...LYNQ_TAGS.slice(0, 2)], callToAction: "DM GROW",
        script: "Screen-record your phone for real: the Telegram notification from the LYNQ bot, opening it, the image and caption, your thumb tapping ✅. Cut to the Instagram profile with this post at the top. 12–20 seconds. This reel is literally true — film it the morning it goes out.",
        shots: [
          { timing: "0–2s", visual: "Lock screen: Telegram notification from the LYNQ bot", onScreenText: "My phone just buzzed" },
          { timing: "2–8s", visual: "The post's image, caption and buttons in Telegram", onScreenText: "I check it" },
          { timing: "8–11s", visual: "Thumb taps ✅", onScreenText: "One tap" },
          { timing: "11–18s", visual: "Instagram profile with the new post on top", onScreenText: "Live. DM GROW" },
        ],
      },
      {
        key: "n-lynq-reel-clinic", brand: LYNQ, day: "2026-11-04", time: "18:30", series: "FIX THIS",
        title: "LYNQ Reel · FIX THIS — 60 seconds on a clinic's website",
        hook: "60 seconds on a clinic's website. Watch where the bookings leak.",
        body: "FIX THIS: 60 seconds on a clinic's website (name hidden).\n\nThe three things I check first on every clinic site:\n1. Can a patient on a phone find \"Book\" without scrolling?\n2. Are the hours and phone number on every page?\n3. Do the Google reviews show up on the site?\n\nWatch what this one gets wrong.\n\nWant me to do yours? DM \"AUDIT\". It's free.",
        facebookBody: "60 seconds on a clinic's website: can a patient find \"Book\" without scrolling, are hours and phone on every page, do the reviews show up? Watch what this one gets wrong. Want a free review of yours? Send us a message.",
        hashtags: ["ClinicMarketing", ...LYNQ_TAGS], callToAction: "DM AUDIT",
        script: "Screen-record a real clinic site in a phone-sized window, name and logo blurred. Walk the three checks in order and say what you actually find. Only claim what's on screen. 30–45 seconds.",
        shots: [
          { timing: "0–2s", visual: "Clinic homepage on a phone frame, name blurred, timer '0:60'", onScreenText: "60-second audit" },
          { timing: "2–15s", visual: "Scrolling to find the Book button", onScreenText: "1. Where's 'Book'?" },
          { timing: "15–27s", visual: "Inner page — looking for hours/phone", onScreenText: "2. Hours + phone" },
          { timing: "27–38s", visual: "Searching for reviews on the site", onScreenText: "3. Reviews" },
          { timing: "38–45s", visual: "Black end card", onScreenText: "Free audit · DM AUDIT" },
        ],
      },
      {
        key: "n-codeit-reel-idea", brand: CODEIT, day: "2026-10-24", time: "16:30", series: "IDEA TO GAME",
        title: "CodeIt Reel · Idea to game in under a minute",
        hook: "Type a sentence. Get a game. Then see the code.",
        body: "One sentence becomes a playable game, and then you see the code behind it. Under a minute.\n\nWhat should we build next? Drop your kid's wildest game idea below and we'll build one of them on camera.\n\nCodeIt is free to start for ages 5 to 18. Link in bio.",
        facebookBody: "One sentence becomes a playable game, then the code behind it, in under a minute. What should we build next? Tell us your kid's wildest game idea and we'll build one on camera.",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        script: "Screen-record CodeIt for real: first frame is the idea being typed (no intro). Game appears, play 3 seconds, change one value (speed or colour), open the code view. 25–40 seconds, original audio or voice-over.",
        shots: [
          { timing: "0–3s", visual: "Typing the idea into CodeIt", onScreenText: "One sentence…" },
          { timing: "3–14s", visual: "The game appears and is played", onScreenText: "…a real game" },
          { timing: "14–28s", visual: "Changing speed or colour, game updates live", onScreenText: "Make it yours" },
          { timing: "28–38s", visual: "Code view with the changed line highlighted", onScreenText: "Now see the code" },
        ],
      },
      {
        key: "n-codeit-reel-print", brand: CODEIT, day: "2026-10-28", time: "16:30", series: "PYTHON IN 20 SECONDS",
        title: "CodeIt Reel · Python in 20 seconds: print()",
        hook: "Your kid's first line of Python, in 20 seconds.",
        body: "Your kid's first line of Python, in 20 seconds.\n\nType print(\"Hello!\"), change it to their name, run it.\n\nSend this to a parent who keeps saying \"I don't know anything about coding.\" Neither did anyone, before line 1.\n\n31 free lessons at codeitlearn.com.",
        facebookBody: "Your kid's first line of Python in 20 seconds: print(\"Hello!\"), change it to their name, press run. 31 free lessons at codeitlearn.com.",
        hashtags: ["LearnPython", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        script: "Screen-record the CodeIt Python playground: type print(\"Hello!\"), run, change to a name, run again. 15–20 seconds, big readable font.",
        shots: [
          { timing: "0–4s", visual: "Typing print(\"Hello!\")", onScreenText: "Line 1 of Python" },
          { timing: "4–9s", visual: "Run → Hello! appears", onScreenText: "Run it" },
          { timing: "9–18s", visual: "Change to a name, run again", onScreenText: "Now make it yours" },
        ],
      },
      {
        key: "n-codeit-reel-input", brand: CODEIT, day: "2026-11-01", time: "16:30", series: "PYTHON IN 20 SECONDS",
        title: "CodeIt Reel · Python in 20 seconds: input()",
        hook: "Lesson 2 of 31: the computer asks your kid a question. 20 seconds.",
        body: "Lesson 2 of 31: input()\n\nname = input(\"What's your name?\")\nprint(\"Hi \" + name)\n\nTwo lines, and the computer talks back. Kids love this one because it's the first time the program waits for them.\n\nTry it tonight in the free playground at codeitlearn.com. Change the question to anything.\n\nSend this to a parent who thinks coding is too hard for a 7 year old.",
        facebookBody: "Lesson 2 of 31: input(). Two lines and the computer asks your kid a question, then answers back. Try it tonight in the free playground at codeitlearn.com.",
        hashtags: ["LearnPython", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        script: "Screen-record the CodeIt Python playground: type the two lines, run, type a name when it asks, see the reply. 15 to 20 seconds, big readable font, no intro.",
        shots: [
          { timing: "0–5s", visual: "Typing name = input(\"What's your name?\")", onScreenText: "Lesson 2 of 31" },
          { timing: "5–10s", visual: "Typing print(\"Hi \" + name) and pressing run", onScreenText: "Run it" },
          { timing: "10–18s", visual: "The program asks, a name is typed, it replies Hi", onScreenText: "It talks back" },
        ],
      },
      {
        key: "n-codeit-reel-prove", brand: CODEIT, day: "2026-11-04", time: "16:30", series: "WE PROVE IT",
        title: "CodeIt Reel · The question after the build",
        hook: "Copying code is easy. Explaining it is learning.",
        body: "Copying code is easy. Explaining it is learning.\n\nAfter every build, CodeIt asks your kid about their own code. The wrong answers come from their own project, so guessing doesn't work.\n\nKids can code. We prove it.\nTry it free, link in bio.",
        facebookBody: "Copying code is easy. Explaining it is learning. After every build, CodeIt asks your kid about their own code, so guessing doesn't work. Kids can code. We prove it.",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        script: "Screen-record finishing a build in CodeIt, then the comprehension question appearing and being answered right first time. 20–30 seconds.",
        shots: [
          { timing: "0–5s", visual: "A finished build running", onScreenText: "Built it?" },
          { timing: "5–17s", visual: "The question generated from that code appears", onScreenText: "Now explain it" },
          { timing: "17–27s", visual: "Answering correctly first time", onScreenText: "We prove it." },
        ],
      },
    ],
    linkedin: [
      {
        key: "n-lynq-li-9pm", brand: LYNQ, day: "2026-10-23", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — The 9pm test",
        body: "I have a habit that annoys business owners until it helps them.\n\nWhen I look at a local business website, I fill in the contact form at 9pm. Then I wait.\n\nMost of the time, nothing happens. Sometimes a reply arrives the next afternoon. By then the person who needed a plumber, a table or an appointment has already booked with whoever answered first.\n\nThis isn't a design problem. The site can be beautiful. It's a response problem, and it happens after hours, when the owner is the one person who can't be at a keyboard.\n\nSo every site LYNQ builds replies on its own. Form in, text and email out within a minute, with the booking link inside. The owner follows up in the morning, like normal, except the customer already feels looked after.\n\nWe run LYNQ the same way. Every post goes out only after a human approves it from a phone. The automation does the waiting. People make the decisions.\n\nIf you run a service business: fill in your own contact form tonight at 9pm. What happens?",
      },
      {
        key: "n-lynq-li-checks", brand: LYNQ, day: "2026-10-28", time: "08:15", pillar: "TEACH",
        title: "LinkedIn · Mustafa — The 3 checks I run on every local business site",
        body: "I review a lot of local business websites. Before design, before SEO, I check three things, and plenty of sites miss at least one.\n\n1. Can a customer on a phone find the main action without scrolling?\nBook, call, get a quote. If it's below three paragraphs of \"welcome to our family business,\" most visitors never see it.\n\n2. Are the hours and phone number on every page?\nNot just the contact page. People land on inner pages from Google.\n\n3. Does the site show proof that already exists?\nMost businesses have Google reviews. Very few show them on their own website, where the decision actually happens.\n\nNone of these need a redesign. All three can usually be fixed in an afternoon.\n\nIf you own or market a local business, run these three on your own site today. If you want a second pair of eyes, send me a message and I'll do a free 5-minute review.",
      },
      {
        key: "n-lynq-li-builds", brand: LYNQ, day: "2026-11-03", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — What LYNQ actually builds",
        body: "People ask what LYNQ does. The short answer is websites. The honest answer is longer.\n\nA website that looks good and does nothing is a brochure. We build the part that works: found on Google, answers in under a minute, gets the booking or the order. The design sits on top of that, not instead of it.\n\nFor a property management company, that meant one page that wins an owner's trust and calms a tenant with a leak at midnight. For a restaurant, it meant the menu, the hours and a table booked in ten seconds on a phone. For a maker selling handmade bags, it meant a store that takes the order so she can stop answering DMs and get back to the hook.\n\nSame rules every time. Found. Answers. Converts. Everything else is taste.\n\nWe don't sell packages and we don't run an hourly meter. You get a written quote for your business, we build it, and we look after it once it's live.\n\nIf you run a business and want an honest look at your site, send me a message. Five minutes, no pitch.",
      },
      {
        key: "n-codeit-li-coding", brand: CODEIT, day: "2026-10-24", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — What kids actually need to learn now",
        body: "I teach kids to code in Toronto. A question I hear from parents: \"Does my kid still need to learn coding if AI can write it?\"\n\nMy honest answer: they need it more, just a different version of it.\n\nWhen AI writes the first draft, the valuable skills move:\n1. Saying clearly what you want\n2. Reading code someone (or something) else wrote\n3. Predicting what it will do before you run it\n4. Finding the line that's wrong when the result isn't what you asked for\n\nThat's what I built CodeIt around. A kid describes a game, gets a working first version, then changes it and sees the code behind every change. After each build, CodeIt asks them questions made from their own project. The wrong answers come from that same file, so you can't guess your way through.\n\nTyping code was never the point. Understanding it is.\n\nTeachers and parents: how are you thinking about this?",
      },
      {
        key: "n-codeit-li-quiz", brand: CODEIT, day: "2026-10-29", time: "08:15", pillar: "HOW IT WORKS",
        title: "LinkedIn · Mustafa — Why our quiz questions come from the kid's own code",
        body: "A lot of coding platforms for kids check one thing: does the code run?\n\nThe problem is that \"it runs\" is easy to fake. Copy, paste, green tick. The platform reports progress. The kid learned nothing.\n\nWhen I designed CodeIt's comprehension checks, I set three rules:\n\n1. Questions are generated from the child's own project file, not a generic question bank.\n2. The wrong answer options come from other real values in that same file, so every option looks plausible to someone who didn't read the code.\n3. Only first-time-correct answers count toward progress.\n\nThe result is slower-looking progress and much more honest progress. A parent can trust that \"done\" means understood.\n\nCodeIt is free to start for ages 5 to 18. The 31 beginner Python lessons and the playground are free for everyone, and the family plan is CA$12/month.\n\nIf you build learning products: how do you measure understanding rather than completion?",
      },
      {
        key: "n-codeit-li-guilt", brand: CODEIT, day: "2026-11-01", time: "08:15", pillar: "LEARN",
        title: "LinkedIn · Mustafa — Screen time isn't the problem",
        body: "Most of the parents I talk to feel guilty about screen time. Almost all of them allow it anyway. The guilt doesn't change the hours. It just makes them feel worse about the hours.\n\nHere is what I've seen teaching kids to code: the screen was never the variable. What the kid does on it is.\n\nTwenty minutes watching someone else play a game and twenty minutes making one look identical from the kitchen. They are not. One ends with a kid who can tell you what they built, what they'd change, and how it works. The other ends with a kid who needs the next video.\n\nThree questions that tell you which one just happened, no app required:\n1. What did you make?\n2. What would you change about it?\n3. Can you show me how it works?\n\nIf they can answer the third one, that was a good twenty minutes.\n\nI built CodeIt so the answer to all three is easy. A kid describes a game, gets a working version, changes it, and sees the code. Free to start, ages 5 to 18.\n\nParents and teachers: what do you ask after screen time?",
      },
      {
        key: "n-codeit-li-workshop", brand: CODEIT, day: "2026-11-04", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — What the first workshop changed",
        body: "CodeIt's first workshop ran at Northcrest's Community Sundays in Toronto. I walked in with a plan and an example project. The plan lasted about ten minutes.\n\nNobody wanted the example. Every kid wanted their own thing. A cat game. A quiz about a little brother. A page for a lemonade stand. The energy in the room came entirely from ownership, and it disappeared the moment I tried to steer everyone back to the same exercise.\n\nSo I stopped steering. Each kid described what they wanted, we built a first version together, and then they changed it. Faster. Different colours. A harder level. Every change showed them the code that made it happen.\n\nThat afternoon became the product. CodeIt starts from the kid's idea, builds the first version with them, and then checks that they understood it with questions made from their own code.\n\nIf you run a community program, a library session or a school club in the GTA and want a hands on coding session, message me. The tool is free, and so is the first session.",
      },
    ],
    // Stories made for stories: one LYNQ and one CodeIt a day. LYNQ reads like a product sheet or a studio
    // note (rarely a question); CodeIt is a quiz one day and its answer the next, with polls and "try tonight".
    stories: [
      // ---- LYNQ ----
      {
        key: "l-spec", brand: LYNQ, day: "2026-10-24", time: "09:30", highlight: "WHAT YOU GET",
        spec: { kind: "specSheet", brand: "lynq", series: "What you get", model: "LYNQ Site", subtitle: "What ships with every build", specs: [{ label: "First screen", value: "Call · Book · Buy" }, { label: "New message", value: "Answered in a minute", accent: true }, { label: "Google profile", value: "Set up properly" }, { label: "After launch", value: "We keep it running" }, { label: "Quote", value: "In writing, up front" }], note: "No packages, no hourly meter. Designed for the business it runs." },
      },
      {
        key: "l-brochure", brand: LYNQ, day: "2026-10-25", time: "09:30", highlight: "BEHIND",
        spec: { kind: "statement", brand: "lynq", series: "Studio note", lines: ["A website is", "not a brochure.", "It is the first", "employee your", "customer meets."], accentWord: "employee", byline: "LYNQ studio" },
      },
      {
        key: "l-process", brand: LYNQ, day: "2026-10-26", time: "09:30", highlight: "START HERE",
        spec: { kind: "process", brand: "lynq", series: "How we work", headline: "How a build runs.", steps: [{ n: "01", name: "Look", detail: "We use your site like a customer would" }, { n: "02", name: "Plan", detail: "One page: what it has to do" }, { n: "03", name: "Build", detail: "Designed on a phone first" }, { n: "04", name: "Launch", detail: "Google, forms and replies wired up" }, { n: "05", name: "Keep", detail: "Updates and fixes stay with us" }], note: "Quoted in writing before step 03." },
      },
      {
        key: "l-onefix", brand: LYNQ, day: "2026-10-27", time: "09:30", highlight: "FIX THIS",
        spec: { kind: "oneFix", brand: "lynq", eyebrow: "One fix", headline: ["One fix", "for today."], fix: "Call now", detail: "A call button in the first screen on mobile, and it stays there while they scroll." },
      },
      {
        key: "l-obj-stopwatch", brand: LYNQ, day: "2026-10-28", time: "14:00", highlight: "FIX THIS", photoFrom: "n-lynq-call",
        spec: { kind: "object", brand: "lynq", series: "Objects", title: "Object 03 · The stopwatch", label: [{ k: "Test", v: "Three seconds" }, { k: "Task", v: "Call or book" }, { k: "Device", v: "Their phone" }], line: "If they can't in three, they leave." },
      },
      {
        key: "l-which", brand: LYNQ, day: "2026-10-29", time: "09:30", highlight: "FIX THIS",
        spec: { kind: "whichSite", brand: "lynq", eyebrow: "Poll", headline: ["Which one", "gets the call?"], sticker: { type: "poll", question: "Which one gets the call?", options: ["A", "B"] } },
      },
      {
        key: "l-index-review", brand: LYNQ, day: "2026-10-30", time: "09:30", highlight: "WHAT YOU GET",
        spec: { kind: "index", brand: "lynq", series: "The free review", headline: "Five checks.", rows: [{ name: "First screen", what: "Can they call or book", where: "Phone" }, { name: "Google", what: "Hours, photos, the link", where: "Maps" }, { name: "Forms", what: "What happens at 9pm", where: "Inbox" }, { name: "Speed", what: "Loads before they give up", where: "4G" }, { name: "Message", what: "What you do, in one line", where: "Hero" }], note: "DM AUDIT for yours." },
      },
      {
        key: "l-teardown", brand: LYNQ, day: "2026-10-31", time: "09:30", highlight: "FIX THIS",
        spec: { kind: "teardown", brand: "lynq", series: "Teardown", headline: "A typical homepage.", before: ["Slideshow first", "Phone number in the footer", "Contact form, no reply", "Three menus deep"], after: ["What you do, one line", "Call button on screen", "Reply in a minute", "Book from the first screen"], note: "Same business, same customers. Fewer steps between them and yes." },
      },
      {
        key: "l-hours-check", brand: LYNQ, day: "2026-11-01", time: "09:30", highlight: "FIX THIS",
        spec: { kind: "checklist", brand: "lynq", eyebrow: "Checklist", headline: ["Google hours,", "checked."], intro: "Ten minutes, today:", items: [{ text: "Real hours set", ok: true }, { text: "Early close day added", ok: true }, { text: "Holiday hours set now", ok: false }, { text: "Website matches Google", ok: false }], close: ["Two left?", "Do them before", "the next holiday."] },
      },
      {
        key: "l-reply-slider", brand: LYNQ, day: "2026-11-02", time: "09:30", highlight: null,
        spec: { kind: "slider", brand: "lynq", eyebrow: "Be honest", headline: "How fast do you", lines: ["answer a new lead?", "Left: next day. Right: under a minute."], sticker: { type: "slider", question: "How fast do you reply?", emoji: "⚡" } },
      },
      {
        key: "l-obj-cubes", brand: LYNQ, day: "2026-11-03", time: "14:00", highlight: "WHAT YOU GET", photoFrom: "n-lynq-includes",
        spec: { kind: "object", brand: "lynq", series: "Objects", title: "Object 04 · Four parts", label: [{ k: "Found", v: "Google, done properly" }, { k: "Answers", v: "Every message, in a minute" }, { k: "Converts", v: "Call, book or buy" }, { k: "Kept", v: "Hosting and fixes" }], line: "One build. Four jobs." },
      },
      {
        key: "l-yes", brand: LYNQ, day: "2026-11-04", time: "09:30", highlight: "BEHIND",
        spec: { kind: "statement", brand: "lynq", series: "Studio note", lines: ["Good design", "is the shortest", "path to yes."], accentWord: "yes.", byline: "LYNQ studio" },
      },
      // ---- CodeIt ----
      {
        key: "c-quiz-ha", brand: CODEIT, day: "2026-10-24", time: "17:00", highlight: "QUIZ",
        spec: { kind: "quiz", brand: "codeit", eyebrow: "Quiz time", headline: "What does it print?", code: ['print("ha" * 3)'], sticker: { type: "quiz", question: "What does it print?", options: ["ha 3", "hahaha", "an error"], correct: 1 } },
      },
      {
        key: "c-answer-ha", brand: CODEIT, day: "2026-10-25", time: "15:45", highlight: "QUIZ",
        spec: { kind: "answer", brand: "codeit", eyebrow: "Yesterday's answer", headline: "It prints:", answer: "hahaha", why: ["* repeats text.", '"ha" three times is', "hahaha, no spaces."], example: 'print("boo " * 2)', tryThis: "Guess that one, then run it." },
      },
      {
        key: "c-poll-build", brand: CODEIT, day: "2026-10-26", time: "17:00", highlight: "BUILDS",
        spec: { kind: "thisOrThat", brand: "codeit", eyebrow: "You pick", headline: "What should we build?", a: { label: "Racing game", icon: "car" }, b: { label: "Pet game", icon: "paw" }, sticker: { type: "poll", question: "What should we build next?", options: ["Racing game", "Pet game"] } },
      },
      {
        key: "c-try-name", brand: CODEIT, day: "2026-10-27", time: "15:45", highlight: "LESSONS",
        spec: { kind: "tryTonight", brand: "codeit", eyebrow: "Try tonight", headline: "Make Python say hi", steps: ["Open the playground", "Type the line below", "Press Run, type your name"], code: 'print("Hi " + input("Name? "))' },
      },
      {
        key: "c-quiz-x", brand: CODEIT, day: "2026-10-28", time: "17:00", highlight: "QUIZ",
        spec: { kind: "quiz", brand: "codeit", eyebrow: "Quiz time", headline: "What does it print?", code: ["x = 5", "x = x + 2", "print(x)"], sticker: { type: "quiz", question: "What does it print?", options: ["5", "7", "x + 2"], correct: 1 } },
      },
      {
        key: "c-answer-x", brand: CODEIT, day: "2026-10-29", time: "15:45", highlight: "QUIZ",
        spec: { kind: "answer", brand: "codeit", eyebrow: "Yesterday's answer", headline: "It prints:", answer: "7", why: ["x starts at 5.", "Then x becomes x + 2,", "so x is now 7."], example: "score = score + 1", tryThis: "That line is every game's score." },
      },
      {
        key: "c-slider-making", brand: CODEIT, day: "2026-10-30", time: "17:00", highlight: "ASK THE TEACHER",
        spec: { kind: "slider", brand: "codeit", eyebrow: "Parents, be honest", headline: "Today's screen time:", lines: ["making or watching?", "Left: all watching. Right: all making."], sticker: { type: "slider", question: "How much was making?", emoji: "🛠️" } },
      },
      {
        key: "c-try-spooky", brand: CODEIT, day: "2026-10-31", time: "15:45", highlight: "LESSONS",
        spec: { kind: "tryTonight", brand: "codeit", eyebrow: "Halloween, try tonight", headline: "A spooky greeting", steps: ["Open the playground", "Type the line below", "Run it, then change Boo"], code: 'print("Boo, " + input("Who? "))' },
      },
      {
        key: "c-quiz-loop", brand: CODEIT, day: "2026-11-01", time: "17:00", highlight: "QUIZ",
        // Same key as the loop quiz it replaced, so the draft is re-rendered rather than orphaned. The loop moved to Pip's comic on Nov 4.
        spec: { kind: "quiz", brand: "codeit", eyebrow: "Bug hunt", headline: "The ghost won't move", code: ["ghost.x = 100", "speed = 0", "ghost.x += speed"], sticker: { type: "quiz", question: "Which line is the bug?", options: ["Line 1", "Line 2", "Line 3"], correct: 1 } },
      },
      {
        key: "c-answer-loop", brand: CODEIT, day: "2026-11-02", time: "15:45", highlight: "QUIZ",
        spec: { kind: "answer", brand: "codeit", eyebrow: "Yesterday's bug hunt", headline: "The bug is:", answer: "Line 2", why: ["speed = 0 means the", "ghost moves 0 steps", "every frame."], example: "speed = 5", tryThis: "Change one number, it moves." },
      },
      {
        key: "c-poll-make", brand: CODEIT, day: "2026-11-03", time: "17:00", highlight: "BUILDS",
        spec: { kind: "thisOrThat", brand: "codeit", eyebrow: "You pick", headline: "Your kid would build:", a: { label: "A space game", icon: "rocket" }, b: { label: "A music maker", icon: "music" }, sticker: { type: "poll", question: "What would your kid build?", options: ["Space game", "Music maker"] } },
      },
      {
        key: "c-try-dice", brand: CODEIT, day: "2026-11-04", time: "15:45", highlight: "LESSONS",
        spec: { kind: "tryTonight", brand: "codeit", eyebrow: "Try tonight", headline: "Roll a dice in Python", steps: ["Open the playground", "Type the two lines", "Run it again and again"], code: "import random\nprint(random.randint(1, 6))" },
      },
      // Case-study highlights: seven finished frames each, five minutes apart so they land in order.
      { key: "case-arcubed-01", brand: LYNQ, day: "2026-10-28", time: "13:00", highlight: "ARCUBED", spec: { kind: "image", brand: "lynq", file: "arcubed-01.jpg", alt: "Arcubed Label, case 04: hand crocheted bags, made to order." } },
      { key: "case-arcubed-02", brand: LYNQ, day: "2026-10-28", time: "13:05", highlight: "ARCUBED", spec: { kind: "image", brand: "lynq", file: "arcubed-02.jpg", alt: "The brief: every bag is made by hand, and every order used to be too." } },
      { key: "case-arcubed-03", brand: LYNQ, day: "2026-10-28", time: "13:10", highlight: "ARCUBED", spec: { kind: "image", brand: "lynq", file: "arcubed-03.jpg", alt: "Pick the shape, then the colour, on the Arcubed Label store." } },
      { key: "case-arcubed-04", brand: LYNQ, day: "2026-10-28", time: "13:15", highlight: "ARCUBED", spec: { kind: "image", brand: "lynq", file: "arcubed-04.jpg", alt: "Every bag, shown before it is made." } },
      { key: "case-arcubed-05", brand: LYNQ, day: "2026-10-28", time: "13:20", highlight: "ARCUBED", spec: { kind: "image", brand: "lynq", file: "arcubed-05.jpg", alt: "Into the bag, not into the DMs: the Arcubed Label cart." } },
      { key: "case-arcubed-06", brand: LYNQ, day: "2026-10-28", time: "13:25", highlight: "ARCUBED", spec: { kind: "image", brand: "lynq", file: "arcubed-06.jpg", alt: "What we built: storefront, customizer, ready now, checkout." } },
      { key: "case-arcubed-07", brand: LYNQ, day: "2026-10-28", time: "13:30", highlight: "ARCUBED", spec: { kind: "image", brand: "lynq", file: "arcubed-07.jpg", alt: "Now the store does the talking. DM AUDIT." } },
      { key: "case-housedeals-01", brand: LYNQ, day: "2026-10-29", time: "14:00", highlight: "HOUSE DEALS", spec: { kind: "image", brand: "lynq", file: "housedeals-01.jpg", alt: "House Deals Direct, case 05: buys homes direct and offers deals to investors." } },
      { key: "case-housedeals-02", brand: LYNQ, day: "2026-10-29", time: "14:05", highlight: "HOUSE DEALS", spec: { kind: "image", brand: "lynq", file: "housedeals-02.jpg", alt: "The brief: one business, two audiences, one site." } },
      { key: "case-housedeals-03", brand: LYNQ, day: "2026-10-29", time: "14:10", highlight: "HOUSE DEALS", spec: { kind: "image", brand: "lynq", file: "housedeals-03.jpg", alt: "Sell without listing it: the House Deals Direct seller form." } },
      { key: "case-housedeals-04", brand: LYNQ, day: "2026-10-29", time: "14:15", highlight: "HOUSE DEALS", spec: { kind: "image", brand: "lynq", file: "housedeals-04.jpg", alt: "Four steps, and owners decide at each one." } },
      { key: "case-housedeals-05", brand: LYNQ, day: "2026-10-29", time: "14:20", highlight: "HOUSE DEALS", spec: { kind: "image", brand: "lynq", file: "housedeals-05.jpg", alt: "The investor side, with every estimate labelled." } },
      { key: "case-housedeals-06", brand: LYNQ, day: "2026-10-29", time: "14:25", highlight: "HOUSE DEALS", spec: { kind: "image", brand: "lynq", file: "housedeals-06.jpg", alt: "What we built: seller form, how it works, investor list, FAQ." } },
      { key: "case-housedeals-07", brand: LYNQ, day: "2026-10-29", time: "14:30", highlight: "HOUSE DEALS", spec: { kind: "image", brand: "lynq", file: "housedeals-07.jpg", alt: "One site, both sides served. DM AUDIT." } },
      { key: "case-kidscoding-01", brand: LYNQ, day: "2026-10-30", time: "14:00", highlight: "KIDS CODING", spec: { kind: "image", brand: "lynq", file: "kidscoding-01.jpg", alt: "Kids Coding, case 06: a STEM school for ages 5 to 17." } },
      { key: "case-kidscoding-02", brand: LYNQ, day: "2026-10-30", time: "14:05", highlight: "KIDS CODING", spec: { kind: "image", brand: "lynq", file: "kidscoding-02.jpg", alt: "The brief: five programs, and one question from every parent: where do we start?" } },
      { key: "case-kidscoding-03", brand: LYNQ, day: "2026-10-30", time: "14:10", highlight: "KIDS CODING", spec: { kind: "image", brand: "lynq", file: "kidscoding-03.jpg", alt: "Three answers, one starting point: the Kids Coding program finder." } },
      { key: "case-kidscoding-04", brand: LYNQ, day: "2026-10-30", time: "14:15", highlight: "KIDS CODING", spec: { kind: "image", brand: "lynq", file: "kidscoding-04.jpg", alt: "Every term on one page: the Kids Coding timeline." } },
      { key: "case-kidscoding-05", brand: LYNQ, day: "2026-10-30", time: "14:20", highlight: "KIDS CODING", spec: { kind: "image", brand: "lynq", file: "kidscoding-05.jpg", alt: "Dates, then Enroll and Pay, on every camp and class." } },
      { key: "case-kidscoding-06", brand: LYNQ, day: "2026-10-30", time: "14:25", highlight: "KIDS CODING", spec: { kind: "image", brand: "lynq", file: "kidscoding-06.jpg", alt: "What we built: program finder, term timeline, camps, online classes." } },
      { key: "case-kidscoding-07", brand: LYNQ, day: "2026-10-30", time: "14:30", highlight: "KIDS CODING", spec: { kind: "image", brand: "lynq", file: "kidscoding-07.jpg", alt: "Parents find it. Then they enroll. DM AUDIT." } },
    ],
  },
  // -------------------------------------------------------------------------
  // Nov 5 to Nov 18: built to get follows and comments. Every post asks for one
  // small action (comment a letter, a number, a word; save; send to a parent),
  // and the guesses, bug hunts and A or B posts are answered in the next day's story,
  // so people come back to check.
  // -------------------------------------------------------------------------
  {
    key: "2026-11-18",
    label: "Nov 5 to Nov 18: LYNQ + CodeIt, built for comments and follows",
    weekStart: "2026-11-05",
    highlights: {
      LYNQ: ["START HERE", "KINGSBRIDGE", "NASMA", "AMY", "ARCUBED", "HOUSE DEALS", "KIDS CODING", "FIX THIS", "WHAT YOU GET", "OFFICE", "BEHIND"],
      CodeIt: ["START HERE", "BUILDS", "LESSONS", "ASK THE TEACHER", "FREE", "ABOUT", "QUIZ", "PIP"],
    },
    feed: [
      // ---- LYNQ ----
      {
        key: "p3-lynq-ab-button", brand: LYNQ, day: "2026-11-05", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · A or B: which button gets the call?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Two buttons. Same page. One of them gets the call. A or B?",
        body: "A or B?\n\nA says \"Contact us\".\nB says \"Call now, we answer\".\n\nSame page, same colour, same spot. We would bet on one of them every single time.\n\nComment A or B. The answer, and why, is in tomorrow's story.\n\nFollow for one of these every week. They take ten seconds and they fix real websites.",
        facebookBody: "A or B? A says \"Contact us\". B says \"Call now, we answer\". Same page, same spot. We'd bet on one of them every time. Comment A or B, the answer is in tomorrow's story.",
        hashtags: LYNQ_TAGS, callToAction: "Comment A or B",
        creativeDirection: `Two small matte black push buttons side by side on the black studio floor, hard light from the upper left, one engraved with a thin white "A" and the other with a thin white "B"; a tiny acid-lime ring of light around the base of button B only. One line of thin white type: "A or B?" ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-housedeals", brand: LYNQ, day: "2026-11-06", time: "12:15", pillar: "PROOF", storyHighlight: "HOUSE DEALS",
        title: "LYNQ · PROOF 05: House Deals Direct", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "One business, two audiences, one website. Here is how we split it.",
        body: "One business. Two audiences. One website.\n\nHouse Deals Direct buys homes from owners and offers deals to investors. Those two people want opposite things from the same site.\n\nSo the site splits early. Owners get a short form, the address first, then two quick steps, and a clear decision at every stage. Investors get their own list, and every estimate is labelled as an estimate.\n\nThe full case is in our HOUSE DEALS highlight.\n\nDoes your business serve two kinds of customer? Comment TWO and we'll tell you where most sites mix them up.",
        facebookBody: "House Deals Direct buys homes from owners and offers deals to investors: two audiences who want opposite things. So the site splits early. Owners get a short form and a clear decision at every step. Investors get their own list, with every estimate labelled. Serve two kinds of customer? Ask us where most sites mix them up.",
        hashtags: ["RealEstate", "WebDesign", "SmallBusiness"], callToAction: "Comment TWO",
        creativeDirection: `Two matte black house keys lying apart on the black studio floor, hard light from the upper left, pointing in opposite directions; one carries a small acid-lime tag. No text. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-onefix", brand: LYNQ, day: "2026-11-07", time: "12:15", pillar: "OFFER", storyHighlight: "WHAT YOU GET",
        title: "LYNQ · Comment your business, get one fix", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Comment what your business does. We will reply with the first fix we would make.",
        body: "This weekend we're doing something simple.\n\nComment what your business does. Plumber, bakery, salon, clinic, gym, anything.\n\nWe'll reply to every comment with the first fix we would make to a website like yours. One fix, written for your type of business, free.\n\nNo link needed and no sales call. If you want us to look at your actual site after that, DM \"AUDIT\".\n\nTag a business owner who should see this.",
        facebookBody: "This weekend: comment what your business does, and we'll reply with the first fix we would make to a website like yours. One fix, free, no sales call. Tag a business owner who should see this.",
        hashtags: LYNQ_TAGS, callToAction: "Comment your business",
        creativeDirection: `A single matte black speech bubble shaped object standing upright on the black studio floor, hard light from the upper left, with one small acid-lime wrench resting against its base. One line of thin white type: "One fix." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-askus", brand: LYNQ, day: "2026-11-08", time: "12:15", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · Ask us anything about your website", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Ask us anything about your website. We answer every comment ourselves.",
        body: "Ask us anything about your website.\n\nWhy it doesn't show up on Google. Why nobody fills in the form. Whether you need a new site or just three fixes. What a fair quote looks like.\n\nWe read and answer every comment ourselves, no bots, no templates. If the honest answer is \"you don't need us\", that is the answer you'll get.\n\nDrop your question below. Follow so you see the answers.",
        facebookBody: "Ask us anything about your website: Google, forms, whether you need a new site or just a few fixes. We answer every comment ourselves, honestly, even when the answer is that you don't need us.",
        hashtags: ["Founder", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comment a question",
        creativeDirection: `A matte black question mark standing upright like a sculpture on the black studio floor, hard light from the upper left and one clean shadow; the dot at its base is acid lime. No text. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-photos", brand: LYNQ, day: "2026-11-09", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · FIX THIS: five photos your Google profile needs", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Five photos your Google profile needs. Most businesses have one, and it's the logo.",
        body: "FIX THIS: your Google photos.\n\nBefore someone calls, they look. Five photos do most of the work:\n1. The outside, so they know they're in the right place\n2. The inside, so they know what to expect\n3. The work itself, a real job or a real plate\n4. The team, if you're comfortable with it\n5. The thing people ask about most\n\nTake them on your phone in daylight. Add one new photo a month after that.\n\nSave this, and send it to the owner who still only has the logo up.",
        facebookBody: "Five photos your Google profile needs: the outside, the inside, the work itself, the team if you're comfortable, and the thing people ask about most. Phone, daylight, one new photo a month after that. Send this to an owner who still only has the logo up.",
        hashtags: ["GoogleBusinessProfile", "LocalSEO", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Save this",
        creativeDirection: `Five small matte black instant photo frames fanned out on the black studio floor, all blank, hard light from the upper left; the corner of the top frame is acid lime. One line of thin white type: "Five photos." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-kidscoding", brand: LYNQ, day: "2026-11-10", time: "12:15", pillar: "PROOF", storyHighlight: "KIDS CODING",
        title: "LYNQ · PROOF 06: Kids Coding", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Five programs and one question from every parent: where do we start?",
        body: "Five programs. One question from every parent: where do we start?\n\nKids Coding is a STEM school for ages 5 to 17. After school, camps, online, workshops, weekly classes. Great problem to have, hard website to get right.\n\nSo the site starts with the question. Parents pick their child's age and interests and the site shows where to begin. Every term is on one page, and every camp and class has Enroll and Pay right next to its dates.\n\nRun and maintained by LYNQ. The full case is in our KIDS CODING highlight.\n\nDo your customers ask \"where do I start?\" Comment START and we'll show you how we'd answer it on your site.",
        facebookBody: "Kids Coding has five programs, and every parent asks where to start. So the site starts with that question: pick an age and interests, see where to begin, then Enroll and Pay next to the dates. Run and maintained by LYNQ. Do your customers ask where to start? Ask us how we'd answer it on your site.",
        hashtags: ["Education", "WebDesign", "SmallBusiness"], callToAction: "Comment START",
        creativeDirection: `Five small matte black wooden blocks lined up on the black studio floor, hard light from the upper left, the first block slightly forward with a thin acid-lime edge. One line of thin white type: "Where do we start?" ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-automate", brand: LYNQ, day: "2026-11-11", time: "12:15", pillar: "OFFER", storyHighlight: "OFFICE",
        title: "LYNQ · OFFICE: what would you automate first?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "If one job in your business ran itself tomorrow, which one? 1, 2 or 3.",
        body: "If one job in your business could run itself tomorrow, which would you pick?\n\n1. Replying to new enquiries, day or night\n2. Sending follow ups and reminders to customers\n3. Posting to Instagram and Facebook every week\n\nComment 1, 2 or 3.\n\nLYNQ Office is built to take jobs like these off your plate, set up around how your business already works, and nothing goes out without your approval.",
        facebookBody: "If one job in your business could run itself tomorrow: 1, replying to enquiries day or night, 2, follow ups and reminders, or 3, posting every week? Comment your number. LYNQ Office is built for jobs like these, and nothing goes out without your approval.",
        hashtags: ["BusinessAutomation", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comment 1, 2 or 3",
        creativeDirection: `Three small matte black toggle switches mounted in a row on a black plate, standing on the black studio floor, hard light from the upper left; only the first switch is flipped up and its tip is acid lime. One line of thin white type: "1, 2 or 3?" ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-myth", brand: LYNQ, day: "2026-11-12", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · Myth or fact: nobody looks at websites anymore", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "\"Nobody looks at websites anymore, it's all Instagram.\" Myth or fact?",
        body: "Myth or fact?\n\n\"Nobody looks at websites anymore. It's all Instagram now.\"\n\nWe hear this every week. Comment MYTH or FACT before you read the answer in tomorrow's story.\n\nA hint: think about the last time you were about to spend real money with a business you had never used. What did you check right before you called?",
        facebookBody: "Myth or fact: \"Nobody looks at websites anymore, it's all Instagram now.\" Think about the last time you were about to spend real money with a business you'd never used. What did you check right before you called? Tell us MYTH or FACT.",
        hashtags: ["MarketingTips", ...LYNQ_TAGS], callToAction: "Comment MYTH or FACT",
        creativeDirection: `A matte black coin standing on its edge on the black studio floor, hard light from the upper left, one face engraved "MYTH" and the visible edge ringed with a thin acid-lime line. No other text. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-sentence", brand: LYNQ, day: "2026-11-13", time: "12:15", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · BEHIND: the one sentence rule", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "If a stranger can't say what you do after one screen, we rewrite it.",
        body: "We have one rule before any design starts.\n\nA stranger opens your site on a phone. One screen, no scrolling. Can they say what you do, who it's for, and how to get it?\n\nIf not, we rewrite the first sentence until they can. Fonts and colours come after.\n\nTry it now: write what your business does in one sentence in the comments. We'll tell you honestly if it passes.",
        facebookBody: "Our one rule before any design: a stranger opens your site on a phone and, without scrolling, can say what you do, who it's for and how to get it. If not, we rewrite the first sentence. Write yours in one sentence and we'll tell you if it passes.",
        hashtags: ["Copywriting", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comment your sentence",
        creativeDirection: `A single matte black ruler lying on the black studio floor, hard light from the upper left, with one short thin white printed line along it and a tiny acid-lime mark at the end of the line. One line of thin white type: "One sentence." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-cases", brand: LYNQ, day: "2026-11-14", time: "12:15", pillar: "PROOF", storyHighlight: "START HERE",
        title: "LYNQ · Six businesses, six different first screens", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Six businesses, six different first screens. Which one should we break down next?",
        body: "Six businesses we've built for, and not one of them has the same first screen.\n\nA home builder. A restaurant. An events business. A handmade bag maker. A home buyer with an investor list. A kids STEM school.\n\nEach site starts with the one thing that business needs a customer to do. That's the whole method.\n\nEvery case is in our highlights. Which kind of business should we break down step by step next? Comment it below.",
        facebookBody: "Six businesses we've built for, and not one has the same first screen: a home builder, a restaurant, an events business, a bag maker, a home buyer with an investor list, and a STEM school. Each starts with the one thing that business needs a customer to do. Which kind should we break down next?",
        hashtags: ["WebDesign", "SmallBusiness", "LYNQ"], callToAction: "Comment a business type",
        creativeDirection: `Six small matte black tiles arranged in two neat rows on the black studio floor, hard light from the upper left, each with a different tiny engraved white symbol; one tile has an acid-lime edge. No text. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-hire", brand: LYNQ, day: "2026-11-15", time: "12:15", pillar: "TEACH", storyHighlight: "WHAT YOU GET",
        title: "LYNQ · Five questions before you hire anyone for your website", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Five questions to ask before you hire anyone to build your website. Including us.",
        body: "Five questions to ask before you hire anyone to build your website. Including us.\n\n1. Who owns the domain and the site when it's done? It should be you.\n2. Who answers the form at 9pm, and how fast?\n3. What happens after launch: who fixes things, and is that in the quote?\n4. Can I change my own hours and prices without calling you?\n5. Is the full quote in writing before anything starts?\n\nIf any answer is vague, keep looking.\n\nSave this for when you need it, and send it to a friend who's about to hire someone.",
        facebookBody: "Five questions before you hire anyone to build your website: who owns the domain when it's done, who answers the form at 9pm, what happens after launch, can you change your own hours and prices, and is the full quote in writing first. If any answer is vague, keep looking.",
        hashtags: ["SmallBusinessTips", ...LYNQ_TAGS], callToAction: "Save this",
        creativeDirection: `A matte black clipboard standing upright on the black studio floor holding one white sheet with five short printed lines, hard light from the upper left; a single acid-lime paper clip at the top. One line of thin white type: "Ask first." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-dmlink", brand: LYNQ, day: "2026-11-16", time: "12:15", pillar: "OFFER", storyHighlight: "WHAT YOU GET",
        title: "LYNQ · Send us your link, get three fixes", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Send us your website link. We'll send back three fixes. Free, this week only.",
        body: "This week only: send us your website link in a DM.\n\nWe'll open it on a phone, like your customers do, and send back three fixes in plain words. The first one you can usually do yourself in ten minutes.\n\nNo call, no pitch, no follow up unless you ask.\n\nDM \"AUDIT\" with your link. Know someone whose site needs it? Send them this post.",
        facebookBody: "This week only: send us your website link and we'll send back three fixes in plain words, after opening it on a phone like your customers do. No call, no pitch. Send us a message with your link.",
        hashtags: LYNQ_TAGS, callToAction: "DM AUDIT",
        creativeDirection: `A matte black envelope standing upright on the black studio floor, hard light from the upper left, its seal a small acid-lime dot. One line of thin white type: "Three fixes." ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-phonefirst", brand: LYNQ, day: "2026-11-17", time: "12:15", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · BEHIND: we design on a phone first", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "We design every page on a phone before we ever open a laptop. Here's why.",
        body: "We design every page on a phone first. The laptop version comes after.\n\nMost of the people who find a local business are on a phone, often standing somewhere, often in a hurry. If the page works there, it works everywhere. The other way around almost never holds.\n\nSo the call button, the hours and the booking link get placed for a thumb first.\n\nHow did you find the last local business you used, phone or laptop? Comment PHONE or LAPTOP.",
        facebookBody: "We design every page on a phone first. Most people find a local business on a phone, in a hurry, so the call button, hours and booking link get placed for a thumb before anything else. How did you find the last local business you used, phone or laptop?",
        hashtags: ["MobileFirst", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comment PHONE or LAPTOP",
        creativeDirection: `A matte black smartphone standing upright on the black studio floor next to a much larger closed black laptop lying flat behind it, hard light from the upper left; the phone's side button is acid lime. No text. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "p3-lynq-ab-headline", brand: LYNQ, day: "2026-11-18", time: "12:15", pillar: "TEACH", storyHighlight: "FIX THIS",
        title: "LYNQ · A or B: which headline gets the booking?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Two headlines for the same plumber. One gets the booking. A or B?",
        body: "A or B, round two.\n\nSame plumber, same website, two first lines:\nA: \"Welcome to our family business, serving you since 1998.\"\nB: \"Burst pipe? We pick up 24/7. Call now.\"\n\nComment A or B. Tomorrow's story has the answer, and the one rule behind it.\n\nGot a headline you're not sure about? Put it in the comments and we'll tell you honestly.",
        facebookBody: "A or B? Same plumber, two first lines. A: \"Welcome to our family business, serving you since 1998.\" B: \"Burst pipe? We pick up 24/7. Call now.\" Which one gets the booking? Tell us, and share a headline you're unsure about.",
        hashtags: ["Copywriting", ...LYNQ_TAGS], callToAction: "Comment A or B",
        creativeDirection: `Two matte black cards standing side by side on the black studio floor, hard light from the upper left, one with a thin white "A" and one with a thin white "B"; a small acid-lime pin holds card B. One line of thin white type: "A or B?" ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      // ---- CodeIt ----
      {
        key: "p3-codeit-guess-space", brand: CODEIT, day: "2026-11-05", time: "19:30", pillar: "TEACH", storyHighlight: "QUIZ",
        title: "CodeIt · Guess the game from four lines", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Four lines of code. Can your kid guess the game?",
        body: "Guess the game.\n\nrocket.y -= 5\nif touching(asteroid):\n    lives -= 1\n# dodge to survive\n\nA, B, C or D? Read it out loud with your kid and comment your letter.\n\nThe answer is in tomorrow's story. Follow so you catch the next one.\n\nReading code and guessing what it does is a real skill, and it's how every CodeIt build ends.",
        facebookBody: "Guess the game from four lines: rocket.y -= 5, if touching(asteroid), lives -= 1, dodge to survive. Snake, Space dodge, Pong or Cooking? Comment your letter, the answer is in tomorrow's story.",
        hashtags: CODEIT_TAGS, callToAction: "Comment A, B, C or D",
        card: { eyebrow: "Guess the game", headline: "Four lines.", sub: "What game is it?", steps: [], format: {
          kind: "guess", code: ["rocket.y -= 5", "if touching(asteroid):", "    lives -= 1", "# dodge to survive"], options: ["Snake", "Space dodge", "Pong", "Cooking"], hint: "Answer in tomorrow's story",
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-ask", brand: CODEIT, day: "2026-11-06", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · You send it, we build it", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your kid's game idea, built on video. Comment it below.",
        body: "You send it, we build it.\n\nAsk your kid: if you could play any game, what would it be? Write it in one sentence in the comments. The sillier the better.\n\n\"a bunny that dodges rain\"\n\"a pizza that runs away from a cat\"\n\nWe'll pick ideas from the comments and build them on CodeIt, on video, next week. No names needed, just the idea.\n\nFollow so you see if yours gets built.",
        facebookBody: "You send it, we build it. Ask your kid what game they'd play if they could play anything, and write it in one sentence in the comments. We'll build some of them on CodeIt, on video, next week. No names needed.",
        hashtags: CODEIT_TAGS, callToAction: "Comment a game idea",
        card: { eyebrow: "You send it, we build it", headline: "Your kid's game idea.", sub: "We'll build it.", steps: [], format: {
          kind: "ask", prompt: "Tell me a game\nyou want to play!", example: "a bunny that dodges rain", promise: "We build them on video",
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-cheat-loop", brand: CODEIT, day: "2026-11-07", time: "10:00", pillar: "LEARN", storyHighlight: "ASK THE TEACHER",
        title: "CodeIt · Parent cheat sheet: what's a loop?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your kid says \"I made a loop.\" Here's what that means, in one picture.",
        body: "Parent cheat sheet: what's a loop?\n\nIt's like telling someone \"stir it three times\" instead of \"stir, stir, stir\".\n\n1. You say what to repeat\n2. You say how many times\n3. The computer does the counting\n\nIn Python: for i in range(3): stir()\n\nSave this for the next time they explain their game to you, and ask them what their loop repeats.\n\nSend it to a parent who says \"I don't know anything about coding.\"",
        facebookBody: "Parent cheat sheet: a loop is \"stir it three times\" instead of \"stir, stir, stir\". You say what to repeat and how many times, and the computer counts. Save it for the next time your kid explains their game.",
        hashtags: CODEIT_TAGS, callToAction: "Save this",
        card: { eyebrow: "Parent cheat sheet", headline: "What's a loop?", sub: "Stir it three times.", steps: [], format: {
          kind: "cheat", word: "loop", like: "\"stir it\nthree times\"", object: "loop", lines: ["You say what to repeat", "You say how many times", "The computer does the counting"], code: "for i in range(3): stir()",
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-split-lives", brand: CODEIT, day: "2026-11-08", time: "10:00", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · One line, two games: lives", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "lives = 1 or lives = 99. Which game would your kid rather play?",
        body: "One line, two games.\n\nlives = 1: one hit and it's over. Every move counts.\nlives = 99: you can't lose. Fun for a minute, then boring.\n\nThe best game is somewhere in between, and finding that number is game design.\n\nAsk your kid: how many lives should it be? Comment their number.\n\nOn CodeIt they find it themselves: change the number, play, change it again.",
        facebookBody: "One line, two games: lives = 1 means one hit and it's over, lives = 99 means you can't lose. The best game is somewhere in between. Ask your kid how many lives it should be and tell us their number.",
        hashtags: CODEIT_TAGS, callToAction: "Comment a number",
        card: { eyebrow: "One line, two games", headline: "How many lives", sub: "should it be?", steps: [], format: {
          kind: "split", hero: "bunny", item: "carrot", note: "Same game. Pick the number.",
          top: { code: "lives = 1", caption: "One hit, done", badge: "♥ 1" },
          bottom: { code: "lives = 99", caption: "Can't lose", badge: "♥ 99" },
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-pip-if", brand: CODEIT, day: "2026-11-09", time: "19:30", pillar: "TEACH", storyHighlight: "PIP",
        title: "CodeIt · Pip learns if", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Pip only wants the umbrella when it rains. That's an if.",
        body: "Pip learns if.\n\nPip doesn't want to carry an umbrella every day. Only when it rains.\n\nif rain:\n    umbrella()\n\nThat's the whole idea. The computer checks something, and only does the next part when it's true. Every game is full of them: if you touch the lava, if the score hits 10, if time runs out.\n\nAsk your kid tonight: what's an if in your favourite game? Comment their answer.\n\nFollow for Pip's next lesson.",
        facebookBody: "Pip learns if: only carry the umbrella when it rains. The computer checks something and only does the next part when it's true. Ask your kid what an if is in their favourite game.",
        hashtags: CODEIT_TAGS, callToAction: "Comment their answer",
        card: { eyebrow: "Pip learns if", headline: "Umbrella?", sub: "Only if it rains.", steps: [], format: { kind: "comic", panels: [
          { pose: "think", bubble: "Do I need\nmy umbrella?", caption: "Pip has a question" },
          { pose: "type", code: "if rain:", caption: "Check first" },
          { pose: "type", code: "    umbrella()", caption: "Then do it" },
          { pose: "cheer", bubble: "Only when\nit rains!", caption: "That's an if" },
        ] } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-start", brand: CODEIT, day: "2026-11-10", time: "19:30", pillar: "OFFER", storyHighlight: "FREE",
        title: "CodeIt · Free tonight, CA$12 when you want more", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "What's free on CodeIt, and what the family plan adds. No surprises.",
        body: "What's free on CodeIt, plainly.\n\nFree: all 31 Python lessons, the playground, and 10 AI game builds a month. No card, nothing to install.\n\nThe family plan is CA$12/month when your kid wants more builds, with progress for each child.\n\nStart with the free part tonight. Most kids know within one build whether they love it.\n\nQuestions about the plan? Ask in the comments, we answer every one.\nAges 5 to 18, link in bio.",
        facebookBody: "What's free on CodeIt: all 31 Python lessons, the playground and 10 AI game builds a month, no card. The family plan is CA$12/month when your kid wants more. Start free tonight, ages 5 to 18.",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        card: { eyebrow: "Start free tonight", headline: "What's free.", sub: "No card needed.", steps: [
          { label: "Free, always", panel: { type: "text", lines: ["31 Python lessons", "The playground", "10 game builds a month"] } },
          { label: "Type one idea, press build", panel: { type: "input", text: "a rocket that dodges asteroids" } },
          { label: "Want more builds?", panel: { type: "terminal", text: "family plan: CA$12/month" } },
        ], takeaway: "Start with the free part tonight.", tryThis: "Ages 5 to 18: codeitlearn.com" },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-bug-bunny", brand: CODEIT, day: "2026-11-11", time: "19:30", pillar: "LEARN", storyHighlight: "QUIZ",
        title: "CodeIt · Bug hunt: the score is stuck on 1", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The bunny eats every carrot, but the score never goes past 1. Find the bug.",
        body: "Bug hunt, round two.\n\nThe bunny eats every carrot, but the score is stuck on 1.\n\n1. score = 0\n2. if bunny.touches(carrot):\n3.     score = 1\n\nWhich line is the bug? Comment the number. The answer is in tomorrow's story.\n\nThis is the most common bug kids write in their first game, and fixing it is when \"score\" finally makes sense.",
        facebookBody: "Bug hunt: the bunny eats every carrot but the score is stuck on 1. Line 1: score = 0. Line 2: if bunny.touches(carrot). Line 3: score = 1. Which line is the bug? The answer is in tomorrow's story.",
        hashtags: CODEIT_TAGS, callToAction: "Comment the line number",
        card: { eyebrow: "Bug hunt", headline: "The score is stuck.", sub: "Find the bug.", steps: [], format: {
          kind: "bug", hero: "bunny", item: "carrot", symptom: "SCORE 1",
          code: ["score = 0", "if bunny.touches(carrot):", "    score = 1"], question: "Which line is the bug?",
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-why-code", brand: CODEIT, day: "2026-11-12", time: "19:30", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · Why every change shows the code", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "We could hide the code. We show it on purpose. Here's why.",
        body: "CodeIt could build a game and hide the code. Plenty of apps do. We show it on purpose.\n\nWhen your kid makes the cat faster, they see the line that changed: speed = 20. When they add a score, they see score = score + 1.\n\nThat's the moment a game stops being magic and starts being something they made. After a few of those, they start changing the code directly.\n\nHas your kid ever asked how a game works? Tell us what they asked in the comments.",
        facebookBody: "CodeIt could build a game and hide the code. We show it on purpose: when your kid makes the cat faster, they see the line that changed. That's when a game stops being magic and becomes something they made.",
        hashtags: CODEIT_TAGS, callToAction: "Comment their question",
        card: { eyebrow: "Why we show the code", headline: "Not magic.", sub: "Something they made.", steps: [
          { label: "They ask for a faster cat", panel: { type: "input", text: "make the cat faster" } },
          { label: "They see the line that changed", panel: { type: "code", lines: ["speed = 20"] } },
          { label: "Next time they change it themselves", panel: { type: "game", hero: "cat", item: "pizza", score: "7" } },
        ], takeaway: "Every change shows the code behind it." },
        creativeDirection: "Rendered card, no real people.",
      },
      {
        key: "p3-codeit-guess-pong", brand: CODEIT, day: "2026-11-13", time: "19:30", pillar: "TEACH", storyHighlight: "QUIZ",
        title: "CodeIt · Guess the game, round two", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Round two. Four lines of code, one classic game. Which one?",
        body: "Guess the game, round two.\n\nball.x += speed\nif ball.hits(paddle):\n    speed = -speed\n# don't let it pass\n\nA, B, C or D? This one is a classic, and parents might get it before kids do.\n\nComment your letter. The answer is in tomorrow's story.",
        facebookBody: "Guess the game, round two: ball.x += speed, if the ball hits the paddle, speed = -speed, don't let it pass. Racing, Pong, Snake or Pet game? Parents might get this one first. The answer is in tomorrow's story.",
        hashtags: CODEIT_TAGS, callToAction: "Comment A, B, C or D",
        card: { eyebrow: "Guess the game", headline: "Round two.", sub: "A classic.", steps: [], format: {
          kind: "guess", code: ["ball.x += speed", "if ball.hits(paddle):", "    speed = -speed", "# don't let it pass"], options: ["Racing", "Pong", "Snake", "Pet game"], hint: "Answer in tomorrow's story",
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-cheat-if", brand: CODEIT, day: "2026-11-14", time: "10:00", pillar: "LEARN", storyHighlight: "ASK THE TEACHER",
        title: "CodeIt · Parent cheat sheet: what's an if?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "\"If it's raining, take a coat.\" You already know how to code an if.",
        body: "Parent cheat sheet: what's an if?\n\nYou already use them. \"If it's raining, take a coat.\" \"If your room is clean, you can play.\"\n\n1. The computer checks something\n2. Yes: it does the next part\n3. No: it skips it\n\nIn Python: if raining: coat()\n\nSave this, and tonight ask your kid for an if from their own day. Then ask for one from their favourite game.",
        facebookBody: "Parent cheat sheet: an if is \"if it's raining, take a coat.\" The computer checks something, does the next part when it's true, and skips it when it's not. Ask your kid for an if from their own day.",
        hashtags: CODEIT_TAGS, callToAction: "Save this",
        card: { eyebrow: "Parent cheat sheet", headline: "What's an if?", sub: "A fork in the road.", steps: [], format: {
          kind: "cheat", word: "if", like: "a fork in\nthe road", object: "fork", lines: ["The computer checks something", "Yes: it does the next part", "No: it skips it"], code: "if raining: coat()",
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-split-score", brand: CODEIT, day: "2026-11-15", time: "10:00", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · One line, two games: the score", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "+1 per carrot or +100 per carrot. One line changes how the game feels.",
        body: "One line, two games.\n\nscore += 1: every carrot counts a little. Getting to 50 feels like work.\nscore += 100: every carrot is a big moment. The numbers get silly fast.\n\nNeither is wrong. It's a choice, and kids love making it.\n\nWhich would your kid pick? Comment 1 or 100.\n\nOn CodeIt they change the number, play, and see the difference straight away.",
        facebookBody: "One line, two games: score += 1 makes every carrot count a little, score += 100 makes every carrot a big moment. Neither is wrong, it's a choice. Would your kid pick 1 or 100?",
        hashtags: CODEIT_TAGS, callToAction: "Comment 1 or 100",
        card: { eyebrow: "One line, two games", headline: "Plus 1", sub: "or plus 100?", steps: [], format: {
          kind: "split", hero: "bunny", item: "carrot", note: "Same game. One number changed.",
          top: { code: "score += 1", caption: "Slow and steady", badge: "SCORE 3" },
          bottom: { code: "score += 100", caption: "Big numbers", badge: "SCORE 300" },
        } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-pip-variable", brand: CODEIT, day: "2026-11-16", time: "19:30", pillar: "TEACH", storyHighlight: "PIP",
        title: "CodeIt · Pip learns a variable", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Pip keeps forgetting the score. So Pip gives it a name.",
        body: "Pip learns a variable.\n\nPip keeps forgetting how many stars it collected. So Pip gives the number a name:\n\nscore = 0\nscore = score + 1\n\nNow the game remembers for Pip. That's a variable: a name the computer keeps a value under, and the value can change.\n\nAsk your kid: what would your game need to remember? Comment their answer.\n\nFollow for Pip's next lesson.",
        facebookBody: "Pip learns a variable: Pip keeps forgetting the score, so it gives the number a name, score = 0, then score = score + 1. Now the game remembers. Ask your kid what their game would need to remember.",
        hashtags: CODEIT_TAGS, callToAction: "Comment their answer",
        card: { eyebrow: "Pip learns a variable", headline: "Name it.", sub: "The game remembers.", steps: [], format: { kind: "comic", panels: [
          { pose: "think", bubble: "How many stars\ndid I get?", caption: "Pip forgot" },
          { pose: "type", code: "score = 0", caption: "Give it a name" },
          { pose: "type", code: "score = score + 1", caption: "Add one each star" },
          { pose: "cheer", bubble: "It remembers\nfor me!", caption: "That's a variable" },
        ] } },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-family", brand: CODEIT, day: "2026-11-17", time: "19:30", pillar: "OFFER", storyHighlight: "FREE",
        title: "CodeIt · One plan for the whole family", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Two kids, one plan. Each one gets their own progress.",
        body: "Two kids who both want to make games? One family plan.\n\nEach child gets their own account, their own builds and their own progress, and you see all of it from the parent area.\n\nIt's CA$12/month for the family, and the free part stays free: 31 lessons, the playground and 10 builds a month.\n\nHow many young coders are in your house? Comment the number, we're curious.\nAges 5 to 18, link in bio.",
        facebookBody: "Two kids who both want to make games? One family plan, CA$12/month, with each child's own builds and progress in the parent area. The free part stays free. Ages 5 to 18.",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        card: { eyebrow: "The family plan", headline: "Two kids.", sub: "One plan.", steps: [
          { label: "Each child, their own builds", panel: { type: "game", hero: "rocket", item: "asteroid", score: "12" } },
          { label: "You see their progress", panel: { type: "text", lines: ["Lessons done", "Games built", "Questions answered right"] } },
          { label: "One price for the family", panel: { type: "terminal", text: "CA$12/month" } },
        ], takeaway: "The free part stays free.", tryThis: "Ages 5 to 18: codeitlearn.com" },
        creativeDirection: "Rendered card.",
      },
      {
        key: "p3-codeit-ask-2", brand: CODEIT, day: "2026-11-18", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · You send it, we build it, round two", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Round two: your kid's game idea, built on video. Comment it.",
        body: "You send it, we build it, round two.\n\nWe're opening the comments for game ideas again.\n\nAsk your kid for one game in one sentence and put it in the comments. A sentence like \"a ghost that steals candy\" is perfect.\n\nWe'll build ideas from the comments on CodeIt, on video. No names needed.\n\nFollow so you see the builds.",
        facebookBody: "You send it, we build it, round two. Ask your kid for one game in one sentence and put it in the comments. We'll build ideas on CodeIt, on video. No names needed.",
        hashtags: CODEIT_TAGS, callToAction: "Comment a game idea",
        card: { eyebrow: "You send it, we build it", headline: "Round two.", sub: "Send your kid's idea.", steps: [], format: {
          kind: "ask", prompt: "What game should\nwe build next?", example: "a ghost that steals candy", promise: "We build them on video",
        } },
        creativeDirection: "Rendered card.",
      },
    ],
    reels: [
      {
        key: "p3-lynq-reel-salon", brand: LYNQ, day: "2026-11-06", time: "18:30", series: "FIX THIS",
        title: "LYNQ Reel · FIX THIS: 60 seconds on a salon's website",
        hook: "60 seconds trying to book a haircut online. Watch where it breaks.",
        body: "FIX THIS: 60 seconds trying to book a haircut on a salon's website (name hidden).\n\nThree things I need: the prices, a free time, and a book button. Watch where I give up.\n\nOwn a salon? Comment SALON and I'll send you the one fix I'd make first.",
        facebookBody: "60 seconds trying to book a haircut on a salon's website: prices, a free time, a book button. Watch where it breaks. Own a salon? Ask us for the one fix we'd make first.",
        hashtags: ["SalonOwner", "WebDesign", "SmallBusiness"], callToAction: "Comment SALON",
        script: "Screen-record a real salon website in a phone frame, name and logo blurred. Narrate as a customer: find prices, find a free time, try to book. Stop the clock where it breaks. 30 to 45 seconds. Only claim what's on screen.",
        shots: [
          { timing: "0–2s", visual: "Salon homepage on a phone, name blurred, timer 0:60", onScreenText: "Booking a haircut. 60 seconds." },
          { timing: "2–15s", visual: "Hunting for prices", onScreenText: "1. How much?" },
          { timing: "15–28s", visual: "Looking for a free time", onScreenText: "2. When are you free?" },
          { timing: "28–40s", visual: "Looking for a book button, ends on the fix list", onScreenText: "3. Can I book? · Comment SALON" },
        ],
      },
      {
        key: "p3-lynq-reel-9pm", brand: LYNQ, day: "2026-11-11", time: "18:30", series: "WATCH IT WORK",
        title: "LYNQ Reel · WATCH IT WORK: a form at 9pm, answered in a minute",
        hook: "I filled in our own contact form at 9pm. Watch my phone.",
        body: "WATCH IT WORK: I filled in our own contact form at 9pm and started a timer.\n\nThe text and the email arrive on their own, with the next step, before the timer hits a minute. That's what every LYNQ site does for its owner's customers.\n\nWhat happens when someone fills in your form at 9pm? Comment what you think happens. Be honest.",
        facebookBody: "We filled in our own contact form at 9pm and started a timer. The text and email arrive on their own, with the next step, inside a minute. What happens when someone fills in your form at 9pm?",
        hashtags: ["BusinessAutomation", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comment what happens",
        script: "Film it for real at night: fill in the contact form on lynq.build on one phone, start a visible timer, and show the reply text and email landing on a second phone. Keep the timer in shot. 15 to 25 seconds. This only works if it's true on the night you film it.",
        shots: [
          { timing: "0–4s", visual: "Phone clock showing 9pm, filling in the form", onScreenText: "9pm. Our own form." },
          { timing: "4–6s", visual: "Tap submit, timer starts", onScreenText: "Timer on" },
          { timing: "6–18s", visual: "Second phone buzzes: text, then email", onScreenText: "Answered" },
          { timing: "18–22s", visual: "Timer stopped under a minute", onScreenText: "What happens on yours?" },
        ],
      },
      {
        key: "p3-lynq-reel-gym", brand: LYNQ, day: "2026-11-16", time: "18:30", series: "FIX THIS",
        title: "LYNQ Reel · FIX THIS: 60 seconds on a gym's website",
        hook: "60 seconds to find a gym's prices and a free trial. Watch where I stop.",
        body: "FIX THIS: 60 seconds on a gym's website (name hidden).\n\nWhat I'm looking for: the price, the hours, and how to try it once. Watch where I stop.\n\nThe fixes are small and most gyms need the same three.\n\nWhich kind of business should I do next? Comment it.",
        facebookBody: "60 seconds on a gym's website: the price, the hours, and how to try it once. Watch where I stop. Which kind of business should we do next?",
        hashtags: ["GymOwner", "WebDesign", "SmallBusiness"], callToAction: "Comment a business type",
        script: "Screen-record a real gym website in a phone frame, name and logo blurred. Look for the price, the hours and a free trial or day pass, in that order. Say what you actually find. 30 to 45 seconds.",
        shots: [
          { timing: "0–2s", visual: "Gym homepage on a phone, name blurred, timer 0:60", onScreenText: "60 seconds. A gym." },
          { timing: "2–15s", visual: "Searching for prices", onScreenText: "1. How much?" },
          { timing: "15–27s", visual: "Searching for hours", onScreenText: "2. When are you open?" },
          { timing: "27–40s", visual: "Searching for a trial, ends on the fix list", onScreenText: "3. Can I try it? · Comment yours" },
        ],
      },
      {
        key: "p3-codeit-reel-split", brand: CODEIT, day: "2026-11-07", time: "16:30", series: "ONE LINE, TWO GAMES",
        title: "CodeIt Reel · One line, two games, live",
        hook: "Watch one number turn a slow game into a chaotic one.",
        body: "One line, two games, live.\n\nThe cat game, built from one sentence. Then speed = 2 becomes speed = 20. Same game, completely different feel.\n\nWhat number should we try next? Comment it and we'll run it.\n\nFree to start, ages 5 to 18. Link in bio.",
        facebookBody: "One number turns a slow game into a chaotic one: speed = 2 becomes speed = 20. What number should we try next? Free to start, ages 5 to 18.",
        hashtags: CODEIT_TAGS, callToAction: "Comment a number",
        script: "Screen-record CodeIt for real: the cat and pizza game running at speed 2 for three seconds, open the code, change 2 to 20, run it again. Split the end screen if you can. 15 to 25 seconds, no intro.",
        shots: [
          { timing: "0–4s", visual: "The cat game running slowly", onScreenText: "speed = 2" },
          { timing: "4–9s", visual: "Code view, 2 changed to 20", onScreenText: "One line" },
          { timing: "9–18s", visual: "The cat zooming", onScreenText: "speed = 20 · What next?" },
        ],
      },
      {
        key: "p3-codeit-reel-build", brand: CODEIT, day: "2026-11-12", time: "16:30", series: "YOU SEND IT, WE BUILD IT",
        title: "CodeIt Reel · We built your kid's idea",
        hook: "You sent the idea. We built it. Here it is.",
        body: "You send it, we build it.\n\nThis idea came from the comments last week. One sentence in, a working game out, then one change so it feels like theirs.\n\nRecognise your idea? Tell us in the comments. Want yours built? Round two opens next Wednesday, follow so you don't miss it.",
        facebookBody: "This game idea came from the comments last week: one sentence in, a working game out, then one change to make it theirs. Want yours built? Round two opens next Wednesday.",
        hashtags: CODEIT_TAGS, callToAction: "Follow for round two",
        script: "Pick a real idea from the comments on the Nov 6 post (no names or usernames on screen). Screen-record typing it into CodeIt, the game appearing, three seconds of play, one change, and the code view. 25 to 40 seconds. Only use an idea someone actually sent.",
        shots: [
          { timing: "0–4s", visual: "The comment's idea typed into CodeIt, no username shown", onScreenText: "Your idea" },
          { timing: "4–15s", visual: "The game appears and is played", onScreenText: "Built" },
          { timing: "15–28s", visual: "One change, then the code view", onScreenText: "Made it yours" },
          { timing: "28–34s", visual: "End card", onScreenText: "Round two: next Wednesday" },
        ],
      },
      {
        key: "p3-codeit-reel-bug", brand: CODEIT, day: "2026-11-16", time: "16:30", series: "BUG HUNT LIVE",
        title: "CodeIt Reel · Bug hunt, live",
        hook: "The game broke. Watch how we find the line.",
        body: "Bug hunt, live.\n\nA real build that didn't do what we asked. Watch how to find the line: read it out loud, guess what it does, change one thing, run it again.\n\nThat's the whole skill, and kids get good at it fast.\n\nWhat's the funniest bug your kid has made? Comment it.",
        facebookBody: "A real build that didn't do what we asked, and how to find the line: read it out loud, guess, change one thing, run it again. What's the funniest bug your kid has made?",
        hashtags: CODEIT_TAGS, callToAction: "Comment a bug",
        script: "Screen-record a real CodeIt build where something is off (a score that doesn't count, a character that doesn't move). Read the code out loud, point at the line, fix it, run it. 25 to 40 seconds. Use a real bug, don't stage a fake one.",
        shots: [
          { timing: "0–4s", visual: "The game doing the wrong thing", onScreenText: "It broke." },
          { timing: "4–16s", visual: "Code view, cursor reading line by line", onScreenText: "Read it out loud" },
          { timing: "16–26s", visual: "One line changed, run again", onScreenText: "Change one thing" },
          { timing: "26–32s", visual: "The game working", onScreenText: "Fixed. Your kid's funniest bug?" },
        ],
      },
    ],
    linkedin: [
      {
        key: "p3-lynq-li-ab", brand: LYNQ, day: "2026-11-10", time: "08:15", pillar: "TEACH",
        title: "LinkedIn · Mustafa: Contact us vs call now",
        body: "Two words on a button can matter more than the whole redesign around them.\n\nI review a lot of local business websites, and the most common button on them says \"Contact us\". It's polite. It's safe. It also asks the customer to do work: figure out how, wait for a reply, wonder if anyone will answer.\n\nCompare it with \"Call now, we answer\". It tells the customer what happens, how fast, and that a person is on the other end.\n\nThree rules I use for the main button on any site:\n\n1. Say the action, not the department. \"Book a table\", not \"Reservations\".\n2. Remove the doubt. \"We answer\", \"Same day\", \"Free quote\".\n3. Keep it on screen on mobile. If the customer has to scroll back up to find it, it's not really there.\n\nNone of this needs a new website. It needs ten minutes and the willingness to be specific.\n\nIf you run a business, look at your main button today and ask: does it tell a stranger exactly what happens when they tap it?",
      },
      {
        key: "p3-lynq-li-own", brand: LYNQ, day: "2026-11-17", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa: Who owns your website?",
        body: "A question I now ask every business owner before we talk about design: who owns your domain?\n\nA surprising number don't know. It was registered years ago by a nephew, a former employee, or the agency before the last agency. The site works, so nobody checks. Until the person who holds the login leaves, and suddenly the business can't change its own hours, its email, or where its name points.\n\nI've helped untangle this more than once, and it is never quick. Accounts in someone's personal email. Renewal notices going to an inbox nobody reads. Passwords that only exist in one person's head.\n\nSo every project we take on starts with the same checklist:\n\n1. The domain is registered in the business's name, with the owner's email.\n2. The owner has their own login to the hosting and the site.\n3. Every password is in a place the business controls, not in ours.\n4. If we stopped working together tomorrow, nothing would break.\n\nThat last one matters most. A good agency should be easy to leave. It's the main reason clients stay.",
      },
      {
        key: "p3-codeit-li-debug", brand: CODEIT, day: "2026-11-06", time: "08:15", pillar: "LEARN",
        title: "LinkedIn · Mustafa: Debugging is the skill",
        body: "When people picture kids learning to code, they picture typing. In my experience the real learning happens when something breaks.\n\nA kid builds a game. The score doesn't go up. They're sure they did it right. Then they read the code out loud, one line at a time, and find it: score = 1 instead of score = score + 1. You can watch the idea of a variable land in that exact moment.\n\nThat's why we started posting bug hunts for parents and kids: three lines of code, one of them wrong, guess which. The hope is that parents and kids argue about it together at the table, because that argument is the lesson.\n\nA few things I've learned from teaching this:\n\n1. Reading code is harder and more useful than writing it.\n2. Kids should predict what the code will do before they run it.\n3. A bug is not a failure. It's the first real question they've asked the computer.\n\nWith AI writing more first drafts, the person who can find the wrong line becomes more valuable, not less. That skill starts young, and it starts with a broken game.",
      },
      {
        key: "p3-codeit-li-ideas", brand: CODEIT, day: "2026-11-13", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa: Building kids' ideas in public",
        body: "This month we tried something on CodeIt's page: we asked parents to comment their kid's game idea in one sentence, and we promised to build some of them on video.\n\nThe point wasn't marketing tricks. It was to show the part of CodeIt that matters most: a child's own idea is the best starting point for learning to code.\n\nWhen I run workshops, the energy in the room always comes from ownership. Give every kid the same example project and attention fades in minutes. Let each kid describe their own game and they will happily spend an hour fixing it, changing it and asking how it works.\n\nBuilding ideas in public also keeps us honest. A reel of a real idea, built live, with the code on screen, either works or it doesn't. There's no hiding behind a polished demo.\n\nIf you work in education or build products for kids, I'd love to hear how you get children to care about the first version of something. In my experience the answer is almost always the same: let it be theirs.",
      },
    ],
    stories: [
      // ---- LYNQ ----
      { key: "p3-l-ab-button", brand: LYNQ, day: "2026-11-05", time: "09:30", highlight: "FIX THIS", spec: { kind: "whichSite", brand: "lynq", eyebrow: "A or B", headline: ["Which button", "gets the call?"], sticker: { type: "poll", question: "Which gets the call?", options: ["A: Contact us", "B: Call now"] } } },
      { key: "p3-l-ab-answer", brand: LYNQ, day: "2026-11-06", time: "09:30", highlight: "FIX THIS", spec: { kind: "oneFix", brand: "lynq", eyebrow: "Yesterday's answer", headline: ["B gets", "the call."], fix: "Call now, we answer", detail: "It says what happens and how fast. \"Contact us\" makes the customer do the work." } },
      { key: "p3-l-onefix-stmt", brand: LYNQ, day: "2026-11-07", time: "09:30", highlight: null, spec: { kind: "statement", brand: "lynq", series: "This weekend", label: "Open offer", lines: ["Comment what", "your business does.", "We reply with", "one fix."], accentWord: "one fix.", byline: "On today's post" } },
      { key: "p3-l-form-slider", brand: LYNQ, day: "2026-11-08", time: "09:30", highlight: null, spec: { kind: "slider", brand: "lynq", eyebrow: "Be honest", headline: "Your contact form:", lines: ["would you bet it works?", "Left: no idea. Right: tested it today."], sticker: { type: "slider", question: "How sure are you?", emoji: "📨" } } },
      { key: "p3-l-photos", brand: LYNQ, day: "2026-11-09", time: "09:30", highlight: "FIX THIS", spec: { kind: "checklist", brand: "lynq", eyebrow: "Fix this", headline: ["Got these", "photos up?"], intro: "On your Google profile:", items: [{ text: "The outside", ok: true }, { text: "The inside", ok: true }, { text: "The work itself", ok: false }, { text: "What people ask about", ok: false }], close: ["Phone,", "daylight,", "today."] } },
      { key: "p3-l-found-poll", brand: LYNQ, day: "2026-11-10", time: "09:30", highlight: null, spec: { kind: "thisOrThat", brand: "lynq", eyebrow: "Quick one", headline: "Customers find you on:", a: { label: "Google", icon: "star" }, b: { label: "Instagram", icon: "phone" }, sticker: { type: "poll", question: "Where do most find you?", options: ["Google", "Instagram"] } } },
      { key: "p3-l-office-spec", brand: LYNQ, day: "2026-11-11", time: "09:30", highlight: "OFFICE", spec: { kind: "specSheet", brand: "lynq", series: "LYNQ Office", model: "LYNQ Office", subtitle: "Three jobs that run themselves", specs: [{ label: "New enquiry", value: "Answered in a minute", accent: true }, { label: "Reminders", value: "Go out on time" }, { label: "Social posts", value: "Drafted, you approve" }, { label: "Your say", value: "Nothing sends without you" }], note: "Built around how your business already works." } },
      { key: "p3-l-myth-answer", brand: LYNQ, day: "2026-11-12", time: "09:30", highlight: "FIX THIS", spec: { kind: "statement", brand: "lynq", series: "Myth or fact", label: "The answer", lines: ["Myth.", "Instagram gets", "the look.", "The website gets", "the call."], accentWord: "the call.", byline: "On today's post" } },
      { key: "p3-l-review-process", brand: LYNQ, day: "2026-11-13", time: "09:30", highlight: "WHAT YOU GET", spec: { kind: "process", brand: "lynq", series: "How the free review works", headline: "Three fixes, free.", steps: [{ n: "01", name: "Send", detail: "Your link, in a DM" }, { n: "02", name: "Look", detail: "We open it on a phone, like a customer" }, { n: "03", name: "Reply", detail: "Three fixes in plain words" }], note: "No call, no pitch." } },
      { key: "p3-l-cases-index", brand: LYNQ, day: "2026-11-14", time: "09:30", highlight: "START HERE", spec: { kind: "index", brand: "lynq", series: "The work", headline: "Six first screens.", rows: [{ name: "Kingsbridge", what: "Home builder and property manager" }, { name: "Nasma", what: "Restaurant" }, { name: "Finding Amy", what: "Photo booth events" }, { name: "Arcubed Label", what: "Handmade bags, made to order" }, { name: "House Deals Direct", what: "Owners and investors" }, { name: "Kids Coding", what: "STEM school, ages 5 to 17" }], note: "Every case is in our highlights." } },
      { key: "p3-l-hire-check", brand: LYNQ, day: "2026-11-15", time: "09:30", highlight: "WHAT YOU GET", spec: { kind: "checklist", brand: "lynq", eyebrow: "Before you hire", headline: ["Before you", "hire anyone."], intro: "Get a clear answer to:", items: [{ text: "Who owns the domain", ok: true }, { text: "Who answers at 9pm", ok: true }, { text: "Who fixes it after launch", ok: true }, { text: "Quote in writing first", ok: true }], close: ["Vague", "answer?", "Keep looking."] } },
      { key: "p3-l-dm-link", brand: LYNQ, day: "2026-11-16", time: "09:30", highlight: "WHAT YOU GET", spec: { kind: "oneFix", brand: "lynq", eyebrow: "This week only", headline: ["Send your link.", "Get three fixes."], fix: "DM AUDIT", detail: "We open it on a phone and reply with three fixes in plain words. Free." } },
      { key: "p3-l-phone-first", brand: LYNQ, day: "2026-11-17", time: "09:30", highlight: "BEHIND", spec: { kind: "teardown", brand: "lynq", series: "How we design", headline: "Phone first.", before: ["Designed on a laptop", "Call button in the footer", "Hours on the contact page"], after: ["Designed for a thumb", "Call button always on screen", "Hours next to the number"], note: "If it works on a phone, it works everywhere." } },
      { key: "p3-l-ab-headline", brand: LYNQ, day: "2026-11-18", time: "09:30", highlight: "FIX THIS", spec: { kind: "whichSite", brand: "lynq", eyebrow: "A or B, round two", headline: ["Which headline", "gets the booking?"], sticker: { type: "poll", question: "Which gets the booking?", options: ["A: Welcome to our...", "B: Burst pipe? Call"] } } },
      // ---- CodeIt ----
      { key: "p3-c-quiz-space", brand: CODEIT, day: "2026-11-05", time: "17:00", highlight: "QUIZ", spec: { kind: "quiz", brand: "codeit", eyebrow: "Guess the game", headline: "Which game is it?", code: ["rocket.y -= 5", "if touching(asteroid):", "    lives -= 1"], sticker: { type: "quiz", question: "Which game is it?", options: ["Snake", "Space dodge", "Pong"], correct: 1 } } },
      { key: "p3-c-answer-space", brand: CODEIT, day: "2026-11-06", time: "15:45", highlight: "QUIZ", spec: { kind: "answer", brand: "codeit", eyebrow: "Yesterday's answer", headline: "The game is:", answer: "Space dodge", why: ["The rocket moves up,", "an asteroid costs a life,", "so you dodge them."], example: "rocket.y -= 10", tryThis: "Faster rocket. Easier or harder?" } },
      { key: "p3-c-poll-idea", brand: CODEIT, day: "2026-11-07", time: "17:00", highlight: "BUILDS", spec: { kind: "thisOrThat", brand: "codeit", eyebrow: "You pick", headline: "Which should we build?", a: { label: "Star catcher", icon: "star" }, b: { label: "Rock dodger", icon: "rock" }, sticker: { type: "poll", question: "Which should we build?", options: ["Star catcher", "Rock dodger"] } } },
      { key: "p3-c-try-speed", brand: CODEIT, day: "2026-11-08", time: "15:45", highlight: "LESSONS", spec: { kind: "tryTonight", brand: "codeit", eyebrow: "Try tonight", headline: "Change one number", steps: ["Build any game on CodeIt", "Open the code, find speed", "Try 2, then 20, then 200"], code: "speed = 20" } },
      { key: "p3-c-quiz-if", brand: CODEIT, day: "2026-11-09", time: "17:00", highlight: "QUIZ", spec: { kind: "quiz", brand: "codeit", eyebrow: "Quiz time", headline: "What does it print?", code: ["if 5 > 3:", '    print("yes")'], sticker: { type: "quiz", question: "What does it print?", options: ["yes", "no", "nothing"], correct: 0 } } },
      { key: "p3-c-answer-if", brand: CODEIT, day: "2026-11-10", time: "15:45", highlight: "QUIZ", spec: { kind: "answer", brand: "codeit", eyebrow: "Yesterday's answer", headline: "It prints:", answer: "yes", why: ["5 > 3 is true,", "so the line under", "the if runs."], example: "if 2 > 3:", tryThis: "Swap the numbers. What now?" } },
      { key: "p3-c-quiz-bug", brand: CODEIT, day: "2026-11-11", time: "17:00", highlight: "QUIZ", spec: { kind: "quiz", brand: "codeit", eyebrow: "Bug hunt", headline: "The score is stuck", code: ["score = 0", "if bunny.touches(carrot):", "    score = 1"], sticker: { type: "quiz", question: "Which line is the bug?", options: ["Line 1", "Line 2", "Line 3"], correct: 2 } } },
      { key: "p3-c-answer-bug", brand: CODEIT, day: "2026-11-12", time: "15:45", highlight: "QUIZ", spec: { kind: "answer", brand: "codeit", eyebrow: "Yesterday's bug hunt", headline: "The bug is:", answer: "Line 3", why: ["score = 1 sets it", "to 1 every time.", "It needs to add one."], example: "score = score + 1", tryThis: "Now it counts every carrot." } },
      { key: "p3-c-quiz-pong", brand: CODEIT, day: "2026-11-13", time: "17:00", highlight: "QUIZ", spec: { kind: "quiz", brand: "codeit", eyebrow: "Guess the game", headline: "A classic. Which?", code: ["ball.x += speed", "if ball.hits(paddle):", "    speed = -speed"], sticker: { type: "quiz", question: "Which game is it?", options: ["Racing", "Pong", "Snake"], correct: 1 } } },
      { key: "p3-c-answer-pong", brand: CODEIT, day: "2026-11-14", time: "15:45", highlight: "QUIZ", spec: { kind: "answer", brand: "codeit", eyebrow: "Yesterday's answer", headline: "The game is:", answer: "Pong", why: ["The ball moves,", "the paddle flips its", "speed, so it bounces."], example: "speed = -speed * 2", tryThis: "Faster every bounce. Try it." } },
      { key: "p3-c-slider-make", brand: CODEIT, day: "2026-11-15", time: "17:00", highlight: "ASK THE TEACHER", spec: { kind: "slider", brand: "codeit", eyebrow: "Ask your kid", headline: "Would they rather", lines: ["play a game or make one?", "Left: play it. Right: make it."], sticker: { type: "slider", question: "Play it or make it?", emoji: "🎮" } } },
      { key: "p3-c-quiz-var", brand: CODEIT, day: "2026-11-16", time: "17:00", highlight: "QUIZ", spec: { kind: "quiz", brand: "codeit", eyebrow: "Pip's code", headline: "What does it print?", code: ["score = 0", "score = score + 1", "score = score + 1", "print(score)"], sticker: { type: "quiz", question: "What does it print?", options: ["0", "1", "2"], correct: 2 } } },
      { key: "p3-c-answer-var", brand: CODEIT, day: "2026-11-17", time: "15:45", highlight: "QUIZ", spec: { kind: "answer", brand: "codeit", eyebrow: "Yesterday's answer", headline: "It prints:", answer: "2", why: ["score starts at 0,", "then adds 1, twice.", "0 + 1 + 1 is 2."], example: "score = score + 10", tryThis: "Change 1 to 10. What prints?" } },
      { key: "p3-c-poll-next", brand: CODEIT, day: "2026-11-18", time: "17:00", highlight: "BUILDS", spec: { kind: "thisOrThat", brand: "codeit", eyebrow: "You pick", headline: "What should Pip build?", a: { label: "Pet game", icon: "paw" }, b: { label: "Racing game", icon: "car" }, sticker: { type: "poll", question: "What should Pip build next?", options: ["Pet game", "Racing game"] } } },
    ],
  },
];

export function getWeekPlan(key: string): WeekPlan | undefined {
  return WEEK_PLANS.find((p) => p.key === key);
}

/** The plan whose week contains (or comes right after) `now`, for the calendar's "Load week plan" button. */
export function currentWeekPlan(now: Date = new Date()): WeekPlan | undefined {
  const today = now.toISOString().slice(0, 10);
  return WEEK_PLANS.filter((p) => planEnd(p) >= today).sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0];
}

/** The last day any entry in the plan is scheduled for. */
export function planEnd(plan: WeekPlan): string {
  const days = [...plan.feed, ...plan.reels, ...plan.linkedin].map((e) => e.day);
  return days.length ? days.sort()[days.length - 1]! : addDays(plan.weekStart, 6);
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

/** Minutes of lead a caught-up post gets, so it clears every platform's "too soon" rule and the next cron tick picks it up. */
const CATCH_UP_LEAD_MINUTES = 20;

/**
 * A plan slot that is already in the past (the plan was loaded late, or a post
 * waited a day for its image) can't be submitted or approved: the schedule
 * check blocks it. Such slots move to the next quarter-hour at least 20 minutes
 * from now, so the post can go out today instead of being stuck.
 */
export function catchUp(at: Date, now: Date = new Date()): Date {
  const earliest = now.getTime() + CATCH_UP_LEAD_MINUTES * 60_000;
  if (at.getTime() >= earliest) return at;
  const quarter = 15 * 60_000;
  return new Date(Math.ceil(earliest / quarter) * quarter);
}

/** Today's date in the plan's timezone, YYYY-MM-DD. */
export function planToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PLAN_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The instant a plan entry goes out: its planned slot, or, for an entry planned
 * for today whose time has passed, the next quarter-hour. An entry from an
 * earlier day is never pulled forward (that piled every missed post onto one
 * afternoon); it stays in the past and `applyWeekPlan` retires it as missed.
 */
function planSlot(day: string, time: string, plusMinutes = 0, now: Date = new Date()): Date {
  const at = planInstant(day, time, plusMinutes);
  return day < planToday(now) ? at : catchUp(at, now);
}

export function planMarker(planKey: string, entryKey: string): string {
  return `weekplan:${planKey}:${entryKey}`;
}

/** Entry key of a story-only story: `ms-` (the owner posts it with a sticker) or `st-` (the Office publishes it). */
export function storyEntryKey(story: Pick<PlanStory, "key" | "spec">): string {
  return `${needsSticker(story.spec) ? "ms" : "st"}-${story.key}`;
}

/** True for the marker of a story the owner posts by hand (it carries a sticker): the Office never submits or publishes it. */
export function isManualStoryMarker(marker: string): boolean {
  return /^weekplan:[^:]+:ms-/.test(marker);
}

/** Renders a story-only story into an uploaded JPEG. Null when its hero photo isn't there yet. */
async function renderPlanStory(db: Db, input: { organizationId: string; actorUserId: string }, planKey: string, story: PlanStory, brandProfileId: string, contentItemId: string, variantId: string): Promise<string | null> {
  let photo: Uint8Array | undefined;
  if (story.spec.kind === "object") {
    if (!story.photoFrom) return null;
    const feedId = await findMarkedItem(db, input.organizationId, planMarker(planKey, story.photoFrom));
    const feed = feedId ? await getVariantsOfItem(db, input, feedId) : [];
    const assetId = feed.find((v) => v.platform === "instagram" && !v.archivedAt && v.media.length)?.media[0]?.assetId;
    if (!assetId) return null;
    photo = (await resolveAssetBytes(db, { organizationId: input.organizationId, assetId })).bytes;
  }
  const out = await composeStory(story.spec, photo);
  const asset = await createUploadedAsset(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    brandProfileId,
    contentItemId,
    contentVariantId: variantId,
    assetType: "image",
    title: `Story · ${story.key}`.slice(0, 200),
    altText: storyAltText(story.spec).slice(0, 1000),
    tags: ["story-original", storyKey(story.spec)],
    file: { bytes: out.bytes, contentType: out.contentType, filename: "story.jpg" },
    platformHint: "instagram",
  });
  return asset.id;
}

function storyAltText(spec: StorySpec): string {
  const s = spec as Record<string, unknown>;
  const parts = [s.alt, s.headline, s.model, s.title, Array.isArray(s.lines) ? (s.lines as string[]).join(" ") : null].flat().filter((x): x is string => typeof x === "string");
  return parts.join(" ") || "Story";
}

const highlightNote = (h: string | null) => (h ? `After it posts, add this story to the ${h} highlight (Instagram app → story → Highlight).` : "24-hour story only — no highlight.");

/** At most this many story images are rendered per load (each takes a moment); the hourly re-load finishes the rest. */
const STORY_RENDERS_PER_LOAD = 8;

export interface WeekPlanReport {
  planKey: string;
  brands: { name: string; created: boolean; accountsLinked: string[] }[];
  scheduled: string[];
  created: string[];
  skipped: string[];
  needsYou: string[];
  imagesQueued: { contentItemId: string; igVariantId: string; copyTo: string[]; card?: CodeItCard; story?: { variantId: string; meta: StoryMeta; brandProfileId: string | null } }[];
}

/**
 * Markers are stored verbatim in `brief.researchNotes`, so the match is exact.
 * (A substring match let `…:lynq-proof-4` find the story `…:lynq-proof-4-story`
 * too, which then got treated as the feed post: its card was re-carded every
 * hour and the copy refresh landed on the wrong item.)
 */
async function findMarkedItem(db: Db, organizationId: string, marker: string): Promise<string | null> {
  const [row] = await db
    .select({ id: marketingContentItems.id })
    .from(marketingContentItems)
    .where(and(eq(marketingContentItems.organizationId, organizationId), isNull(marketingContentItems.archivedAt), sql`${marketingContentItems.brief}->>'researchNotes' = ${marker}`))
    .orderBy(marketingContentItems.createdAt)
    .limit(1);
  return row?.id ?? null;
}

const STORY_CARD_TAG = "story-card";
const fromTag = (feedAssetId: string) => `from:${feedAssetId}`;

/**
 * True when a story still needs a composed card for the current feed image:
 * no media, the raw feed square, or a card made from a different (older)
 * feed image. A card made from this feed image is kept.
 */
async function storyNeedsCard(db: Db, organizationId: string, storyMedia: SocialContentItem["variants"][number]["media"], feedAssetId: string): Promise<boolean> {
  const current = storyMedia[0]?.assetId;
  if (!current) return true;
  if (current === feedAssetId) return true;
  try {
    const row = await resolveAssetRow(db, organizationId, current);
    const tags = Array.isArray(row.tags) ? (row.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
    if (!tags.includes(STORY_CARD_TAG)) return false; // an owner-chosen image: leave it
    if (row.contentType !== "image/jpeg") return true; // old PNG card: Instagram refuses it
    return !tags.includes(fromTag(feedAssetId));
  } catch {
    return true;
  }
}

const RESCHEDULABLE = new Set(["draft", "changes_requested"]);
/** Statuses whose image may be remade when the plan's art direction changes: anything not yet approved. */
const REMAKEABLE = new Set(["draft", "changes_requested", "ready_for_review"]);

/** What a post's story card says: the series label (its highlight), one caption line, the next step. */
export interface StoryMeta { brand: StoryBrand; series: string; line: string; cta: string; title: string }

export function storyMetaFor(post: PlanFeedPost): StoryMeta {
  const p = { ...post, ...(post.fallback ?? {}) };
  return {
    brand: post.brand.brandKey === "codeit" ? "codeit" : "lynq",
    series: post.storyHighlight ?? (post.pillar === "TEACH" ? "FIX THIS" : post.pillar),
    line: (p.hook ?? p.body?.split("\n")[0] ?? p.title ?? "").trim(),
    cta: p.callToAction ?? "New post",
    title: p.title ?? post.key,
  };
}

/**
 * The story never re-posts the raw square: it gets a composed 9:16 card
 * (brand wordmark, series label, the post image, one line, one next step),
 * so every story on the profile reads the same way. Composed once per
 * feed image; the card is stored as an uploaded asset tagged story-card.
 */
async function storyCardMedia(db: Db, input: { organizationId: string; actorUserId: string }, feedAssetId: string, meta: StoryMeta, brandProfileId: string | null): Promise<SocialContentItem["variants"][number]["media"]> {
  try {
    // A card for this feed image may already exist (the hourly re-apply runs often): reuse it instead of composing another.
    const [existing] = await db
      .select({ id: socialAssets.id })
      .from(socialAssets)
      .where(and(eq(socialAssets.organizationId, input.organizationId), isNull(socialAssets.archivedAt), eq(socialAssets.contentType, "image/jpeg"), sql`${socialAssets.tags} @> ${JSON.stringify([STORY_CARD_TAG, fromTag(feedAssetId)])}::jsonb`))
      .orderBy(desc(socialAssets.createdAt))
      .limit(1);
    if (existing) return [{ assetId: existing.id, position: 0, role: "primary" as const }];
    const source = await resolveAssetRow(db, input.organizationId, feedAssetId);
    const sourceTags = Array.isArray(source.tags) ? (source.tags as unknown[]) : [];
    if (sourceTags.includes(STORY_CARD_TAG)) throw new Error("source is already a story card");
    const { bytes } = await resolveAssetBytes(db, { organizationId: input.organizationId, assetId: feedAssetId });
    const card = await composeStoryCard({ brand: meta.brand, image: bytes, series: meta.series, line: meta.line, cta: meta.cta });
    const asset = await createUploadedAsset(db, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      brandProfileId,
      assetType: "image",
      title: `Story card · ${meta.title}`.slice(0, 200),
      altText: meta.line.slice(0, 1000),
      tags: [STORY_CARD_TAG, fromTag(feedAssetId)],
      file: { bytes: card.bytes, contentType: card.contentType, filename: "story.jpg" },
      platformHint: "instagram",
    });
    return [{ assetId: asset.id, position: 0, role: "primary" as const }];
  } catch (err) {
    console.error("[week-plan] story card failed, using the feed image:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    return [{ assetId: feedAssetId, position: 0, role: "primary" as const }];
  }
}

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
    // The plan's visual system is the brand's visual system: keep the brand profile in step so the image prompt
    // (which quotes the brand's visual rules) never contradicts the art direction.
    if (ref.visual && (brand.visualRules !== ref.visual.visualRules || brand.visualIdentity.notes !== ref.visual.notes)) {
      try {
        brand = await updateBrand(db, { organizationId: input.organizationId, brandProfileId: brand.id, actorUserId: input.actorUserId, expectedRevision: brand.revision, changes: { visualRules: ref.visual.visualRules, visualIdentity: { ...brand.visualIdentity, notes: ref.visual.notes } } });
        report.scheduled.push(`${brand.name}: visual rules updated`);
      } catch (err) {
        console.error("[week-plan] brand visual sync failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
      }
    }
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

  // 1b. Entries removed from the plan: archive their drafts so the morning send never picks them up.
  for (const key of plan.retired ?? []) {
    for (const marker of [planMarker(plan.key, key), planMarker(plan.key, `${key}-story`)]) {
      const id = await findMarkedItem(db, input.organizationId, marker);
      if (!id) continue;
      try {
        const item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: id, actorUserId: input.actorUserId });
        if (item.variants.some((v) => !v.archivedAt && !RESCHEDULABLE.has(v.status))) continue;
        await archiveContentItem(db, { organizationId: input.organizationId, contentItemId: id, actorUserId: input.actorUserId, expectedRevision: item.revision });
        report.skipped.push(`${item.title}: retired from the plan`);
      } catch (err) {
        report.skipped.push(`${key}: couldn't retire (${err instanceof Error ? err.message.slice(0, 80) : "unknown"})`);
      }
    }
  }

  // 2. Feed posts (+ a story for each).
  for (const post of plan.feed) {
    const brandProfileId = brandIds.get(post.brand.brandKey);
    if (!brandProfileId) continue;
    const at = planSlot(post.day, post.time);
    let item: SocialContentItem | null = null;

    // A post planned for an earlier day that never went out is missed, not late: its untouched drafts (post + story)
    // are archived so they stop showing up as "today", and the plan carries on with the entries still ahead.
    if (post.day < planToday() && !post.existingContentItemId) {
      const marker = planMarker(plan.key, post.key);
      const existingId = await findMarkedItem(db, input.organizationId, marker);
      if (existingId) {
        const existing = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingId, actorUserId: input.actorUserId });
        const live = existing.variants.filter((v) => !v.archivedAt);
        if (live.length && live.every((v) => v.status === "draft")) {
          for (const id of [existingId, await findMarkedItem(db, input.organizationId, planMarker(plan.key, `${post.key}-story`))]) {
            if (!id) continue;
            try {
              const it = id === existingId ? existing : await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: id, actorUserId: input.actorUserId });
              await archiveContentItem(db, { organizationId: input.organizationId, contentItemId: id, actorUserId: input.actorUserId, expectedRevision: it.revision });
            } catch {
              // Someone touched it since: leave it.
            }
          }
          report.skipped.push(`${existing.title}: missed (${post.day}), archived`);
          continue;
        }
      }
    }

    let useExisting = false;
    if (post.existingContentItemId) {
      try {
        item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: post.existingContentItemId, actorUserId: input.actorUserId });
        useExisting = !item.archivedAt;
      } catch {
        item = null;
      }
      if (!useExisting && !post.fallback) {
        report.skipped.push(`${post.key}: draft ${post.existingContentItemId} not found`);
        continue;
      }
    }
    if (useExisting && item) {
      let moved = 0;
      for (const v of item.variants) {
        if (v.archivedAt || !RESCHEDULABLE.has(v.status)) continue;
        if (v.scheduledFor?.getTime() === at.getTime()) continue;
        await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { scheduledFor: at } });
        moved++;
      }
      if (moved) report.scheduled.push(`${item.title} → ${post.day} ${post.time}`);
    } else {
      const p = { ...post, ...(post.fallback ?? {}) };
      const marker = planMarker(plan.key, post.key);
      const existingId = await findMarkedItem(db, input.organizationId, marker);
      if (existingId) {
        item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingId, actorUserId: input.actorUserId });
        // Re-loading the plan updates the copy of posts nobody has touched yet (still drafts), so caption fixes land without re-creating anything.
        const refreshed = await refreshPlanCopy(db, input, item, (v) => ({ hook: p.hook ?? "", body: v.platform === "facebook" ? (p.facebookBody ?? p.body ?? "") : (p.body ?? ""), hashtags: p.hashtags ?? [], callToAction: p.callToAction ?? "", scheduledFor: at }));
        if (refreshed) {
          item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingId, actorUserId: input.actorUserId });
          report.scheduled.push(`${item.title}: caption updated`);
        }
        // Changed art direction on an untouched post: store it and drop the old image (post + story) so the cron remakes it.
        const wantArt = p.card ? cardKey(p.card) : (p.creativeDirection ?? "");
        if (wantArt && item.brief.creativeDirection !== wantArt && item.variants.every((v) => v.archivedAt || REMAKEABLE.has(v.status))) {
          await updateContentItem(db, { organizationId: input.organizationId, contentItemId: item.id, actorUserId: input.actorUserId, expectedRevision: item.revision, changes: { brief: { creativeDirection: wantArt } } });
          const storyId = await findMarkedItem(db, input.organizationId, planMarker(plan.key, `${post.key}-story`));
          const all = [...item.variants, ...(storyId ? await getVariantsOfItem(db, input, storyId) : [])];
          for (const v of all) {
            if (v.archivedAt || !v.media.length || !REMAKEABLE.has(v.status)) continue;
            // Clearing the image on a post in review returns it to draft (content.ts), so nobody approves a version that no longer exists.
            await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { media: [] } });
          }
          item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingId, actorUserId: input.actorUserId });
          report.scheduled.push(`${item.title}: image will be remade`);
        }
      } else {
        const brief: SocialContentBrief = {
          kind: p.kind ?? "image_post",
          objective: p.pillar === "OFFER" ? "promotion" : p.pillar === "FOUNDER" ? "founder_voice" : p.pillar === "LEARN" || p.pillar === "TEACH" ? "education" : "engagement",
          audience: "",
          topic: `${p.pillar} post`,
          tone: "",
          callToAction: p.callToAction ?? "",
          creativeDirection: p.card ? cardKey(p.card) : (p.creativeDirection ?? ""),
          hook: p.hook ?? "",
          script: "",
          shots: [],
          sourceText: "",
          keyPoints: [`Pillar: ${p.pillar}`, p.storyHighlight ? `Story highlight: ${p.storyHighlight}` : "Story: 24h only", ...(post.fallback && post.existingContentItemId ? ["Plan copy written without the original draft — check every claim about the client against their real site before approving."] : [])],
          researchNotes: marker,
        };
        item = await createContentItem(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, brandProfileId, title: p.title ?? p.key, brief, platforms: p.platforms ?? ["instagram", "facebook"], scheduledFor: at });
        for (const v of item.variants) {
          // A carousel needs 2+ slides: only real-screenshot posts start as carousels; AI-image posts start as a single cover image.
          const format = p.kind === "carousel" && p.realPhotoOnly ? "carousel" : "image";
          const body = v.platform === "facebook" ? (p.facebookBody ?? p.body ?? "") : (p.body ?? "");
          await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { format, hook: p.hook ?? "", body, hashtags: p.hashtags ?? [], callToAction: p.callToAction ?? "", scheduledFor: at } });
        }
        item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: item.id, actorUserId: input.actorUserId });
        report.created.push(`${item.title} · ${post.day} ${post.time}`);
      }
      const ig = item.variants.find((v) => v.platform === "instagram" && !v.archivedAt);
      if (p.realPhotoOnly) report.needsYou.push(`${item.title}: ${p.uploadNote ?? "upload a real photo (founder posts don't use AI images)."}`);
      else if (ig && !ig.media.length) report.imagesQueued.push({ contentItemId: item.id, igVariantId: ig.id, copyTo: item.variants.filter((v) => v.id !== ig.id && !v.archivedAt && !v.media.length).map((v) => v.id), ...(p.card ? { card: p.card } : {}) });
    }

    if (!item) continue;
    noteAccounts(post.brand.brandKey, item);

    // Story: re-shares the post's image 10 minutes after it goes out.
    const storyMarker = planMarker(plan.key, `${post.key}-story`);
    const existingStoryId = await findMarkedItem(db, input.organizationId, storyMarker);
    if (existingStoryId) {
      // The story re-shares the post's image: if the image arrived after the story was made, copy it across now.
      const igFeed = item.variants.find((v) => v.platform === "instagram" && !v.archivedAt);
      if (igFeed?.media.length) {
        const story = await getVariantsOfItem(db, input, existingStoryId);
        for (const sv of story) {
          if (sv.archivedAt || !RESCHEDULABLE.has(sv.status)) continue;
          const storyAt = planSlot(post.day, post.time, 10);
          // No media yet, or still the raw feed square from before story cards existed: give it the composed card.
          const needsCard = await storyNeedsCard(db, input.organizationId, sv.media, igFeed.media[0]!.assetId);
          const changes = { ...(needsCard ? { media: await storyCardMedia(db, input, igFeed.media[0]!.assetId, storyMetaFor(post), brandProfileId) } : {}), ...(sv.scheduledFor?.getTime() === storyAt.getTime() ? {} : { scheduledFor: storyAt }) };
          if (Object.keys(changes).length) await updateVariant(db, { organizationId: input.organizationId, contentVariantId: sv.id, actorUserId: input.actorUserId, expectedRevision: sv.revision, changes });
        }
      } else {
        const story = await getVariantsOfItem(db, input, existingStoryId);
        const storyAt = planSlot(post.day, post.time, 10);
        for (const sv of story) {
          if (sv.archivedAt || !RESCHEDULABLE.has(sv.status) || sv.scheduledFor?.getTime() === storyAt.getTime()) continue;
          await updateVariant(db, { organizationId: input.organizationId, contentVariantId: sv.id, actorUserId: input.actorUserId, expectedRevision: sv.revision, changes: { scheduledFor: storyAt } });
        }
      }
    } else {
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
        scheduledFor: planSlot(post.day, post.time, 10),
      });
      const igStory = story.variants[0];
      const igFeed = item.variants.find((v) => v.platform === "instagram" && !v.archivedAt);
      if (igStory) {
        await updateVariant(db, { organizationId: input.organizationId, contentVariantId: igStory.id, actorUserId: input.actorUserId, expectedRevision: igStory.revision, changes: { format: "story", scheduledFor: planSlot(post.day, post.time, 10), ...(!igStory.channelAccountId && igFeed?.channelAccountId ? { channelAccountId: igFeed.channelAccountId } : {}), ...(igFeed?.media.length ? { media: await storyCardMedia(db, input, igFeed.media[0]!.assetId, storyMetaFor(post), brandProfileId) } : {}) } });
        const queued = report.imagesQueued.find((q) => q.contentItemId === item!.id);
        if (queued) queued.story = { variantId: igStory.id, meta: storyMetaFor(post), brandProfileId };
      }
      report.created.push(`${story.title}`);
    }
  }

  // 2b. Story-only stories: rendered from their spec (no AI). Sticker stories stay drafts the owner posts from the app.
  let storyRenders = 0;
  for (const st of plan.stories ?? []) {
    const brandProfileId = brandIds.get(st.brand.brandKey);
    if (!brandProfileId) continue;
    const manual = needsSticker(st.spec);
    const marker = planMarker(plan.key, storyEntryKey(st));
    const wantKey = storyKey(st.spec);
    const at = planSlot(st.day, st.time);
    let id = await findMarkedItem(db, input.organizationId, marker);
    if (st.day < planToday()) {
      // Its day is over: an untouched draft (always the case for sticker stories) leaves the Library.
      if (!id) continue;
      try {
        const old = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: id, actorUserId: input.actorUserId });
        if (old.variants.every((v) => v.archivedAt || v.status === "draft")) await archiveContentItem(db, { organizationId: input.organizationId, contentItemId: id, actorUserId: input.actorUserId, expectedRevision: old.revision });
      } catch {
        // Touched since: leave it.
      }
      continue;
    }
    const keyPoints = [highlightNote(st.highlight), ...(manual ? ["Post this one yourself from the Instagram app: it needs a sticker the API can't add."] : [])];
    const sourceText = "sticker" in st.spec ? stickerInstructions(st.spec.sticker) : "";
    if (!id) {
      const created = await createContentItem(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        brandProfileId,
        title: `Story · ${st.key}${st.highlight ? ` → ${st.highlight}` : ""}${manual ? " (sticker)" : ""}`,
        brief: { kind: "story", objective: "engagement", audience: "", topic: "Story made for stories", tone: "", callToAction: "", hook: "", script: "", shots: [], sourceText, creativeDirection: "", keyPoints, researchNotes: marker },
        platforms: ["instagram"],
        scheduledFor: at,
      });
      id = created.id;
      const v = created.variants[0];
      const account = v && !v.channelAccountId ? accountFor.get(`${st.brand.brandKey}|instagram`) : undefined;
      if (v) await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { format: "story", scheduledFor: at, ...(account ? { channelAccountId: account } : {}) } });
      report.created.push(`${created.title} · ${st.day} ${st.time}`);
    }
    const item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: id, actorUserId: input.actorUserId });
    const v = item.variants.find((x) => x.platform === "instagram" && !x.archivedAt);
    if (!v || !REMAKEABLE.has(v.status)) continue;
    const changed = item.brief.creativeDirection !== wantKey;
    const changes: Parameters<typeof updateVariant>[1]["changes"] = {};
    if ((changed || !v.media.length) && storyRenders < STORY_RENDERS_PER_LOAD) {
      try {
        const assetId = await renderPlanStory(db, input, plan.key, st, brandProfileId, item.id, v.id);
        storyRenders++;
        if (assetId) {
          changes.media = [{ assetId, position: 0, role: "primary" as const }];
          await updateContentItem(db, { organizationId: input.organizationId, contentItemId: item.id, actorUserId: input.actorUserId, expectedRevision: item.revision, changes: { brief: { creativeDirection: wantKey, keyPoints, sourceText } } });
          if (changed && v.media.length) report.scheduled.push(`${item.title}: image updated`);
        }
      } catch (err) {
        console.error("[week-plan] story render failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
      }
    }
    if (RESCHEDULABLE.has(v.status) && v.scheduledFor?.getTime() !== at.getTime()) changes.scheduledFor = at;
    if (Object.keys(changes).length) await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes });
  }

  // 3. Reels: separate from the grid (not shared to feed); the owner films them from the script.
  for (const reel of plan.reels) {
    const brandProfileId = brandIds.get(reel.brand.brandKey);
    if (!brandProfileId) continue;
    const marker = planMarker(plan.key, reel.key);
    const existingReelId = await findMarkedItem(db, input.organizationId, marker);
    if (existingReelId) {
      const existing = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingReelId, actorUserId: input.actorUserId });
      if (await refreshPlanCopy(db, input, existing, (v) => ({ hook: reel.hook, body: v.platform === "facebook" ? (reel.facebookBody ?? reel.body) : reel.body, hashtags: reel.hashtags, callToAction: reel.callToAction, scheduledFor: planSlot(reel.day, reel.time) }))) report.scheduled.push(`${existing.title}: updated`);
      if (reel.videoFromTelegram && (await attachTelegramVideo(db, input, existingReelId))) report.scheduled.push(`${existing.title}: video from Telegram attached`);
      if (reel.videoFile && (await attachBundledVideo(db, input, existingReelId, brandProfileId, reel.videoFile, reel.title))) report.scheduled.push(`${existing.title}: rendered video attached`);
      if (reel.aiVideo && existing.brief.creativeDirection !== reel.aiVideo.prompt && existing.variants.every((v) => v.archivedAt || RESCHEDULABLE.has(v.status))) {
        await updateContentItem(db, { organizationId: input.organizationId, contentItemId: existing.id, actorUserId: input.actorUserId, expectedRevision: existing.revision, changes: { brief: { creativeDirection: reel.aiVideo.prompt, keyPoints: reelKeyPoints(reel) } } });
        report.scheduled.push(`${existing.title}: video prompt updated`);
      }
      continue;
    }
    const at = planSlot(reel.day, reel.time);
    const item = await createContentItem(db, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      brandProfileId,
      title: reel.title,
      brief: {
        kind: "short_video_concept", objective: "awareness", audience: "", topic: `Reel series: ${reel.series}`, tone: "", callToAction: reel.callToAction,
        creativeDirection: reel.aiVideo?.prompt ?? "Real screen recording, filmed by you. First frame shows a real screen or business name — never a tagline.",
        hook: reel.hook, script: reel.script,
        shots: reel.shots.map((s) => ({ timing: s.timing, visual: s.visual, onScreenText: s.onScreenText ?? "", audio: s.audio ?? "" })),
        sourceText: "", keyPoints: reelKeyPoints(reel), researchNotes: marker,
      },
      platforms: ["instagram", "facebook"],
      scheduledFor: at,
    });
    for (const v of item.variants) {
      const platformOptions: SocialVariantPlatformOptions = v.platform === "instagram" ? { shareToFeed: false } : {};
      const account = v.channelAccountId ? undefined : accountFor.get(`${reel.brand.brandKey}|${v.platform}`);
      await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { format: v.platform === "instagram" ? "reel" : "video", hook: reel.hook, body: v.platform === "facebook" ? (reel.facebookBody ?? reel.body) : reel.body, hashtags: reel.hashtags, callToAction: reel.callToAction, platformOptions, scheduledFor: at, ...(account ? { channelAccountId: account } : {}) } });
    }
    report.created.push(`${reel.title} · ${reel.day} ${reel.time}`);
    if (reel.videoFromTelegram && (await attachTelegramVideo(db, input, item.id))) report.scheduled.push(`${reel.title}: video from Telegram attached`);
    else if (reel.videoFile && (await attachBundledVideo(db, input, item.id, brandProfileId, reel.videoFile, reel.title))) report.scheduled.push(`${reel.title}: rendered video attached`);
    else if (reel.aiVideo) report.needsYou.push(`${reel.title}: AI video ready to make (${reel.aiVideo.seconds} s). Press Make video in Studio once video credits are set up; nothing is spent before that.`);
    else report.needsYou.push(`${reel.title}: film it from the script and upload the video before ${reel.day}.`);
  }

  // 4. LinkedIn: text posts for Mustafa's profile (drafts until LinkedIn is connected; copy them from Telegram or the Library meanwhile).
  for (const li of plan.linkedin) {
    const brandProfileId = brandIds.get(li.brand.brandKey);
    if (!brandProfileId) continue;
    const marker = planMarker(plan.key, li.key);
    const existingLiId = await findMarkedItem(db, input.organizationId, marker);
    if (existingLiId) {
      const existing = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingLiId, actorUserId: input.actorUserId });
      if (await refreshPlanCopy(db, input, existing, () => ({ hook: li.body.split("\n")[0] ?? "", body: li.body, hashtags: [], scheduledFor: planSlot(li.day, li.time) }))) report.scheduled.push(`${existing.title}: updated`);
      continue;
    }
    const at = planSlot(li.day, li.time);
    const item = await createContentItem(db, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      brandProfileId,
      title: li.title,
      brief: { kind: "founder_post", objective: "founder_voice", audience: "", topic: `LinkedIn ${li.pillar} post`, tone: "", callToAction: "", creativeDirection: "", hook: li.body.split("\n")[0] ?? "", script: "", shots: [], sourceText: "", keyPoints: [`Pillar: ${li.pillar}`, "Text-only, no link — reply to every comment in the first hour."], researchNotes: marker },
      platforms: ["linkedin"],
      scheduledFor: at,
    });
    for (const v of item.variants) {
      await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { format: "text", hook: li.body.split("\n")[0] ?? "", body: li.body, hashtags: [], scheduledFor: at } });
    }
    report.created.push(`${li.title} · ${li.day} ${li.time}`);
  }

  // 5. Story cards nothing points at any more (older versions, and the ones the hourly re-card made) leave the library.
  const pruned = await pruneOrphanStoryCards(db, input);
  if (pruned) report.scheduled.push(`${pruned} unused story card${pruned === 1 ? "" : "s"} archived`);

  return report;
}

function reelKeyPoints(reel: PlanReel): string[] {
  return [`Reel series: ${reel.series}`, "Reels stay off the grid (not shared to feed).", ...(reel.aiVideo ? [`AI video: ${reel.aiVideo.seconds} seconds. Made only when you press Make video.`] : [])];
}

/** Renders a CodeIt story card and attaches it to the post's Instagram version (replacing nothing: callers only ask when there is no media). */
async function attachCodeItCard(db: Db, input: { organizationId: string; actorUserId: string }, contentItemId: string, igVariantId: string, spec: CodeItCard): Promise<void> {
  const item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId, actorUserId: input.actorUserId });
  const ig = item.variants.find((v) => v.id === igVariantId);
  if (!ig) throw new Error("variant not found");
  const png = await composeCodeItCard(spec);
  const asset = await createUploadedAsset(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    brandProfileId: item.brandProfileId ?? null,
    contentItemId: item.id,
    contentVariantId: ig.id,
    assetType: "image",
    title: `${item.title} — card`.slice(0, 200),
    altText: `${spec.headline} ${spec.sub}`.slice(0, 1000),
    tags: ["codeit-card"],
    file: { bytes: png.bytes, contentType: png.contentType, filename: "card.jpg" },
    platformHint: "instagram",
  });
  await updateVariant(db, { organizationId: input.organizationId, contentVariantId: ig.id, actorUserId: input.actorUserId, expectedRevision: ig.revision, changes: { media: [{ assetId: asset.id, position: 0, role: "primary" as const }], format: "image" } });
}

/** Puts the newest video sent to the Telegram bot on every version of a reel that still has no media. True when something was attached. */
const REELS_DIR = path.join(process.cwd(), "src", "assets", "reels");

/** Attaches a bundled rendered reel to a reel's empty variants, uploading the file once per workspace. */
async function attachBundledVideo(db: Db, input: { organizationId: string; actorUserId: string }, contentItemId: string, brandProfileId: string, file: string, title: string): Promise<boolean> {
  const variants = await getVariantsOfItem(db, input, contentItemId);
  const empty = variants.filter((v) => !v.archivedAt && !v.media.length && RESCHEDULABLE.has(v.status) && v.platform !== "linkedin");
  if (!empty.length) return false;
  const tag = `reel-file:${file}`;
  const [found] = await db
    .select({ id: socialAssets.id })
    .from(socialAssets)
    .where(and(eq(socialAssets.organizationId, input.organizationId), isNull(socialAssets.archivedAt), eq(socialAssets.assetType, "video"), sql`${socialAssets.tags} @> ${JSON.stringify([tag])}::jsonb`))
    .limit(1);
  let assetId = found?.id;
  if (!assetId) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(path.join(REELS_DIR, file)));
    } catch {
      console.error(`[week-plan] rendered reel missing: ${file}`);
      return false;
    }
    const asset = await createUploadedAsset(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, brandProfileId, contentItemId, assetType: "video", title: `Reel · ${title}`.slice(0, 200), tags: ["rendered-reel", tag], file: { bytes, contentType: "video/mp4", filename: file }, platformHint: "instagram" });
    assetId = asset.id;
  }
  let attached = 0;
  for (const v of empty) {
    try {
      await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { media: [{ assetId, position: 0, role: "primary" as const }] } });
      attached++;
    } catch (err) {
      console.error("[week-plan] rendered reel attach failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    }
  }
  return attached > 0;
}

async function attachTelegramVideo(db: Db, input: { organizationId: string; actorUserId: string }, contentItemId: string): Promise<boolean> {
  const variants = await getVariantsOfItem(db, input, contentItemId);
  const empty = variants.filter((v) => !v.archivedAt && !v.media.length && RESCHEDULABLE.has(v.status) && v.platform !== "linkedin");
  if (!empty.length) return false;
  const [video] = await db
    .select({ id: socialAssets.id })
    .from(socialAssets)
    .where(and(eq(socialAssets.organizationId, input.organizationId), isNull(socialAssets.archivedAt), eq(socialAssets.assetType, "video"), sql`${socialAssets.tags} @> ${JSON.stringify(["telegram"])}::jsonb`))
    .orderBy(desc(socialAssets.createdAt))
    .limit(1);
  if (!video) return false;
  let attached = 0;
  for (const v of empty) {
    try {
      await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { media: [{ assetId: video.id, position: 0, role: "primary" as const }] } });
      attached++;
    } catch (err) {
      console.error("[week-plan] telegram video attach failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    }
  }
  return attached > 0;
}

/** Archives story-card assets (older than an hour) that no live variant uses. Bounded per run. */
async function pruneOrphanStoryCards(db: Db, input: { organizationId: string; actorUserId: string }, limit = 150): Promise<number> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const cards = await db
    .select({ id: socialAssets.id })
    .from(socialAssets)
    .where(and(eq(socialAssets.organizationId, input.organizationId), isNull(socialAssets.archivedAt), sql`${socialAssets.tags} @> ${JSON.stringify([STORY_CARD_TAG])}::jsonb`, sql`${socialAssets.createdAt} < ${cutoff}`))
    .orderBy(socialAssets.createdAt)
    .limit(limit);
  let archived = 0;
  for (const card of cards) {
    const [used] = await db
      .select({ id: socialContentVariants.id })
      .from(socialContentVariants)
      .where(and(eq(socialContentVariants.organizationId, input.organizationId), isNull(socialContentVariants.archivedAt), sql`${socialContentVariants.media} @> ${JSON.stringify([{ assetId: card.id }])}::jsonb`))
      .limit(1);
    if (used) continue;
    try {
      await archiveAsset(db, { organizationId: input.organizationId, assetId: card.id, actorUserId: input.actorUserId });
      archived++;
    } catch {
      // Already archived by another run, or not ours to archive: skip.
    }
  }
  return archived;
}

/** Runs the queued image generations one at a time, then copies each image onto the post's Facebook version and its story. Best-effort. */
export async function generatePlanImages(db: Db, input: { organizationId: string; actorUserId: string; queue: WeekPlanReport["imagesQueued"] }): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const job of input.queue) {
    try {
      if (job.card) await attachCodeItCard(db, input, job.contentItemId, job.igVariantId, job.card);
      else await regenerateVariantPart(db, { organizationId: input.organizationId, contentVariantId: job.igVariantId, actorUserId: input.actorUserId, part: "image" });
      const item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: job.contentItemId, actorUserId: input.actorUserId });
      const ig = item.variants.find((v) => v.id === job.igVariantId);
      const media = ig?.media.slice(0, 1).map((m) => ({ ...m, position: 0, role: "primary" as const })) ?? [];
      if (!media.length) throw new Error("no image attached");
      for (const targetId of job.copyTo) {
        // Story variants live on their own item; re-read each target for its current revision.
        const target = await getVariantRevision(db, input.organizationId, input.actorUserId, targetId);
        if (target && !target.media.length) await updateVariant(db, { organizationId: input.organizationId, contentVariantId: targetId, actorUserId: input.actorUserId, expectedRevision: target.revision, changes: { media } });
      }
      if (job.story) {
        const target = await getVariantRevision(db, input.organizationId, input.actorUserId, job.story.variantId);
        if (target && !target.media.length) await updateVariant(db, { organizationId: input.organizationId, contentVariantId: target.id, actorUserId: input.actorUserId, expectedRevision: target.revision, changes: { media: await storyCardMedia(db, input, media[0]!.assetId, job.story.meta, job.story.brandProfileId) } });
      }
      done++;
    } catch (err) {
      failed++;
      console.error("[week-plan] image generation failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    }
  }
  return { done, failed };
}

type PlanCopy = { hook: string; body: string; hashtags: string[]; callToAction?: string; scheduledFor?: Date };
const tagKey = (tags: string[]) => tags.map((t) => t.replace(/^#/, "").toLowerCase()).join(" ");

/** Writes the plan's current copy onto variants nobody has edited or submitted yet. Returns how many changed. */
async function refreshPlanCopy(db: Db, input: { organizationId: string; actorUserId: string }, item: SocialContentItem, want: (v: SocialContentItem["variants"][number]) => PlanCopy): Promise<number> {
  let changed = 0;
  for (const v of item.variants) {
    if (v.archivedAt || !RESCHEDULABLE.has(v.status)) continue;
    const w = want(v);
    const same = v.hook === w.hook && v.body === w.body && tagKey(v.hashtags) === tagKey(w.hashtags) && (w.callToAction === undefined || v.callToAction === w.callToAction) && (w.scheduledFor === undefined || v.scheduledFor?.getTime() === w.scheduledFor.getTime());
    if (same) continue;
    await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: w });
    changed++;
  }
  return changed;
}

async function getVariantsOfItem(db: Db, input: { organizationId: string; actorUserId: string }, contentItemId: string): Promise<SocialContentItem["variants"]> {
  try {
    return (await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId, actorUserId: input.actorUserId })).variants;
  } catch {
    return [];
  }
}

/**
 * Finishes the images the load-time job didn't get to (that job runs in the request's
 * leftover time and is cut off by the serverless limit). Generates a few per call and
 * copies each image onto the post's Facebook version and its story; the cron calls it
 * every run, so a loaded plan fills itself in within the hour. Best-effort.
 */
export async function fillWeekPlanImages(db: Db, input: { organizationId: string; actorUserId: string; limit?: number; planKey?: string }): Promise<{ generated: number; copied: number; failed: number }> {
  const plans = input.planKey ? WEEK_PLANS.filter((p) => p.key === input.planKey) : WEEK_PLANS;
  const limit = input.limit ?? 3;
  const out = { generated: 0, copied: 0, failed: 0 };
  const primary = (media: SocialContentItem["variants"][number]["media"]) => media.slice(0, 1).map((m) => ({ ...m, position: 0, role: "primary" as const }));
  for (const plan of plans) {
    const marked = await db
      .select({ id: marketingContentItems.id, marker: sql<string>`${marketingContentItems.brief}->>'researchNotes'` })
      .from(marketingContentItems)
      .where(and(eq(marketingContentItems.organizationId, input.organizationId), isNull(marketingContentItems.archivedAt), sql`${marketingContentItems.brief}->>'researchNotes' like ${`weekplan:${plan.key}:%`}`));
    if (!marked.length) continue;
    const idFor = new Map(marked.map((m) => [m.marker, m.id]));
    for (const post of plan.feed) {
      if (out.generated + out.failed >= limit) return out;
      const p = { ...post, ...(post.fallback ?? {}) };
      const itemId = idFor.get(planMarker(plan.key, post.key));
      if (!itemId || p.realPhotoOnly) continue;
      let variants = await getVariantsOfItem(db, input, itemId);
      const ig = variants.find((v) => v.platform === "instagram" && !v.archivedAt);
      if (!ig) continue;
      // A feed image that isn't square came from the old portrait render (edges cut): clear it on every version so it is remade.
      if (ig.media.length && REMAKEABLE.has(ig.status) && ((await isWrongShape(db, input.organizationId, ig.media[0]!.assetId)) || (await isPngCard(db, input.organizationId, ig.media[0]!.assetId)))) {
        const storyId0 = idFor.get(planMarker(plan.key, `${post.key}-story`));
        const all = [...variants, ...(storyId0 ? await getVariantsOfItem(db, input, storyId0) : [])];
        for (const v of all) {
          if (v.archivedAt || !v.media.length || !REMAKEABLE.has(v.status)) continue;
          await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { media: [] } });
        }
        variants = await getVariantsOfItem(db, input, itemId);
      }
      const igNow = variants.find((v) => v.id === ig.id) ?? ig;
      if (!igNow.media.length) {
        if (!RESCHEDULABLE.has(igNow.status)) continue;
        try {
          if (p.card) await attachCodeItCard(db, input, itemId, ig.id, p.card);
          else await regenerateVariantPart(db, { organizationId: input.organizationId, contentVariantId: ig.id, actorUserId: input.actorUserId, part: "image" });
          out.generated++;
          variants = await getVariantsOfItem(db, input, itemId);
        } catch (err) {
          out.failed++;
          console.error("[week-plan] image generation failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
          continue;
        }
      }
      const media = primary(variants.find((v) => v.id === ig.id)?.media ?? []);
      if (!media.length) continue;
      const storyId = idFor.get(planMarker(plan.key, `${post.key}-story`));
      const storyVariants = storyId ? await getVariantsOfItem(db, input, storyId) : [];
      const storyIds = new Set(storyVariants.map((v) => v.id));
      const targets = [...variants.filter((v) => v.id !== ig.id && !v.archivedAt && v.platform !== "linkedin"), ...storyVariants];
      const brandProfileId = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: itemId, actorUserId: input.actorUserId }).then((i) => i.brandProfileId ?? null).catch(() => null);
      for (const t of targets) {
        if (t.archivedAt || t.media.length || !RESCHEDULABLE.has(t.status)) continue;
        try {
          // Stories get the composed 9:16 card; the Facebook version gets the square itself.
          const changes = { media: storyIds.has(t.id) ? await storyCardMedia(db, input, media[0]!.assetId, storyMetaFor(post), brandProfileId) : media };
          await updateVariant(db, { organizationId: input.organizationId, contentVariantId: t.id, actorUserId: input.actorUserId, expectedRevision: t.revision, changes });
          out.copied++;
        } catch (err) {
          console.error("[week-plan] image copy failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
        }
      }
    }
  }
  return out;
}


/** True for a rendered card stored as PNG (before cards were JPEG): Instagram refuses it, so it is remade. */
async function isPngCard(db: Db, organizationId: string, assetId: string): Promise<boolean> {
  try {
    const row = await resolveAssetRow(db, organizationId, assetId);
    const tags = Array.isArray(row.tags) ? (row.tags as unknown[]) : [];
    return row.contentType !== "image/jpeg" && (tags.includes("codeit-card") || tags.includes(STORY_CARD_TAG));
  } catch {
    return false;
  }
}

/** True when a feed image isn't square (every earlier portrait render had its top or bottom cut; feed images are 1:1 now). Unknown dimensions count as fine. */
async function isWrongShape(db: Db, organizationId: string, assetId: string): Promise<boolean> {
  try {
    const row = await resolveAssetRow(db, organizationId, assetId);
    if (!row.width || !row.height) return false;
    return Math.abs(row.width / row.height - 1) > 0.02;
  } catch {
    return false;
  }
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
  kind: "post" | "story" | "reel" | "linkedin";
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
  /** The image that will go out (first media of the Instagram version, else the first version with media). */
  assetId: string | null;
  /** First line of the caption as it will be posted. */
  hook: string | null;
  /** Platforms this entry posts to, in display order. */
  platforms: string[];
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
  const summarize = (item: SocialContentItem | null, kind: WeekPlanEntryStatus["kind"], realPhoto = false): Pick<WeekPlanEntryStatus, "status" | "needs" | "contentItemId" | "assetId" | "hook" | "platforms"> => {
    if (!item) return { status: null, needs: null, contentItemId: null, assetId: null, hook: null, platforms: [] };
    const live = item.variants.filter((v) => !v.archivedAt);
    const status = live.map((v) => v.status as string).sort((a, b) => PROGRESS.indexOf(a) - PROGRESS.indexOf(b))[0] ?? null;
    const missingMedia = live.some((v) => !v.media.length && v.platform !== "linkedin");
    const missingAccount = live.some((v) => !v.channelAccountId);
    const needs = missingAccount ? "account" : missingMedia ? (kind === "reel" ? "video" : realPhoto ? "photo" : "image") : null;
    const lead = live.find((v) => v.platform === "instagram") ?? live.find((v) => v.media.length) ?? live[0] ?? null;
    const assetId = lead?.media[0]?.assetId ?? live.find((v) => v.media.length)?.media[0]?.assetId ?? null;
    const hook = (lead?.hook || lead?.body.split("\n")[0] || "").trim() || null;
    return { status, needs, contentItemId: item.id, assetId, hook, platforms: live.map((v) => v.platform) };
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
    const item = get(post.existingContentItemId) ?? get(idFor.get(planMarker(plan.key, post.key)));
    const storyItem = get(idFor.get(planMarker(plan.key, `${post.key}-story`)));
    const brand = post.brand.createWith?.name ?? "LYNQ";
    entries.push({ key: post.key, kind: "post", brand, day: post.day, time: post.time, title: item?.title ?? post.title ?? post.key, pillar: post.pillar, highlight: null, ...summarize(item, "post", post.realPhotoOnly || (!get(post.existingContentItemId) && post.fallback?.realPhotoOnly)) });
    entries.push({ key: `${post.key}-story`, kind: "story", brand, day: post.day, time: post.time, title: storyItem?.title ?? `Story · ${item?.title ?? post.title ?? post.key}`, pillar: null, highlight: post.storyHighlight, ...summarize(storyItem, "story", post.realPhotoOnly) });
  }
  for (const reel of plan.reels) {
    const item = get(idFor.get(planMarker(plan.key, reel.key)));
    entries.push({ key: reel.key, kind: "reel", brand: reel.brand.createWith?.name ?? "LYNQ", day: reel.day, time: reel.time, title: reel.title, pillar: reel.series, highlight: null, ...summarize(item, "reel") });
  }
  for (const li of plan.linkedin) {
    const item = get(idFor.get(planMarker(plan.key, li.key)));
    entries.push({ key: li.key, kind: "linkedin", brand: li.brand.createWith?.name ?? "LYNQ", day: li.day, time: li.time, title: li.title, pillar: li.pillar, highlight: null, ...summarize(item, "post") });
  }
  entries.sort((a, b) => `${a.day} ${a.time} ${a.kind}`.localeCompare(`${b.day} ${b.time} ${b.kind}`));
  return { loaded: anyLoaded, entries };
}

// ---------------------------------------------------------------------------
// "Pip builds a game": CodeIt's AI reel series, ready to make.
//
// Five 10-second episodes of the mascot building one game, with a story poll
// between episodes so followers pick what happens next. Nothing here is in a
// plan yet: once video credits are set up, the series is added to a plan with
// `pipSeries(startDay)` and each episode is made from Studio → Make video.
// ---------------------------------------------------------------------------

const PIP = "Pip, CodeIt's mascot: a small round orange fluffy creature with big round eyes, tiny arms and a yellow hoodie. Flat 2D vector animation in the spirit of Toca Boca: bold rounded shapes, cream background, orange, navy and mint accents, soft bouncy motion, no 3D, no gradients, no words or letters, no logos, no people. Vertical 9:16, Pip centred and large.";

const PIP_TAGS = ["KidsWhoCode", "PythonForKids", "CodeIt"];
const PIP_BODY = (line: string) => `${line}\n\nPip is building a game, one episode at a time, and you pick what happens next in our story poll.\n\nYour kid can build one too: describe it, CodeIt makes the first version, they change it and see the code. Free to start, ages 5 to 18.\nLink in bio: codeitlearn.com`;

const PIP_EPISODES: Omit<PlanReel, "day" | "time" | "brand">[] = [
  {
    key: "pip-1", series: "PIP BUILDS A GAME", title: "CodeIt · Pip builds a game, episode 1: the idea",
    hook: "Pip has never made a game. Tonight that changes.",
    body: PIP_BODY("Episode 1: Pip has an idea."), hashtags: PIP_TAGS, callToAction: "Link in bio",
    script: "Pip opens a laptop, types one sentence, and a rocket pops out of the screen. Text on screen: 'Pip has never made a game.' then 'Tonight that changes.' End card: 'Ep 1 of 5. You pick what's next in our story.'",
    shots: [
      { timing: "0–3s", visual: "Pip sits on a cream floor with a navy laptop, typing fast", onScreenText: "Pip has never made a game." },
      { timing: "3–7s", visual: "A flat orange rocket pops out of the screen and hovers", onScreenText: "One sentence in. A rocket out." },
      { timing: "7–10s", visual: "Pip gasps, claps, looks straight at the camera", onScreenText: "Ep 1 of 5. You pick what's next." },
    ],
    aiVideo: { seconds: 10, prompt: `${PIP} Pip sits cross-legged on the floor with a small navy laptop and types quickly. A flat orange rocket pops out of the laptop screen and hovers in front of Pip, wobbling. Pip gasps, claps its tiny hands, then looks straight at the camera, delighted. Slow push in.` },
  },
  {
    key: "pip-2", series: "PIP BUILDS A GAME", title: "CodeIt · Pip builds a game, episode 2: it doesn't work",
    hook: "Every game breaks the first time. Watch Pip fix it.",
    body: PIP_BODY("Episode 2: it doesn't work. Yet."), hashtags: PIP_TAGS, callToAction: "Link in bio",
    script: "The rocket tries to take off and flops. Pip frowns, changes one thing, and the rocket flies a loop. Text: 'Every game breaks the first time.' then 'Change one line. Try again.'",
    shots: [
      { timing: "0–3s", visual: "The rocket wobbles up and flops onto the floor with a puff", onScreenText: "Every game breaks the first time." },
      { timing: "3–7s", visual: "Pip frowns, leans to the laptop, taps one key", onScreenText: "Change one line." },
      { timing: "7–10s", visual: "The rocket springs up and flies a loop; Pip cheers", onScreenText: "Try again. Ep 2 of 5." },
    ],
    aiVideo: { seconds: 10, prompt: `${PIP} A flat orange rocket tries to take off from the floor, wobbles and flops over with a small puff of cloud. Pip frowns, leans to a navy laptop and taps one key carefully. The rocket springs up and flies a happy loop around Pip, who throws both arms up and cheers.` },
  },
  {
    key: "pip-3", series: "PIP BUILDS A GAME", title: "CodeIt · Pip builds a game, episode 3: make it harder",
    hook: "You voted. Pip adds asteroids.",
    body: PIP_BODY("Episode 3: you voted, so now it gets harder."), hashtags: PIP_TAGS, callToAction: "Link in bio",
    script: "Made after the poll on episode 2. Asteroids won: grey rocks float in and the rocket dodges them while Pip steers. If stars won instead, use: 'Mint stars float in and the rocket zooms to collect them while Pip steers.' Text: 'You voted.' then 'Now it gets harder.'",
    shots: [
      { timing: "0–3s", visual: "Flat grey asteroids drift in from the sides", onScreenText: "You voted." },
      { timing: "3–7s", visual: "Pip steers with the arrow keys; the rocket dodges", onScreenText: "Now it gets harder." },
      { timing: "7–10s", visual: "Near miss; Pip bounces in its seat", onScreenText: "Ep 3 of 5." },
    ],
    aiVideo: { seconds: 10, prompt: `${PIP} Flat grey asteroids drift slowly in from both sides. Pip presses the arrow keys on a navy laptop, leaning left and right, and the flat orange rocket in front of it dodges each asteroid. One near miss; Pip bounces in its seat with excitement.` },
  },
  {
    key: "pip-4", series: "PIP BUILDS A GAME", title: "CodeIt · Pip builds a game, episode 4: the score",
    hook: "A game isn't a game until it keeps score.",
    body: PIP_BODY("Episode 4: score = score + 1."), hashtags: PIP_TAGS, callToAction: "Link in bio",
    script: "Numbers pop up each time the rocket gets past an asteroid, counting to 10. Pip dances. Text: 'A game needs a score.' then 'score = score + 1'.",
    shots: [
      { timing: "0–3s", visual: "The rocket passes an asteroid; a flat '1' pops up", onScreenText: "A game needs a score." },
      { timing: "3–7s", visual: "Numbers count up quickly, bouncing", onScreenText: "score = score + 1" },
      { timing: "7–10s", visual: "A big '10' lands; Pip dances", onScreenText: "Ep 4 of 5." },
    ],
    aiVideo: { seconds: 10, prompt: `${PIP} Each time the flat orange rocket flies past a grey asteroid, a chunky navy number pops up above it and bounces: 1, 2, 3, counting faster and faster. A big orange 10 lands with a bounce and Pip does a happy little dance beside the laptop.` },
  },
  {
    key: "pip-5", series: "PIP BUILDS A GAME", title: "CodeIt · Pip builds a game, episode 5: prove it",
    hook: "Pip built a game. Can Pip explain it?",
    body: PIP_BODY("Episode 5: building it is half. Understanding it is the other half."), hashtags: PIP_TAGS, callToAction: "Link in bio",
    script: "Pip turns the laptop to the camera. Three answer bubbles float up; Pip taps the right one and it turns orange with a tick. Confetti. Text: 'Building it is half.' then 'Understanding it is the other half.' End card: 'Your kid's turn: codeitlearn.com'.",
    shots: [
      { timing: "0–3s", visual: "Pip proudly turns the laptop toward the camera", onScreenText: "Building it is half." },
      { timing: "3–7s", visual: "Three round answer bubbles float up; Pip taps the middle one", onScreenText: "Understanding it is the other half." },
      { timing: "7–10s", visual: "It turns orange with a tick; orange and mint confetti", onScreenText: "Your kid's turn: codeitlearn.com" },
    ],
    aiVideo: { seconds: 10, prompt: `${PIP} Pip proudly turns a navy laptop toward the camera. Three round cream answer bubbles float up in a row; Pip thinks, then taps the middle one, which turns bright orange with a white tick. Flat orange and mint confetti falls and Pip throws its arms up.` },
  },
];

/** The polls between episodes: each one decides the next episode. */
const PIP_POLLS: Omit<PlanStory, "day" | "time" | "brand">[] = [
  { key: "pip-poll-1", highlight: "PIP", spec: { kind: "thisOrThat", brand: "codeit", eyebrow: "Pip needs you", headline: "What should we add?", a: { label: "Asteroids", icon: "rock" }, b: { label: "Stars", icon: "star" }, sticker: { type: "poll", question: "What should Pip add next?", options: ["Asteroids", "Stars"] } } },
  { key: "pip-quiz-2", highlight: "PIP", spec: { kind: "quiz", brand: "codeit", eyebrow: "Pip's code", headline: "What fixes the score?", code: ["score = 0", "# the rocket passes", "score = ???"], footnote: "Episode 4 shows the answer.", sticker: { type: "quiz", question: "What goes in ???", options: ["score + 1", "1", "score"], correct: 0 } } },
];

/**
 * The series laid out from `startDay` (YYYY-MM-DD): an episode every two days at
 * 16:30, the poll the day after episode 2, the code quiz the day after
 * episode 3. Spread into a plan's `reels` and `stories`.
 */
export function pipSeries(startDay: string): { reels: PlanReel[]; stories: PlanStory[] } {
  const day = (offset: number) => {
    const d = new Date(`${startDay}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  return {
    reels: PIP_EPISODES.map((e, i) => ({ ...e, brand: CODEIT, day: day(i * 2), time: "16:30" })),
    stories: [
      { ...PIP_POLLS[0]!, brand: CODEIT, day: day(3), time: "17:00" },
      { ...PIP_POLLS[1]!, brand: CODEIT, day: day(5), time: "17:00" },
    ],
  };
}
