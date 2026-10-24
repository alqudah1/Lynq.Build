// A genuine multi-step agent: each call's output feeds the next, and the
// agent can flag its own uncertainty rather than always producing a
// confident answer. This is the real "agentic AI" behind the marketing
// claim on services.html — not a single-shot content generator.

function getPortfolioLink(industry) {
  const i = (industry || '').toLowerCase();
  if (i.includes('restaurant') || i.includes('food') || i.includes('cafe') ||
      i.includes('coffee') || i.includes('bakery') || i.includes('kitchen')) {
    return { url: 'https://lynq.build/projects/saffron-kitchen', label: 'Saffron Kitchen' };
  }
  if (i.includes('renovati') || i.includes('contractor') || i.includes('plumb') ||
      i.includes('landscap') || i.includes('cleaning') || i.includes('construct')) {
    return { url: 'https://lynq.build/projects/peak-renovations', label: 'Peak Renovations' };
  }
  return { url: 'https://lynq.build', label: 'our portfolio' };
}

async function callClaude(API_KEY, { system, prompt, maxTokens = 700 }) {
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
      ...(system ? { system } : {}),
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { lead } = req.body || {};
  if (!lead) return res.status(400).json({ error: 'lead required' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const portfolio = getPortfolioLink(lead.industry || lead.category);
  const leadFacts = `Name: ${lead.name}
Industry: ${lead.category || lead.industry || 'unknown'}
Google rating: ${lead.rating ? `${lead.rating} stars (${lead.reviews} reviews)` : 'not listed'}
Website status: ${lead.needsVerification ? 'no site found on Google Maps, but this field is often blank even when a real site exists' : lead.websiteScore === 0 ? 'confirmed no website' : `has a site, scored ${lead.websiteScore}/100 — issue: ${lead.reason || 'unspecified'}`}
Address: ${lead.address || 'unknown'}`;

  const steps = {};

  // ── Step 1: Analyze ──────────────────────────────────────────────
  try {
    steps.analysis = await callClaude(API_KEY, {
      maxTokens: 400,
      prompt: `You're triaging a cold sales lead for a web design agency (LYNQ). Here are the facts:

${leadFacts}

Decide, honestly:
1. "priority" — "Hot", "Warm", or "Cold" (Hot = confirmed weak/no site + decent rating; Cold = data looks unreliable or business looks like a poor fit)
2. "angle" — the single most compelling, specific thing to open with (one sentence, no fluff)
3. "needsHumanCheck" — true/false: is there anything here (like an unverified "no website" flag) that a human should confirm before this lead gets contacted?
4. "checkReason" — if needsHumanCheck is true, one sentence on what to verify and why. Empty string otherwise.

Return ONLY this JSON shape: {"priority":"...","angle":"...","needsHumanCheck":true,"checkReason":"..."}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Step 1 (analyze) failed: ${err.message}`, steps });
  }

  // ── Step 2: Draft, seeded with Step 1's own analysis ─────────────
  try {
    steps.draft = await callClaude(API_KEY, {
      maxTokens: 700,
      prompt: `You're Mustafa at LYNQ (lynq.build), a Toronto web design agency. Another part of this system already analyzed this lead and decided on an angle — use it, don't re-derive it.

Lead facts:
${leadFacts}

Analysis to build from:
- Priority: ${steps.analysis.priority}
- Opening angle: ${steps.analysis.angle}
- Relevant portfolio example: ${portfolio.url} (${portfolio.label})

Write a cold email (4-5 sentences) that opens with that exact angle, references the portfolio link naturally, and ends with a soft CTA to book a free call at lynq.build/#contact. Sign off as Mustafa / LYNQ.

Return ONLY this JSON shape: {"subject":"...","email":"..."}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Step 2 (draft) failed: ${err.message}`, steps });
  }

  // ── Step 3: Self-review the draft against the original facts ────
  try {
    steps.review = await callClaude(API_KEY, {
      maxTokens: 300,
      prompt: `Review this draft cold email against the actual lead facts it's supposed to be based on. Be genuinely critical — don't just approve everything.

Lead facts:
${leadFacts}

Draft email:
${steps.draft.email}

Check: does the email claim anything about this business that isn't actually in the facts above (a hallucination)? Is the tone appropriate for a business this size?

Return ONLY this JSON shape: {"confidence": 0-100, "note": "one honest sentence on whether this is ready to send as-is or what to fix"}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Step 3 (review) failed: ${err.message}`, steps });
  }

  return res.status(200).json({ ok: true, steps, portfolioUrl: portfolio.url });
};
