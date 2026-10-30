module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { product, topic, platform, existingHook, brandVoice } = req.body || {};

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const isShortForm = ['tiktok', 'reels', 'shorts', 'stories'].includes(platform);
  const platformNote = isShortForm
    ? 'spoken-word short video — first 2 seconds decide whether they stay or scroll'
    : platform === 'linkedin'
    ? 'LinkedIn text post — first line must stop the professional scroll'
    : 'social media feed — pattern interrupt to stop the scroll';

  const prompt = `You are a hook specialist who writes viral social media openers. Generate 9 hooks.

BUSINESS: ${product || 'codeit'}
PLATFORM: ${platform || 'tiktok'} — ${platformNote}
TOPIC: ${topic || 'general content'}
${existingHook ? `EXISTING HOOK TO RIFF ON: "${existingHook}"` : ''}
${brandVoice ? `BRAND VOICE: ${brandVoice}` : ''}

Rules:
- Max 15 words per hook (10 words ideal for video)
- Written for spoken delivery — punchy, no filler, no "Hey guys"
- Each hook must use a completely different psychological trigger
- No fake results. CodeIt: "I built this" or "we can build this for you" — not "my student made $10k"
- Insurance: no specific premium promises, no guarantees

Return ONLY valid JSON, no markdown:
{
  "hooks": [
    { "type": "Pattern Interrupt",  "hook": "...", "why": "one sentence on the psychology" },
    { "type": "Curiosity Gap",      "hook": "...", "why": "..." },
    { "type": "Bold Claim",         "hook": "...", "why": "..." },
    { "type": "Story Opener",       "hook": "...", "why": "..." },
    { "type": "Contrarian Take",    "hook": "...", "why": "..." },
    { "type": "Fear / FOMO",        "hook": "...", "why": "..." },
    { "type": "Direct Question",    "hook": "...", "why": "..." },
    { "type": "Shocking Stat",      "hook": "...", "why": "..." },
    { "type": "Personal Confession","hook": "...", "why": "..." }
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
        max_tokens: 2000,
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
