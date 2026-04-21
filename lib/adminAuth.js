const crypto = require('crypto');
const { ensureSchema, getPool, hasMySQLConfig } = require('./mysql');

const HASH_ITERATIONS = 120000;
const ADMIN_ROLES = new Set(['super_admin', 'admin']);
const SESSION_PREFIX = 'admin-session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

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

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signSessionPayload(encodedPayload) {
  return crypto.createHmac('sha256', getAdminToken()).update(encodedPayload).digest('base64url');
}

function createAdminSessionToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    id: user.id || '',
    email: user.email || '',
    role: normalizeAdminRole(user.role, 'admin'),
    source: user.source || 'database',
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  };
  const encodedPayload = base64UrlJson(payload);
  return `${SESSION_PREFIX}.${encodedPayload}.${signSessionPayload(encodedPayload)}`;
}

function parseAdminSessionToken(token) {
  const raw = String(token || '');
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_PREFIX) return null;
  const encodedPayload = parts[1];
  const signature = parts[2];
  if (!safeEqual(signature, signSessionPayload(encodedPayload))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    return {
      id: String(payload.id || ''),
      email: String(payload.email || ''),
      role: normalizeAdminRole(payload.role, 'admin'),
      source: String(payload.source || 'database')
    };
  } catch (_e) {
    return null;
  }
}

function normalizeAdminRole(role, fallback = 'admin') {
  const r = String(role || '').trim();
  return ADMIN_ROLES.has(r) ? r : fallback;
}

function isSuperAdmin(admin) {
  return admin && admin.role === 'super_admin';
}

function publicAdminUser(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    email: String(row.email || ''),
    role: normalizeAdminRole(row.role, 'admin'),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function filterVisibleUsers(users, viewer) {
  const publicUsers = users.map(publicAdminUser).filter(Boolean);
  if (!viewer || isSuperAdmin(viewer)) return publicUsers;
  return publicUsers.filter((u) => u.id === viewer.id || u.email === viewer.email);
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
  const [rows] = await pool.query('SELECT id, email, password_hash, role FROM admin_users ORDER BY created_at ASC, id ASC LIMIT 1');
  return rows && rows[0] ? rows[0] : null;
}

async function listDbAdminUsers() {
  if (!hasMySQLConfig()) return [];
  await ensureSchema();
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, email, role, created_at AS createdAt, updated_at AS updatedAt FROM admin_users ORDER BY created_at ASC, id ASC'
  );
  return rows || [];
}

async function getDbAdminUserByEmail(email) {
  if (!hasMySQLConfig()) return null;
  await ensureSchema();
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, email, password_hash, role FROM admin_users WHERE email = ? LIMIT 1', [String(email || '').trim()]);
  return rows && rows[0] ? rows[0] : null;
}

async function getDbAdminUserById(id) {
  if (!hasMySQLConfig()) return null;
  await ensureSchema();
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, email, password_hash, role FROM admin_users WHERE id = ? LIMIT 1', [String(id || '')]);
  return rows && rows[0] ? rows[0] : null;
}

async function getAdminAccountStatus(viewer) {
  const users = await listDbAdminUsers();
  if (users.length) {
    const visibleUsers = filterVisibleUsers(users, viewer);
    const self = viewer && viewer.email ? viewer : visibleUsers[0];
    return {
      email: self ? self.email : users[0].email,
      role: self ? normalizeAdminRole(self.role, 'admin') : normalizeAdminRole(users[0].role, 'admin'),
      source: 'database',
      hasDatabaseAccount: true,
      canManageAdmins: Boolean(viewer && isSuperAdmin(viewer)),
      users: visibleUsers
    };
  }
  return {
    email: getAdminEmail(),
    role: 'super_admin',
    source: 'environment',
    hasDatabaseAccount: false,
    canManageAdmins: true,
    users: []
  };
}

async function getEffectiveAdminEmail() {
  const account = await getAdminAccountStatus();
  return account.email;
}

