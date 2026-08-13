module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { contact } = req.body || {};
  if (!contact?.name) return res.status(400).json({ error: 'contact.name required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const rel   = contact.relationship || 'friend';
  const age   = contact.age   ? `approximately ${contact.age} years old` : '';
  const notes = contact.notes ? `Additional context: ${contact.notes}.` : '';

  const prompt = `You are writing natural market outreach scripts for Mustafa, a newly licensed life insurance agent in Toronto working with a major insurance company.

Contact info:
- Name: ${contact.name}
- Relationship to Mustafa: ${rel}
${age ? `- Age: ${age}` : ''}
${notes}

The natural market approach means Mustafa is reaching out to people he already knows. The tone must be:
- Warm, genuine, NOT salesy
- Like a real conversation, not a pitch
- Soft ask: just requesting 20 minutes to practice/show what he does
- No pressure, no obligation language
- Mention he recently got licensed

Write THREE things and return as valid JSON only:

1. "callScript" — A natural 45-60 second phone opener. Start with a warm greeting by name. Mention he recently got his life insurance licence. Say he's building his client base and thought of them. Ask if they'd be open to a quick 20-min coffee or call (in person or Zoom) so he can show them what he does. Keep it conversational. Handle the most common objection ("I already have insurance") with: "That's totally fine, I'm not here to replace anything — I just want to show you what I'm doing and maybe get your feedback."

2. "smsScript" — A casual text, max 160 chars. Hey [name], it's Mustafa! Just got my life insurance licence. Would love to catch up and show you what I'm doing — free coffee on me? 😄

3. "followUpScript" — A follow-up call script for 3-5 days after no response. Warm, short, not pushy. Reference the previous message.

Return ONLY valid JSON:
{
  "callScript": "...",
  "smsScript": "...",
  "followUpScript": "..."
}`;

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
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const aiData = await aiRes.json();
    const raw    = aiData.content?.[0]?.text || '';
    const match  = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const parsed = JSON.parse(match[0]);
    if (!parsed.callScript) throw new Error('Empty response');
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: `Claude failed: ${err.message}` });
  }
};
