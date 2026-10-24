module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { suggestedBiz, memory, previousScenario, forceNewAngle } = req.body || {};
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  function formatBiz(biz, data) {
    if (!data) return '';
    return [
      `${biz.toUpperCase()}`,
      `Description: ${data.description || '—'}`,
      `Mission: ${data.mission || '—'}`,
      `Audience: ${data.audience || '—'}`,
      `Pillars: ${(data.pillars || '').split('\n').filter(Boolean).join(' | ')}`,
      `Offers: ${(data.offers || '').split('\n').filter(Boolean).join(' | ')}`,
      `CTAs: ${(data.ctas || '').split('\n').filter(Boolean).join(' | ')}`,
      `Voice: ${data.voice || '—'}`,
      `Features: ${(data.features || '').split('\n').filter(Boolean).join(' | ')}`,
    ].join('\n');
  }

  const memBlock = memory
    ? ['codeit', 'lynq', 'insurance'].map(k => formatBiz(k, memory[k])).filter(Boolean).join('\n\n')
    : 'No business memory available.';

  const avoidLine = previousScenario
    ? `\nDo NOT repeat or closely resemble this previous scenario: "${previousScenario}"${forceNewAngle ? ' — choose a completely different angle and content type.' : ''}`
    : '';

  const prompt = `You are a content strategist and copywriter. Your job is to autonomously choose what content to create today and then generate a complete content pack for all platforms.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS MEMORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Suggested business for today: ${suggestedBiz || 'codeit'}${avoidLine}

Step 1 — DECIDE:
- Choose which business to focus on (use suggested business unless there's a compelling reason to differ)
- Choose one content pillar from that business's pillars
- Choose one of these honest angles (NO fake results, NO external proof):
  * "I tested this" — personal experiment or test
  * "I challenged [business/tool] to..." — challenge format
  * "I'm building this" — work-in-progress, behind the scenes
  * "Here's what AI can create when..." — demonstration/reveal
  * "Nobody talks about this, but..." — contrarian insight
  * "The honest truth about..." — transparent take
- Write a specific scenario (1-2 sentences) describing exactly what moment, insight, or demo to show on camera. Be concrete — reference actual features, actual situations, actual feelings from the business memory.

Step 2 — GENERATE: Create 6 platform-specific content pieces from that scenario + a recording plan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Every hook must be DIFFERENT in opening words and angle
- TikTok/Reels/Shorts: word-for-word spoken scripts. TikTok: 30-45s punchy. Reels: 30-45s warmer. Shorts: 15-30s tight.
- LinkedIn: professional insight post. Facebook: warmer community post.
- Captions: text posted WITH the video, not the script itself.
- Hashtags: TikTok/Reels 10-15, LinkedIn 5-8, Facebook 6-10, Shorts 8-12. Single space-separated string.
- CTAs must come EXACTLY from business memory above — do not invent new ones.
- Image/video prompts: describe realistic visuals, not generic "person on phone" shots.
- Stories: 5-6 frames. Bold text overlay (3-6 words) + visual description. Arc: Hook → build → CTA.
- No buzzwords, no corporate speak, write like a real human who runs this business.
- No fake student/user results. Use "I tested this", "I challenged X", "I'm building this", "Here's what AI creates".

Recording plan rules:
- Hook: the exact first sentence to say on camera (same as tiktok hook)
- Duration: estimated total recording time (e.g. "~45 seconds")
- Scenes: 4-6 scenes. Each scene = what to say/do + what to show on screen + camera/framing note.

Return ONLY valid JSON — no markdown, no code fences, no extra text:

{
  "chosenBusiness": "codeit|lynq|insurance",
  "chosenPillar": "The pillar chosen",
  "chosenAngle": "The angle chosen (e.g. I tested this)",
  "scenario": "1-2 sentence description of the specific moment or idea being shown",
  "tiktok": {
    "hook": "First spoken line (first 2 seconds)",
    "script": "Full word-for-word TikTok script",
    "caption": "TikTok caption (not the script)",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "Exact CTA from memory",
    "imagePrompt": "Thumbnail image description",
    "videoPrompt": "B-roll / visual direction"
  },
  "reels": {
    "hook": "Different opening — warmer angle",
    "script": "Full Reels script — different angle than TikTok",
    "caption": "Instagram caption",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "CTA from memory",
    "imagePrompt": "Cover image description",
    "videoPrompt": "Visual direction"
  },
  "shorts": {
    "hook": "Super tight hook — 3-5 words",
    "script": "Shortest script — 15-30s, no fluff",
    "caption": "YouTube caption",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "CTA from memory",
    "imagePrompt": "Thumbnail description",
    "videoPrompt": "Visual direction"
  },
  "linkedin": {
    "hook": "Professional opening — insight-first",
    "post": "Full LinkedIn post",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "CTA from memory",
    "imagePrompt": "LinkedIn image description"
  },
  "facebook": {
    "hook": "Warm community-style opening",
    "post": "Full Facebook post",
    "hashtags": "#tag1 #tag2 ...",
    "cta": "CTA from memory",
    "imagePrompt": "Facebook image description"
  },
  "stories": [
    { "text": "Bold overlay (3-6 words)", "visual": "What to show/shoot", "sticker": "emoji or empty string", "duration": "5s" },
    { "text": "...", "visual": "...", "sticker": "", "duration": "5s" },
    { "text": "...", "visual": "...", "sticker": "", "duration": "5s" },
    { "text": "...", "visual": "...", "sticker": "", "duration": "5s" },
    { "text": "...", "visual": "...", "sticker": "", "duration": "5s" },
    { "text": "CTA text from memory", "visual": "CTA frame — link in bio", "sticker": "👆", "duration": "7s" }
  ],
  "recordingPlan": {
    "hook": "Exact first sentence to say on camera",
    "duration": "~45 seconds",
    "scenes": [
      { "num": 1, "action": "What to say/do", "show": "What to show on screen", "cameraNote": "Framing or camera direction" },
      { "num": 2, "action": "...", "show": "...", "cameraNote": "..." },
      { "num": 3, "action": "...", "show": "...", "cameraNote": "..." },
      { "num": 4, "action": "...", "show": "...", "cameraNote": "..." }
    ]
  }
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
        max_tokens: 8000,
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
