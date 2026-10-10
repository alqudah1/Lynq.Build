// Kingsbridge Group — contact form delivery endpoint.
//
// Runs as a Vercel Node.js Function at /api/contact on the Kingsbridge project
// (same origin as the site, so no CORS and no third-party form service). Delivers every
// valid inquiry to the Kingsbridge mailbox via Microsoft Graph sendMail using the
// client-credentials flow against the existing Microsoft 365 tenant.
//
// SECURITY: every Microsoft value lives in server-side environment variables and is read
// only inside this function. Nothing here is bundled into or referenced by any browser
// asset — the site is plain static HTML, so there is no build step that could inline them.
// Never log a secret, an access token, or an Authorization header.
//
// DELIVERY PROVIDER (Oct 2026): Kingsbridge mail moved to Google Workspace. When both Gmail
// variables below are set, inquiries are sent through Gmail SMTP (smtp.gmail.com:465, TLS)
// as the Workspace mailbox, so they land in Gmail. Sending through Microsoft Graph would keep
// delivering inside the old Microsoft 365 tenant (internal delivery ignores MX), so the
// Gmail path takes priority. If the Gmail variables are absent, the Graph path below is used
// unchanged. No dependencies: the SMTP exchange uses Node's built-in `tls` module.
//
//   GMAIL_USER          The Workspace mailbox to send AS, e.g. admin@kingsbridgegroup.ca
//   GMAIL_APP_PASSWORD  A Google app password for that mailbox (requires 2-Step Verification)
//
// Microsoft Graph environment variables (fallback when Gmail is not configured):
//   MS_TENANT_ID       Directory (tenant) ID of the Kingsbridge Microsoft Entra tenant
//   MS_CLIENT_ID       Application (client) ID of the app registration
//   MS_CLIENT_SECRET   Client secret VALUE (not the secret ID)
//   MS_SENDER_UPN      Mailbox the mail is sent AS, e.g. admin@kingsbridgegroup.ca
//   CONTACT_RECIPIENT  Optional. Where inquiries are delivered. Defaults to admin@kingsbridgegroup.ca
//
// Microsoft Entra app registration needs the APPLICATION permission Mail.Send with admin
// consent granted. Mail.Send (application) is tenant-wide by default, so it MUST be scoped
// to the single sender mailbox with an Exchange Online application access policy — see
// 08_Final_Delivery/contact-form-setup.md for the exact commands.

const GRAPH_SEND_TIMEOUT_MS = 10000;
const DEFAULT_RECIPIENT = 'admin@kingsbridgegroup.ca';

// The only inquiry types the form offers. Anything else is rejected rather than echoed
// into an email subject line.
const INQUIRY_TYPES = [
  'Custom Home Inquiry',
  'Commercial Property Management Inquiry',
  'General Inquiry'
];

// Every field the form can submit, with the label used in the email and a length cap.
// Unknown keys in the payload are ignored entirely.
const FIELDS = [
  ['name', 'Name', 100],
  ['email', 'Email', 254],
  ['phone', 'Phone', 40],
  ['cm-company', 'Company', 120],
  ['ch-location', 'Project Location', 160],
  ['ch-type', 'Project Type', 60],
  ['ch-timing', 'Timeline', 60],
  ['cm-location', 'Property Location', 160],
  ['cm-type', 'Property Type', 60],
  ['cm-size', 'Approximate Size / Units', 120],
  ['cm-needs', 'Support Needed', 60],
  ['message', 'Message', 5000]
];

// Hosts allowed to POST here. A request with no Origin header (a same-origin fetch) is
// always allowed; a cross-origin Origin that is not on this list is refused.
const ALLOWED_ORIGIN_HOSTS = [
  'www.kingsbridgegroup.ca',
  'kingsbridgegroup.ca',
  'localhost',
  '127.0.0.1'
];

// --- in-memory throttling -------------------------------------------------------------
// Fluid Compute reuses a warm instance across requests, so these maps do real work for the
// bursty abuse they target (one visitor hammering submit, a script replaying a payload).
// They are per-instance, not global — deliberately "basic" protection as specified, and the
// honeypot plus Graph-side throttling carry the rest.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const MIN_FILL_TIME_MS = 3000;

