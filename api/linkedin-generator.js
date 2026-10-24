/**
 * LinkedIn Generator — specialized professional content pack.
 * Generates: professional hook, short post, long founder version,
 * carousel idea, image prompt (brand-specific), posting checklist.
 * Manual mode only unless LinkedIn connection is active.
 *
 * POST { business, timeStr, instruction }
 * Returns { ok, post }
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const BIS_DEFS = {
  codeit: {
    name:         'CodeIt Learn',
    description:  'AI-powered platform that lets kids and beginners build real websites, games, quizzes, and apps instantly.',
    liAudience:   'Educators, parents, ed-tech founders, teachers, school principals, investors in education technology, homeschool communities.',
    voice:        'Founder journey, product honesty, optimistic builder energy. Share what you are learning.',
    ctas:         'Try it free at codeitlearn.com | Follow CodeIt for updates | DM to partner or collaborate',
    safety:       'No verified student results → "I tested this" / "CodeIt can build this". Use "concept" for mockups. No income claims.',
    imageStyle:   'warm creative workspace, kids/beginners building real projects, bright orange/mint/cream palette, founder working on laptop, NOT generic AI robot, educational and joyful atmosphere',
    brandColors:  '#1a1a2e, #7c3aed, #e6c07a (amber gold)',
    liConnection: 'CodeIt LinkedIn page — not yet connected. Manual post required.',
  },
  lynq: {
    name:         'Lynq.build',
    description:  'Modern web design agency building high-converting websites and AI systems for small businesses.',
    liAudience:   'Business owners, marketing managers, restaurant owners, service businesses, decision-makers at SMBs, digital agencies.',
    voice:        'Direct, confident, premium agency expertise. Show the work. Let results speak. Teach something useful.',
    ctas:         'Get a free audit at lynq.build | Book a call | DM to get started',
    safety:       'No unverified client results. Use "concept" for mockups. No specific ROI claims. NO purple.',
    imageStyle:   'modern premium dark aesthetic, editorial photography, clean backgrounds, NO purple, warm amber accents, business-focused professional look',
    brandColors:  '#0a0a0a (near black), #e6c07a (amber gold), #ffffff',
    liConnection: 'Lynq LinkedIn page — not yet connected. Manual post required.',
  },
  insurance: {
    name:         'Insurance Advisor',
    description:  'Independent insurance advisor helping Canadians find the right life, health, and disability coverage.',
    liAudience:   'Canadian professionals, HR managers, small business owners, families planning financially, accountants and financial planners.',
    voice:        'Educational, trustworthy, calm authority. Helpful without pressure. Teach, do not sell.',
    ctas:         'Book a free review | DM for a quote | Get a free consultation',
    safety:       'Educational only. No specific premium promises. No guarantees. No fear tactics. Frame as "talk to an advisor about your situation."',
    imageStyle:   'professional trustworthy Canadian setting, family/protection/business atmosphere, warm neutral tones, NO fear imagery, handshake or consultation aesthetic',
    brandColors:  '#1a1a2e (navy), #2563eb (blue), #ffffff',
    liConnection: 'Insurance LinkedIn profile — not yet connected. Manual post required.',
  },
};

async function generateLinkedInPost({ business, timeStr, instruction }) {
  const biz = BIS_DEFS[business];
  if (!biz) throw new Error(`Unknown business "${business}". Use: codeit, lynq, insurance`);

  const prompt = `You are a LinkedIn content strategist for ${biz.name}.

BUSINESS: ${biz.description}
LINKEDIN AUDIENCE: ${biz.liAudience}
VOICE: ${biz.voice}
CTAs (pick one that fits): ${biz.ctas}
IMAGE STYLE: ${biz.imageStyle}
BRAND COLORS: ${biz.brandColors}
SAFETY (non-negotiable): ${biz.safety}
${instruction ? `INSTRUCTION: ${instruction}` : 'Pick the strongest LinkedIn angle for this business today.'}

Generate a complete LinkedIn content pack. Professional, specific, and scroll-stopping on LinkedIn.
Write for real value — not corporate fluff. LinkedIn rewards depth and authenticity.
Short post: conversational, direct, one main insight.
Long post: founder/advisor voice, structured, shares hard-won knowledge.

Return ONLY valid JSON — no markdown fences, no extra text:
{
  "hook": "professional opening line — stops the scroll. Appears before 'see more' — must create curiosity or state a bold truth",
  "shortPost": "SHORT VERSION 150–200 words: conversational, one main insight, natural line breaks for readability. CTA at end. No hashtags here.",
  "longPost": "LONG FOUNDER VERSION 300–400 words: deeper story or insight, structured with line breaks, opens with hook, ends with strong CTA. Write like a real founder/advisor sharing hard-won knowledge. No hashtags here.",
  "carouselIdea": {
    "title": "carousel topic (e.g. '5 things small businesses get wrong about websites')",
    "slides": [
      { "num": 1, "headline": "cover slide headline", "body": "cover slide supporting text" },
      { "num": 2, "headline": "point 1 headline", "body": "1-2 sentence explanation" },
      { "num": 3, "headline": "point 2 headline", "body": "1-2 sentence explanation" },
      { "num": 4, "headline": "point 3 headline", "body": "1-2 sentence explanation" },
      { "num": 5, "headline": "final slide", "body": "wrap up + call to action", "cta": "specific CTA" }
    ]
  },
  "cta": "one clear call to action",
  "hashtags": "#tag1 #tag2 #tag3 #tag4 #tag5 (max 5, LinkedIn-optimized — professional, searchable)",
  "bestPostTime": "best day + time for LinkedIn (e.g. 'Tuesday 8:00 AM EST')",
  "copyReadyText": "ready-to-paste LinkedIn post: hook + two blank lines + shortPost body + blank line + CTA + blank line + hashtags. Formatted exactly as it should appear on LinkedIn.",
  "imagePrompt": "DETAILED ChatGPT/Midjourney image prompt. Include: scene description, composition (rule of thirds / centered), lighting style (natural / studio / ambient), mood, specific colors (${biz.brandColors}), visual style (${biz.imageStyle}), aspect ratio 1200x627 (LinkedIn horizontal), text overlay idea (e.g. '\"5 website mistakes\" in bold sans-serif, top left, white text on dark overlay'), what to AVOID",
  "postingChecklist": [
    "1. Open LinkedIn (desktop recommended for best formatting control)",
    "2. Tap 'Start a post'",
    "3. Paste from copyReadyText — check line breaks are preserved",
    "4. Add companion image or carousel PDF (10-slide max)",
    "5. Preview on mobile before posting",
    "6. Schedule or post at bestPostTime",
    "7. Engage with every comment in the first 30 minutes — algorithm boost",
    "8. Check analytics (impressions, reactions, comments) after 24 hours"
  ],
  "pillar": "thought-leadership | education | proof | inspiration | behind-the-scenes"
}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body:    JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Claude error');
  const raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { business, timeStr, instruction } = req.body || {};
  if (!business) return res.status(400).json({ error: 'business required (codeit, lynq, insurance)' });
  try {
    const post = await generateLinkedInPost({ business, timeStr, instruction });
    return res.status(200).json({ ok: true, post });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports.generateLinkedInPost = generateLinkedInPost;
module.exports.BIS_DEFS             = BIS_DEFS;
