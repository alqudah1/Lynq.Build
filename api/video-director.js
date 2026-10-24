module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { product, hook, script, platform, cta, textOverlay, pillar } = req.body || {};

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const isStory     = platform === 'stories';
  const isShortForm = ['tiktok', 'reels', 'shorts'].includes(platform);
  const duration    = isStory ? '15 seconds' : isShortForm ? '30-60 seconds' : platform === 'linkedin' ? '60-90 seconds' : '45-75 seconds';
  const sceneCount  = isStory ? 3 : isShortForm ? 5 : 6;

  const prompt = `You are a solo-creator video director for social media. Write a shot-by-shot production brief the creator can follow alone with a phone.

BUSINESS: ${product}
PLATFORM: ${platform}
TARGET DURATION: ${duration}
HOOK: ${hook || ''}
FULL SCRIPT: ${script || ''}
CTA: ${cta || ''}
TEXT OVERLAY: ${textOverlay || ''}
PILLAR: ${pillar || ''}

Write exactly ${sceneCount} scenes. Be specific and actionable — creator must be able to film without asking questions.

Return ONLY valid JSON, no markdown:
{
  "duration": "${duration}",
  "pacing": "pacing descriptor (e.g. Fast-cut every 2-3s, Steady confident hold)",
  "musicMood": "specific music style to search (e.g. Lo-fi hip hop, Upbeat electronic no lyrics, Motivational cinematic)",
  "setup": "camera position, angle, distance, and lighting to set up BEFORE filming",
  "scenes": [
    {
      "num": 1,
      "timing": "0-3s",
      "action": "exactly what to say and do on camera",
      "camera": "angle, framing, and any movement",
      "textOverlay": "text to display on screen during this scene (empty string if none)",
      "broll": "b-roll clip suggestion for editing in, or empty string",
      "cut": "cut trigger or transition note"
    }
  ],
  "brollList": ["specific b-roll clip 1", "clip 2", "clip 3", "clip 4"],
  "editingNotes": "key post-production instructions in 1-2 sentences",
  "captionStyle": "caption style description (e.g. Bold white pop-up words, Sentence captions bottom third)",
  "performanceTips": ["specific delivery tip 1", "tip 2", "tip 3"]
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
        max_tokens: 3000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Anthropic error');

    const raw    = data.content?.[0]?.text || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
