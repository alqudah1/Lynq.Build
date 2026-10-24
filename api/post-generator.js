/**
 * Post Generator — Full Production Pack (11 elements).
 * Generates hook, caption, recording plan, shot list, voiceover script,
 * image prompt, Canva layout, CapCut editing guide, and posting steps.
 * No paid media APIs required — graceful fallback to text prompts.
 *
 * POST { business, platform, timeStr, instruction }
 * Returns { ok, post, scheduledTime }
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const BIS_DEFS = {
  codeit: {
    name:         'CodeIt Learn',
    description:  'AI-powered platform that lets kids and beginners build real websites, games, quizzes, and apps instantly. Uses AI to scaffold and remix projects.',
    audience:     'Parents of kids 8–16, school teachers, homeschool families.',
    ctas:         'Try it free at codeitlearn.com | Start building for free | Show your kid\'s first project',
    voice:        'Encouraging, honest, relatable to parents. Founder energy.',
    safety:       'No verified student results → use "I tested this" or "CodeIt can build this". Use "concept" for mockups. No income or job claims.',
    brandColors:  '#1a1a2e, #7c3aed (purple), #e6c07a (amber gold)',
    imageStyle:   'warm, playful, kids/beginners building real projects, bright orange/mint/cream palette — NOT generic AI robot',
    contentFocus: 'AI builder, games, websites, quizzes, sharing, remixing, learning by doing, parent pride moments',
  },
  lynq: {
    name:         'Lynq.build',
    description:  'Modern web design agency building high-converting websites and AI systems for small businesses. Premium dark editorial aesthetic.',
    audience:     'Small business owners, restaurants, local service providers, entrepreneurs.',
    ctas:         'Get a free audit at lynq.build | Book a call | DM to get started',
    voice:        'Direct, confident, premium. Show the work. Let results speak.',
    safety:       'No unverified client results. Use "concept" for mockups. No specific ROI claims unless documented. NO purple.',
    brandColors:  '#0a0a0a (near black), #e6c07a (amber gold), #ffffff',
    imageStyle:   'modern premium dark aesthetic, editorial photography, clean backgrounds, NO purple, warm amber accents',
    contentFocus: 'websites, AI systems, small business automation, web design process, before/after, agency life',
  },
  insurance: {
    name:         'Insurance Advisor',
    description:  'Independent insurance advisor helping Canadians find the right life, health, and disability coverage. Educational and trustworthy.',
    audience:     'Canadians 25–55 considering life, health, disability, or critical illness insurance.',
    ctas:         'Book a free review | DM for a quote | Get a free consultation',
    voice:        'Educational, calm, trustworthy. Never salesy. Never fear-based.',
    safety:       'Educational only. No specific premium promises. No guarantees. No fear tactics. No misleading claims. Frame as "talk to an advisor."',
    brandColors:  '#1a1a2e (navy), #2563eb (blue), #ffffff',
    imageStyle:   'realistic, trustworthy, family/protection/business-professional, warm natural light, NO fear imagery',
    contentFocus: 'insurance education, common mistakes, policy comparisons, peace of mind, financial protection',
  },
};

const PLAT_SPECS = {
  instagram: { type: 'visual', tone: 'visual, punchy. Short sentences. Emoji OK.',             maxHashtags: 10, cta_style: 'Link in bio or DM us',           videoLen: '30–45s Reels',      canvaSize: '1080×1080 or 1080×1350' },
  facebook:  { type: 'text',   tone: 'friendly, conversational, community.',                    maxHashtags: 5,  cta_style: 'Comment below or message us',    videoLen: '1–3 min or Reel',   canvaSize: '1200×630' },
  linkedin:  { type: 'text',   tone: 'professional, insightful, thought-leadership.',           maxHashtags: 5,  cta_style: 'Follow for more. Comment below.', videoLen: '60–90s',            canvaSize: '1200×627' },
  tiktok:    { type: 'video',  tone: 'fast, entertaining, hook in first 3 seconds.',            maxHashtags: 8,  cta_style: 'Follow / Link in bio',           videoLen: '30–60s TikTok',     canvaSize: '1080×1920' },
  reels:     { type: 'video',  tone: 'visual, lifestyle, hook in first 3 seconds.',             maxHashtags: 10, cta_style: 'Save / Share / Link in bio',     videoLen: '30–60s Reels',      canvaSize: '1080×1920' },
  shorts:    { type: 'video',  tone: 'quick value, vertical, hook first, no fluff.',            maxHashtags: 5,  cta_style: 'Subscribe / Comment',            videoLen: '30–60s Shorts',     canvaSize: '1080×1920' },
};

function timeToISO(timeStr) {
  const now = new Date();
  if (!timeStr || timeStr === 'today')    return now.toISOString();
  if (timeStr === 'tomorrow') {
    const tom = new Date(now);
    tom.setDate(tom.getDate() + 1);
    tom.setHours(9, 0, 0, 0);
    return tom.toISOString();
  }
  try { const d = new Date(timeStr); if (!isNaN(d)) return d.toISOString(); } catch {}
  return now.toISOString();
}

async function generatePost({ business, platform, timeStr, instruction }) {
  const biz  = BIS_DEFS[business];
  const plat = PLAT_SPECS[platform];
  if (!biz || !plat) throw new Error(`Unknown business "${business}" or platform "${platform}"`);

  const prompt = `You are a content creator, recording director, and social media strategist for ${biz.name}.

BUSINESS: ${biz.description}
AUDIENCE: ${biz.audience}
VOICE: ${biz.voice}
CONTENT FOCUS: ${biz.contentFocus}
IMAGE STYLE: ${biz.imageStyle}
BRAND COLORS: ${biz.brandColors}
CTAs (pick one): ${biz.ctas}
SAFETY (non-negotiable): ${biz.safety}

PLATFORM: ${platform.toUpperCase()}
PLATFORM TONE: ${plat.tone}
VIDEO LENGTH: ${plat.videoLen}
MAX HASHTAGS: ${plat.maxHashtags}
CTA STYLE: ${plat.cta_style}
CANVA SIZE: ${plat.canvaSize}
${instruction ? `INSTRUCTION: ${instruction}` : ''}

Generate a COMPLETE production-ready post pack. Assume solo creator, phone camera, ring light. Be specific and immediately usable. No generic filler.

Return ONLY valid JSON — no markdown, no extra text:
{
  "idea": {
    "concept": "specific one-sentence content idea",
    "angle": "unique angle (e.g. 'I tested this', 'Most people get this wrong', 'Here is what happened when...')",
    "why": "why this resonates with the audience right now"
  },
  "recordingPlan": {
    "duration": "target video length",
    "setup": "camera setup (e.g. 'Phone on tripod, ring light from front, clean or branded background')",
    "hookShot": "exact opening shot — what viewer sees in first 3 seconds",
    "scenes": [
      { "num": 1, "action": "what creator says/does", "show": "what appears on screen", "camera": "angle or movement", "duration": "3-5s" }
    ]
  },
  "shotList": [
    { "num": 1, "shot": "shot name (e.g. talking head)", "action": "what happens", "camera": "angle/movement note", "duration": "time estimate" }
  ],
  "voiceover": "COMPLETE VERBATIM SCRIPT — every word to say, ready to read aloud. Include [pause] for pauses, [emphasis] for key words. Written for natural spoken delivery.",
  "hook": "exact opening line that stops the scroll",
  "caption": "complete post caption — no hashtags, clean copy, platform-appropriate length",
  "cta": "one clear call to action",
  "hashtags": "#tag1 #tag2 (space-separated, max ${plat.maxHashtags})",
  "storyText": "one punchy line for a Story or Reel cover",
  "imagePrompt": "DETAILED ChatGPT/Midjourney prompt — scene, lighting, mood, composition, colors (${biz.brandColors}), style (${biz.imageStyle}), size ${plat.canvaSize}, what to AVOID",
  "canva": {
    "template": "exact template type and size",
    "headline": "main headline text",
    "subtext": "supporting line",
    "colors": "specific colors to use",
    "font": "font style",
    "layout": "layout description (e.g. 'Bold centered text, dark bg, logo bottom right')"
  },
  "capcut": {
    "intro": "first 3-second intro cut description",
    "transitions": "transition style between scenes",
    "textOverlays": ["text overlay 1 at 0:03", "text overlay 2 at 0:12"],
    "musicMood": "music style and BPM (e.g. 'upbeat electronic 120bpm, builds at hook')",
    "effects": "specific CapCut effects to apply",
    "export": "export settings (resolution, fps, optimized for ${platform})"
  },
  "postingSteps": [
    "1. Open ${platform} app",
    "2. [next step]",
    "Final: Check analytics after 2 hours"
  ],
  "pillar": "education | inspiration | proof | entertainment | behind-the-scenes | tips",
  "recommendedTime": "best day + time (e.g. 'Tuesday 6:00 PM EST')"
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

  const { business, platform, timeStr, instruction } = req.body || {};
  if (!business || !platform) return res.status(400).json({ error: 'business and platform required' });
  try {
    const post = await generatePost({ business, platform, timeStr, instruction });
    return res.status(200).json({ ok: true, post, scheduledTime: timeToISO(timeStr) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports.generatePost = generatePost;
module.exports.timeToISO    = timeToISO;
module.exports.BIS_DEFS     = BIS_DEFS;
