// Shared queue generation logic — used by auto-queue.js and telegram/webhook.js

const POSTING_TIMES = {
  codeit:    { tiktok:'5:00 PM', reels:'6:00 PM', shorts:'4:30 PM', stories:'8:00 PM', linkedin:'9:30 AM', facebook:'7:30 PM' },
  lynq:      { tiktok:'5:00 PM', reels:'6:00 PM', shorts:'4:30 PM', stories:'6:00 PM', linkedin:'10:00 AM', facebook:'12:00 PM' },
  insurance: { tiktok:'6:00 PM', reels:'7:00 PM', shorts:'5:00 PM', stories:'8:30 PM', linkedin:'9:00 AM',  facebook:'8:00 PM' },
};

const PLATFORM_GROUPS = [
  ['tiktok', 'reels', 'shorts'],
  ['linkedin'],
  ['facebook', 'stories'],
];

function pickQueueBusinesses(recentPosts) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent  = recentPosts.filter(p => new Date(p.createdAt).getTime() > weekAgo);
  const total   = recent.length || 1;
  const counts  = { codeit: 0, lynq: 0, insurance: 0 };
  recent.forEach(p => { if (p.product in counts) counts[p.product]++; });
  const targets = { codeit: 0.70, lynq: 0.20, insurance: 0.10 };
  return Object.entries(targets)
    .map(([biz, target]) => ({ biz, deficit: target - counts[biz] / total }))
    .sort((a, b) => b.deficit - a.deficit)
    .map(x => x.biz);
}

function formatBizBlock(biz, data) {
  if (!data) return '';
  return [
    biz.toUpperCase(),
    `Mission: ${data.mission || data.description || '—'}`,
    `Audience: ${data.audience || '—'}`,
    `Pillars: ${(data.pillars || '').split('\n').filter(Boolean).join(' | ')}`,
    `CTAs: ${(data.ctas || '').split('\n').filter(Boolean).join(' | ')}`,
    `Voice: ${data.voice || '—'}`,
    data.compliance ? `Compliance: ${data.compliance}` : '',
  ].filter(Boolean).join('\n');
}

async function generateQueue(bisMemory, agentMemory, recentPosts) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  const biz = pickQueueBusinesses(recentPosts || []);

  const postsSpec = [0, 1, 2].map(i => {
    const product  = biz[i] || biz[0];
    const group    = PLATFORM_GROUPS[i];
    const platform = group[Math.floor(Math.random() * group.length)];
    const time     = POSTING_TIMES[product]?.[platform] || '5:00 PM';
    return `Post ${i + 1}: product="${product}", platform="${platform}", recommendedTime="${time}"`;
  }).join('\n');

  const memBlock = ['codeit', 'lynq', 'insurance']
    .map(k => formatBizBlock(k, (bisMemory || {})[k]))
    .filter(Boolean)
    .join('\n\n');

  const avoidBlock = agentMemory?.recentTopics?.length
    ? `\nAvoid these recently used angles:\n${agentMemory.recentTopics.slice(0, 8).join('\n')}`
    : '';

  const prompt = `You are a content strategist. Generate exactly 3 social media posts, each with 3 versions.

BUSINESS MEMORY:
${memBlock}

POST ASSIGNMENTS:
${postsSpec}
${avoidBlock}

Versions per post:
- A: Viral — punchy pattern-interrupt hook, moves fast, built to share
- B: Educational — teaches something specific, builds trust and authority
- C: Founder — personal story, authentic, behind-the-scenes, vulnerable

Rules:
- Scripts: max 90 words each, written for spoken delivery
- Each version must be a COMPLETELY DIFFERENT angle — not just reworded
- Hooks: each version must open with different first words
- textOverlay: 3-6 bold words shown on screen while recording
- recordingInstructions: exactly one sentence — what to show/do on camera
- CTAs: use EXACTLY from business memory, word for word
- Hashtags: 8-12 tags, single space-separated string
- No fake student/client results — say "I tested this" or "CodeIt can build this"
- Insurance: educational only, no guarantees, no specific premium promises

Return ONLY valid JSON, no markdown, no code fences:
{
  "posts": [
    {
      "product": "codeit|lynq|insurance",
      "platform": "tiktok|reels|shorts|stories|linkedin|facebook",
      "chosenPillar": "...",
      "recommendedTime": "5:00 PM",
      "versions": {
        "A": { "label": "Viral", "hook": "...", "script": "...", "caption": "...", "textOverlay": "...", "hashtags": "...", "cta": "...", "recordingInstructions": "...", "imagePrompt": "..." },
        "B": { "label": "Educational", "hook": "...", "script": "...", "caption": "...", "textOverlay": "...", "hashtags": "...", "cta": "...", "recordingInstructions": "...", "imagePrompt": "..." },
        "C": { "label": "Founder", "hook": "...", "script": "...", "caption": "...", "textOverlay": "...", "hashtags": "...", "cta": "...", "recordingInstructions": "...", "imagePrompt": "..." }
      }
    }
  ]
}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 10000,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Anthropic error');
  const raw    = data.content?.[0]?.text || '';
  const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

  const now = Date.now();
  parsed.posts = parsed.posts.map((post, i) => ({
    ...post,
    id:              `${now}-${i}`,
    status:          'draft',
    selectedVersion: null,
    approvalNotes:   '',
    rejectionReason: '',
    editInstruction: '',
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  }));

  return parsed;
}

module.exports = { generateQueue, POSTING_TIMES };