async function verifyAdminLogin(email, password) {
  const users = await listDbAdminUsers();
  if (users.length) {
    const user = await getDbAdminUserByEmail(email);
    if (!user) return { ok: false, reason: 'invalid_credentials' };
    if (!verifyPassword(password, user.password_hash)) return { ok: false, reason: 'invalid_credentials' };
    return { ok: true, source: 'database', id: user.id, email: user.email, role: normalizeAdminRole(user.role, 'admin') };
  }

  const expectedEmail = getAdminEmail();
  const expectedPass = getAdminPassword();
  if (!expectedPass) return { ok: false, reason: 'password_not_configured' };
  if (!safeEqual(email, expectedEmail)) return { ok: false, reason: 'invalid_credentials' };
  if (!safeEqual(password, expectedPass)) return { ok: false, reason: 'invalid_credentials' };
  return { ok: true, source: 'environment', id: 'environment', email: expectedEmail, role: 'super_admin' };
}

function assertMySQLConfigured() {
  if (!hasMySQLConfig()) {
    const err = new Error('mysql_not_configured');
    err.code = 'mysql_not_configured';
    throw err;
  }
}

function normalizeAdminEmail(email) {
  const nextEmail = String(email || '').trim();
  if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    const err = new Error('admin_email_invalid');
    err.code = 'admin_email_invalid';
    throw err;
  }
  return nextEmail;
}

function normalizeAdminPassword(password) {
  const nextPassword = String(password || '');
  if (nextPassword.length < 6) {
    const err = new Error('admin_password_too_short');
    err.code = 'admin_password_too_short';
    throw err;
  }
  return nextPassword;
}

async function verifyAccountMutation({ actor, currentPassword }) {
  const currentEmail = String((actor && actor.email) || (await getEffectiveAdminEmail()) || '').trim();
  const verified = await verifyAdminLogin(currentEmail, currentPassword);
  if (!verified.ok) {
    const err = new Error('current_password_invalid');
    err.code = 'current_password_invalid';
    throw err;
  }
}

function assertSuperAdmin(actor) {
  if (!isSuperAdmin(actor)) {
    const err = new Error('permission_denied');
    err.code = 'permission_denied';
    throw err;
  }
}

function assertCanEditUser(actor, userId) {
  if (isSuperAdmin(actor)) return;
  if (actor && actor.id && actor.id === userId) return;
  const err = new Error('permission_denied');
  err.code = 'permission_denied';
  throw err;
}

async function countSuperAdmins(exceptId) {
  if (!hasMySQLConfig()) return 0;
  await ensureSchema();
  const pool = getPool();
  const params = [];
  let sql = "SELECT COUNT(*) AS n FROM admin_users WHERE role = 'super_admin'";
  if (exceptId) {
    sql += ' AND id <> ?';
    params.push(String(exceptId));
  }
  const [rows] = await pool.query(sql, params);
  return rows && rows[0] ? Number(rows[0].n || 0) : 0;
}

function assertNotRemovingLastSuperAdmin(existing, nextRole) {
  if (normalizeAdminRole(existing.role, 'admin') !== 'super_admin') return Promise.resolve();
  if (normalizeAdminRole(nextRole, 'admin') === 'super_admin') return Promise.resolve();
  return countSuperAdmins(existing.id).then((remaining) => {
    if (remaining > 0) return;
    const err = new Error('last_super_admin');
    err.code = 'last_super_admin';
    throw err;
  });
}

function createAdminUserId() {
  return crypto.randomBytes(8).toString('hex');
}

async function createAdminAccount({ email, currentPassword, newPassword, role }, actor) {
  assertMySQLConfigured();
  const nextEmail = normalizeAdminEmail(email);
  const nextPassword = normalizeAdminPassword(newPassword);
  const users = await listDbAdminUsers();
  if (users.length) assertSuperAdmin(actor);
  await verifyAccountMutation({ actor, currentPassword });
  const nextRole = users.length ? normalizeAdminRole(role, 'admin') : 'super_admin';

  await ensureSchema();
  const pool = getPool();
  try {
    await pool.query('INSERT INTO admin_users (id, email, password_hash, role) VALUES (?, ?, ?, ?)', [
      createAdminUserId(),
      nextEmail,
      hashPassword(nextPassword),
      nextRole
    ]);
  } catch (e) {
    if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
      const err = new Error('admin_email_exists');
      err.code = 'admin_email_exists';
      throw err;
    }
    throw e;
  }
  return getAdminAccountStatus();
}

