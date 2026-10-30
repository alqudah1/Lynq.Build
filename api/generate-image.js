const { put } = require('@vercel/blob');

const GPT_SIZES = {
  tiktok: '1024x1536', reels: '1024x1536', shorts: '1024x1536', stories: '1024x1536',
  linkedin: '1024x1024', facebook: '1024x1024',
};
const DE3_SIZES = {
  tiktok: '1024x1792', reels: '1024x1792', shorts: '1024x1792', stories: '1024x1792',
  linkedin: '1024x1024', facebook: '1024x1024',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { prompt, platform, conceptTitle } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY — add it in Vercel environment variables' });

  const gptSize = GPT_SIZES[platform] || '1024x1024';
  const de3Size = DE3_SIZES[platform] || '1024x1024';

  let b64;
  try {
    // Try gpt-image-1 first
    const r1 = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: gptSize, quality: 'medium' }),
    });
    const d1 = await r1.json();

    if (r1.ok && d1.data?.[0]?.b64_json) {
      b64 = d1.data[0].b64_json;
    } else if (d1.error?.code === 'model_not_found' || r1.status === 404) {
      // Fallback: dall-e-3
      const r2 = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: de3Size, quality: 'standard', response_format: 'b64_json' }),
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error?.message || 'OpenAI error');
      b64 = d2.data?.[0]?.b64_json;
    } else if (!r1.ok) {
      throw new Error(d1.error?.message || 'OpenAI error');
    }

    if (!b64) throw new Error('No image data returned');

    const slug     = (conceptTitle || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const filename = `lynq-images/${Date.now()}-${slug}.jpg`;
    const buffer   = Buffer.from(b64, 'base64');
    const blob     = await put(filename, buffer, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: false });

    return res.status(200).json({ ok: true, url: blob.url, size: gptSize });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
