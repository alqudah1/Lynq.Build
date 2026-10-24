const { put } = require('@vercel/blob');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { text, voiceId, title } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });

  const EL_KEY = process.env.ELEVENLABS_API_KEY;
  if (!EL_KEY) return res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY — add it in Vercel environment variables' });

  const voice = voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel default

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key':   EL_KEY,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail?.message || err.detail || `ElevenLabs error ${r.status}`);
    }

    const audioBuffer = await r.arrayBuffer();
    const slug     = (title || 'voice').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const filename = `lynq-audio/${Date.now()}-${slug}.mp3`;
    const blob     = await put(filename, Buffer.from(audioBuffer), {
      access: 'public', contentType: 'audio/mpeg', addRandomSuffix: false,
    });

    return res.status(200).json({ ok: true, url: blob.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
