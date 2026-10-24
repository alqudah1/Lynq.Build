module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { product, hook, script, platform, pillar, brandVisual } = req.body || {};

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const isVertical = ['tiktok', 'reels', 'shorts', 'stories'].includes(platform);
  const aspectRatio = isVertical ? '--ar 9:16' : platform === 'linkedin' ? '--ar 4:5' : '--ar 1:1';

  const prompt = `You are a creative director generating visual concepts for social media content.

BUSINESS: ${product}
PLATFORM: ${platform} (${aspectRatio})
PILLAR: ${pillar || ''}
HOOK: ${hook || ''}
SCRIPT EXCERPT: ${(script || '').slice(0, 200)}
${brandVisual ? `BRAND VISUAL: ${brandVisual}` : ''}

Generate exactly 3 visual concepts. Each serves the hook from a different creative angle:
- Concept 1: Real & Authentic — phone-quality, feels genuine and unfiltered
- Concept 2: Produced & Polished — professional studio quality, high-end brand feel
- Concept 3: Graphic & Designed — bold typography-driven or illustrated, stops scroll through design

Each imagePrompt must work directly in Midjourney or DALL-E. Be specific: style reference, lighting, composition, color palette, mood, technical specs.

Return ONLY valid JSON, no markdown:
{
  "concepts": [
    {
      "title": "concept name",
      "style": "Real & Authentic",
      "description": "one sentence on what this visual achieves",
      "imagePrompt": "full ready-to-use prompt with style keywords, lighting description, composition, color palette, mood, technical keywords, ${aspectRatio} --v 6",
      "artDirection": "practical shot direction if creating this yourself",
      "mood": "emotional feel in 3-4 words",
      "colors": "specific color palette",
      "textOverlay": "how and where to place hook text on this image"
    },
    {
      "title": "...",
      "style": "Produced & Polished",
      ...
    },
    {
      "title": "...",
      "style": "Graphic & Designed",
      ...
    }
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
        max_tokens: 2500,
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
