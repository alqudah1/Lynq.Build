const { put, list } = require('@vercel/blob');

const BRAIN_PATH = 'lynq-tg/brand-brain.json';

async function loadBrain() {
  try {
    const { blobs } = await list({ prefix: 'lynq-tg/brand-brain' });
    if (!blobs.length) return {};
    const res = await fetch(blobs[0].downloadUrl);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function saveBrain(data) {
  return put(BRAIN_PATH, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      return res.status(200).json(await loadBrain());
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { business, bisData } = req.body || {};
  if (!business) return res.status(400).json({ error: 'business required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const BIZ_NAMES = {
    codeit:    'CodeIt — app development platform for entrepreneurs and small businesses',
    lynq:      'Lynq.build — modern web design agency',
    insurance: 'Insurance advisory — life and protection products',
  };

  const bisBlock = bisData
    ? [
        bisData.mission      && `Mission: ${bisData.mission}`,
        bisData.description  && `Description: ${bisData.description}`,
        bisData.audience     && `Audience: ${bisData.audience}`,
        bisData.pillars      && `Content Pillars: ${bisData.pillars}`,
        bisData.voice        && `Brand Voice: ${bisData.voice}`,
        bisData.ctas         && `CTAs: ${bisData.ctas}`,
        bisData.compliance   && `Compliance: ${bisData.compliance}`,
      ].filter(Boolean).join('\n')
    : 'No BIS data provided — infer from business name and category.';

  const prompt = `You are a brand strategist. Generate a deep Brand DNA profile for this business.

BUSINESS: ${BIZ_NAMES[business] || business}
INTELLIGENCE:
${bisBlock}

Return ONLY valid JSON, no markdown:
{
  "archetype": "one brand archetype — The Creator, The Rebel, The Sage, The Hero, The Explorer, The Ruler, The Caregiver, The Everyman, The Jester, The Magician",
  "personality": "2-3 sentences describing how the brand talks, acts, and makes people feel",
  "voice": {
    "tone": "core tone in 3-5 words",
    "spectrum": ["trait1", "trait2", "trait3"],
    "avoid": ["tone to avoid 1", "tone to avoid 2"]
  },
  "visual": {
    "style": "visual style descriptor (e.g. Clean minimal tech, Warm editorial, Bold graphic)",
    "mood": "overall visual mood",
    "photography": "photography direction for social content",
    "textStyle": "text overlay style guidance"
  },
  "audiencePsychology": "what this audience fears, desires, and responds to — 2 sentences",
  "powerWords": ["word1", "word2", "word3", "word4", "word5", "word6", "word7", "word8"],
  "contentDo": ["do this 1", "do this 2", "do this 3", "do this 4"],
  "contentDont": ["avoid this 1", "avoid this 2", "avoid this 3"],
  "hookStyles": ["hook style that works for this brand 1", "hook style 2", "hook style 3"],
  "signatureFormats": ["content format 1", "content format 2", "content format 3"]
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
        max_tokens: 2000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Anthropic error');

    const raw    = data.content?.[0]?.text || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    parsed.updatedAt = new Date().toISOString();

    const brain = await loadBrain();
    brain[business] = parsed;
    await saveBrain(brain);

    return res.status(200).json({ ok: true, brain: parsed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
