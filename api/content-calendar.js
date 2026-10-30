module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { business, days, batchStart, startDate, focus, context } = req.body || {};
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  function formatBiz(biz, data) {
    if (!data) return '';
    return [
      `${biz.toUpperCase()}`,
      `Mission: ${data.mission || data.description || '—'}`,
      `Audience: ${data.audience || '—'}`,
      `Pillars: ${(data.pillars || '').split('\n').filter(Boolean).join(' | ')}`,
      `CTAs: ${(data.ctas || '').split('\n').filter(Boolean).join(' | ')}`,
      `Voice: ${data.voice || '—'}`,
    ].join('\n');
  }

  const bizKeys   = business === 'all' ? ['codeit','lynq','insurance'] : [business];
  const ctxBlock  = context
    ? bizKeys.map(k => formatBiz(k, context[k])).join('\n\n')
    : 'No business context provided.';

  // Build date map for this batch
  const startD = new Date(startDate + 'T00:00:00');
  const dateMap = Array.from({ length: days }, (_, i) => {
    const d = new Date(startD);
    d.setDate(startD.getDate() + (batchStart - 1) + i);
    return { n: batchStart + i, date: d.toISOString().slice(0,10) };
  });

  const bizRule = business === 'all'
    ? 'Rotate through all three businesses evenly. Each day assign one: "codeit", "lynq", or "insurance". Mix the order — do not go sequentially.'
    : `Every day is for business: "${business}"`;

  const focusLine = focus ? `\nCampaign focus / theme: "${focus}"` : '';

  const TYPES = [
    'Demo / Tutorial','Before & After','Behind the Build','Personal Story',
    'Tips & Education','Client Result','Product Feature','Question / Poll',
    'Announcement','Myth Bust','FAQ Answer','Process Walkthrough'
  ];
  const PLATFORMS = ['TikTok','Instagram Reels','LinkedIn','YouTube Shorts','Facebook'];

  const prompt = `You are a content strategist. Generate a ${days}-day social media content plan starting at day ${batchStart}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${ctxBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${bizRule}${focusLine}
- Never repeat the same content type 2 consecutive days for the same business
- Rotate platforms — no same platform 3 days in a row for the same business
- Hooks must be specific, punchy, and attention-grabbing. No generic lines.
- CTAs must be from the business context above — do not invent new ones
- Recording ref: one sentence — exactly what to show on camera. Actionable.
- Use only these content types: ${TYPES.join(', ')}
- Use only these platforms: ${PLATFORMS.join(', ')}

Day-to-date mapping: ${dateMap.map(d => `Day ${d.n}=${d.date}`).join(', ')}

Return ONLY a valid JSON object with NO markdown, NO code fences:
{
  "days": [
    {
      "id": "unique-id-string",
      "n": 1,
      "date": "YYYY-MM-DD",
      "biz": "codeit|lynq|insurance",
      "type": "Content type",
      "platform": "Platform name",
      "hook": "Opening hook line",
      "cta": "Exact CTA from business memory",
      "ref": "One-sentence recording reference",
      "status": "draft",
      "notes": ""
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
        max_tokens: 8000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Anthropic API error');

    const raw    = data.content?.[0]?.text || '';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Ensure every entry has a unique id
    (parsed.days || []).forEach((d, i) => {
      if (!d.id) d.id = `${d.date}-${d.biz}-${i}-${Date.now()}`;
    });

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
