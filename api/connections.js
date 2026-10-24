const { put, list } = require('@vercel/blob');

const PATH = 'lynq-tg/connections.json';

// All valid business:platform combinations
const MATRIX = {
  codeit:    ['instagram', 'facebook'],
  lynq:      ['linkedin', 'instagram', 'facebook'],
  insurance: ['linkedin', 'instagram', 'facebook'],
};

function connKey(business, platform) { return `${business}:${platform}`; }

async function loadConnections() {
  try {
    const { blobs } = await list({ prefix: 'lynq-tg/connections' });
    if (!blobs.length) return {};
    const res = await fetch(blobs[0].downloadUrl);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function saveConnections(data) {
  return put(PATH, JSON.stringify(data), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false,
  });
}

async function isConnected(business, platform) {
  const data  = await loadConnections();
  const entry = data[connKey(business, platform)];
  return !!(entry?.accessToken && entry?.status === 'connected');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — return full matrix with status (tokens redacted)
  if (req.method === 'GET') {
    const data   = await loadConnections();
    const result = {};
    for (const [biz, platforms] of Object.entries(MATRIX)) {
      result[biz] = {};
      for (const plat of platforms) {
        const key  = connKey(biz, plat);
        const conn = data[key] || {};
        result[biz][plat] = {
          business:    biz,
          platform:    plat,
          account:     conn.account     || '',
          status:      conn.status      || 'disconnected',
          connectedAt: conn.connectedAt || null,
          lastChecked: conn.lastChecked || null,
          hasToken:    !!(conn.accessToken),
        };
      }
    }
    return res.status(200).json(result);
  }

  // POST — save or update a connection
  if (req.method === 'POST') {
    const { business, platform, account, accessToken } = req.body || {};
    if (!business || !MATRIX[business]) {
      return res.status(400).json({ error: `business must be one of: ${Object.keys(MATRIX).join(', ')}` });
    }
    if (!platform || !MATRIX[business].includes(platform)) {
      return res.status(400).json({ error: `platform for ${business} must be: ${MATRIX[business].join(', ')}` });
    }
    const data = await loadConnections();
    const key  = connKey(business, platform);
    const prev = data[key] || {};
    data[key] = {
      business,
      platform,
      account:     account     !== undefined ? account     : (prev.account     || ''),
      accessToken: accessToken !== undefined ? accessToken : (prev.accessToken || ''),
      status:      accessToken ? 'connected' : (prev.status || 'disconnected'),
      connectedAt: accessToken ? new Date().toISOString() : (prev.connectedAt || null),
      lastChecked: new Date().toISOString(),
    };
    await saveConnections(data);
    return res.status(200).json({ ok: true, key, status: data[key].status });
  }

  // DELETE — disconnect
  if (req.method === 'DELETE') {
    const { business, platform } = req.body || req.query || {};
    if (!business || !platform) return res.status(400).json({ error: 'business and platform required' });
    const data = await loadConnections();
    const key  = connKey(business, platform);
    if (data[key]) {
      data[key].status      = 'disconnected';
      data[key].accessToken = '';
      data[key].connectedAt = null;
      data[key].lastChecked = new Date().toISOString();
    }
    await saveConnections(data);
    return res.status(200).json({ ok: true, key, status: 'disconnected' });
  }

  return res.status(405).end();
};

module.exports.loadConnections = loadConnections;
module.exports.isConnected     = isConnected;
module.exports.MATRIX          = MATRIX;
