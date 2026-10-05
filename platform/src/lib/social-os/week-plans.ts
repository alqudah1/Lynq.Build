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
}

const LYNQ: PlanBrandRef = { brandKey: "lynq", matchName: /^lynq\b/i };
const LYNQ_TAGS = ["TorontoSmallBusiness", "WebDesign", "GTA"];
const LYNQ_LOOK = "LYNQ's look, matching @lynqbuild: near-black background, one acid-lime accent, large thin editorial type, generous margins, cinematic and calm. Real screens and objects, not illustrations. No stock people, no glossy 3D, no gradients, no clip-art icons.";
const PROOF_UPLOAD = "Upload real screenshots of the client's live site (phone + desktop) on the dark LYNQ card. Proof posts never use AI images.";

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
    label: "Week of Oct 12 — LYNQ + CodeIt",
    weekStart: "2026-10-12",
    highlights: {
      LYNQ: ["START HERE", "WORK", "RESULTS", "PRICING", "BEHIND"],
      CodeIt: ["START HERE", "BUILDS", "LESSONS", "PRICING", "ABOUT"],
    },
    feed: [
      // ── LYNQ — grid rows read PROOF → TEACH → OFFER/FOUNDER. Series names repeat every week so people learn them.
      {
        key: "lynq-mon", brand: LYNQ, day: "2026-10-12", time: "12:15", pillar: "PROOF", storyHighlight: "WORK",
        title: "LYNQ · PROOF 01 — Kingsbridge Group", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Two people visit a property manager's website. Only one of them is a customer yet.",
        body: "Two people visit a property manager's website.\n\nOne owns a building and is deciding who to trust with it. The other is a tenant with a leak at 11pm.\n\nKingsbridge Group's website has to win both — the trust of the owner and the patience of the tenant.\n\nWe designed it, we built it, and we still look after it.\n\nSwipe through it.\n\nRunning a local business with a site that isn't pulling its weight? DM \"AUDIT\" and I'll send you a free 5-minute review.",
        facebookBody: "Two people visit a property manager's website: an owner deciding who to trust, and a tenant with a leak at 11pm.\n\nKingsbridge Group's website has to win both. We designed it, built it, and still look after it.\n\nWant a free 5-minute review of your own site? Send us a message.",
        hashtags: ["PropertyManagement", ...LYNQ_TAGS], callToAction: "DM AUDIT",
        creativeDirection: `Carousel on the dark LYNQ card: slide 1 headline "One site. Two visitors." in lime; slides 2–4 real screenshots of the Kingsbridge site (homepage, an inner page, phone view). ${LYNQ_LOOK}`,
        realPhotoOnly: true, uploadNote: PROOF_UPLOAD,
      },
      {
        key: "lynq-tue", brand: LYNQ, day: "2026-10-13", time: "07:30", pillar: "TEACH", storyHighlight: null,
        title: "LYNQ · FIX THIS — Your menu is a PDF", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Your menu is a PDF. Here's what that's quietly costing you.",
        body: "FIX THIS ▸ Your menu is a PDF.\n\nOn a phone, a PDF menu opens tiny, loads slowly, and makes people pinch and zoom. Someone hungry at 6:40pm doesn't zoom. They go back and tap the next restaurant.\n\nThe fix takes an afternoon:\n→ A real menu page (text, not a file)\n→ A booking button at the top of every page\n→ Hours and phone number visible without scrolling\n\nSave this for your next website update — or send it to the restaurant owner who needs it.",
        facebookBody: "FIX THIS: your menu is a PDF.\n\nOn a phone it opens tiny and slow. A hungry customer doesn't zoom — they book somewhere else.\n\nThe fix: a real menu page, a booking button at the top, and hours you can see without scrolling.\n\nKnow a restaurant owner who needs this? Share it with them.",
        hashtags: ["TorontoRestaurants", "RestaurantMarketing", "WebDesign"], callToAction: "Save this",
        creativeDirection: `A real paper restaurant menu folded down into a tiny unreadable square, sitting on a giant phone screen like a postage stamp; a lime magnifying glass hovers over it. "FIX THIS" small in lime, "Your menu is a PDF." large in white. ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-wed", brand: LYNQ, day: "2026-10-14", time: "18:30", pillar: "OFFER", storyHighlight: "PRICING",
        title: "LYNQ · THE RECEIPT — What $2,500 buys", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Most agencies say \"it depends.\" Here's the receipt.",
        body: "THE RECEIPT ▸ Launch Site — $2,500. One time.\n\nWhat's on it:\n✓ A 5-page website, built for phones first\n✓ Your Google Business Profile set up properly\n✓ A booking or contact form that lands in your inbox\n✓ Live in 10 days\n\nWhat's not on it: hourly billing, surprise invoices, or \"it depends.\"\n\nBuilt for trades, clinics and restaurants with no website — or one from 2018.\n\nDM \"SITE\" and I'll tell you honestly if it's right for you.",
        facebookBody: "Launch Site — $2,500, one time.\n\n✓ 5-page website, phone-first\n✓ Google Business Profile set up properly\n✓ Booking or contact form to your inbox\n✓ Live in 10 days\n\nNo hourly billing, no surprises. For trades, clinics and restaurants with no website, or one from 2018. Message us to see if it fits.",
        hashtags: LYNQ_TAGS, callToAction: "DM SITE",
        creativeDirection: `A long thermal receipt curling out of a laptop screen onto a black desk under one hard side light. Line items "5 pages", "Google profile", "Booking form", "Live in 10 days"; "TOTAL $2,500" in lime; "THE RECEIPT" small at the top. ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-thu", brand: LYNQ, day: "2026-10-15", time: "12:15", pillar: "PROOF", storyHighlight: "WORK",
        title: "LYNQ · PROOF 02 — Nasma", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "People open a restaurant's website for three things. We built Nasma's around them.",
        body: "People open a restaurant's website for three things: the menu, the hours, and a way to book.\n\nEverything else is decoration.\n\nFor Nasma we started there — then made it look as good as the food.\n\nSwipe for the phone view.\n\nOwn a restaurant in the GTA? DM \"AUDIT\" for a free 5-minute review of your site.",
        facebookBody: "Diners open a restaurant's website for three things: the menu, the hours, and a way to book. For Nasma we started there — then made it look as good as the food.\n\nWant a free 5-minute review of your restaurant's site? Send us a message.",
        hashtags: ["TorontoRestaurants", ...LYNQ_TAGS], callToAction: "DM AUDIT",
        creativeDirection: `Carousel on the dark LYNQ card: slide 1 "Menu. Hours. Book." in white with lime dots; slides 2–3 real screenshots of Nasma's site on a phone. ${LYNQ_LOOK}`,
        realPhotoOnly: true, uploadNote: PROOF_UPLOAD,
      },
      {
        key: "lynq-fri", brand: LYNQ, day: "2026-10-16", time: "12:15", pillar: "TEACH", storyHighlight: null,
        title: "LYNQ · FIX THIS — 5 empty fields on your Google profile", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Before anyone sees your website, they see this. Most owners leave half of it empty.",
        body: "FIX THIS ▸ Your Google Business Profile.\n\nBefore anyone sees your website, they see this. And most local businesses leave half of it empty:\n\n1. Business description\n2. Services (with prices if you can)\n3. Hours — including holidays\n4. Photos of the real place and real work\n5. A booking or website link\n\nIt's free, it takes an hour, and it's often the first impression you make.\n\nSave this and do it this weekend.",
        facebookBody: "Before anyone sees your website, they see your Google Business Profile. Five fields most owners leave empty: description, services, hours (holidays too), real photos, and a booking link.\n\nFree, one hour, and often your first impression. Worth doing this weekend.",
        hashtags: ["GoogleBusinessProfile", "LocalSEO", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Save this",
        creativeDirection: `A shopfront window at night with five empty lit picture frames hanging on the glass, each labelled in small lime type: description, services, hours, photos, booking. "FIX THIS" small in lime. ${LYNQ_LOOK}`,
      },
      {
        key: "lynq-sat", brand: LYNQ, day: "2026-10-17", time: "10:00", pillar: "FOUNDER", storyHighlight: "BEHIND",
        title: "LYNQ · FOUNDER — Why I stopped saying \"it depends\"", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "The worst answer to \"how much is a website?\" is the one most agencies give.",
        body: "\"How much is a website?\"\n\n\"It depends\" is the most honest-sounding dishonest answer in my industry. It means: we'll find out how much you're willing to pay.\n\nSo LYNQ sells fixed packages with fixed prices. You know what you get, what it costs and when it's live — before we start.\n\nThis week I also changed how we post: every post is drafted, sent to my phone, and only goes out when I approve it. Same rule as client work. Nothing ships without a human saying yes.\n\nI'm Mustafa. Ask me anything — comments are open.",
        facebookBody: "\"How much is a website?\" — \"It depends\" usually means \"we'll see what you'll pay.\"\n\nSo LYNQ sells fixed packages at fixed prices: you know what you get, what it costs and when it's live before we start.\n\nI'm Mustafa. Questions welcome in the comments.",
        hashtags: ["Founder", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Comments open",
        creativeDirection: "Real phone photo only: you at your desk, laptop open, natural light, no graphics.",
        realPhotoOnly: true, uploadNote: "Upload a real phone photo of you — founder posts don't use AI images.",
      },
      {
        key: "lynq-sun", brand: LYNQ, day: "2026-10-18", time: "12:15", pillar: "PROOF", storyHighlight: "WORK",
        title: "LYNQ · PROOF 03 — Finding Amy", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "An events business needs its website to do one thing: get the date request.",
        body: "An events business needs its website to do exactly one thing: get the date request.\n\nFinding Amy runs a photo booth for events. Their customers want to see the booth at a real party, see what's included, and ask about their date — fast.\n\nSo the whole site walks that one path.\n\nSwipe through it.\n\nWant your site built around the one thing that pays you? DM \"AUDIT\".",
        facebookBody: "An events business needs its website to do one thing: get the date request. We built Finding Amy's site around that one path — see the booth, see what's included, ask about your date.\n\nWant yours built around the one thing that pays you? Send us a message.",
        hashtags: ["TorontoEvents", ...LYNQ_TAGS], callToAction: "DM AUDIT",
        creativeDirection: `Carousel on the dark LYNQ card: slide 1 "One path." in white, lime arrow; slides 2–4 real screenshots of the Finding Amy site on a phone. ${LYNQ_LOOK}`,
        realPhotoOnly: true, uploadNote: PROOF_UPLOAD,
      },
      {
        key: "lynq-mon2", brand: LYNQ, day: "2026-10-19", time: "07:30", pillar: "TEACH", storyHighlight: null,
        title: "LYNQ · FIX THIS — Slow replies lose the job", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "They filled in your form. They also filled in two others.",
        body: "FIX THIS ▸ Slow replies.\n\nSomeone fills in your contact form. They also filled in two others.\n\nThe business that answers first usually gets the job — and at 9pm, that's rarely you.\n\nThe fix isn't working later. It's an instant reply: a text and an email that go out the moment the form is sent, with your booking link inside.\n\nThat's what our Lead Engine sets up.\n\nSend this to a business owner who's always \"getting back to people.\"",
        facebookBody: "Someone fills in your contact form — and two others. The business that answers first usually gets the job.\n\nThe fix isn't working later; it's an instant text and email the moment the form is sent, with your booking link inside. That's what our Lead Engine sets up.",
        hashtags: ["SmallBusinessTips", ...LYNQ_TAGS.slice(0, 2)], callToAction: "Send to a business owner",
        creativeDirection: `A pile of white paper airplanes (contact forms) crash-landed on an empty desk at night, a wall clock reading 9:04, and one lime paper airplane flying straight back out. "FIX THIS" small in lime. ${LYNQ_LOOK}`,
      },

      // ── CodeItLearn — keeps the mascot world from the existing grid. Rows read BUILD → LEARN → HOW/FOUNDER/OFFER.
      {
        key: "codeit-mon", brand: CODEIT, day: "2026-10-12", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · One sentence in. One game out.", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Your kid types one sentence. A minute later, they're playing it.",
        body: "\"A game where a cat catches falling pizza.\"\n\nThat one sentence is all it takes. CodeIt builds a working first version — and then the real part starts.\n\nYour kid makes it faster. Changes the colours. Adds a score. And every change shows them the code behind it.\n\nThat's the whole idea: start with their idea, end with their code.\n\nFree to start, no card needed. Ages 5–18.\nLink in bio → codeitlearn.com",
        facebookBody: "\"A game where a cat catches falling pizza.\"\n\nOne sentence, and CodeIt builds a working first version. Then your kid makes it faster, changes the colours, adds a score — and sees the code behind every change.\n\nFree to start, no card needed, ages 5–18: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `The mascot surfing a giant pizza slice through its own bright 2D game world that bursts out of the laptop screen; a sticky note on the laptop reads "a cat catches falling pizza". Headline "One sentence in. One game out." ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-tue", brand: CODEIT, day: "2026-10-13", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Same 20 minutes.", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Same 20 minutes of screen time. Two very different kids at the end of it.",
        body: "Same 20 minutes. Same screen.\n\nOne kid watched someone else play a game.\nOne kid made one.\n\nScreen time isn't the problem — passive screen time is. Three questions that tell you which kind it was:\n\n1. \"What did you make?\"\n2. \"What would you change about it?\"\n3. \"Can you show me how it works?\"\n\nIf they can answer number 3, they learned something.\n\nSave this for after dinner tonight.",
        facebookBody: "Same 20 minutes, same screen: one kid watched a game, one kid made one.\n\nThree questions that tell you which kind of screen time it was:\n1. What did you make?\n2. What would you change?\n3. Can you show me how it works?\n\nIf they can answer number 3, they learned something.",
        hashtags: ["ScreenTime", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        creativeDirection: `Mirror composition with one wall clock showing 20 minutes: left half grey and sleepy, the mascot slumped on a couch with a tablet; right half bright and warm, the same mascot building a rocket out of colourful code blocks. Headline "Same 20 minutes." ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-wed", brand: CODEIT, day: "2026-10-14", time: "19:30", pillar: "HOW IT WORKS", storyHighlight: "START HERE",
        title: "CodeIt · We prove it.", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "Kids can code. We prove it — here's how.",
        body: "Our bio says \"Kids can code. We prove it.\" Here's the proof part.\n\nA lot of coding apps only check whether the code runs. That's easy to fake — copy, paste, done.\n\nCodeIt checks whether your kid understands it. After a build, it asks questions generated from their own project. The wrong answers come from other real values in that same file, so guessing doesn't work. Only first-time-correct answers count.\n\nCopying isn't learning. Explaining is.\n\nTry it free → link in bio.",
        facebookBody: "A lot of coding apps only check whether the code runs. CodeIt checks whether your kid understands it.\n\nAfter each build, it asks questions made from their own project — the wrong answers come from their own code too, so guessing doesn't work.\n\nKids can code. We prove it. Try it free: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        creativeDirection: `The mascot as a detective in a tiny trench coat with a magnifying glass, inspecting one giant highlighted line of code; a quiz card pinned like evidence on a corkboard with red string. Headline "We prove it." ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-thu", brand: CODEIT, day: "2026-10-15", time: "19:30", pillar: "BUILD", storyHighlight: "BUILDS",
        title: "CodeIt · Their obsession, their app", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Whatever your kid won't stop talking about can become an app they built.",
        body: "Dinosaurs. Football. Minecraft. Their favourite snack.\n\nWhatever your kid won't stop talking about can become a quiz app they built themselves.\n\nThey describe it. CodeIt builds the first version. Then they make it theirs — new questions, new colours, a harder level — and see the code behind every change.\n\nWhat would your kid build first? (Example project shown.)\n\nAges 5–18. Free to start.",
        facebookBody: "Dinosaurs, football, Minecraft — whatever your kid won't stop talking about can become a quiz app they build themselves. They describe it, CodeIt builds the first version, and they make it theirs.\n\nWhat would your kid build first?",
        hashtags: CODEIT_TAGS, callToAction: "Link in bio",
        creativeDirection: `The mascot wearing a dinosaur-costume hood, proudly holding up a tablet with a bright dinosaur quiz app (big rounded orange answer buttons) while a toy T-rex cheers on the desk. Small label "example project". ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-fri", brand: CODEIT, day: "2026-10-16", time: "19:30", pillar: "LEARN", storyHighlight: "LESSONS",
        title: "CodeIt · Lesson 1 of 31: make the computer say your name", kind: "carousel", platforms: ["instagram", "facebook"],
        hook: "The first line of Python almost every coder ever wrote. Try it with your kid tonight.",
        body: "Lesson 1 of 31 ▸ print()\n\nprint(\"Hello!\")\n\nThat's the first line of Python almost every coder ever wrote. It tells the computer: show this on the screen.\n\nTry it with your kid tonight: change \"Hello!\" to their name. Press run. That's programming.\n\nAll 31 beginner lessons and the Python playground are free for everyone — no AI involved, so the learning is theirs.\n\nSave this for the weekend.",
        facebookBody: "Lesson 1 of 31: print(\"Hello!\")\n\nThe first line of Python almost every coder wrote. Try it tonight — change \"Hello!\" to your kid's name and press run.\n\nAll 31 beginner lessons and the Python playground are free at codeitlearn.com.",
        hashtags: ["LearnPython", ...CODEIT_TAGS.slice(1)], callToAction: "Save this",
        creativeDirection: `The mascot shouting through a megaphone made of curly code brackets; the speech bubble print("Hello!") turns into the word Hello! in big bouncy letters. Headline "Lesson 1 of 31". ${CODEIT_LOOK}`,
      },
      {
        key: "codeit-sat", brand: CODEIT, day: "2026-10-17", time: "10:00", pillar: "FOUNDER", storyHighlight: "ABOUT",
        title: "CodeIt · Why I'm building CodeIt", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "I teach kids to code. Here's the moment that made me build CodeIt.",
        body: "I'm Mustafa. I teach kids to code in Toronto, and I ran CodeIt's first workshop at Northcrest's Community Sundays.\n\nWhat I see in class: kids light up when they build something that's theirs — and tune out when it's another worksheet.\n\nSo CodeIt starts with their idea, builds the first version with them, then makes sure they understand every line.\n\nParents and teachers: what would you want it to do next? Comments are open.",
        facebookBody: "I'm Mustafa. I teach kids to code in Toronto, and I ran CodeIt's first workshop at Northcrest's Community Sundays.\n\nKids light up when they build something that's theirs — so CodeIt starts with their idea and makes sure they understand every line.\n\nParents and teachers: what would you want it to do next?",
        hashtags: ["EdTech", ...CODEIT_TAGS.slice(1)], callToAction: "Comments open",
        creativeDirection: "Real photo only: you teaching, the workshop room (no identifiable children), or your laptop with CodeIt open. Upload it in LYNQ — no AI image for founder posts.",
        realPhotoOnly: true, uploadNote: "Upload a real photo of you teaching or your laptop with CodeIt open — no identifiable children.",
      },
      {
        key: "codeit-sun", brand: CODEIT, day: "2026-10-18", time: "10:00", pillar: "OFFER", storyHighlight: "PRICING",
        title: "CodeIt · Free means free", kind: "image_post", platforms: ["instagram", "facebook"],
        hook: "Free to start. No card. Here's exactly what's included.",
        body: "\"Free\" usually means \"free until we ask for your card.\" Not here.\n\nFree for everyone:\n✓ 31 beginner Python lessons\n✓ The Python playground\n✓ 10 AI-assisted builds a month\nNo card needed.\n\nFamily plan: CA$12/month.\n\nBuilt for ages 5–18.\nStart free → codeitlearn.com (link in bio)",
        facebookBody: "Free for everyone: 31 beginner Python lessons, the Python playground, and 10 AI-assisted builds a month. No card needed.\n\nFamily plan: CA$12/month. Ages 5–18.\n\nStart free: codeitlearn.com",
        hashtags: CODEIT_TAGS, callToAction: "Start free at codeitlearn.com",
        creativeDirection: `The mascot cheerfully pushing away a giant credit card wearing a "no card needed" sticker, while holding a golden ticket that says FREE; a small card in the corner reads "Family plan CA$12/month". Headline "Free means free." ${CODEIT_LOOK}`,
      },
    ],
    reels: [
      {
        key: "lynq-reel-tue", brand: LYNQ, day: "2026-10-13", time: "18:30", series: "BUILD LOG",
        title: "LYNQ Reel · BUILD LOG — Day 1 of 10",
        hook: "I'm building a local business a website in 10 days. This is Day 1.",
        body: "BUILD LOG ▸ Day 1 of 10.\n\nDay 1 isn't design. It's one question: what does the person visiting this site actually want to do?\n\nBook. Call. Get a quote. Everything we build after today serves that one answer.\n\nFollow to watch the next 9 days.\nWant yours built the same way? DM \"SITE\".",
        facebookBody: "BUILD LOG, Day 1 of 10: before any design, one question — what does the visitor actually want to do? Book, call, or get a quote. Everything after today serves that answer. Follow along for the next 9 days.",
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
        key: "lynq-reel-thu", brand: LYNQ, day: "2026-10-15", time: "18:30", series: "WATCH IT WORK",
        title: "LYNQ Reel · WATCH IT WORK — one tap, live",
        hook: "This post went live because I tapped one button on my phone.",
        body: "WATCH IT WORK ▸ This post went live because I tapped one button.\n\nThe system drafts it. My phone buzzes. I read the caption, check the image, tap ✅ — and it's on Instagram and Facebook.\n\nNo logging into four apps. No \"I'll post Thursday\" that turns into next month.\n\nIt's what our Growth System sets up for clients.\nDM \"GROW\" and I'll show you how it would work for you.",
        facebookBody: "This post went live because I tapped one button on my phone. The system drafts it, I check it, one tap — and it's on Instagram and Facebook. It's what our Growth System sets up for clients. Message us to see how it would work for you.",
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
        key: "lynq-reel-sat", brand: LYNQ, day: "2026-10-17", time: "12:15", series: "FIX THIS",
        title: "LYNQ Reel · FIX THIS — 60 seconds on a clinic's website",
        hook: "60 seconds on a GTA clinic's website. Watch where the bookings leak.",
        body: "FIX THIS ▸ 60 seconds on a GTA clinic's website (name hidden).\n\nThe three things I check first on every clinic site:\n1. Can a patient on a phone find \"Book\" without scrolling?\n2. Are the hours and phone number on every page?\n3. Do the Google reviews show up on the site?\n\nWatch what this one gets wrong.\n\nWant me to do yours? DM \"AUDIT\" — it's free.",
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
        key: "codeit-reel-tue", brand: CODEIT, day: "2026-10-13", time: "16:30", series: "IDEA → GAME",
        title: "CodeIt Reel · Idea → game in under a minute",
        hook: "Type a sentence. Get a game. Then see the code.",
        body: "One sentence → a playable game → the code behind it. Under a minute.\n\nWhat should we build next? Drop your kid's wildest game idea below and we'll build one of them on camera.\n\nCodeIt is free to start for ages 5–18. Link in bio.",
        facebookBody: "One sentence → a playable game → the code behind it, in under a minute. What should we build next? Tell us your kid's wildest game idea and we'll build one on camera.",
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
        key: "codeit-reel-thu", brand: CODEIT, day: "2026-10-15", time: "16:30", series: "PYTHON IN 20 SECONDS",
        title: "CodeIt Reel · Python in 20 seconds: print()",
        hook: "Your kid's first line of Python, in 20 seconds.",
        body: "Your kid's first line of Python, in 20 seconds.\n\nprint(\"Hello!\") → change it to their name → run it.\n\nSend this to a parent who keeps saying \"I don't know anything about coding.\" Neither did anyone, before line 1.\n\n31 free lessons at codeitlearn.com.",
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
        key: "codeit-reel-sat", brand: CODEIT, day: "2026-10-17", time: "11:00", series: "WE PROVE IT",
        title: "CodeIt Reel · The question after the build",
        hook: "Copying code is easy. Explaining it is learning.",
        body: "Copying code is easy. Explaining it is learning.\n\nAfter every build, CodeIt asks your kid about their own code — and the wrong answers come from their own project, so guessing doesn't work.\n\nKids can code. We prove it.\nTry it free → link in bio.",
        facebookBody: "Copying code is easy; explaining it is learning. After every build, CodeIt asks your kid about their own code — so guessing doesn't work. Kids can code. We prove it.",
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
        key: "lynq-li-tue", brand: LYNQ, day: "2026-10-13", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — I stopped saying \"it depends\"",
        body: "\"How much does a website cost?\"\n\nFor years the standard answer in my industry has been \"it depends.\" I used to say it too.\n\nHere's what it actually means to a local business owner: \"I'm going to find out how much you're willing to pay.\" It's the least trustworthy sentence a small business can hear at the moment it's deciding whether to trust you.\n\nSo at LYNQ we stopped.\n\nWe sell three fixed packages with the price on the page. The entry one is a 5-page site, a properly set-up Google Business Profile and a booking form, live in 10 days, for $2,500.\n\nWhy it's worth it:\n→ Calls get shorter. People arrive already knowing if it fits.\n→ The package is the scope, so there's less to argue about later.\n→ I spend my time building instead of writing custom quotes.\n\nFixed pricing isn't for everyone. Complex builds still need a conversation. But for most local businesses, the honest answer to \"how much?\" is a number.\n\nIf you run a service business: do you publish your prices? Why or why not?",
      },
      {
        key: "lynq-li-thu", brand: LYNQ, day: "2026-10-15", time: "08:15", pillar: "TEACH",
        title: "LinkedIn · Mustafa — The 3 checks I run on every local business site",
        body: "I review a lot of local business websites. Before design, before SEO, I check three things — and plenty of sites miss at least one.\n\n1. Can a customer on a phone find the main action without scrolling?\nBook, call, get a quote. If it's below three paragraphs of \"welcome to our family business,\" most visitors never see it.\n\n2. Are the hours and phone number on every page?\nNot just the contact page. People land on inner pages from Google.\n\n3. Does the site show proof that already exists?\nMost businesses have Google reviews. Very few show them on their own website, where the decision actually happens.\n\nNone of these need a redesign. All three can usually be fixed in an afternoon.\n\nIf you own or market a local business, run these three on your own site today. If you want a second pair of eyes, send me a message and I'll do a free 5-minute review.",
      },
      {
        key: "codeit-li-wed", brand: CODEIT, day: "2026-10-14", time: "08:15", pillar: "FOUNDER",
        title: "LinkedIn · Mustafa — What kids actually need to learn now",
        body: "I teach kids to code in Toronto. A question I hear from parents: \"Does my kid still need to learn coding if AI can write it?\"\n\nMy honest answer: they need it more — but a different version of it.\n\nWhen AI writes the first draft, the valuable skills move:\n→ Saying clearly what you want\n→ Reading code someone (or something) else wrote\n→ Predicting what it will do before you run it\n→ Finding the line that's wrong when the result isn't what you asked for\n\nThat's what I built CodeIt around. A kid describes a game, gets a working first version, then changes it and sees the code behind every change. After each build, CodeIt asks them questions generated from their own project — and the wrong answers come from that same file, so you can't guess your way through.\n\nTyping code was never the point. Understanding it is.\n\nTeachers and parents: how are you thinking about this?",
      },
      {
        key: "codeit-li-fri", brand: CODEIT, day: "2026-10-16", time: "08:15", pillar: "HOW IT WORKS",
        title: "LinkedIn · Mustafa — Why our quiz questions come from the kid's own code",
        body: "A lot of coding platforms for kids check one thing: does the code run?\n\nThe problem is that \"it runs\" is easy to fake. Copy, paste, green tick. The platform reports progress. The kid learned nothing.\n\nWhen I designed CodeIt's comprehension checks, I set three rules:\n\n1. Questions are generated from the child's own project file — not a generic question bank.\n2. The wrong answer options come from other real values in that same file, so every option looks plausible to someone who didn't read the code.\n3. Only first-time-correct answers count toward progress.\n\nThe result is slower-looking progress and much more honest progress. A parent can trust that \"done\" means understood.\n\nCodeIt is free to start for ages 5–18 — the 31 beginner Python lessons and the playground are free for everyone, with a CA$12/month family plan.\n\nIf you build learning products: how do you measure understanding rather than completion?",
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
    if (await findMarkedItem(db, input.organizationId, marker)) continue;
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
