const mysql = require('mysql2/promise');

function withTimeout(promise, ms, code) {
  const timeoutMs = Number(ms);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => {
        const err = new Error(code || 'timeout');
        err.code = code || 'timeout';
        reject(err);
      }, timeoutMs);
      t.unref && t.unref();
    })
  ]);
}

function hasMySQLConfig() {
  const host = process.env.MYSQL_HOST || '';
  const user = process.env.MYSQL_USER || process.env.MYSQL_USERNAME || '';
  const db = process.env.MYSQL_DATABASE || '';
  const addr = process.env.MYSQL_ADDRESS || '';
  return Boolean((host || addr) && user && db);
}

function getMySQLOptions() {
  const address = String(process.env.MYSQL_ADDRESS || '').trim();
  let host = process.env.MYSQL_HOST;
  let port = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306;
  if (!host && address) {
    const [h, p] = address.split(':');
    host = (h || '').trim();
    const pn = Number(p);
    if (Number.isFinite(pn) && pn > 0) port = pn;
  }

  return {
    host,
    port,
    user: process.env.MYSQL_USER || process.env.MYSQL_USERNAME,
    password: process.env.MYSQL_PASSWORD || process.env.MYSQL_PASS || '',
    database: process.env.MYSQL_DATABASE,
    connectTimeout: process.env.MYSQL_CONNECT_TIMEOUT_MS ? Number(process.env.MYSQL_CONNECT_TIMEOUT_MS) : 3000,
    waitForConnections: true,
    connectionLimit: process.env.MYSQL_POOL_SIZE ? Number(process.env.MYSQL_POOL_SIZE) : 10,
    queueLimit: 0,
    charset: 'utf8mb4'
  };
}

let pool = null;

function getPool() {
  if (!hasMySQLConfig()) return null;
  if (pool) return pool;
  pool = mysql.createPool(getMySQLOptions());
  return pool;
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return { mode: 'file' };

  const timeoutMs = process.env.MYSQL_QUERY_TIMEOUT_MS ? Number(process.env.MYSQL_QUERY_TIMEOUT_MS) : 5000;

  await withTimeout(
    p.query('SELECT 1'),
    timeoutMs,
    'mysql_ping_timeout'
  );

  await withTimeout(p.query(`
    CREATE TABLE IF NOT EXISTS content_kv (
      k VARCHAR(64) PRIMARY KEY,
      v JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `), timeoutMs, 'mysql_schema_timeout');

  await withTimeout(p.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      phone VARCHAR(32) NOT NULL,
      community VARCHAR(128) NOT NULL DEFAULT '',
      area VARCHAR(32) NOT NULL DEFAULT '',
      demand TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      contacted_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `), timeoutMs, 'mysql_schema_timeout');

  const [appointmentColumns] = await withTimeout(p.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'appointments'
      AND COLUMN_NAME IN ('status', 'contacted_at')
  `), timeoutMs, 'mysql_schema_timeout');
  const appointmentColumnSet = new Set((appointmentColumns || []).map((r) => r.COLUMN_NAME));
  if (!appointmentColumnSet.has('status')) {
    await withTimeout(p.query(`
      ALTER TABLE appointments
      ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending' AFTER demand
    `), timeoutMs, 'mysql_schema_timeout');
  }
  if (!appointmentColumnSet.has('contacted_at')) {
    await withTimeout(p.query(`
      ALTER TABLE appointments
      ADD COLUMN contacted_at TIMESTAMP NULL DEFAULT NULL AFTER status
    `), timeoutMs, 'mysql_schema_timeout');
  }

  await withTimeout(p.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id VARCHAR(32) PRIMARY KEY,
      v JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `), timeoutMs, 'mysql_schema_timeout');

  await withTimeout(p.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id VARCHAR(32) PRIMARY KEY,
      email VARCHAR(128) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'super_admin',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_admin_users_email (email)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `), timeoutMs, 'mysql_schema_timeout');

  const [adminUserColumns] = await withTimeout(p.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'admin_users'
      AND COLUMN_NAME = 'role'
  `), timeoutMs, 'mysql_schema_timeout');
  if (!adminUserColumns || adminUserColumns.length === 0) {
    await withTimeout(p.query(`
      ALTER TABLE admin_users
      ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'super_admin' AFTER password_hash
    `), timeoutMs, 'mysql_schema_timeout');
  }

  await withTimeout(p.query(`
    CREATE TABLE IF NOT EXISTS admin_categories (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      icon VARCHAR(255) NOT NULL DEFAULT '',
      sort INT NULL,
      status ENUM('enabled','disabled') NOT NULL DEFAULT 'enabled',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_admin_categories_name (name)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `), timeoutMs, 'mysql_schema_timeout');

  await withTimeout(p.query(`
    CREATE TABLE IF NOT EXISTS admin_content (
      id VARCHAR(64) PRIMARY KEY,
      type VARCHAR(32) NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT '',
      status ENUM('enabled','disabled') NOT NULL DEFAULT 'enabled',
      v JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_admin_content_type (type),
      INDEX idx_admin_content_title (title)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `), timeoutMs, 'mysql_schema_timeout');

  return { mode: 'mysql' };
}

module.exports = {
  hasMySQLConfig,
  getPool,
  ensureSchema
};
