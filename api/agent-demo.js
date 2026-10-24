// Public, rate-limited version of the 3-step agent behind lead-agent.js —
// same real chained reasoning, scoped to a simple hypothetical business
// instead of a real scraped lead, so anyone can safely try it on the
// public site without touching real lead data or sending real email.

const RATE_LIMIT = 12;
const WINDOW_MS = 60 * 60 * 1000;
const ipHits = globalThis.__lynqAgentDemoRateLimit || (globalThis.__lynqAgentDemoRateLimit = new Map());

function checkRateLimit(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

async function callClaude(API_KEY, { prompt, maxTokens = 400 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}`);
  const data = await res.json();
  const raw = data.content?.[0]?.text || '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');
  return JSON.parse(jsonMatch[0]);
}

const VALID_SITUATIONS = ['No website', 'Outdated or slow website', 'Has a site, wants more leads'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { businessName, industry, situation } = req.body || {};
  if (!businessName || typeof businessName !== 'string' || businessName.length > 80) {
    return res.status(400).json({ error: 'businessName required (max 80 chars)' });
  }
  if (!industry || typeof industry !== 'string' || industry.length > 60) {
    return res.status(400).json({ error: 'industry required (max 60 chars)' });
  }
  if (!VALID_SITUATIONS.includes(situation)) {
    return res.status(400).json({ error: 'situation must be one of: ' + VALID_SITUATIONS.join(', ') });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Demo is rate-limited — try again in a bit.' });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const safeName = businessName.replace(/[<>]/g, '');
  const safeIndustry = industry.replace(/[<>]/g, '');
  const facts = `Business name: ${safeName}\nIndustry: ${safeIndustry}\nSituation: ${situation}`;

  const steps = {};

  try {
    steps.analysis = await callClaude(API_KEY, {
      maxTokens: 300,
      prompt: `You're triaging a hypothetical cold sales lead for a web design + AI automation agency (LYNQ). Facts:

${facts}

Decide:
1. "angle" — the single most compelling, specific thing to open outreach with (one sentence, no fluff, grounded in the situation given)
2. "risk" — one honest sentence on what could make this pitch land badly if the assumptions are wrong

Return ONLY this JSON shape: {"angle":"...","risk":"..."}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Step 1 (analyze) failed: ${err.message}`, steps });
  }

  try {
    steps.draft = await callClaude(API_KEY, {
      maxTokens: 350,
      prompt: `You're Mustafa at LYNQ. Another step already analyzed this lead — use its angle, don't re-derive it.

${facts}

Opening angle to use: ${steps.analysis.angle}

Write a short cold email (3-4 sentences) opening with that angle, ending with a soft CTA to book a free call at lynq.build/#contact. Sign off as Mustafa / LYNQ.

Return ONLY this JSON shape: {"subject":"...","email":"..."}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Step 2 (draft) failed: ${err.message}`, steps });
  }

  try {
    steps.review = await callClaude(API_KEY, {
      maxTokens: 200,
      prompt: `Critically review this draft against the facts it's based on — don't just approve it.

${facts}

Draft:
${steps.draft.email}

Does it claim anything not actually in the facts? Return ONLY this JSON shape: {"confidence": 0-100, "note": "one honest sentence"}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Step 3 (review) failed: ${err.message}`, steps });
  }

  return res.status(200).json({ ok: true, steps });
};
