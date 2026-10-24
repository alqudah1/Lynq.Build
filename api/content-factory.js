module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { update, business, memory } = req.body || {};
  if (!update?.trim()) return res.status(400).json({ error: 'update is required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  function formatBiz(biz, data) {
    if (!data) return '';
    return [
      `${biz.toUpperCase()}`,
      `Description: ${data.description || '—'}`,
      `Audience: ${data.audience || '—'}`,
      `Pillars: ${(data.pillars || '').split('\n').filter(Boolean).join(' | ')}`,
      `CTAs: ${(data.ctas || '').split('\n').filter(Boolean).join(' | ')}`,
      `Voice: ${data.voice || '—'}`,
    ].join('\n');
  }

  const bizKeys  = business === 'all' ? ['codeit','lynq','insurance'] : [business];
  const memBlock = memory
    ? bizKeys.map(k => formatBiz(k, memory[k])).join('\n\n')
    : 'No business memory available.';

  const bizLabel = business === 'all'
    ? 'all three businesses (CodeIt, Lynq.build, Mustafa Insurance) — blend or pick the best angle'
    : bizKeys[0];

  const prompt = `You are a content factory. One update → 6 complete content pieces, each fully adapted to its platform. Every hook must be DIFFERENT. Every script/post must be DIFFERENT in angle, not just reworded.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS MEMORY (use always)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TODAY'S UPDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Business: ${bizLabel}
Update: "${update}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Each hook must open differently — no two hooks can start the same way
- TikTok/Reels/Shorts scripts: word-for-word what to SAY on camera. Written for spoken delivery.
  TikTok: fast, punchy, hook in first 2 sec, 30–45s spoken
  Reels: slightly warmer, more human, 30–45s
  Shorts: tightest — 15–30s, get to the point immediately
- LinkedIn/Facebook: written text posts. LinkedIn = professional insight. Facebook = warmer community tone.
- Captions (video platforms): the text posted WITH the video. Not the script.
- Hashtags: TikTok/Reels 10-15 tags, LinkedIn 5-8, Facebook 6-10. As a single space-separated string.
- CTAs must use exact CTAs from business memory above — do not invent new ones
- Image prompt: describe a realistic thumbnail/cover photo — mood, lighting, composition, subject
- Video prompt: describe the visual direction for b-roll or editing — what to show on screen while talking
- Stories: 5–6 frames. Each frame = 3-6 words of bold text overlay + one-sentence visual description. Think: Story arc. Frame 1 = hook, Frame 6 = CTA.
- No buzzwords. No corporate language. Write like a real human.
- No fake results. If a metric is claimed, say "I tested this" not "users achieve X".

Return ONLY valid JSON — no markdown, no code fences, no extra text:

{
  "tiktok": {
    "hook": "First line spoken in the first 2 seconds",
    "script": "Full word-for-word script to record",
    "caption": "TikTok caption text (not the script)",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "End CTA from memory",
    "imagePrompt": "Thumbnail image description",
    "videoPrompt": "Visual/b-roll direction for the video"
  },
  "reels": {
    "hook": "Different opening hook — warmer angle",
    "script": "Full Reels script — different angle than TikTok",
    "caption": "Instagram caption",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "CTA from memory",
    "imagePrompt": "Cover image description",
    "videoPrompt": "Visual direction"
  },
  "shorts": {
    "hook": "Super tight hook — 3-5 words max",
    "script": "Shortest script — 15-30s, no fluff",
    "caption": "YouTube caption",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "CTA from memory",
    "imagePrompt": "Thumbnail description",
    "videoPrompt": "Visual direction"
  },
  "linkedin": {
    "hook": "Professional opening line — insight-first",
    "post": "Full LinkedIn post — professional but human",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "CTA from memory",
    "imagePrompt": "LinkedIn image description"
  },
  "facebook": {
    "hook": "Warm community-style opening line",
    "post": "Full Facebook post — warmer, more casual",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "CTA from memory",
    "imagePrompt": "Facebook image description"
  },
  "stories": [
    { "text": "Bold overlay text (3-6 words)", "visual": "What to show/shoot for this frame", "sticker": "emoji or empty string", "duration": "5s" },
    { "text": "...", "visual": "...", "sticker": "", "duration": "5s" },
    { "text": "...", "visual": "...", "sticker": "", "duration": "5s" },
    { "text": "...", "visual": "...", "sticker": "", "duration": "5s" },
    { "text": "...", "visual": "...", "sticker": "", "duration": "5s" },
    { "text": "CTA text from memory", "visual": "CTA frame — swipe up or link in bio", "sticker": "👆", "duration": "7s" }
  ]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 7000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Anthropic API error');

    const raw    = data.content?.[0]?.text || '';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
