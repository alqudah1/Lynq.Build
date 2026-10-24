module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { update, business, memory, previousContent } = req.body || {};
  if (!update?.trim()) return res.status(400).json({ error: 'update is required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  // Build memory context block
  function formatBizMemory(biz, data) {
    if (!data) return '';
    return `
=== ${biz.toUpperCase()} ===
Description:    ${data.description || '—'}
Target Audience: ${data.audience || '—'}
Content Pillars:
${(data.pillars || '').split('\n').filter(Boolean).map(p => `  • ${p}`).join('\n')}
Current Offers:
${(data.offers || '').split('\n').filter(Boolean).map(o => `  • ${o}`).join('\n')}
CTAs to use:
${(data.ctas || '').split('\n').filter(Boolean).map(c => `  • ${c}`).join('\n')}
Brand Voice:    ${data.voice || '—'}`.trim();
  }

  const bizKeys = business === 'all' ? ['codeit', 'lynq', 'insurance'] : [business];
  const memoryBlock = (memory && Object.keys(memory).length)
    ? bizKeys.map(k => formatBizMemory(k, memory[k])).join('\n\n')
    : 'No memory stored yet — generate based on the update alone.';

  // Build previous content block
  const prevBlock = (previousContent && previousContent.length)
    ? previousContent.map((p, i) =>
        `Post ${i + 1}:\nUpdate: "${p.update || ''}"\nInstagram: "${p.instagram || ''}"\nTikTok hook: "${(p.tiktok || '').split('\n')[0] || ''}"`
      ).join('\n\n')
    : 'No previous content saved yet.';

  // Business label for prompt
  const bizLabel = business === 'all'
    ? 'all three businesses (CodeIt, Lynq.build, and Mustafa Alqudah Insurance) — blend or pick the most relevant angle based on the update'
    : bizKeys[0];

  const prompt = `You are a social media content writer. You have deep context about the business(es) below — use it as the foundation for every piece of content you write.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS MEMORY (always reference this)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memoryBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREVIOUS CONTENT (match style, avoid repeating topics)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${prevBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TODAY'S UPDATE (the raw material for this content)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Business: ${bizLabel}
Update: "${update}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES (non-negotiable)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Write like a real human, not a brand account
- Use the CTAs from memory — do not invent new ones
- Stay within the content pillars — do not go off-brand
- Match the brand voice exactly as described in memory
- Short sentences. No corporate language. No buzzwords.
- Every post needs one clear CTA — use the ones from memory
- No fake claims or exaggerated results
- If a result is mentioned and not independently verified, say "I tested this" — never "users achieve X" or "students build X"
- Do not repeat topics from previous content unless the update gives new information
- Max 2 emojis per post

Generate content for all platforms below. Return ONLY a valid JSON object — no markdown, no code fences, no extra text:

{
  "tiktok": "TikTok/Reels/Shorts script. Hook in first 2 seconds. 45–60 seconds when spoken aloud. Visual directions in [brackets]. End with CTA from memory.",
  "instagram": "Instagram caption. 3–5 lines. Conversational. End with CTA from memory.",
  "facebook": "Facebook caption. 4–6 lines. Slightly warmer tone. End with CTA from memory.",
  "linkedin": "LinkedIn post. 5–8 lines. Professional but human. Small story or insight. End with CTA from memory.",
  "hashtags": "12–15 relevant hashtags as a single space-separated string",
  "imagePrompt": "Detailed prompt for an AI image or video thumbnail. Describe mood, lighting, composition, and any text overlays."
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Anthropic API error');

    const raw   = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
