import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingChannelAccounts, marketingContentItems } from "@/db/schema";
import { resolveAssetRow } from "./assets";
import { createBrand, listBrands } from "./brands";
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
  highlights: Record<string, string[]>;
  /** Entry keys removed from the plan: their loaded drafts (and stories) are archived on the next load. */
  retired?: string[];
}

const LYNQ: PlanBrandRef = { brandKey: "lynq", matchName: /^lynq\b/i };
const LYNQ_TAGS = ["TorontoSmallBusiness", "WebDesign", "GTA"];
const LYNQ_LOOK = "LYNQ's look, matching @lynqbuild: a cinematic photoreal night scene, near-black with one acid-lime light source, one hero object as the metaphor, shallow depth of field, film grain, the kind of frame a premium brand would run as a billboard. Headline in large thin white editorial type with one word in lime, placed in the clear part of the frame. The LYNQ mascot (a small black hooded robot with glowing lime eyes, as in the reference images) may appear as the brand character. No stock people, no faces, no clip-art icons, no gradients, nothing touching the top or bottom edge.";
const HONEST_CARD = "Honest design card: no website screens, no logos, no people or faces — it must never pass for the client's real site, premises or customers.";

const CODEIT_PROFILE: BrandProfileInput = {
  brandKey: "codeit",
  name: "CodeIt",
  positioning: "A free, browser-based coding studio for ages 5–18: kids describe a site, game or quiz, get a working first version, then edit it and see the code. Plus 31 beginner Python lessons and a Python playground that run with no AI involved.",
  audience: "Parents of kids aged 5–18 in Toronto and across Canada who want screen time that builds something; homeschool families; teachers looking for beginner Python.",
  voice: "Warm, playful, plain-spoken. Talks to parents, never down to kids. Short sentences, real examples, a little humour, no hype.",
  visualRules: "Match @codeitlearn: warm cream background, the orange fluffy clay-style mascot in a yellow hoodie, cozy desk scenes (laptop, sticky notes, sketchbook), chunky rounded navy and orange headline type, small doodles (stars, arrows, code brackets). Never show real children's faces.",
  productContext: "Free to start, no card required: 10 AI-assisted builds a month, 31 beginner Python lessons and the Python playground are free for everyone. Paid family plan: CA$12/month. Lead differentiator: comprehension is checked against the child's own project — questions are generated from their code, wrong options come from other real values in the same file, and only first-time-correct answers count.",
  claimsGuardrails: "Prices only in CAD (CA$12/month). Never claim Mustafa is a parent or homeschooler. No invented testimonials, user counts, results or partnerships. Example projects are labelled as examples.",
  callsToAction: ["Start free at codeitlearn.com", "Link in bio", "Save this for later"],
  approvedExamples: [],
  companyInfo: "CodeIt (codeitlearn.com), founded by Mustafa in Toronto. First workshop ran at Northcrest's Community Sundays.",
  brandStory: "Mustafa teaches kids to code and built the tool he wanted: start from the kid's own idea, build the first version with them, then make sure they understand every line.",
  writingStyle: "Lead with what the kid does, then why it matters to the parent. One idea per post. End with one clear next step.",
  visualIdentity: { colors: [{ name: "CodeIt orange", hex: "#F97316", role: "accent" }, { name: "Cream", hex: "#FFF6EC", role: "background" }, { name: "Navy", hex: "#1E2A44", role: "text" }], typography: { heading: "Baloo 2", body: "Nunito" }, logoAssetIds: [], notes: "The orange mascot appears in every visual." },
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

const CODEIT_TAGS = ["KidsWhoCode", "PythonForKids", "TorontoParents"];
const CODEIT_LOOK = "Match @codeitlearn exactly: warm cream background, the orange fluffy clay-style mascot with big eyes wearing a yellow hoodie, cozy desk scene with a laptop, sticky notes and a sketchbook, soft daylight, small doodles (stars, arrows, </> brackets). Chunky rounded navy-and-orange headline type only where described. Never show a real child.";

export const WEEK_PLANS: WeekPlan[] = [
  {
    key: "2026-10-12",
    label: "Oct 7 to Oct 21 — LYNQ + CodeIt, one post a day each",
    weekStart: "2026-10-07",
    retired: ["lynq-wed", "lynq-sat", "lynq-mon", "codeit-mon", "lynq-mon-r", "lynq-reel-tue"],
    highlights: {
      LYNQ: ["START HERE", "WORK", "RESULTS", "PRICING", "BEHIND"],
      CodeIt: ["START HERE", "BUILDS", "LESSONS", "PRICING", "ABOUT"],
    },
    feed: [
      // ── LYNQ — grid rows read PROOF → TEACH → OFFER/FOUNDER. Series names repeat every week so people learn them.
      {
        key: "lynq-intro", brand: LYNQ, day: "2026-10-07", time: "12:15", pillar: "FOUNDER", storyHighlight: "START HERE",
        title: "LYNQ · WHO WE ARE — Let me introduce us properly", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "I'm Mustafa. This is what LYNQ actually does, and how we work.",
        body: "Let me introduce us properly.\n\nI'm Mustafa, and LYNQ is the studio I run out of Toronto.\n\nWe build websites and the systems behind them for local businesses. Property managers, restaurants, event companies, trades. The kind of business where the owner is also the receptionist, the bookkeeper, and the person answering messages at 11pm.\n\nHere's how we work. We don't sell packages. We look at your business, work out what the site actually has to do for you, and give you a written quote for that. Then we build it, launch it, and keep looking after it.\n\nFollow this page and you'll see the work, the small fixes that make a big difference, and what goes on behind the scenes.\n\nGot a site that isn't pulling its weight? DM \"AUDIT\" and I'll send you a free 5 minute review.",
        facebookBody: "Let me introduce us properly. I'm Mustafa, and LYNQ is the studio I run out of Toronto.\n\nWe build websites and the systems behind them for local businesses: property managers, restaurants, event companies, trades.\n\nWe don't sell packages. We look at your business, work out what the site has to do for you, and give you a written quote for that. Then we build it, launch it, and keep looking after it.\n\nWant a free 5 minute review of your site? Send us a message.",
        hashtags: ["Toronto", ...LYNQ_TAGS], callToAction: "DM AUDIT",
        creativeDirection: `A rain-wet Toronto side street at night, a giant acid-lime neon "LYNQ" wordmark glowing on a dark brick wall and reflected in the puddles, a streetcar's blurred light trail passing behind; the LYNQ mascot stands small in the foreground looking up at the sign, lime eyes glowing. Headline "Hi, we're LYNQ." large in thin white type in the dark sky above the sign, "Websites. Systems. Automation. For local businesses in the GTA." small in lime under it. No real people, no faces, no website screens. ${LYNQ_LOOK}`,
              },
      {
        key: "lynq-tue", brand: LYNQ, day: "2026-10-08", time: "07:30", pillar: "TEACH", storyHighlight: null,
        title: "LYNQ · FIX THIS — Your menu is a PDF", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Your menu is a PDF. That's costing you tables.",
        body: "FIX THIS: your menu is a PDF.\n\nOn a phone, a PDF menu opens tiny, loads slowly, and makes people pinch and zoom. Someone hungry at 6:40pm doesn't zoom. They go back and tap the next restaurant.\n\nThe fix takes an afternoon:\n1. A real menu page (text, not a file)\n2. A booking button at the top of every page\n3. Hours and phone number you can see without scrolling\n\nSave this for your next website update, or send it to the restaurant owner who needs it.",
        facebookBody: "FIX THIS: your menu is a PDF.\n\nOn a phone it opens tiny and slow. A hungry customer doesn't zoom. They book somewhere else.\n\nThe fix: a real menu page, a booking button at the top, and hours you can see without scrolling.\n\nKnow a restaurant owner who needs this? Share it with them.",
        hashtags: ["TorontoRestaurants", "RestaurantMarketing", "WebDesign"], callToAction: "Save this",
        creativeDirection: `A real paper restaurant menu folded down into a tiny unreadable square, sitting on a giant phone screen like a postage stamp; a lime magnifying glass hovers over it. "FIX THIS" small in lime, "Your menu is a PDF." large in white. ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-offer-2", brand: LYNQ, day: "2026-10-11", time: "12:15", pillar: "OFFER", storyHighlight: "PRICING",
        title: "LYNQ · WHAT YOU GET — A site that answers", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "A website that gets you customers has four parts. Most local sites have one.",
        body: "WHAT YOU GET with a LYNQ site:\n\n1. Built for phones first, with the booking or call button at the top of every page\n2. Your Google Business Profile set up properly, so people find you before they find your competitor\n3. A form that replies by text and email in under a minute, with your booking link inside\n4. We keep it running after launch. Hours change, photos change, we update it\n\nWhat you don't get: hourly billing or surprise invoices. You get a written quote for your business before anything starts.\n\nTrades, clinics and restaurants across the GTA.\n\nDM \"SITE\" and I'll tell you what it would take for yours.",
        facebookBody: "A LYNQ site comes with four things:\n\n1. Phone first, booking or call button at the top of every page\n2. Google Business Profile set up properly\n3. A form that replies by text and email in under a minute\n4. We keep it running after launch\n\nNo hourly billing, no surprise invoices. A written quote for your business before anything starts. Message us to see what yours would take.",
        hashtags: LYNQ_TAGS, callToAction: "DM SITE",
        creativeDirection: `Four objects floating in a row above still black water at night, each lit by its own lime spotlight and mirrored in the water: a brass telephone handset, a map pin, a speech bubble cut from frosted glass, a chrome wrench. Headline "What you get." large in white above them, the four words "Phone first · Found on Google · Replies in 60s · Kept running" small in lime below. No prices, no dollar signs. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-thu", brand: LYNQ, day: "2026-10-15", time: "12:15", pillar: "PROOF", storyHighlight: "WORK",
        title: "LYNQ · PROOF 02 — Nasma", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "People open a restaurant's website for three things. We built Nasma's in Amman around them.",
        body: "People open a restaurant's website for three things: the menu, the hours, and a way to book.\n\nEverything else is decoration.\n\nFor Nasma, a restaurant in Amman, we started with those three, then made the whole thing look as good as the food.\n\nWe build in Toronto and Amman. Own a restaurant in either city? DM \"AUDIT\" for a free 5 minute review of your site.",
        facebookBody: "Diners open a restaurant's website for three things: the menu, the hours, and a way to book. For Nasma in Amman we started there, then made it look as good as the food.\n\nWant a free 5 minute review of your restaurant's site? Send us a message.",
        hashtags: ["Amman", "RestaurantMarketing", "WebDesign"], callToAction: "DM AUDIT",
        creativeDirection: `A long dark restaurant table after closing, one chair pulled out, a single lime spotlight from above landing on a brass reservation bell at the far end, its long shadow running down the table; a blank folded menu card and a small brass clock sit in the half-light beside it. Headline "Menu. Hours. Book." large in white, "PROOF 02 · Nasma" small in lime. ${HONEST_CARD} ${LYNQ_LOOK}`,
              },
      {
        key: "lynq-fri", brand: LYNQ, day: "2026-10-13", time: "12:15", pillar: "TEACH", storyHighlight: null,
        title: "LYNQ · FIX THIS — 5 empty fields on your Google profile", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Before anyone sees your website, they see this. Most owners leave half of it empty.",
        body: "FIX THIS: your Google Business Profile.\n\nBefore anyone sees your website, they see this. And most local businesses leave half of it empty:\n\n1. Business description\n2. Services (with prices if you can)\n3. Hours, including holidays\n4. Photos of the real place and real work\n5. A booking or website link\n\nIt's free, it takes an hour, and it's often the first impression you make.\n\nSave this and do it this weekend.",
        facebookBody: "Before anyone sees your website, they see your Google Business Profile. Five fields most owners leave empty: description, services, hours (holidays too), real photos, and a booking link.\n\nFree, one hour, and often your first impression. Worth doing this weekend.",
        hashtags: ["GoogleBusinessProfile", "LocalSEO", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Save this",
        creativeDirection: `An empty parking lot at night in front of a closed, dark storefront; a giant three-metre map pin stands in the middle of the lot glowing lime, lighting the wet asphalt, half of its face blank. Headline "Half of it is empty." large in white, "FIX THIS · your Google profile" small in lime. ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-founder-2", brand: LYNQ, day: "2026-10-14", time: "10:00", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · FOUNDER — The 9pm test", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "I fill in contact forms at 9pm to see who answers. Almost nobody does.",
        body: "I have a habit. When I look at a local business website, I fill in the contact form at 9pm and wait.\n\nMost of the time, nothing. A reply the next afternoon if I'm lucky. By then the person who needed a plumber, a table or an appointment has already booked with someone else.\n\nThat's why every LYNQ site replies on its own. Form in, text and email out, with the booking link, in under a minute. Then the owner follows up in the morning like normal.\n\nIt's also how we run LYNQ itself. Every post you see here was drafted, checked and approved from my phone before it went out. Nothing ships without a human saying yes.\n\nI'm Mustafa. Ask me anything, the comments are open.",
        facebookBody: "I fill in local business contact forms at 9pm to see who answers. Almost nobody does. By the next afternoon the customer has booked with someone else.\n\nSo every LYNQ site replies on its own, by text and email, in under a minute. The owner follows up in the morning.\n\nI'm Mustafa. Questions welcome in the comments.",
        hashtags: ["Founder", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comments open",
        creativeDirection: `A phone lying face-down on a dark desk at night, one sliver of lime notification light leaking out from under it across the wood; a desk clock in the background reads 9:04; the LYNQ mascot sits on the edge of the desk watching the phone. Headline "The business that replies first gets the job." large in thin white type, "Mustafa, LYNQ" small in lime. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-sun", brand: LYNQ, day: "2026-10-20", time: "12:15", pillar: "PROOF", storyHighlight: "WORK",
        title: "LYNQ · PROOF 03 — Finding Amy", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "An events business needs its website to do one thing: get the date request.",
        body: "An events business needs its website to do exactly one thing: get the date request.\n\nFinding Amy rents photo booths for events in Amman. Their customers want to see the booth at a real party, see what's included, and ask about their date, fast.\n\nSo the whole site walks that one path.\n\nWant your site built around the one thing that pays you? DM \"AUDIT\".",
        facebookBody: "An events business needs its website to do one thing: get the date request. We built Finding Amy's site in Amman around that one path. See the booth, see what's included, ask about your date.\n\nWant yours built around the one thing that pays you? Send us a message.",
        hashtags: ["Amman", "EventPlanning", "WebDesign"], callToAction: "DM AUDIT",
        creativeDirection: `A dark empty event hall; at the far end a photo-booth curtain glows acid lime from inside, the only light in the room; a single straight trail of gold confetti on the floor leads from the camera to the curtain. Headline "One path." large in white, "PROOF 03 · Finding Amy" small in lime. ${HONEST_CARD} ${LYNQ_LOOK}`,
              },
      {
        key: "lynq-mon2", brand: LYNQ, day: "2026-10-17", time: "12:15", pillar: "TEACH", storyHighlight: null,
        title: "LYNQ · FIX THIS — Slow replies lose the job", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "They filled in your form. They also filled in two others.",
        body: "FIX THIS: slow replies.\n\nSomeone fills in your contact form. They also filled in two others.\n\nThe business that answers first usually gets the job. At 9pm, that's rarely you.\n\nThe fix isn't working later. It's an instant reply: a text and an email that go out the moment the form is sent, with your booking link inside.\n\nThat's what our Lead Engine sets up.\n\nSend this to a business owner who's always \"getting back to people.\"",
        facebookBody: "Someone fills in your contact form, and two others. The business that answers first usually gets the job.\n\nThe fix isn't working later. It's an instant text and email the moment the form is sent, with your booking link inside. That's what our Lead Engine sets up.",
        hashtags: ["SmallBusinessTips", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Send to a business owner",
        creativeDirection: `Dozens of white paper airplanes crash-landed in a heap on a dark office floor at night, lit by a single window; one acid-lime paper airplane is caught mid-air flying back out toward the camera, trailing a thin light streak. Headline "They also filled in two others." large in white, "FIX THIS · slow replies" small in lime. ${LYNQ_LOOK}`,
      },

      // ── CodeItLearn — keeps the mascot world from the existing grid. Rows read BUILD → LEARN → HOW/FOUNDER/OFFER.
      {
        key: "codeit-mon-r", brand: CODEIT, day: "2026-10-07", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · One sentence in. One game out.", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your kid types one sentence. A minute later, they're playing it.",
        body: "\"A game where a cat catches falling pizza.\"\n\nThat one sentence is all it takes. CodeIt builds a working first version, and then the real part starts.\n\nYour kid makes it faster. Changes the colours. Adds a score. And every change shows them the code behind it.\n\nStart with their idea, end with their code.\n\nFree to start, no card needed. Ages 5 to 18.\nLink in bio: codeitlearn.com",
        facebookBody: "\"A game where a cat catches falling pizza.\"\n\nOne sentence, and CodeIt builds a working first version. Then your kid makes it faster, changes the colours, adds a score, and sees the code behind every change.\n\nFree to start, no card needed, ages 5 to 18: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `The mascot surfing a giant pizza slice through its own bright 2D game world that bursts out of the laptop screen; a sticky note on the laptop reads "a cat catches falling pizza". Headline "One sentence in. One game out." set in the middle of the frame. No logo, badge, wordmark or label anywhere; the top 15% and bottom 15% of the image are plain cream background with nothing in them. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-tue", brand: CODEIT, day: "2026-10-08", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Same 20 minutes.", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Same 20 minutes of screen time. Two very different kids at the end of it.",
        body: "Same 20 minutes. Same screen.\n\nOne kid watched someone else play a game.\nOne kid made one.\n\nScreen time isn't the problem. Passive screen time is. Three questions that tell you which kind it was:\n\n1. \"What did you make?\"\n2. \"What would you change about it?\"\n3. \"Can you show me how it works?\"\n\nIf they can answer number 3, they learned something.\n\nSave this for after dinner tonight.",
        facebookBody: "Same 20 minutes, same screen: one kid watched a game, one kid made one.\n\nThree questions that tell you which kind of screen time it was:\n1. What did you make?\n2. What would you change?\n3. Can you show me how it works?\n\nIf they can answer number 3, they learned something.",
        hashtags: ["ScreenTime", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        creativeDirection: `Mirror composition with one wall clock showing 20 minutes: left half grey and sleepy, the mascot slumped on a couch with a tablet; right half bright and warm, the same mascot building a rocket out of colourful code blocks. Headline "Same 20 minutes." ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-wed", brand: CODEIT, day: "2026-10-10", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · We prove it.", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Kids can code. We prove it. Here's how.",
        body: "Our bio says \"Kids can code. We prove it.\" This is the proof part.\n\nA lot of coding apps only check whether the code runs. That's easy to fake. Copy, paste, done.\n\nCodeIt checks whether your kid understands it. After a build, it asks questions made from their own project. The wrong answers come from other real values in that same file, so guessing doesn't work. Only answers that are right the first time count.\n\nCopying isn't learning. Explaining is.\n\nTry it free, link in bio.",
        facebookBody: "A lot of coding apps only check whether the code runs. CodeIt checks whether your kid understands it.\n\nAfter each build, it asks questions made from their own project. The wrong answers come from their own code too, so guessing doesn't work.\n\nKids can code. We prove it. Try it free: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        creativeDirection: `The mascot as a detective in a tiny trench coat with a magnifying glass, inspecting one giant highlighted line of code; a quiz card pinned like evidence on a corkboard with red string. Headline "We prove it." ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-thu", brand: CODEIT, day: "2026-10-14", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · Their obsession, their app", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Whatever your kid won't stop talking about can become an app they built.",
        body: "Dinosaurs. Football. Minecraft. Their favourite snack.\n\nWhatever your kid won't stop talking about can become a quiz app they built themselves.\n\nThey describe it. CodeIt builds the first version. Then they make it theirs with new questions, new colours, a harder level, and they see the code behind every change.\n\nWhat would your kid build first? (Example project shown.)\n\nAges 5 to 18. Free to start.",
        facebookBody: "Dinosaurs, football, Minecraft, whatever your kid won't stop talking about can become a quiz app they build themselves. They describe it, CodeIt builds the first version, and they make it theirs.\n\nWhat would your kid build first?",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `The mascot wearing a dinosaur-costume hood, proudly holding up a tablet with a bright dinosaur quiz app (big rounded orange answer buttons) while a toy T-rex cheers on the desk. Small label "example project". ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-fri", brand: CODEIT, day: "2026-10-20", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Lesson 1 of 31: make the computer say your name", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "The first line of Python almost every coder ever wrote. Try it with your kid tonight.",
        body: "Lesson 1 of 31: print()\n\nprint(\"Hello!\")\n\nThat's the first line of Python almost every coder ever wrote. It tells the computer: show this on the screen.\n\nTry it with your kid tonight. Change \"Hello!\" to their name. Press run. That's programming.\n\nAll 31 beginner lessons and the Python playground are free for everyone, with no AI involved, so the learning is theirs.\n\nSave this for the weekend.",
        facebookBody: "Lesson 1 of 31: print(\"Hello!\")\n\nThe first line of Python almost every coder wrote. Try it tonight. Change \"Hello!\" to your kid's name and press run.\n\nAll 31 beginner lessons and the Python playground are free at codeitlearn.com.",
        hashtags: ["LearnPython", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        creativeDirection: `The mascot shouting through a megaphone made of curly code brackets; the speech bubble print("Hello!") turns into the word Hello! in big bouncy letters. Headline "Lesson 1 of 31". ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-sat", brand: CODEIT, day: "2026-10-11", time: "10:00", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · Why I'm building CodeIt", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "I teach kids to code. Here's the moment that made me build CodeIt.",
        body: "I'm Mustafa. I teach kids to code in Toronto, and I ran CodeIt's first workshop at Northcrest's Community Sundays.\n\nWhat I see in class: kids light up when they build something that's theirs, and tune out when it's another worksheet.\n\nSo CodeIt starts with their idea, builds the first version with them, then makes sure they understand every line.\n\nParents and teachers: what would you want it to do next? Comments are open.",
        facebookBody: "I'm Mustafa. I teach kids to code in Toronto, and I ran CodeIt's first workshop at Northcrest's Community Sundays.\n\nKids light up when they build something that's theirs. So CodeIt starts with their idea and makes sure they understand every line.\n\nParents and teachers: what would you want it to do next?",
        hashtags: ["EdTech", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        creativeDirection: `Quote card: the mascot standing at a small whiteboard with a marker, having just written "Start with their idea. End with their code." in chunky navy type; "— Mustafa, founder" small in orange underneath. No real people. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-sun", brand: CODEIT, day: "2026-10-13", time: "19:30", pillar: "OFFER", storyHighlight: "PRICING",
        title: "CodeIt · Free means free", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Free to start. No card. Here's exactly what's included.",
        body: "\"Free\" usually means \"free until we ask for your card.\" Not with CodeIt.\n\nFree for everyone:\n✓ 31 beginner Python lessons\n✓ The Python playground\n✓ 10 AI assisted builds a month\nNo card needed.\n\nFamily plan: CA$12/month.\n\nBuilt for ages 5 to 18.\nStart free at codeitlearn.com (link in bio)",
        facebookBody: "Free for everyone: 31 beginner Python lessons, the Python playground, and 10 AI assisted builds a month. No card needed.\n\nFamily plan: CA$12/month. Ages 5 to 18.\n\nStart free: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        creativeDirection: `The mascot cheerfully pushing away a giant credit card wearing a "no card needed" sticker, while holding a golden ticket that says FREE; a small card in the corner reads "Family plan CA$12/month". Headline "Free means free." ${CODEIT_LOOK}`,
      },
      {
        key: "lynq-w2-arcubed", brand: LYNQ, day: "2026-10-10", time: "12:15", pillar: "PROOF", storyHighlight: "WORK",
        title: "LYNQ · PROOF 04 — Arcubed Label", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "A made-to-order shop has one job online: take the order without a DM.",
        body: "A made-to-order shop has one job online: take the order without a DM.\n\nArcubed Label makes crochet bags in Amman. Before the site, every order was a conversation: colour, size, deposit, delivery, all in messages, all by hand.\n\nSo we built the store end to end. Pick the bag, pick the colour, pay, done. The owner sees the order, not a chat.\n\nWe build in Toronto and Amman. Selling something you make by hand? DM \"AUDIT\" and I'll show you what your store is missing.",
        facebookBody: "A made-to-order shop has one job online: take the order without a DM.\n\nArcubed Label makes crochet bags in Amman. We built the store end to end: pick the bag, pick the colour, pay, done. The owner sees the order, not a chat.\n\nSelling something you make by hand? Send us a message for a free 5 minute review of your store.",
        hashtags: ["Amman", "Ecommerce", "WebDesign"], callToAction: "DM AUDIT",
        creativeDirection: `A single handmade crochet tote in a deep natural colour hanging from a brass hook against a dark wall, lit by one acid-lime spotlight from above; on the floor beneath it, a neat stack of plain kraft order slips with a lime wax seal. Headline "Take the order." large in white, "PROOF 04 · Arcubed Label" small in lime. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-w2-office", brand: LYNQ, day: "2026-10-18", time: "12:15", pillar: "OFFER", storyHighlight: "PRICING",
        title: "LYNQ · LYNQ OFFICE — Your business on one screen", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Six logins to run one small business. That's where the hours go.",
        body: "Count the logins you open to run your business. Email, invoices, the booking tool, the spreadsheet, two social apps.\n\nThat's where the hours go. Not into the work, into moving between the tools.\n\nLYNQ Office puts it on one screen: your customers, your projects, what needs you today, and automations that do the repeat work. Posts go out after you approve them from your phone. Leads get a reply before you've seen them.\n\nIt's built per business, so there's no price list. We look at what you run, then quote it in writing.\n\nDM \"OFFICE\" and I'll walk you through it.",
        facebookBody: "Count the logins you open to run your business. That's where the hours go, into moving between tools.\n\nLYNQ Office puts it on one screen: customers, projects, what needs you today, and automations that do the repeat work. Built per business, quoted in writing.\n\nMessage us and we'll walk you through it.",
        hashtags: ["BusinessAutomation", ...LYNQ_TAGS.slice(0, 2)], callToAction: "DM OFFICE",
        creativeDirection: `A dark control room at night: six old monitors stacked along a wall are switched off and dusty, and in front of them one sleek screen glows acid lime on a clean black desk with the LYNQ mascot sitting beside it. No readable interface, just light. Headline "One screen." large in white, "LYNQ Office" small in lime. ${HONEST_CARD} ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-w2-twocities", brand: LYNQ, day: "2026-10-21", time: "10:00", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · FOUNDER — Toronto and Amman", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "We build in two cities. Here's why that's good for you.",
        body: "LYNQ works out of Toronto and Amman.\n\nIt started because that's where our people are. It stayed because it works: a Toronto client gets the design conversation in their afternoon and wakes up to the build already moved on.\n\nThe standards don't change with the city. A site has to be found, has to answer, and has to get the booking or the order. Kingsbridge in Toronto. Nasma, Finding Amy and Arcubed in Amman. Same rules.\n\nI'm Mustafa. If you run a business in either city and your site isn't doing one of those three things, DM \"AUDIT\".",
        facebookBody: "LYNQ works out of Toronto and Amman. It started because that's where our people are. It stayed because it works.\n\nThe standards don't change with the city: a site has to be found, has to answer, and has to get the booking or the order.\n\nI'm Mustafa. Run a business in either city? Message us for a free review of your site.",
        hashtags: ["Toronto", "Amman", "WebDesign"], callToAction: "DM AUDIT",
        creativeDirection: `Night panorama split down the middle by one thin acid-lime line: on the left the CN Tower and Toronto skyline over dark water, on the right the stone hills and lit stairways of Amman, both under the same deep black sky, the lime line arcing across like a signal between them. Headline "Toronto. Amman." large in white, "Same rules." small in lime. No real people, no website screens. ${LYNQ_LOOK}`,
      },
      {
        key: "codeit-w2-askteacher", brand: CODEIT, day: "2026-10-15", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Ask the teacher: does my kid still need coding if AI writes it?", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "\"Do kids still need to learn coding if AI can write it?\" I teach this. Here's my honest answer.",
        body: "ASK THE TEACHER: \"Do kids still need to learn coding if AI can write it?\"\n\nI teach kids to code, so I get this one a lot. Honest answer: yes, but a different version of it.\n\nWhen AI writes the first draft, the skill moves to:\n1. Saying clearly what you want\n2. Reading what came back\n3. Spotting the line that's wrong\n\nThat's exactly what a kid does in CodeIt. Describe the game, get a version, change it, see the code, answer questions about it.\n\nGot a question for the teacher? Put it in the comments and I'll answer it in a post.",
        facebookBody: "\"Do kids still need to learn coding if AI can write it?\" I teach kids to code. Honest answer: yes, a different version of it. Saying clearly what you want, reading what came back, spotting the line that's wrong.\n\nGot a question for the teacher? Ask in the comments.",
        hashtags: ["AIForKids", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        creativeDirection: `The mascot in round teacher glasses sitting on a tall stool beside a small chalkboard that reads "Ask the teacher" in chunky navy chalk letters; a paper question card with a big "?" leans against the laptop. Headline "Still need coding?" ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-w2-question", brand: CODEIT, day: "2026-10-17", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · The question after the build", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The game works. Now one question: what makes the character jump?",
        body: "The game works. Now comes the part most apps skip.\n\nOne question, made from your kid's own code: \"What makes the character jump?\"\n\nThe answer options aren't random. They're other real values from their project, so a guess looks just as plausible as the right answer. Only a first time right answer counts.\n\nThat's how we know they understood it, not just ran it.\n\nKids can code. We prove it. Free to start, link in bio.",
        facebookBody: "The game works. Now one question, made from your kid's own code: what makes the character jump? The wrong answers come from their own project, so guessing doesn't work.\n\nThat's how we know they understood it. Free to start: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `A big friendly quiz card floating above the laptop like a speech bubble: "What makes the character jump?" with three rounded orange answer buttons, the mascot pointing at it with one finger on its chin, thinking; a tiny 2D platformer character mid-jump on the laptop screen. Headline "Prove it." ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-w2-sunday", brand: CODEIT, day: "2026-10-18", time: "10:00", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · What a room full of kids taught me", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The first CodeIt workshop taught me more than any plan did.",
        body: "The first CodeIt workshop was at Northcrest's Community Sundays. A room, some laptops, kids who'd never written a line of code.\n\nWhat I learned in two hours:\n\nNobody wanted the example project. Every kid wanted their own thing: a cat game, a quiz about their brother, a page for their lemonade stand.\n\nSo that's what CodeIt became. It starts with the kid's idea, not ours.\n\nI'm Mustafa. If you run a community program or a school club in the GTA and want a session, message me. The tool is free, and so is the first session.",
        facebookBody: "The first CodeIt workshop was at Northcrest's Community Sundays. What I learned: nobody wanted the example project. Every kid wanted their own thing.\n\nSo that's what CodeIt became. It starts with the kid's idea, not ours.\n\nRun a community program or school club in the GTA? Message me.",
        hashtags: ["TorontoKids", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        creativeDirection: `A cozy community-room scene with no real people: a row of small desks with laptops, each screen showing a different tiny kid-made project (a cat, a quiz, a lemonade stand page), the mascot at the front holding a marker beside a flip chart that reads "Your idea first". No real children, no faces. ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-w2-challenge", brand: CODEIT, day: "2026-10-21", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · October challenge: a game about your favourite snack", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "October challenge: build a game about your favourite snack. Free to enter, free to build.",
        body: "OCTOBER CHALLENGE: build a game about your favourite snack.\n\nPizza that falls from the sky. A samosa that has to dodge the fork. Popcorn you catch in a bucket. Any snack, any idea.\n\nHow it works:\n1. Your kid describes the game in one sentence on codeitlearn.com\n2. CodeIt builds the first version\n3. They change one thing and make it theirs\n\nSend us the game (no faces needed, just the screen) and we'll share our favourites with first name and age, with your permission.\n\nFree to enter, free to build. Ages 5 to 18.",
        facebookBody: "OCTOBER CHALLENGE: build a game about your favourite snack. Your kid describes it in one sentence on codeitlearn.com, CodeIt builds the first version, they make it theirs.\n\nSend us the game (just the screen, no faces) and we'll share our favourites with your permission. Free to enter, free to build.",
        hashtags: ["KidsChallenge", ...CODEIT_TAGS.slice(0, 2)], callToAction: "Start free at codeitlearn.com",
        creativeDirection: `The mascot holding a giant slice of pizza like a trophy under a hand-painted paper banner reading "OCTOBER CHALLENGE", surrounded by doodled snacks (popcorn, a samosa, a donut) each with tiny game controller arms; a laptop shows a bright snack-catching game. Headline "Your favourite snack. Now a game." ${CODEIT_LOOK}`,
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
        hook: "60 seconds on a GTA clinic's website. Watch where the bookings leak.",
        body: "FIX THIS: 60 seconds on a GTA clinic's website (name hidden).\n\nThe three things I check first on every clinic site:\n1. Can a patient on a phone find \"Book\" without scrolling?\n2. Are the hours and phone number on every page?\n3. Do the Google reviews show up on the site?\n\nWatch what this one gets wrong.\n\nWant me to do yours? DM \"AUDIT\". It's free.",
        facebookBody: "60 seconds on a GTA clinic's website: can a patient find \"Book\" without scrolling, are hours and phone on every page, do the reviews show up? Watch what this one gets wrong. Want a free review of yours? Send us a message.",
        hashtags: ["ClinicMarketing", ...LYNQ_TAGS], callToAction: "DM AUDIT",
        script: "Screen-record a real GTA clinic site in a phone-sized window, name and logo blurred. Walk the three checks in order and say what you actually find. Only claim what's on screen. 30–45 seconds.",
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
        key: "lynq-w2-reel-rebuilt", brand: LYNQ, day: "2026-10-12", time: "18:30", series: "REBUILT",
        title: "LYNQ Reel · REBUILT — a plumber's homepage in 10 minutes",
        hook: "I rebuilt a GTA plumber's homepage in 10 minutes. Here's what changed.",
        body: "REBUILT: a GTA plumber's homepage in 10 minutes (name hidden).\n\nWhat changed:\n1. \"Call now\" at the top, not under three paragraphs\n2. Service area and hours on the first screen\n3. The Google reviews they already had, finally on the site\n\nOld on the left, new on the right at the end.\n\nWant yours done? DM \"REBUILD\" and I'll send you the before and after of your own homepage.",
        facebookBody: "I rebuilt a GTA plumber's homepage in 10 minutes. Call now at the top, service area and hours on the first screen, their Google reviews on the site. Old and new side by side at the end. Want yours? Send us a message.",
        hashtags: ["TorontoPlumber", ...LYNQ_TAGS.slice(0, 2)], callToAction: "DM REBUILD",
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
        hook: "60 seconds on a Toronto restaurant's website, on a phone, hungry. Watch where I give up.",
        body: "FIX THIS: 60 seconds on a Toronto restaurant's website (name hidden), on a phone, hungry.\n\nI'm looking for three things: the menu, the hours, a way to book. Watch where I give up.\n\nThe fixes are small: a real menu page instead of a PDF, hours on the first screen, a book button that stays on screen.\n\nOwn a restaurant? DM \"AUDIT\" and I'll do yours. It's free.",
        facebookBody: "60 seconds on a Toronto restaurant's website, on a phone, hungry. Menu, hours, book. Watch where I give up. Own a restaurant? Send us a message for a free review of your site.",
        hashtags: ["TorontoRestaurants", "RestaurantMarketing", "WebDesign"], callToAction: "DM AUDIT",
        script: "Screen-record a real Toronto restaurant site in a phone frame, name blurred. Narrate as a hungry customer: find the menu, find the hours, try to book. Stop the clock where it breaks. 30 to 45 seconds. Only claim what's on screen.",
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
        title: "LinkedIn · Mustafa — Building in Toronto and Amman",
        body: "LYNQ builds websites and business systems out of two cities: Toronto and Amman.\n\nIt wasn't a strategy at first. It's where our people are. It became a strength quickly.\n\nA Toronto client has the design conversation in their afternoon, and by the time they wake up the build has moved on. An Amman client gets the same. The work doesn't sit still for a whole night.\n\nMore important: local business is local business in both places. A restaurant in Amman needs the same three things a restaurant in Scarborough needs. Menu, hours, a way to book, visible on a phone in ten seconds. A property manager in Toronto and a made to order shop in Amman both lose customers at the same spot: the moment the site makes someone wait or guess.\n\nSo the rules don't change with the city. Found on Google. Answers in under a minute. Gets the booking or the order. Everything else is taste.\n\nIf you run a business in either city and want an honest look at your site, send me a message. Five minutes, no pitch.",
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
/** Statuses whose image may be remade when the plan's art direction changes: anything not yet approved. */
const REMAKEABLE = new Set(["draft", "changes_requested", "ready_for_review"]);

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
    const at = planInstant(post.day, post.time);
    let item: SocialContentItem | null = null;

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
        const wantArt = p.creativeDirection ?? "";
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
          creativeDirection: p.creativeDirection ?? "",
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
      else if (ig && !ig.media.length) report.imagesQueued.push({ contentItemId: item.id, igVariantId: ig.id, copyTo: item.variants.filter((v) => v.id !== ig.id && !v.archivedAt && !v.media.length).map((v) => v.id) });
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
          const storyAt = planInstant(post.day, post.time, 10);
          const changes = { ...(sv.media.length ? {} : { media: igFeed.media.slice(0, 1).map((m) => ({ ...m, position: 0, role: "primary" as const })) }), ...(sv.scheduledFor?.getTime() === storyAt.getTime() ? {} : { scheduledFor: storyAt }) };
          if (Object.keys(changes).length) await updateVariant(db, { organizationId: input.organizationId, contentVariantId: sv.id, actorUserId: input.actorUserId, expectedRevision: sv.revision, changes });
        }
      } else {
        const story = await getVariantsOfItem(db, input, existingStoryId);
        const storyAt = planInstant(post.day, post.time, 10);
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
    const existingReelId = await findMarkedItem(db, input.organizationId, marker);
    if (existingReelId) {
      const existing = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingReelId, actorUserId: input.actorUserId });
      if (await refreshPlanCopy(db, input, existing, (v) => ({ hook: reel.hook, body: v.platform === "facebook" ? (reel.facebookBody ?? reel.body) : reel.body, hashtags: reel.hashtags, callToAction: reel.callToAction, scheduledFor: planInstant(reel.day, reel.time) }))) report.scheduled.push(`${existing.title}: updated`);
      continue;
    }
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
      await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { format: v.platform === "instagram" ? "reel" : "video", hook: reel.hook, body: v.platform === "facebook" ? (reel.facebookBody ?? reel.body) : reel.body, hashtags: reel.hashtags, callToAction: reel.callToAction, platformOptions, scheduledFor: at, ...(account ? { channelAccountId: account } : {}) } });
    }
    report.created.push(`${reel.title} · ${reel.day} ${reel.time}`);
    report.needsYou.push(`${reel.title}: film it from the script and upload the video before ${reel.day}.`);
  }

  // 4. LinkedIn: text posts for Mustafa's profile (drafts until LinkedIn is connected; copy them from Telegram or the Library meanwhile).
  for (const li of plan.linkedin) {
    const brandProfileId = brandIds.get(li.brand.brandKey);
    if (!brandProfileId) continue;
    const marker = planMarker(plan.key, li.key);
    const existingLiId = await findMarkedItem(db, input.organizationId, marker);
    if (existingLiId) {
      const existing = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: existingLiId, actorUserId: input.actorUserId });
      if (await refreshPlanCopy(db, input, existing, () => ({ hook: li.body.split("\n")[0] ?? "", body: li.body, hashtags: [], scheduledFor: planInstant(li.day, li.time) }))) report.scheduled.push(`${existing.title}: updated`);
      continue;
    }
    const at = planInstant(li.day, li.time);
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
      // An image that isn't 4:5 gets cropped by Instagram (top and bottom lost): clear it on every version so it is remade.
      if (ig.media.length && RESCHEDULABLE.has(ig.status) && (await isWrongShape(db, input.organizationId, ig.media[0]!.assetId))) {
        const storyId0 = idFor.get(planMarker(plan.key, `${post.key}-story`));
        const all = [...variants, ...(storyId0 ? await getVariantsOfItem(db, input, storyId0) : [])];
        for (const v of all) {
          if (v.archivedAt || !v.media.length || !RESCHEDULABLE.has(v.status)) continue;
          await updateVariant(db, { organizationId: input.organizationId, contentVariantId: v.id, actorUserId: input.actorUserId, expectedRevision: v.revision, changes: { media: [] } });
        }
        variants = await getVariantsOfItem(db, input, itemId);
      }
      const igNow = variants.find((v) => v.id === ig.id) ?? ig;
      if (!igNow.media.length) {
        if (!RESCHEDULABLE.has(igNow.status)) continue;
        try {
          await regenerateVariantPart(db, { organizationId: input.organizationId, contentVariantId: ig.id, actorUserId: input.actorUserId, part: "image" });
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
      const targets = [...variants.filter((v) => v.id !== ig.id && !v.archivedAt && v.platform !== "linkedin"), ...(storyId ? await getVariantsOfItem(db, input, storyId) : [])];
      for (const t of targets) {
        if (t.archivedAt || t.media.length || !RESCHEDULABLE.has(t.status)) continue;
        try {
          await updateVariant(db, { organizationId: input.organizationId, contentVariantId: t.id, actorUserId: input.actorUserId, expectedRevision: t.revision, changes: { media } });
          out.copied++;
        } catch (err) {
          console.error("[week-plan] image copy failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
        }
      }
    }
  }
  return out;
}


/** True when a feed image's stored dimensions are taller than 4:5 (Instagram would crop it). Unknown dimensions count as fine. */
async function isWrongShape(db: Db, organizationId: string, assetId: string): Promise<boolean> {
  try {
    const row = await resolveAssetRow(db, organizationId, assetId);
    if (!row.width || !row.height) return false;
    return row.width / row.height < 0.78;
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
