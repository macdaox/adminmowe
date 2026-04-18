const crypto = require('crypto');

function getAdminToken() {
  const token = process.env.ADMIN_TOKEN;
  if (token && token.trim()) return token.trim();
  return 'dev-admin-token';
}

function getAdminUsername() {
  const u = process.env.ADMIN_USERNAME;
  if (u && u.trim()) return u.trim();
  return 'admin';
}

function getAdminPassword() {
  const p = process.env.ADMIN_PASSWORD;
  if (p && p.trim()) return p;
  if (process.env.NODE_ENV === 'production') return '';
  return 'admin123456';
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  const len = Math.max(aa.length, bb.length);
  const ap = Buffer.concat([aa, Buffer.alloc(len - aa.length)]);
  const bp = Buffer.concat([bb, Buffer.alloc(len - bb.length)]);
  return crypto.timingSafeEqual(ap, bp) && aa.length === bb.length;
}

function verifyAdminLogin(username, password) {
  const expectedUser = getAdminUsername();
  const expectedPass = getAdminPassword();
  if (!expectedPass) return { ok: false, reason: 'password_not_configured' };
  if (!safeEqual(username, expectedUser)) return { ok: false, reason: 'invalid_credentials' };
  if (!safeEqual(password, expectedPass)) return { ok: false, reason: 'invalid_credentials' };
  return { ok: true };
}

function adminAuth(req, res, next) {
  const expected = getAdminToken();
  const got = req.header('x-admin-token') || '';
  if (got === expected) return next();
  res.status(401).json({ error: 'unauthorized' });
}

module.exports = {
  getAdminUsername,
  getAdminPassword,
  verifyAdminLogin,
  getAdminToken,
  adminAuth
};
