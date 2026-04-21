const crypto = require('crypto');
const { ensureSchema, getPool, hasMySQLConfig } = require('./mysql');

const ADMIN_USER_ID = 'main';
const HASH_ITERATIONS = 120000;

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

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password || ''), s, HASH_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${HASH_ITERATIONS}$${s}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isFinite(iterations) || iterations <= 0 || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, 'sha256').toString('hex');
  return safeEqual(actual, expected);
}

async function getDbAdminUser() {
  if (!hasMySQLConfig()) return null;
  await ensureSchema();
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, email, password_hash FROM admin_users WHERE id = ? LIMIT 1', [ADMIN_USER_ID]);
  return rows && rows[0] ? rows[0] : null;
}

async function getAdminAccountStatus() {
  const user = await getDbAdminUser();
  if (user) return { email: user.email, source: 'database', hasDatabaseAccount: true };
  return { email: getAdminEmail(), source: 'environment', hasDatabaseAccount: false };
}

async function getEffectiveAdminEmail() {
  const account = await getAdminAccountStatus();
  return account.email;
}

async function verifyAdminLogin(email, password) {
  const user = await getDbAdminUser();
  if (user) {
    if (!safeEqual(email, user.email)) return { ok: false, reason: 'invalid_credentials' };
    if (!verifyPassword(password, user.password_hash)) return { ok: false, reason: 'invalid_credentials' };
    return { ok: true, source: 'database', email: user.email };
  }

  const expectedEmail = getAdminEmail();
  const expectedPass = getAdminPassword();
  if (!expectedPass) return { ok: false, reason: 'password_not_configured' };
  if (!safeEqual(email, expectedEmail)) return { ok: false, reason: 'invalid_credentials' };
  if (!safeEqual(password, expectedPass)) return { ok: false, reason: 'invalid_credentials' };
  return { ok: true, source: 'environment', email: expectedEmail };
}

async function updateAdminAccount({ email, currentPassword, newPassword }) {
  if (!hasMySQLConfig()) {
    const err = new Error('mysql_not_configured');
    err.code = 'mysql_not_configured';
    throw err;
  }
  const nextEmail = String(email || '').trim();
  const nextPassword = String(newPassword || '');
  if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    const err = new Error('admin_email_invalid');
    err.code = 'admin_email_invalid';
    throw err;
  }
  if (nextPassword.length < 6) {
    const err = new Error('admin_password_too_short');
    err.code = 'admin_password_too_short';
    throw err;
  }

  const currentEmail = (await getEffectiveAdminEmail()) || nextEmail;
  const verified = await verifyAdminLogin(currentEmail, currentPassword);
  if (!verified.ok) {
    const err = new Error('current_password_invalid');
    err.code = 'current_password_invalid';
    throw err;
  }

  await ensureSchema();
  const pool = getPool();
  await pool.query(
    'INSERT INTO admin_users (id, email, password_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash)',
    [ADMIN_USER_ID, nextEmail, hashPassword(nextPassword)]
  );
  return getAdminAccountStatus();
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
  getEffectiveAdminEmail,
  getAdminPassword,
  getAdminAccountStatus,
  verifyAdminLogin,
  updateAdminAccount,
  adminAuth
};