// Longer than a token request plus a send (two 10s Graph timeouts), so an attempt whose
// instance died mid-send can never block that inquiry for good.
const PENDING_STALE_MS = 60 * 1000;

const rateBuckets = new Map();
// Successful-delivery deduplication: key -> { state: 'pending' | 'sent', at }.
// An entry exists ONLY around a real Microsoft Graph send — 'pending' while Graph is being
// called, 'sent' once Graph has accepted the message. A failed send removes its entry, so a
// failure can never be mistaken for a delivered inquiry and the visitor can genuinely retry.
const deliveries = new Map();

function sweep(map, now) {
  if (map.size < 500) return;
  for (const [key, value] of map) {
    const last = Array.isArray(value) ? value[value.length - 1] : value.at;
    if (now - last > RATE_LIMIT_WINDOW_MS) map.delete(key);
  }
}

function rateLimited(ip, now) {
  sweep(rateBuckets, now);
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  rateBuckets.set(ip, hits);
  return hits.length > RATE_LIMIT_MAX;
}

// Read-only: reports what already happened to this inquiry, never records anything.
// 'sent'    — Graph accepted it within the duplicate window; do not send it again.
// 'pending' — an identical request is being sent right now; do not start a second send.
// null      — never delivered (or the record expired): a genuine attempt may proceed.
function deliveryState(key, now) {
  sweep(deliveries, now);
  const entry = deliveries.get(key);
  if (!entry) return null;
  if (entry.state === 'sent' && now - entry.at < DUPLICATE_WINDOW_MS) return 'sent';
  if (entry.state === 'pending' && now - entry.at < PENDING_STALE_MS) return 'pending';
  deliveries.delete(key);
  return null;
}

// --- helpers --------------------------------------------------------------------------

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function clean(value, max) {
  if (value === undefined || value === null) return '';
  // Strip control characters (including CR/LF, which is what would let a crafted value
  // break out of a subject line) and collapse the result to the field's cap.
  return String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_ORIGIN_HOSTS.includes(host) || /\.vercel\.app$/.test(host);
  } catch {
    return false;
  }
}

// --- Microsoft Graph ------------------------------------------------------------------

// Tokens last ~1 hour. Cache on the warm instance and refresh a minute early so a request
// never races the expiry.
let cachedToken = null;

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) return cachedToken.value;

  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    client_secret: env.MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(GRAPH_SEND_TIMEOUT_MS)
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    // Log only Microsoft's error code/description — never the token response itself.
    const err = new Error('token_request_failed');
    err.detail = `${response.status} ${payload.error || ''} ${payload.error_description || ''}`.trim();
    throw err;
  }

  cachedToken = {
    value: payload.access_token,
    expiresAt: now + (Number(payload.expires_in) || 3600) * 1000
  };
  return cachedToken.value;
}

async function sendViaGraph(env, { subject, html, replyTo, recipient }) {
  const token = await getAccessToken(env);

  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: recipient } }]
  };
  // Reply-To is only set from a visitor address that passed strict validation, so hitting
  // reply in Outlook goes straight back to the person who submitted the form.
  if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo } }];

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MS_SENDER_UPN)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: false }),
      signal: AbortSignal.timeout(GRAPH_SEND_TIMEOUT_MS)
    }
  );

  // sendMail returns 202 Accepted with an empty body on success.
  if (response.status === 202) return;

  let detail = String(response.status);
  try {
    const body = await response.json();
    if (body && body.error) detail += ` ${body.error.code || ''} ${body.error.message || ''}`;
  } catch {
    /* non-JSON error body — the status alone is enough to diagnose */
  }
  // A stale cached token would produce a 401; drop it so the next attempt re-authenticates.
  if (response.status === 401) cachedToken = null;
  const err = new Error('graph_send_failed');
  err.detail = detail.trim();
  throw err;
}

// --- Gmail SMTP (Google Workspace) ----------------------------------------------------

const tls = require('tls');

const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const GMAIL_SMTP_PORT = 465;

function gmailConfigured(env) {
  return Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
}

