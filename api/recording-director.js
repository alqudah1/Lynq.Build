/**
 * Recording Director — full production plan for video content.
 * Returns: hook, duration, scenes, platform scripts, shot list,
 * voiceover script, image prompt, Canva layout, CapCut guide, posting steps.
 *
 * POST { update, business, length, context }
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { update, business, length, context } = req.body || {};
  if (!update?.trim()) return res.status(400).json({ error: 'update is required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  function formatBizContext(biz, data) {
    if (!data) return '';
    const lines = [
      `Business: ${biz.toUpperCase()}`,
      `Description: ${data.description || '—'}`,
      `Audience: ${data.audience || '—'}`,
      `Mission: ${data.mission || '—'}`,
      `Brand Voice: ${data.voice || '—'}`,
      `CTAs: ${(data.ctas || '').split('\n').filter(Boolean).join(' | ')}`,
    ];
    if (data.compliance) lines.push(`Compliance: ${data.compliance}`);
    return lines.join('\n');
  }

  const bizKeys      = business === 'all' ? ['codeit', 'lynq', 'insurance'] : [business];
  const ctxBlock     = context ? bizKeys.map(k => formatBizContext(k, context[k])).join('\n\n') : 'No business context.';
  const durationMap  = { '15': '12–17 seconds', '30': '25–35 seconds', '60': '50–65 seconds', '90': '75–95 seconds' };
  const targetDur    = durationMap[String(length)] || '25–35 seconds';
  const bizLabel     = business === 'all'
    ? 'all three (CodeIt, Lynq.build, Insurance) — pick most relevant'
    : bizKeys[0];

  const IMAGE_STYLES = {
    codeit:    'warm, playful, kids building real projects, orange/mint/cream palette, NOT generic AI robot',
    lynq:      'modern premium dark aesthetic, editorial, NO purple, amber gold accents',
    insurance: 'professional, trustworthy, family/protection setting, warm tones, NO fear imagery',
  };
  const BRAND_COLORS = {
    codeit:    '#1a1a2e, #7c3aed, #e6c07a',
    lynq:      '#0a0a0a, #e6c07a, #ffffff',
    insurance: '#1a1a2e, #2563eb, #ffffff',
  };
  const imgStyle = business === 'all' ? 'clean, branded, professional' : (IMAGE_STYLES[business] || 'clean, branded');
  const colors   = business === 'all' ? '#1a1a2e, #e6c07a, #ffffff' : (BRAND_COLORS[business] || '#1a1a2e, #ffffff');

  const prompt = `You are a video recording director AND content strategist. Tell Mustafa EXACTLY what to record and how to produce it.
He is a solo creator with a phone camera and ring light.

━━━ BUSINESS CONTEXT ━━━
${ctxBlock}

━━━ RECORDING BRIEF ━━━
Business: ${bizLabel}
What to show/happened: "${update}"
Target duration: ${targetDur}

━━━ RULES ━━━
- Hook = first 2 seconds. Spoken. Attention-grabbing. Stop the scroll.
- Scenes: 3–5 total. Specific camera instructions.
- Platform scripts = exact words to say, written for spoken delivery.
  TikTok: fast, punchy, hook first, CTA last.
  Instagram: slightly warmer, 1 beat slower.
  LinkedIn: confident narration, professional.
  YouTube Shorts: clearest narrative, slightly longer.
- Voiceover = complete verbatim master script.
- No buzzwords. Short sentences. Real human speech.
- Safety: CodeIt → no unverified results. Lynq → no fake client claims. Insurance → educational only, no premium promises.

Return ONLY valid JSON — no markdown, no fences:
{
  "hook": "exact opening line to say in first 2 seconds",
  "duration": "estimated spoken duration",
  "scenes": [
    { "num": 1, "action": "what to say/do", "show": "what camera sees", "cameraNote": "camera instruction" }
  ],
  "tiktok": "exact word-for-word TikTok/Reels script",
  "instagram": "exact word-for-word Instagram Reels script, slightly warmer",
  "linkedin": "exact word-for-word LinkedIn video script, professional narration",
  "youtube": "exact word-for-word YouTube Shorts script, clearest narrative",
  "shotList": [
    { "num": 1, "shot": "shot name (e.g. talking head, screen recording, b-roll)", "action": "what happens", "camera": "angle/movement", "duration": "time estimate" }
  ],
  "voiceover": "COMPLETE MASTER VOICEOVER SCRIPT — every word, verbatim, ready to record. Include [pause] for pauses, [emphasis] for key words.",
  "imagePrompt": "DETAILED ChatGPT/Midjourney prompt for thumbnail or cover. Include: scene, lighting, mood, composition, colors (${colors}), style (${imgStyle}), size 1080x1920 for TikTok/Reels or 1280x720 for YouTube, text overlay idea, what to AVOID",
  "canva": {
    "template": "exact Canva template type and size",
    "headline": "main text overlay",
    "subtext": "supporting line",
    "colors": "colors to use",
    "font": "font style (e.g. bold sans-serif)",
    "layout": "layout description"
  },
  "capcut": {
    "intro": "first 3-second intro cut",
    "transitions": "transition style",
    "textOverlays": ["overlay text — at 0:03", "overlay text — at 0:12"],
    "musicMood": "music style and BPM",
    "effects": "CapCut effects to use",
    "export": "export settings (1080x1920, 30fps, for TikTok/Reels/Shorts)"
  },
  "postingSteps": [
    "1. Record using the shot list above",
    "2. Import into CapCut — follow editing guide",
    "3. Export at 1080x1920, 30fps",
    "4. Post on TikTok: [specific steps]",
    "5. Cross-post to Instagram Reels",
    "6. Cross-post to YouTube Shorts",
    "Final: Engage with comments in first 30 minutes"
  ]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body:    JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
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
