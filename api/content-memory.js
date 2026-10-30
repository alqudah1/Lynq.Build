const { put, list } = require('@vercel/blob');

const PATH     = 'lynq-tg/content-memory.json';
const MAX_ITEMS = 500;

async function loadMemory() {
  try {
    const { blobs } = await list({ prefix: 'lynq-tg/content-memory' });
    if (!blobs.length) return [];
    const res = await fetch(blobs[0].downloadUrl);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function saveMemory(items) {
  if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);
  return put(PATH, JSON.stringify(items), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false,
  });
}

// Similarity check — returns true if hook/angle combo already exists for same business
function isDuplicate(items, { business, hook, angle }) {
  const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const nb = normalize(business);
  const nh = normalize(hook);
  const na = normalize(angle);
  return items.some(item => {
    if (normalize(item.business) !== nb) return false;
    const ih = normalize(item.hook);
    const ia = normalize(item.angle);
    // Exact match or high overlap (>80% words in common)
    const hWords = new Set(nh.split(' ').filter(Boolean));
    const iWords = new Set(ih.split(' ').filter(Boolean));
    const overlap = [...hWords].filter(w => iWords.has(w)).length;
    const sim = hWords.size ? overlap / hWords.size : 0;
    return (nh === ih && na === ia) || (sim > 0.8 && normalize(item.angle) === na);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — return memory, optional ?business= filter
  if (req.method === 'GET') {
    const items = await loadMemory();
    const biz   = req.query?.business;
    const out   = biz ? items.filter(i => i.business === biz) : items;
    return res.status(200).json({ items: out, total: items.length });
  }

  // POST — record a new content entry, check for duplicates
  if (req.method === 'POST') {
    const { business, hook, angle, platform, postDate, status, contentId, scenario } = req.body || {};
    if (!business || !hook) return res.status(400).json({ error: 'business and hook required' });

    const items = await loadMemory();
    const dupe  = isDuplicate(items, { business, hook, angle });

    if (dupe && req.query?.force !== '1') {
      return res.status(409).json({ duplicate: true, message: 'Similar content already exists for this business.' });
    }

    const entry = {
      id:         `mem_${Date.now()}`,
      contentId:  contentId || null,
      business,
      hook,
      angle:      angle    || '',
      scenario:   scenario || '',
      platform:   platform || 'all',
      postDate:   postDate || new Date().toISOString().slice(0, 10),
      status:     status   || 'draft',
      createdAt:  new Date().toISOString(),
    };

    items.unshift(entry);
    await saveMemory(items);
    return res.status(200).json({ ok: true, entry, duplicate: false });
  }

  // DELETE — remove by id
  if (req.method === 'DELETE') {
    const id = req.body?.id || req.query?.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    let items = await loadMemory();
    items = items.filter(i => i.id !== id);
    await saveMemory(items);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
};

module.exports.loadMemory  = loadMemory;
module.exports.saveMemory  = saveMemory;
module.exports.isDuplicate = isDuplicate;
