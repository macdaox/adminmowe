const mysql = require('mysql2/promise');

function hasMySQLConfig() {
  return Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);
}

function getMySQLOptions() {
  return {
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
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

  await p.query(`
    CREATE TABLE IF NOT EXISTS content_kv (
      k VARCHAR(64) PRIMARY KEY,
      v JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      phone VARCHAR(32) NOT NULL,
      community VARCHAR(128) NOT NULL DEFAULT '',
      area VARCHAR(32) NOT NULL DEFAULT '',
      demand TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id VARCHAR(32) PRIMARY KEY,
      v JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
  `);

  await p.query(`
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
  `);

  await p.query(`
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
  `);

  return { mode: 'mysql' };
}

module.exports = {
  hasMySQLConfig,
  getPool,
  ensureSchema
};
