const BASE    = 'https://api.dev.runwayml.com/v1';
const VERSION = '2024-11-06';

const PORTRAIT_RATIO  = '768:1280';
const LANDSCAPE_RATIO = '1280:768';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const RUNWAY_KEY = process.env.RUNWAY_API_KEY;
  if (!RUNWAY_KEY) return res.status(500).json({ error: 'Missing RUNWAY_API_KEY — add it in Vercel environment variables' });

  const auth = {
    'Authorization':   `Bearer ${RUNWAY_KEY}`,
    'Content-Type':    'application/json',
    'X-Runway-Version': VERSION,
  };

  // Poll: GET ?taskId=xxx
  if (req.method === 'GET') {
    const taskId = req.query?.taskId;
    if (!taskId) return res.status(400).json({ error: 'taskId required' });
    try {
      const r    = await fetch(`${BASE}/tasks/${taskId}`, { headers: auth });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Runway error');
      return res.status(200).json({
        taskId,
        status:   data.status,
        videoUrl: data.output?.[0] || null,
        error:    data.failure    || null,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Start: POST { prompt, platform, imageUrl? }
  if (req.method !== 'POST') return res.status(405).end();

  const { prompt, platform, imageUrl } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const isPortrait = ['tiktok', 'reels', 'shorts', 'stories'].includes(platform);
  const ratio      = isPortrait ? PORTRAIT_RATIO : LANDSCAPE_RATIO;

  const taskBody = imageUrl
    ? { taskType: 'image_to_video', model: 'gen3a_turbo', promptImage: imageUrl, promptText: prompt, duration: 5, ratio }
    : { taskType: 'text_to_video',  model: 'gen3a_turbo', textPrompt: prompt, duration: 5, ratio };

  try {
    const r    = await fetch(`${BASE}/tasks`, { method: 'POST', headers: auth, body: JSON.stringify(taskBody) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Runway error');
    return res.status(200).json({ ok: true, taskId: data.id, status: data.status || 'PENDING' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
