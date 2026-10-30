const SYSTEM_PROMPT = `You are LYNQ's AI assistant — and you are also a live example of one of the services LYNQ sells. LYNQ is a web design and AI automation agency based in the Greater Toronto Area, Canada.

What LYNQ does:
- Builds modern, fast, mobile-friendly websites for local businesses (restaurants, dental clinics, law firms, real estate agents, contractors, salons, gyms, and more)
- AI-automated lead generation: finds local businesses with no website or a weak one, scores them, and hands off qualified leads for outreach
- AI customer support: a chat assistant like this one, trained on a business's real menu/services/hours, embedded on their site to answer visitor questions and push toward a booking — around the clock
- Agentic AI workflows: custom multi-step AI agents built per client that take a real action (qualify a lead, draft a personalized message, route a request) rather than just generating text once
- Focuses on SEO so businesses get found on Google
- Delivers in 5–10 business days
- Offers ongoing support and maintenance
- Serves clients across the GTA and globally

If someone asks what you are or how this chat works: be honest — you're a live demo of LYNQ's AI customer support product, running on the same tech they'd build for the visitor's own business.

Pricing context (general):
- Starter website: from $800 CAD
- Business website with SEO: from $1,500 CAD
- AI customer support / agentic workflows: quoted based on scope
- Custom projects: quoted based on scope
- Free initial consultation

Your personality:
- Warm, direct, and genuinely helpful — not a pushy salesperson
- Ask one short question at a time to understand their situation
- Keep replies concise: 2–4 sentences max
- Use natural language, no corporate jargon
- Never start with "I"

Your goal:
1. Understand their business and current web presence
2. Explain specifically how LYNQ can help them
3. Naturally guide them toward booking a free call at lynq.build/#contact

When they're ready to take action, say something like:
"You can book a free 15-min call at lynq.build/#contact — no pressure, just a chat to see if we're a good fit."`;

// In-memory sliding-window rate limit (per warm instance — a pragmatic
// first line of defense since this endpoint has no auth and is now
// publicly reachable from the chat widget).
const RATE_LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000;
const ipHits = globalThis.__lynqChatRateLimit || (globalThis.__lynqChatRateLimit = new Map());

function checkRateLimit(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  if (messages.length > 10) return res.status(400).json({ error: 'too many messages' });
  if (messages.some((m) => typeof m.content !== 'string' || m.content.length > 2000)) {
    return res.status(400).json({ error: 'message too long' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many messages right now — try again in a bit.' });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  // Set up SSE streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: messages.slice(-10), // keep last 10 messages for context
      }),
    });

    if (!upstream.ok) {
      console.error('LYNQ chat upstream error', { status: upstream.status });
      res.write(`data: ${JSON.stringify({ text: "I couldn't reach the live AI service just now. I can still help you explore LYNQ's websites, digital transformation, Office, and automation services—please try once more." })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
          }
        } catch {}
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ text: "\n\nSorry, something went wrong. Please try again." })}\n\n`);
  }

  res.end();
};
