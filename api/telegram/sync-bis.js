const { saveBis } = require('../_lib/tg-session');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const bis = req.body || {};
  if (!bis.codeit && !bis.lynq && !bis.insurance) {
    return res.status(400).json({ error: 'No BIS data provided' });
  }

  try {
    await saveBis(bis);
    return res.status(200).json({ ok: true, synced: Object.keys(bis).length + ' keys' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