async function updateAdminAccountById(id, { email, currentPassword, newPassword, role }, actor) {
  assertMySQLConfigured();
  const userId = String(id || '');
  const existing = await getDbAdminUserById(userId);
  if (!existing) {
    const err = new Error('admin_user_not_found');
    err.code = 'admin_user_not_found';
    throw err;
  }
  assertCanEditUser(actor, userId);
  const nextEmail = normalizeAdminEmail(email);
  const hasNewPassword = String(newPassword || '').length > 0;
  const nextPassword = hasNewPassword ? normalizeAdminPassword(newPassword) : '';
  const nextRole = isSuperAdmin(actor) ? normalizeAdminRole(role, normalizeAdminRole(existing.role, 'admin')) : normalizeAdminRole(existing.role, 'admin');
  await assertNotRemovingLastSuperAdmin(existing, nextRole);
  await verifyAccountMutation({ actor, currentPassword });

  const pool = getPool();
  try {
    if (hasNewPassword) {
      await pool.query('UPDATE admin_users SET email = ?, password_hash = ?, role = ? WHERE id = ?', [
        nextEmail,
        hashPassword(nextPassword),
        nextRole,
        userId
      ]);
    } else {
      await pool.query('UPDATE admin_users SET email = ?, role = ? WHERE id = ?', [nextEmail, nextRole, userId]);
    }
  } catch (e) {
    if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
      const err = new Error('admin_email_exists');
      err.code = 'admin_email_exists';
      throw err;
    }
    throw e;
  }
  return getAdminAccountStatus(actor && actor.id === userId ? { ...actor, email: nextEmail, role: nextRole } : actor);
}

async function deleteAdminAccount(id, { currentPassword }, actor) {
  assertMySQLConfigured();
  assertSuperAdmin(actor);
  const userId = String(id || '');
  const users = await listDbAdminUsers();
  if (!users.some((u) => u.id === userId)) {
    const err = new Error('admin_user_not_found');
    err.code = 'admin_user_not_found';
    throw err;
  }
  if (users.length <= 1) {
    const err = new Error('last_admin_user');
    err.code = 'last_admin_user';
    throw err;
  }
  const existing = users.find((u) => u.id === userId);
  await assertNotRemovingLastSuperAdmin(existing, 'admin');
  await verifyAccountMutation({ actor, currentPassword });
  const pool = getPool();
  await pool.query('DELETE FROM admin_users WHERE id = ?', [userId]);
  return getAdminAccountStatus(actor);
}

async function updateAdminAccount({ email, currentPassword, newPassword }, actor) {
  assertMySQLConfigured();
  const nextEmail = normalizeAdminEmail(email);
  const nextPassword = normalizeAdminPassword(newPassword);
  await verifyAccountMutation({ actor, currentPassword });

  await ensureSchema();
  const pool = getPool();
  const existing = await getDbAdminUser();
  const id = existing ? existing.id : createAdminUserId();
  await pool.query(
    'INSERT INTO admin_users (id, email, password_hash, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash)',
    [id, nextEmail, hashPassword(nextPassword), 'super_admin']
  );
  return getAdminAccountStatus(actor && actor.id === id ? { ...actor, email: nextEmail } : actor);
}

function extractBearer(req) {
  const raw = req.header('authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(raw);
  return m ? m[1] : '';
}

function adminAuth(req, res, next) {
  const expected = getAdminToken();
  const got = extractBearer(req) || req.header('x-admin-token') || '';
  const session = parseAdminSessionToken(got);
  if (session) {
    req.admin = session;
    return next();
  }
  if (got === expected) {
    req.admin = { id: 'legacy', email: getAdminEmail(), role: 'super_admin', source: 'legacy' };
    return next();
  }
  res.status(401).json({ ok: false, message: 'unauthorized' });
}

module.exports = {
  getAdminToken,
  getAdminEmail,
  createAdminSessionToken,
  getEffectiveAdminEmail,
  getAdminPassword,
  getAdminAccountStatus,
  verifyAdminLogin,
  createAdminAccount,
  updateAdminAccount,
  updateAdminAccountById,
  deleteAdminAccount,
  adminAuth
};
