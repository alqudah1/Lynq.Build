module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const { contact, note } = req.body || {};
  if (!contact || !note) return res.status(400).json({ error: 'contact and note required' });

  const prompt = `Mustafa is a 23-year-old life insurance agent in Toronto with Global Life. He just had a conversation with someone in his natural market and wrote this quick note about how it went:

Contact: ${contact.name} (${contact.relationship || 'acquaintance'})
Current status: ${contact.status}
His note: "${note}"

Based on this, give him:
1. The best status to set for this contact (one of: new, called, meeting, presented, sold, notNow)
2. A specific next action — exact words if he needs to send a message, or exact thing to do
3. A one-sentence coaching tip based on what he described

Return ONLY valid JSON:
{
  "status": "called",
  "nextAction": "exact next step or message to send",
  "tip": "one sentence coaching tip"
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
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await aiRes.json();
    const raw = data.content?.[0]?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    return res.status(200).json(JSON.parse(match[0]));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
