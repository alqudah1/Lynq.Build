module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const { profile } = req.body || {};
  if (!profile) return res.status(400).json({ error: 'profile required' });

  const prompt = `You are helping Mustafa, a 23-year-old newly licensed life insurance agent in Toronto, Ontario working with Global Life, build his natural market list.

His background:
- Age: 23, lives in Toronto, Ontario
- Licensed with Global Life (recently)
- School: ${profile.school || 'not specified'}
- Previous jobs: ${profile.jobs || 'not specified'}
- Hobbies / sports / gym: ${profile.hobbies || 'not specified'}
- Community (mosque, church, cultural group, etc.): ${profile.community || 'not specified'}
- Other details: ${profile.other || 'none'}

Your job: Generate a MEMORY PROMPT LIST — a categorized list that helps Mustafa recall every person he knows who could be a life insurance prospect.

For each category, give 3-5 specific memory prompts that jog his memory (e.g. "Who did you always hang out with at lunch in Grade 11?"). Then give 1-2 sentences on WHY this group is a good natural market target (life stage, likely needs).

Categories to cover (tailor to his background — skip any that don't apply):
1. Family (immediate + extended)
2. High school friends
3. College/university (if applicable)
4. Former coworkers
5. Sports / gym friends
6. Community / mosque / cultural connections
7. Neighbours
8. Social media (people he actually knows)
9. Friends of friends (weddings, events)

For each: 3 short memory prompts max. Keep each prompt under 12 words.

Then 4 Quick Wins — types of people at 23 in Ontario most likely to buy now.

Return ONLY this exact JSON structure, no markdown, no extra text:
{"categories":[{"name":"string","why":"string","reach":"string","prompts":["string","string","string"]}],"quickWins":[{"type":"string","reason":"string","approach":"string"}]}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const aiData = await aiRes.json();
    const raw = aiData.content?.[0]?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const parsed = JSON.parse(match[0]);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
};