// RFC 2047 encoded-word, so names and inquiry types with non-ASCII characters survive.
function encodeHeader(value) {
  const text = String(value).replace(/[\r\n]/g, ' ');
  return /^[\x20-\x7E]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrapBase64(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
}

// Builds the RFC 5322 message. Exported for tests.
function buildMimeMessage({ from, to, replyTo, subject, html, date = new Date() }) {
  const domain = String(from).split('@')[1] || 'localhost';
  const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${domain}>`;
  const headers = [
    `From: "Kingsbridge Website" <${from}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(html)}`;
}

// Minimal SMTP client for one message over implicit TLS. Resolves on a 250 after DATA,
// rejects on any unexpected reply code, socket error or timeout. Never logs credentials.
function smtpSend({ host, port, user, pass, from, to, data, timeoutMs = GRAPH_SEND_TIMEOUT_MS, connect = tls.connect }) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host });
    let buffer = '';
    let settled = false;
    const steps = [
      { expect: 220, send: `EHLO kingsbridgegroup.ca` },
      { expect: 250, send: `AUTH PLAIN ${Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64')}` },
      { expect: 235, send: `MAIL FROM:<${from}>` },
      { expect: 250, send: `RCPT TO:<${to}>` },
      { expect: 250, send: 'DATA' },
      // Dot-stuff any line that begins with "." (RFC 5321 §4.5.2), then terminate.
      { expect: 354, send: `${data.replace(/\r\n\./g, '\r\n..')}\r\n.` },
      { expect: 250, send: 'QUIT', done: true }
    ];
    let index = 0;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        socket.destroy();
        reject(err);
      } else {
        socket.end();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      const err = new Error('gmail_send_failed');
      err.detail = 'timeout';
      finish(err);
    }, timeoutMs);

    socket.setEncoding('utf8');
    socket.on('error', (e) => {
      const err = new Error('gmail_send_failed');
      err.detail = e.code || 'socket_error';
      finish(err);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      // A reply is complete when its last line has a space after the code ("250 OK").
      let match;
      while ((match = buffer.match(/^(\d{3})([ -])(.*)\r?\n/m)) && match.index === 0) {
        buffer = buffer.slice(match[0].length);
        if (match[2] === '-') continue;
        const code = Number(match[1]);
        const step = steps[index];
        if (!step) return;
        if (code !== step.expect) {
          const err = new Error('gmail_send_failed');
          // Reply code and server text only — AUTH replies never echo the password.
          err.detail = `${code} ${match[3]}`.slice(0, 200);
          return finish(err);
        }
        socket.write(`${step.send}\r\n`);
        index += 1;
        if (step.done) return finish();
      }
    });
  });
}

async function sendViaGmail(env, { subject, html, replyTo, recipient }) {
  const from = env.GMAIL_USER;
  const data = buildMimeMessage({ from, to: recipient, replyTo, subject, html });
  await smtpSend({
    host: GMAIL_SMTP_HOST,
    port: GMAIL_SMTP_PORT,
    user: from,
    // Google displays app passwords in groups of four; spaces are not part of the password.
    pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, ''),
    from,
    to: recipient,
    data
  });
}

