const { put, list } = require('@vercel/blob');

const PATH = 'lynq-tg/schedule.json';

const VALID_STATUSES = ['draft', 'scheduled', 'approved', 'posted', 'cancelled', 'failed'];
const VALID_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'reels', 'shorts', 'stories'];

async function loadSchedule() {
  try {
    const { blobs } = await list({ prefix: 'lynq-tg/schedule' });
    if (!blobs.length) return [];
    const res = await fetch(blobs[0].downloadUrl);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function saveSchedule(items) {
  return put(PATH, JSON.stringify(items), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false,
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — list scheduled posts, optional ?status= ?business= ?platform=
  if (req.method === 'GET') {
    let items = await loadSchedule();
    const { status, business, platform } = req.query || {};
    if (status)   items = items.filter(i => i.status   === status);
    if (business) items = items.filter(i => i.business === business);
    if (platform) items = items.filter(i => i.platform === platform);
    // Sort by scheduledTime ascending
    items.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));
    return res.status(200).json({ items, total: items.length });
  }

  // POST — create a scheduled post
  if (req.method === 'POST') {
    const { business, platform, scheduledTime, content, contentId, caption, hashtags, imageUrl, videoUrl, audioUrl } = req.body || {};
    if (!business)      return res.status(400).json({ error: 'business required' });
    if (!platform)      return res.status(400).json({ error: 'platform required' });
    if (!scheduledTime) return res.status(400).json({ error: 'scheduledTime required (ISO 8601)' });

    const items = await loadSchedule();
    const item = {
      id:            `sch_${Date.now()}`,
      business,
      platform,
      scheduledTime: new Date(scheduledTime).toISOString(),
      status:        'scheduled',
      contentId:     contentId  || null,
      content:       content    || null,   // full content object
      caption:       caption    || '',
      hashtags:      hashtags   || '',
      imageUrl:      imageUrl   || null,
      videoUrl:      videoUrl   || null,
      audioUrl:      audioUrl   || null,
      createdAt:     new Date().toISOString(),
      publishedAt:   null,
      error:         null,
    };

    items.push(item);
    await saveSchedule(items);
    return res.status(200).json({ ok: true, item });
  }

  // PATCH — update status or fields
  if (req.method === 'PATCH') {
    const { id, status, scheduledTime, imageUrl, videoUrl, audioUrl, error } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });

    const items = await loadSchedule();
    const idx   = items.findIndex(i => i.id === id);
    if (idx === -1) return res.status(404).json({ error: 'item not found' });

    if (status && VALID_STATUSES.includes(status)) {
      items[idx].status = status;
      if (status === 'posted') items[idx].publishedAt = new Date().toISOString();
    }
    if (scheduledTime) items[idx].scheduledTime = new Date(scheduledTime).toISOString();
    if (imageUrl)      items[idx].imageUrl  = imageUrl;
    if (videoUrl)      items[idx].videoUrl  = videoUrl;
    if (audioUrl)      items[idx].audioUrl  = audioUrl;
    if (error)         items[idx].error     = error;

    await saveSchedule(items);
    return res.status(200).json({ ok: true, item: items[idx] });
  }

  // DELETE — remove by id
  if (req.method === 'DELETE') {
    const id = req.body?.id || req.query?.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    let items = await loadSchedule();
    items = items.filter(i => i.id !== id);
    await saveSchedule(items);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
};

module.exports.loadSchedule = loadSchedule;
module.exports.saveSchedule = saveSchedule;
