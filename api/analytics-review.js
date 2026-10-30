module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { week, weekData, trend, bisContext } = req.body || {};
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  function fmtMetrics(entry) {
    const lines = [`Business: ${entry.business || 'all'}`, `Week: ${entry.weekStart}`];
    const plats = {
      instagram: { Views: 'views', Reach: 'reach', Saves: 'saves', Shares: 'shares', Followers: 'followers' },
      tiktok:    { Views: 'views', 'Watch Time (min)': 'watchTime', Likes: 'likes', Shares: 'shares' },
      youtube:   { Views: 'views', 'Retention %': 'retention', Subscribers: 'subscribers' },
      linkedin:  { Impressions: 'impressions', 'Engagement %': 'engagement' },
      facebook:  { Reach: 'reach', 'Engagement %': 'engagement' },
    };
    Object.entries(plats).forEach(([plat, fields]) => {
      const d = entry[plat];
      if (!d) return;
      const vals = Object.entries(fields)
        .filter(([,k]) => d[k] != null && d[k] !== 0)
        .map(([label, k]) => `${label}: ${d[k]}`);
      if (vals.length) lines.push(`${plat.charAt(0).toUpperCase()+plat.slice(1)}: ${vals.join(', ')}`);
    });
    if (entry.topContent?.title) {
      lines.push(`Top content: "${entry.topContent.title}" on ${entry.topContent.platform} (${entry.topContent.pillar})`);
    }
    if (entry.notes) lines.push(`Notes: ${entry.notes}`);
    return lines.join('\n');
  }

  const currentBlock = weekData.map(fmtMetrics).join('\n\n');

  const trendBlock = (trend || [])
    .filter(t => t.week !== week)
    .slice(0, 3)
    .map(t => t.entries.map(e => `[${t.week}] ${e.business || 'all'} — IG views: ${e.instagram?.views||0}, TT views: ${e.tiktok?.views||0}, LI impressions: ${e.linkedin?.impressions||0}`).join('\n'))
    .join('\n');

  const bisBlock = bisContext
    ? Object.entries(bisContext)
        .filter(([,v]) => v && typeof v === 'object')
        .map(([k,v]) => `${k.toUpperCase()}: ${v.description || ''} | Pillars: ${(v.pillars||'').replace(/\n/g,' | ')}`)
        .join('\n')
    : 'No business context.';

  const prompt = `You are a social media performance analyst reviewing weekly metrics for a content creator who runs three businesses.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${bisBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS WEEK (${week})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${currentBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREVIOUS WEEKS (trend)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${trendBlock || 'No previous data available.'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REVIEW INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Write a concise, honest, actionable weekly review.
- Be specific — reference actual numbers, not generic advice
- If data is thin, say what you can infer and what's missing
- For "next week" recommendations: give 2-3 specific content ideas
- No corporate language, no filler phrases
- Each answer should be 2-5 sentences

Return ONLY a valid JSON object — no markdown, no code fences:
{
  "worked": "What performed well and why",
  "failed": "What underperformed or showed weak engagement",
  "nextWeek": "Specific content recommendations for next week based on what worked",
  "bestPillar": "Which content pillar drove the most engagement and why",
  "bestPlatform": "Which platform performed best this week and what that means"
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
        max_tokens: 1200,
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
