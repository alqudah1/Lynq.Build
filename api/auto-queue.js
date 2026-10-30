const { generateQueue } = require('./_lib/gen-queue');
const { loadBis }       = require('./_lib/tg-session');
const { loadMemory }    = require('./_lib/tg-memory');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { recentPosts = [] } = req.body || {};
    const [bisMemory, agentMemory] = await Promise.all([loadBis(), loadMemory()]);
    const result = await generateQueue(bisMemory, agentMemory, recentPosts);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
