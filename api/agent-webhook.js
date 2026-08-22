const { requireAdmin } = require('./_admin-auth');

const ALLOWED_FIELDS = [
  'first_name', 'last_name', 'email', 'company', 'linkedin_url', 'phone',
  'website', 'address', 'industry', 'website_score', 'website_issues',
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const webhookUrl = process.env.MAKE_LEAD_WEBHOOK_URL || process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) return res.status(503).json({ error: 'Lead automation webhook is not configured' });

  const payload = Object.fromEntries(ALLOWED_FIELDS.map(field => [
    field,
    String(req.body?.[field] ?? '').slice(0, 2000),
  ]));
  if (!payload.company) return res.status(400).json({ error: 'company is required' });

  try {
    const upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(502).json({ error: `Lead automation failed (${upstream.status})`, detail: detail.slice(0, 200) });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: `Lead automation unavailable: ${err.message}` });
  }
};
