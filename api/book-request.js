const nodemailer = require('nodemailer');
const { put, list } = require('@vercel/blob');

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
    body: JSON.stringify({ chat_id: chatId, text: `New lynq.build consultation booking\n\n${text}` }),
  });
  return response.ok;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Times already booked, so the calendar can grey them out. Only the times
  // are stored and returned here, never who booked them.
  if (req.method === 'GET') {
    let taken = [];
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { blobs } = await list({ prefix: 'book-slots/' });
        taken = blobs.map((b) => Number(b.pathname.slice('book-slots/'.length).replace('.txt', '')))
          .filter((ms) => ms > Date.now()).map((ms) => new Date(ms).toISOString());
      } catch (err) { console.error('book-request slot list failed:', err); }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ taken });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please email mustafa@lynq.build directly.' });
  }

  const { name, business, email, message, website, service, timeline, budget, slot, slotLocal } = req.body || {};

  // Honeypot: real visitors never fill in a field this hidden.
  if (website) return res.status(200).json({ ok: true });

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !isValidEmail(String(email).trim())) return res.status(400).json({ error: 'A valid email is required.' });
  if (String(name).length > 200 || String(business || '').length > 200 || String(message || '').length > 4000) {
    return res.status(400).json({ error: 'One of the fields is too long.' });
  }

  // The call time the visitor picked on the calendar.
  let slotMs = null;
  if (slot) {
    slotMs = Date.parse(String(slot));
    if (!Number.isFinite(slotMs) || slotMs < Date.now() || slotMs > Date.now() + 60 * 24 * 3600 * 1000) {
      return res.status(400).json({ error: 'That call time is no longer available. Please pick another.' });
    }
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { blobs } = await list({ prefix: `book-slots/${slotMs}.txt` });
        if (blobs.length) return res.status(409).json({ error: 'Someone just took that time. Please pick another.' });
      } catch (err) { console.error('book-request slot check failed:', err); }
    }
  }
  const callTime = slotMs
    ? new Date(slotMs).toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Toronto time'
    : '';
  const cleanSlotLocal = String(slotLocal || '').trim().slice(0, 120);

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
    `Call time: ${callTime || 'not picked'}${cleanSlotLocal ? ` (their time: ${cleanSlotLocal})` : ''}`,
    `Service: ${cleanService || '—'}`,
    `Timeline: ${cleanTimeline || '—'}`,
    `Budget: ${cleanBudget || '—'}`,
    '',
    cleanMessage || '(no message provided)',
  ].join('\n');

  let delivered = false;
  let emailed = false;
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
      subject: `${callTime ? 'Call booked: ' + callTime : 'Project inquiry'} · ${cleanName}${cleanBusiness ? ' · ' + cleanBusiness : ''}`,
      text: bodyText,
    });
    delivered = true;
    emailed = true;
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
        callTime,
      }), { access: 'public', contentType: 'application/json', addRandomSuffix: false });
      delivered = true;
    } catch (err) { console.error('book-request durable fallback failed:', err); }
  }

  if (!delivered) return res.status(500).json({ error: 'Could not send right now. Please email mustafa@lynq.build directly.' });

  // Hold the time so nobody else can pick it.
  if (slotMs && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await put(`book-slots/${slotMs}.txt`, 'booked', { access: 'public', contentType: 'text/plain', addRandomSuffix: false });
    } catch (err) { console.error('book-request slot hold failed:', err); }
  }

  // A booking should also reach the phone right away, even when email worked.
  if (slotMs && emailed) {
    try { await notifyCompanyInbox(bodyText); } catch (err) { console.error('book-request phone notice failed:', err); }
  }

  return res.status(200).json({ ok: true });
};
