const nodemailer = require('nodemailer');
const { put } = require('@vercel/blob');

const RATE_LIMIT = 8;
const WINDOW_MS = 60 * 60 * 1000;
const hits = globalThis.__lynqBookRateLimit || (globalThis.__lynqBookRateLimit = new Map());

function checkRateLimit(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
}

const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

async function notifyCompanyInbox(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_ALLOWED_USER_ID || '').trim();
  if (!token || !chatId) return false;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: `New lynq.build project inquiry\n\n${text}` }),
  });
  return response.ok;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please email mustafa@lynq.build directly.' });
  }

  const { name, business, email, message, website, service, timeline, budget } = req.body || {};

  // Honeypot: real visitors never fill in a field this hidden.
  if (website) return res.status(200).json({ ok: true });

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !isValidEmail(String(email).trim())) return res.status(400).json({ error: 'A valid email is required.' });
  if (String(name).length > 200 || String(business || '').length > 200 || String(message || '').length > 4000) {
    return res.status(400).json({ error: 'One of the fields is too long.' });
  }

  const cleanName = String(name).trim();
  const cleanBusiness = String(business || '').trim();
  const cleanEmail = String(email).trim();
  const cleanMessage = String(message || '').trim();
  const cleanService = String(service || '').trim();
  const cleanTimeline = String(timeline || '').trim();
  const cleanBudget = String(budget || '').trim();

  const bodyText = [
    `Name: ${cleanName}`,
    `Business: ${cleanBusiness || '—'}`,
    `Email: ${cleanEmail}`,
    `Service: ${cleanService || '—'}`,
    `Timeline: ${cleanTimeline || '—'}`,
    `Budget: ${cleanBudget || '—'}`,
    '',
    cleanMessage || '(no message provided)',
  ].join('\n');

  let delivered = false;
  const ZOHO_PASS = process.env.ZOHO_APP_PASSWORD;
  if (ZOHO_PASS) try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zohocloud.ca', port: 465, secure: true,
      auth: { user: 'hello@lynq.build', pass: ZOHO_PASS },
    });
    await transporter.sendMail({
      from: '"LYNQ Website" <hello@lynq.build>',
      // Keep the existing authenticated SMTP transport, but deliver every
      // website inquiry to the active Microsoft 365 company mailbox.
      to: 'mustafa@lynq.build',
      replyTo: cleanEmail,
      subject: `Project inquiry from ${cleanName}${cleanBusiness ? ' — ' + cleanBusiness : ''}`,
      text: bodyText,
    });
    delivered = true;
  } catch (err) {
    console.error('book-request send failed:', err);
  }

  // The public contact address moved from Zoho to Microsoft 365. Until the
  // Microsoft mailbox transport is connected here, deliver inquiries through
  // the existing private company notification channel instead of losing them.
  if (!delivered) {
    try { delivered = await notifyCompanyInbox(bodyText); }
    catch (err) { console.error('book-request notification fallback failed:', err); }
  }

  // Final durable fallback: preserve the inquiry in the project's private
  // operational storage so a temporary mail-provider issue cannot lose a lead.
  if (!delivered && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      await put(`website-inquiries/${id}.json`, JSON.stringify({
        receivedAt: new Date().toISOString(),
        name: cleanName,
        business: cleanBusiness,
        email: cleanEmail,
        message: cleanMessage,
        service: cleanService,
        timeline: cleanTimeline,
        budget: cleanBudget,
      }), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
      delivered = true;
    } catch (err) { console.error('book-request durable fallback failed:', err); }
  }

  if (!delivered) return res.status(500).json({ error: 'Could not send right now. Please email mustafa@lynq.build directly.' });

  return res.status(200).json({ ok: true });
};
