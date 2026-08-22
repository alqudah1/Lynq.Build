const crypto = require('crypto');

const COOKIE_NAME = 'lynq_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest();
}

function safeEqual(left, right) {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

function getConfig() {
  return {
    password: process.env.LYNQ_ADMIN_PASSWORD || '',
    secret: process.env.LYNQ_ADMIN_SESSION_SECRET || '',
  };
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionToken(secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    issuedAt: now,
    nonce: crypto.randomBytes(16).toString('base64url'),
  })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function verifySessionToken(token, secret, now = Date.now()) {
  if (!token || !secret) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload, secret))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(data.issuedAt) && data.issuedAt <= now && now - data.issuedAt <= SESSION_TTL_MS;
  } catch {
    return false;
  }
}

function isAuthenticated(req) {
  const { secret } = getConfig();
  const token = parseCookies(req.headers?.cookie || '')[COOKIE_NAME];
  return verifySessionToken(token, secret);
}

function requireAdmin(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: 'Admin authentication required' });
  return false;
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function expiredSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

module.exports = {
  createSessionToken,
  expiredSessionCookie,
  getConfig,
  isAuthenticated,
  requireAdmin,
  safeEqual,
  sessionCookie,
  verifySessionToken,
};
