const {
  createSessionToken,
  expiredSessionCookie,
  getConfig,
  isAuthenticated,
  safeEqual,
  sessionCookie,
} = require('./_admin-auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ authenticated: isAuthenticated(req) });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', expiredSessionCookie());
    return res.status(200).json({ authenticated: false });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, secret } = getConfig();
  if (!password || !secret) {
    return res.status(503).json({ error: 'Admin login is not configured' });
  }

  if (!safeEqual(req.body?.password, password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  res.setHeader('Set-Cookie', sessionCookie(createSessionToken(secret)));
  return res.status(200).json({ authenticated: true });
};
