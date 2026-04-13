const https = require('https');
const http = require('http');
const { URL } = require('url');

function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function checkWebsite(url) {
  if (!url || !url.trim()) return { score: 0, reason: 'No website', qualified: true };
  let clean = url.trim();
  if (!clean.startsWith('http')) clean = 'https://' + clean;
  try {
    const parsed = new URL(clean);
    const lib = parsed.protocol === 'https:' ? https : http;
    return new Promise(resolve => {
      const req = lib.request({
        hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
        method: 'GET', timeout: 6000,
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
      }, res => {
        let body = '';
        res.on('data', c => { body += c; if (body.length > 50000) req.destroy(); });
        res.on('end', () => {
          const issues = [];
          let score = 100;
          if (!body.includes('viewport')) { issues.push('Not mobile-responsive'); score -= 30; }
          if (!clean.startsWith('https')) { issues.push('No HTTPS'); score -= 20; }
          if (!body.includes('<meta') || !body.includes('description')) { issues.push('Missing meta'); score -= 15; }
          if (!body.includes('react') && !body.includes('next') && !body.includes('vue') && !body.includes('tailwind') && !body.includes('bootstrap')) {
            issues.push('Outdated tech'); score -= 10;
          }
          if (!body.includes('facebook') && !body.includes('instagram') && !body.includes('twitter')) {
            issues.push('No social links'); score -= 10;
          }
          if (body.length < 2000) { issues.push('Placeholder site'); score -= 25; }
          const qualified = score < 60;
          resolve({ score: Math.max(0, score), reason: issues.length ? issues.join(', ') : 'Decent website', qualified });
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ score: 10, reason: 'Site unreachable', qualified: true }); });
      req.on('error', () => resolve({ score: 5, reason: 'Site broken', qualified: true }));
      req.end();
    });
  } catch {
    return { score: 5, reason: 'Invalid URL', qualified: true };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { city, industry } = req.body || {};
  if (!city || !industry) return res.status(400).json({ error: 'city and industry required' });

  const OUTSCRAPER_KEY = process.env.OUTSCRAPER_API_KEY;
  const WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
  if (!OUTSCRAPER_KEY || !WEBHOOK_URL) return res.status(500).json({ error: 'Missing env vars: OUTSCRAPER_API_KEY and MAKE_WEBHOOK_URL' });

  // Scrape Google Maps via Outscraper
  const params = new URLSearchParams({
    query: `${industry}, ${city}`,
    limit: '20', language: 'en', region: 'CA', async: 'false',
    fields: 'name,full_address,phone,site,owner_name,place_id',
  });

  let businesses = [];
  try {
    const scrape = await httpRequest(
      `https://api.app.outscraper.com/maps/search-v3?${params}`,
      { headers: { 'X-API-KEY': OUTSCRAPER_KEY } }
    );
    businesses = scrape.data?.data?.[0] || [];
  } catch (err) {
    return res.status(500).json({ error: `Outscraper failed: ${err.message}` });
  }

  const leads = [];
  let qualified = 0, sent = 0;

  for (const biz of businesses) {
    const webCheck = await checkWebsite(biz.site);
    if (!webCheck.qualified) continue;
    qualified++;

    const lead = {
      name: biz.name,
      phone: biz.phone || '',
      website: biz.site || '',
      address: biz.full_address || '',
      industry,
      city,
      websiteScore: webCheck.score,
      reason: webCheck.reason,
      sent: false,
    };

    // Send to Make.com webhook → Clay → Instantly
    try {
      const wRes = await httpRequest(WEBHOOK_URL, { method: 'POST' }, {
        first_name: biz.owner_name || biz.name.split(' ')[0] || 'Owner',
        last_name: biz.name.split(' ').slice(1).join(' ') || '',
        email: '',
        company: biz.name,
        linkedin_url: '',
        phone: biz.phone || '',
        website: biz.site || '',
        address: biz.full_address || '',
        industry,
        website_score: webCheck.score,
        website_issues: webCheck.reason,
      });
      if (wRes.status >= 200 && wRes.status < 300) { lead.sent = true; sent++; }
    } catch { /* webhook failure — lead still recorded */ }

    leads.push(lead);
  }

  return res.status(200).json({
    found: businesses.length,
    qualified,
    sent,
    skipped: 0,
    leads,
  });
};
