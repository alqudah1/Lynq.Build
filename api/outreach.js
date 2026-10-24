const nodemailer = require('nodemailer');

// Pick a relevant portfolio example based on industry
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { lead, toEmail, sendEmail } = req.body || {};
  if (!lead) return res.status(400).json({ error: 'lead required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const ZOHO_PASS     = process.env.ZOHO_APP_PASSWORD;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const portfolio = getPortfolioLink(lead.industry || lead.category);
  const issuesSummary = lead.websiteScore === 0
    ? 'They have no website at all.'
    : `Their website issues: ${lead.reason}.`;

  const prompt = `You are writing outreach for Mustafa at LYNQ (lynq.build), a web design agency in Toronto.

Business info:
- Name: ${lead.name}
- Industry: ${lead.category || lead.industry}
- ${issuesSummary}
${lead.rating ? `- Google rating: ${lead.rating} stars (${lead.reviews} reviews)` : ''}
- Portfolio example to reference: ${portfolio.url} (${portfolio.label})

Write THREE things and return as JSON:

1. "subject" — email subject line (specific to their business)
2. "email" — cold email body, 4-5 sentences. Mention their specific issue. Reference the portfolio link naturally. End with a soft CTA to book a free call at lynq.build/#contact. Sign off as Mustafa / LYNQ.
3. "sms" — SMS text, max 160 chars. Casual, mention who you are, their issue, and lynq.build. No emojis.
4. "callScript" — a 30-second phone call opener script. Natural, not salesy. Mention their specific issue. Ask if they have 2 minutes.

Return ONLY valid JSON like:
{
  "subject": "...",
  "email": "...",
  "sms": "...",
  "callScript": "..."
}`;

  let subject, emailBody, sms, callScript;
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
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const aiData = await aiRes.json();
    const raw = aiData.content?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);
    subject    = parsed.subject    || `Quick question about ${lead.name}'s online presence`;
    emailBody  = parsed.email      || '';
    sms        = parsed.sms        || '';
    callScript = parsed.callScript || '';
    if (!emailBody) throw new Error('Empty email body');
  } catch (err) {
    return res.status(500).json({ error: `Claude failed: ${err.message}` });
  }

  // Send email only if requested and email provided
  if (sendEmail && toEmail) {
    if (!ZOHO_PASS) return res.status(500).json({ error: 'Missing ZOHO_APP_PASSWORD' });
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.zohocloud.ca', port: 465, secure: true,
        auth: { user: 'hello@lynq.build', pass: ZOHO_PASS },
      });
      await transporter.sendMail({
        from: '"Mustafa @ LYNQ" <hello@lynq.build>',
        to: toEmail,
        subject,
        text: emailBody,
      });
    } catch (err) {
      return res.status(500).json({ error: `Email send failed: ${err.message}` });
    }
  }

  return res.status(200).json({ ok: true, subject, email: emailBody, sms, callScript, portfolioUrl: portfolio.url });
};
