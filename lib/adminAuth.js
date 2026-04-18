const crypto = require('crypto');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  const len = Math.max(aa.length, bb.length);
  const ap = Buffer.concat([aa, Buffer.alloc(len - aa.length)]);
  const bp = Buffer.concat([bb, Buffer.alloc(len - bb.length)]);
  return crypto.timingSafeEqual(ap, bp) && aa.length === bb.length;
}

function getAdminToken() {
  const token = process.env.ADMIN_TOKEN;
  if (token && token.trim()) return token.trim();
  return 'dev-admin-token';
}

function getAdminEmail() {
  const e = process.env.ADMIN_EMAIL;
  if (e && e.trim()) return e.trim();
  return 'admin@example.com';
}

function getAdminPassword() {
  const p = process.env.ADMIN_PASSWORD;
  if (p && p.trim()) return p;
  if (process.env.NODE_ENV === 'production') return '';
  return 'admin123';
}

function verifyAdminLogin(email, password) {
  const expectedEmail = getAdminEmail();
  const expectedPass = getAdminPassword();
  if (!expectedPass) return { ok: false, reason: 'password_not_configured' };
  if (!safeEqual(email, expectedEmail)) return { ok: false, reason: 'invalid_credentials' };
  if (!safeEqual(password, expectedPass)) return { ok: false, reason: 'invalid_credentials' };
  return { ok: true };
}

function extractBearer(req) {
  const raw = req.header('authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(raw);
  return m ? m[1] : '';
}

function adminAuth(req, res, next) {
  const expected = getAdminToken();
  const got = extractBearer(req) || req.header('x-admin-token') || '';
  if (got === expected) return next();
  res.status(401).json({ ok: false, message: 'unauthorized' });
}

module.exports = {
  getAdminToken,
  getAdminEmail,
  getAdminPassword,
  verifyAdminLogin,
  adminAuth
};
