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

function extractEmail(html) {
  if (!html) return '';
  const mailto = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (mailto) return mailto[1].toLowerCase();
  const skip = ['example.com','sentry.io','wixpress.com','squarespace.com','wordpress.com',
                'schema.org','google.com','facebook.com','w3.org','jquery.com','cloudflare.com'];
  const all = html.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g) || [];
  return (all.find(e => !skip.some(s => e.includes(s))) || '').toLowerCase();
}

async function checkWebsite(url) {
  if (!url || !url.trim()) return { score: 0, reason: 'No website', qualified: true, email: '' };
  let clean = url.trim();
  if (!clean.startsWith('http')) clean = 'https://' + clean;
  try {
    const parsed = new URL(clean);
    const lib = parsed.protocol === 'https:' ? https : http;
    return new Promise(resolve => {
      const req = lib.request({
        hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
        method: 'GET', timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
      }, res => {
        let body = '';
        res.on('data', c => { body += c; if (body.length > 60000) req.destroy(); });
        res.on('end', () => {
          const issues = [];
          let score = 100;
          if (!body.includes('viewport'))    { issues.push('Not mobile-responsive'); score -= 30; }
          if (!clean.startsWith('https'))    { issues.push('No HTTPS'); score -= 20; }
          if (!body.includes('description')) { issues.push('Missing meta description'); score -= 15; }
          if (!body.includes('react') && !body.includes('next') && !body.includes('vue') &&
              !body.includes('tailwind') && !body.includes('bootstrap')) {
            issues.push('Outdated tech'); score -= 10;
          }
          if (!body.includes('facebook') && !body.includes('instagram') && !body.includes('twitter')) {
            issues.push('No social links'); score -= 10;
          }
          if (body.length < 2000) { issues.push('Placeholder site'); score -= 25; }
          resolve({ score: Math.max(0, score), reason: issues.length ? issues.join(', ') : 'Decent website', qualified: score < 60, email: extractEmail(body) });
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ score: 10, reason: 'Site unreachable', qualified: true, email: '' }); });
      req.on('error',   ()  => resolve({ score: 5,  reason: 'Site broken',      qualified: true, email: '' }));
      req.end();
    });
  } catch {
    return { score: 5, reason: 'Invalid URL', qualified: true, email: '' };
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
  if (!OUTSCRAPER_KEY) return res.status(500).json({ error: 'Missing OUTSCRAPER_API_KEY' });

  const key = OUTSCRAPER_KEY.trim();
  const query = `${industry} in ${city}`;

  // ── Scrape via sync API (instant, no polling needed) ──────────────────────
  const params = new URLSearchParams({
    query, limit: '10', language: 'en', region: 'CA', async: 'false',
    fields: 'name,full_address,phone,site,owner_name,rating,reviews,type,photo,description',
  });

  let results = [];
  try {
    const scrapeRes = await fetch(
      `https://api.app.outscraper.com/maps/search-v3?${params}`,
      { headers: { 'X-API-KEY': key } }
    );
    if (scrapeRes.status === 401) return res.status(500).json({ error: 'Outscraper API key invalid' });
    if (scrapeRes.status === 402) return res.status(500).json({ error: 'Outscraper credits exhausted — top up at outscraper.com' });
    if (!scrapeRes.ok) {
      const txt = await scrapeRes.text();
      return res.status(500).json({ error: `Outscraper error ${scrapeRes.status}: ${txt.slice(0, 200)}` });
    }
    const json = await scrapeRes.json();
    results = json?.data?.[0] || [];
  } catch (err) {
    return res.status(500).json({ error: `Outscraper request failed: ${err.message}` });
  }

  if (!results.length) {
    return res.status(200).json({
      found: 0, qualified: 0, sent: 0, skipped: 0, leads: [],
      debug: `No businesses found for "${query}"`,
    });
  }

  // ── Fetch a single page and extract email ────────────────────────────────
  function fetchPage(url) {
    return new Promise(resolve => {
      try {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request({
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname || '/',
          method: 'GET', timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        }, r => {
          let body = '';
          r.on('data', c => { body += c; if (body.length > 50000) req.destroy(); });
          r.on('end', () => resolve(body));
        });
        req.on('timeout', () => { req.destroy(); resolve(''); });
        req.on('error', () => resolve(''));
        req.end();
      } catch { resolve(''); }
    });
  }

  // ── Find email by checking homepage + /contact + /about ──────────────────
  async function findEmail(siteUrl) {
    if (!siteUrl) return '';
    let base = siteUrl.trim();
    if (!base.startsWith('http')) base = 'https://' + base;

    // Skip social/review sites
    const skip = ['instagram.com','facebook.com','twitter.com','yelp.com','google.com','linkedin.com'];
    if (skip.some(s => base.includes(s))) return '';

    try {
      const origin = new URL(base).origin;
      // Check up to 3 pages in sequence — stop as soon as we find an email
      const pages = [base, `${origin}/contact`, `${origin}/contact-us`, `${origin}/about`];
      for (const page of pages) {
        const html = await fetchPage(page);
        const email = extractEmail(html);
        if (email) return email;
      }
      return '';
    } catch { return ''; }
  }

  // ── Score website quality while also finding email ────────────────────────
  function scoreHtml(html, url) {
    if (!html || html.length < 500) return { score: 5, reason: 'Placeholder / unreachable site' };
    const issues = [];
    let score = 100;
    if (!html.includes('viewport'))     { issues.push('Not mobile-friendly'); score -= 35; }
    if (!url.startsWith('https'))       { issues.push('No HTTPS'); score -= 20; }
    if (!html.includes('description')) { issues.push('No meta description'); score -= 15; }
    const modern = html.includes('react') || html.includes('next') || html.includes('vue') ||
                   html.includes('tailwind') || html.includes('bootstrap') || html.includes('wp-content') ||
                   html.includes('squarespace') || html.includes('wix') || html.includes('shopify');
    if (!modern) { issues.push('Outdated / no framework'); score -= 10; }
    const social = html.includes('facebook') || html.includes('instagram') || html.includes('twitter') || html.includes('tiktok');
    if (!social) { issues.push('No social links'); score -= 10; }
    if (html.length < 3000) { issues.push('Very thin content'); score -= 20; }
    return { score: Math.max(0, score), reason: issues.length ? issues.join(', ') : 'Looks decent' };
  }

  // ── Fetch homepage, score it, and extract email in one pass ──────────────
  async function analyseAndFindEmail(siteUrl) {
    if (!siteUrl) return { score: 0, reason: 'No website', email: '' };
    let base = siteUrl.trim();
    if (!base.startsWith('http')) base = 'https://' + base;
    const skip = ['instagram.com','facebook.com','twitter.com','yelp.com','google.com','linkedin.com'];
    if (skip.some(s => base.includes(s))) return { score: 0, reason: 'No website', email: '' };
    try {
      const origin = new URL(base).origin;
      const pages  = [base, `${origin}/contact`, `${origin}/contact-us`, `${origin}/about`];
      let homepageHtml = '';
      let foundEmail = '';
      for (const page of pages) {
        const html = await fetchPage(page);
        if (!html) continue;
        if (!homepageHtml) homepageHtml = html;           // first page = homepage for scoring
        if (!foundEmail) foundEmail = extractEmail(html); // grab email as soon as we see one
        if (foundEmail && homepageHtml) break;
      }
      const { score, reason } = scoreHtml(homepageHtml, base);
      return { score, reason, email: foundEmail };
    } catch { return { score: 5, reason: 'Site error', email: '' }; }
  }

  // ── Run all analysis in parallel ──────────────────────────────────────────
  const analyses = await Promise.all(results.map(biz => analyseAndFindEmail(biz.site)));

  const leads = results.map((biz, i) => {
    const { score, reason, email } = analyses[i];
    const websiteScore = biz.site ? score : 0;
    const finalReason  = biz.site ? reason : 'No website';
    // Qualified = genuinely needs help: no site OR bad site (score < 55)
    const qualified    = !biz.site || websiteScore < 55;
    return {
      name:        biz.name         || '',
      phone:       biz.phone        || '',
      website:     biz.site         || '',
      address:     biz.full_address || '',
      industry,
      city,
      rating:      biz.rating       || null,
      reviews:     biz.reviews      || 0,
      category:    biz.type         || industry,
      photo:       biz.photo        || '',
      description: biz.description  || '',
      ownerName:   biz.owner_name   || '',
      email,
      websiteScore,
      reason:      finalReason,
      qualified,
      sent:        false,
    };
  });

  return res.status(200).json({
    found:     leads.length,
    qualified: leads.length,
    sent:      0,
    skipped:   0,
    leads,
  });
};
