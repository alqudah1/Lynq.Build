const { loadSession } = require('../_lib/tg-session');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const session = await loadSession();
    return res.status(200).json({
      drafts:      session.drafts || [],
      posts:       session.posts  || [],
      lastDraftId: session.lastDraftId || null,
      lastPostId:  session.lastPostId  || null,
      state:       session.state || 'idle',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
