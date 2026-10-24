/**
 * Telegram Send — push a message from the admin panel to the bot owner.
 * POST { text, parse_mode? }
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { text, parse_mode = 'HTML' } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });

  const BOT_TOKEN  = (process.env.TELEGRAM_BOT_TOKEN  || '').trim();
  const ALLOWED_ID = (process.env.TELEGRAM_ALLOWED_USER_ID || '').trim();
  if (!BOT_TOKEN || !ALLOWED_ID) return res.status(500).json({ error: 'Bot not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USER_ID)' });

  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    parseInt(ALLOWED_ID),
        text:       String(text).slice(0, 4096),
        parse_mode,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.description || 'Telegram error' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
