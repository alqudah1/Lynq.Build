const { loadSession, saveSession } = require('../_lib/tg-session');

const VALID_STATUSES = [
  'draft', 'approved', 'ready_to_post', 'posted', 'skipped',
  'rejected', 'needs_edit', 'scheduled', 'needs_review',
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { id, status, selectedVersion, approvalNotes } = req.body || {};
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const session = await loadSession();

    // Search drafts (legacy) then posts (queue)
    let item = session.drafts.find(d => d.id === id);
    let pool = 'drafts';
    if (!item) {
      item = (session.posts || []).find(p => p.id === id);
      pool = 'posts';
    }
    if (!item) return res.status(404).json({ error: 'Item not found' });

    item.status    = status;
    item.updatedAt = new Date().toISOString();
    if (selectedVersion) item.selectedVersion = selectedVersion;
    if (approvalNotes)   item.approvalNotes   = approvalNotes;

    await saveSession(session);
    return res.status(200).json({ ok: true, item, pool });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
