/**
 * Asset Engine — unified asset generation with graceful fallback.
 * If APIs are connected: generate real image/voice/video.
 * If APIs are unavailable: return text prompts only. Never fails.
 *
 * POST { business, hook, script, imagePrompt, videoPrompt, platform, voiceId }
 * Returns { image, voice, video, fallback }
 */

const { put } = require('@vercel/blob');

const BASE_RUNWAY  = 'https://api.dev.runwayml.com/v1';
const RW_VERSION   = '2024-11-06';

// ── Platform size maps ──────────────────────────────────────────────────────

const GPT_SIZES = {
  tiktok: '1024x1536', reels: '1024x1536', shorts: '1024x1536', stories: '1024x1536',
  youtube: '1792x1024', linkedin: '1024x1024', facebook: '1024x1024',
};
const RUNWAY_RATIOS = {
  tiktok: '768:1280', reels: '768:1280', shorts: '768:1280', stories: '768:1280',
  youtube: '1280:768', linkedin: '1280:768', facebook: '1280:768',
};

// ── Generate image (OpenAI → fallback to prompt) ────────────────────────────

async function generateImage({ prompt, platform, title, openaiKey }) {
  if (!openaiKey) {
    return { type: 'prompt', prompt, message: 'OpenAI not connected. Use this prompt in your image tool.' };
  }
  const size = GPT_SIZES[platform] || '1024x1024';
  try {
    const r1 = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size, quality: 'medium' }),
    });
    const d1 = await r1.json();
    let b64 = d1.data?.[0]?.b64_json;

    if (!b64 && (d1.error?.code === 'model_not_found' || r1.status === 404)) {
      const r2 = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1792', quality: 'standard', response_format: 'b64_json' }),
      });
      const d2 = await r2.json();
      if (r2.ok) b64 = d2.data?.[0]?.b64_json;
      else return { type: 'prompt', prompt, message: d2.error?.message || 'Image generation failed.' };
    } else if (!r1.ok) {
      return { type: 'prompt', prompt, message: d1.error?.message || 'Image generation failed.' };
    }

    const slug     = (title || 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const filename = `lynq-images/${Date.now()}-${slug}.jpg`;
    const blob     = await put(filename, Buffer.from(b64, 'base64'), {
      access: 'public', contentType: 'image/jpeg', addRandomSuffix: false,
    });
    return { type: 'image', url: blob.url, size };
  } catch (e) {
    return { type: 'prompt', prompt, message: e.message };
  }
}

// ── Generate voice (ElevenLabs → fallback to script) ───────────────────────

async function generateVoice({ text, voiceId, title, elKey }) {
  if (!elKey) {
    return { type: 'script', text, message: 'ElevenLabs not connected. Record this script as your voiceover.' };
  }
  const voice = voiceId || '21m00Tcm4TlvDq8ikWAM';
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return { type: 'script', text, message: err.detail?.message || err.detail || `ElevenLabs error ${r.status}` };
    }
    const buf      = await r.arrayBuffer();
    const slug     = (title || 'voice').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const filename = `lynq-audio/${Date.now()}-${slug}.mp3`;
    const blob     = await put(filename, Buffer.from(buf), {
      access: 'public', contentType: 'audio/mpeg', addRandomSuffix: false,
    });
    return { type: 'audio', url: blob.url };
  } catch (e) {
    return { type: 'script', text, message: e.message };
  }
}

// ── Start video (Runway → fallback to prompt) ──────────────────────────────

async function startVideo({ prompt, platform, imageUrl, runwayKey }) {
  if (!runwayKey) {
    return { type: 'prompt', prompt, message: 'Runway not connected. Use this prompt in your video tool.' };
  }
  const ratio = RUNWAY_RATIOS[platform] || '1280:768';
  const auth  = {
    'Authorization':    `Bearer ${runwayKey}`,
    'Content-Type':     'application/json',
    'X-Runway-Version': RW_VERSION,
  };
  const taskBody = imageUrl
    ? { taskType: 'image_to_video', model: 'gen3a_turbo', promptImage: imageUrl, promptText: prompt, duration: 5, ratio }
    : { taskType: 'text_to_video',  model: 'gen3a_turbo', textPrompt: prompt, duration: 5, ratio };

  try {
    const r    = await fetch(`${BASE_RUNWAY}/tasks`, { method: 'POST', headers: auth, body: JSON.stringify(taskBody) });
    const data = await r.json();
    if (!r.ok) return { type: 'prompt', prompt, message: data.message || 'Runway error' };
    return { type: 'task', taskId: data.id, status: data.status || 'PENDING' };
  } catch (e) {
    return { type: 'prompt', prompt, message: e.message };
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { business, hook, script, imagePrompt, videoPrompt, platform, voiceId, title } = req.body || {};

  const openaiKey = process.env.OPENAI_API_KEY   || null;
  const elKey     = process.env.ELEVENLABS_API_KEY || null;
  const runwayKey = process.env.RUNWAY_API_KEY    || null;

  const imgPrompt   = imagePrompt || hook || '';
  const vidPrompt   = videoPrompt || imagePrompt || hook || '';
  const voiceText   = script || hook || '';
  const assetTitle  = title || business || 'asset';

  const [image, voice, video] = await Promise.all([
    generateImage({ prompt: imgPrompt,  platform, title: assetTitle, openaiKey }),
    generateVoice({ text: voiceText,    voiceId,  title: assetTitle, elKey }),
    startVideo({   prompt: vidPrompt,   platform, runwayKey }),
  ]);

  const fallback = image.type !== 'image' || voice.type !== 'audio' || video.type === 'prompt';

  return res.status(200).json({
    ok: true,
    fallback,
    apis: { openai: !!openaiKey, elevenlabs: !!elKey, runway: !!runwayKey },
    image,
    voice,
    video,
  });
};

module.exports.generateImage = generateImage;
module.exports.generateVoice = generateVoice;
module.exports.startVideo    = startVideo;