// --- handler --------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!originAllowed(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden.' });
  }

  let body;
  try {
    body = req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }

  // Honeypot: a real visitor never sees or fills the "website" input. Answer 200 so a bot
  // gets no signal that it was caught, but send nothing.
  if (clean(body.website, 200)) {
    return res.status(200).json({ ok: true });
  }

  // Submitted faster than a human could plausibly complete the form.
  const renderedAt = Number(body.renderedAt);
  if (Number.isFinite(renderedAt) && renderedAt > 0) {
    const elapsed = Date.now() - renderedAt;
    if (elapsed >= 0 && elapsed < MIN_FILL_TIME_MS) {
      return res.status(200).json({ ok: true });
    }
  }

  // Validate.
  const values = {};
  for (const [key, , max] of FIELDS) values[key] = clean(body[key], max);

  const inquiryType = clean(body.inquiryType, 80);
  const errors = [];
  if (values.name.length < 2) errors.push('a full name');
  if (!isEmail(values.email)) errors.push('a valid email address');
  if (values.message.length < 10) errors.push('a message of at least 10 characters');
  if (!INQUIRY_TYPES.includes(inquiryType)) errors.push('a valid inquiry type');

  if (errors.length) {
    // Field NAMES only — never the values, which are the visitor's personal details.
    // Without this a rejected submission is invisible in the logs: it looks to the visitor
    // like "the form is broken", and all anyone can see afterwards is a bare 400.
    const invalid = [
      values.name.length < 2 && 'name',
      !isEmail(values.email) && 'email',
      values.message.length < 10 && 'message',
      !INQUIRY_TYPES.includes(inquiryType) && 'inquiryType'
    ].filter(Boolean);
    console.warn('[contact] rejected: invalid fields:', invalid.join(', '));
    return res.status(400).json({ ok: false, error: `Please provide ${errors.join(', ')}.` });
  }

  const now = Date.now();
  const ip = clientIp(req);
  if (rateLimited(ip, now)) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({
      ok: false,
      error: 'Too many submissions from this connection. Please try again shortly.'
    });
  }
  const dedupeKey = `${values.email}|${values.message}`.toLowerCase();
  const prior = deliveryState(dedupeKey, now);
  if (prior === 'sent') {
    // This exact inquiry was genuinely delivered moments ago — a double click or a resubmit.
    // Kingsbridge already has it, so confirm without sending a second copy. `delivered` is
    // deliberately absent: no new lead happened, so the page must not report one.
    return res.status(200).json({ ok: true, duplicate: true });
  }
  if (prior === 'pending') {
    // An identical request is mid-send. Refuse rather than race it into a second email;
    // nothing is claimed as delivered, and the visitor can retry once it settles.
    return res.status(409).json({
      ok: false,
      error: 'This inquiry is already being sent. Please wait a moment before trying again.'
    });
  }

  const env = process.env;
  const useGmail = gmailConfigured(env);
  const missing = useGmail
    ? []
    : ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_SENDER_UPN'].filter((k) => !env[k]);
  if (missing.length) {
    // Names only — never values.
    console.error('[contact] missing environment variables:', missing.join(', '));
    return res.status(503).json({ ok: false, error: 'Inquiry delivery is not configured yet.' });
  }

  const recipient = clean(env.CONTACT_RECIPIENT, 254) || DEFAULT_RECIPIENT;
  const subject = clean(`Kingsbridge Website Inquiry — ${inquiryType} — ${values.name}`, 200);

  const rows = FIELDS
    .filter(([key]) => values[key])
    .map(([key, label]) => {
      const value = escapeHtml(values[key]).replace(/\n/g, '<br>');
      return `<tr>
        <td style="padding:6px 16px 6px 0;vertical-align:top;color:#6b6b6b;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;vertical-align:top;color:#141414;">${value}</td>
      </tr>`;
    })
    .join('');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#141414;">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a6a3b;">Kingsbridge Website Inquiry</p>
  <p style="margin:0 0 18px;font-size:18px;font-weight:600;">${escapeHtml(inquiryType)}</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
  <p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e4e0d8;font-size:12px;color:#8a8a8a;">
    Submitted ${escapeHtml(new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' }))} (Toronto)
    via kingsbridgegroup.ca. Reply directly to this email to respond to ${escapeHtml(values.name)}.
  </p>
</div>`;

  // Mark in-flight immediately before the send, so a concurrent identical request cannot
  // start a second one. Only a confirmed Graph acceptance turns this into 'sent'.
  deliveries.set(dedupeKey, { state: 'pending', at: Date.now() });
  try {
    const send = useGmail ? sendViaGmail : sendViaGraph;
    await send(env, { subject, html, replyTo: values.email, recipient });
    deliveries.set(dedupeKey, { state: 'sent', at: Date.now() });
    // `delivered: true` is returned ONLY here, after Gmail (250 after DATA) or Microsoft
    // Graph (202) accepted the message.
    // The page fires the GA4 generate_lead conversion on this flag and nothing else.
    return res.status(200).json({ ok: true, delivered: true });
  } catch (error) {
    // Not delivered: forget the attempt entirely so the same inquiry can be retried.
    deliveries.delete(dedupeKey);
    // error.detail carries the provider's error code and message only — no token, no secret.
    console.error('[contact] delivery failed:', error.message, error.detail || '');
    return res.status(502).json({
      ok: false,
      error: 'We could not send your inquiry automatically.'
    });
  }
};

// Test hooks (not used at runtime).
module.exports._internal = { buildMimeMessage, smtpSend, gmailConfigured, encodeHeader };
