const { getStore: getFileStore, updateStore: updateFileStore } = require('./store');
const { getPool, hasMySQLConfig, ensureSchema } = require('./mysql');

const SECTION_KEYS = ['home', 'cases', 'designers', 'about', 'contact'];
const ALL_KEYS = ['site'].concat(SECTION_KEYS);

let initPromise = null;

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const schema = await ensureSchema();
    if (schema.mode !== 'mysql') return { mode: 'file' };

    const pool = getPool();
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM content_kv');
    const count = rows && rows[0] ? Number(rows[0].c) : 0;
    if (count > 0) return { mode: 'mysql' };

    const seed = require('../data/store.seed.json');
    const tasks = ALL_KEYS.map((k) => {
      const v = seed[k] || {};
      return pool.query('INSERT INTO content_kv (k, v) VALUES (?, ?)', [k, JSON.stringify(v)]);
    });
    await Promise.all(tasks);
    return { mode: 'mysql' };
  })();
  return initPromise;
}

async function getSectionFromMySQL(key) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT v FROM content_kv WHERE k = ?', [key]);
  if (!rows || rows.length === 0) return null;
  const v = rows[0].v;
  if (typeof v === 'string') return JSON.parse(v);
  return v;
}

async function setSectionToMySQL(key, value) {
  const pool = getPool();
  const json = JSON.stringify(value);
  await pool.query('INSERT INTO content_kv (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [key, json]);
  return true;
}

async function listAppointmentsFromMySQL(limit) {
  const pool = getPool();
  const take = limit ? Number(limit) : 200;
  const [rows] = await pool.query(
    'SELECT id, name, phone, community, area, demand, created_at FROM appointments ORDER BY created_at DESC LIMIT ?',
    [take]
  );
  return (rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    community: r.community || '',
    area: r.area || '',
    demand: r.demand || '',
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
  }));
}

async function insertAppointmentToMySQL(appointment) {
  const pool = getPool();
  await pool.query(
    'INSERT INTO appointments (id, name, phone, community, area, demand, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      appointment.id,
      appointment.name,
      appointment.phone,
      appointment.community || '',
      appointment.area || '',
      appointment.demand || '',
      new Date(appointment.createdAt)
    ]
  );
}

async function resetMySQL() {
  const pool = getPool();
  const seed = require('../data/store.seed.json');
  const tasks = ALL_KEYS.map((k) => {
    const v = seed[k] || {};
    return pool.query('INSERT INTO content_kv (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [
      k,
      JSON.stringify(v)
    ]);
  });
  await Promise.all(tasks);
  await pool.query('TRUNCATE TABLE appointments');
}

async function getStore() {
  if (!hasMySQLConfig()) return getFileStore();
  await init();
  const store = {};
  for (const k of ALL_KEYS) {
    store[k] = (await getSectionFromMySQL(k)) || {};
  }
  store.appointments = await listAppointmentsFromMySQL(200);
  return store;
}

async function getSection(key) {
  if (key === 'appointments') {
    if (!hasMySQLConfig()) {
      const store = await getFileStore();
      return store.appointments || [];
    }
    await init();
    return listAppointmentsFromMySQL(200);
  }

  if (!hasMySQLConfig()) {
    const store = await getFileStore();
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
  }

  await init();
  return getSectionFromMySQL(key);
}

async function setSection(key, value) {
  if (key === 'appointments') return false;
  if (!key) return false;

  if (!hasMySQLConfig()) {
    await updateFileStore((s) => {
      s[key] = value;
    });
    return true;
  }

  await init();
  await setSectionToMySQL(key, value);
  return true;
}

async function replaceStore(nextStore) {
  if (!nextStore || typeof nextStore !== 'object') return false;
  if (!hasMySQLConfig()) {
    await updateFileStore(() => nextStore);
    return true;
  }

  await init();
  for (const k of ALL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(nextStore, k)) continue;
    await setSectionToMySQL(k, nextStore[k]);
  }
  return true;
}

async function reset() {
  if (!hasMySQLConfig()) {
    const seed = require('../data/store.seed.json');
    await updateFileStore(() => seed);
    return true;
  }
  await init();
  await resetMySQL();
  return true;
}

async function createAppointment(appointment) {
  if (!hasMySQLConfig()) {
    await updateFileStore((store) => {
      store.appointments = Array.isArray(store.appointments) ? store.appointments : [];
      store.appointments.unshift(appointment);
    });
    return true;
  }

  await init();
  await insertAppointmentToMySQL(appointment);
  return true;
}

module.exports = {
  SECTION_KEYS,
  ALL_KEYS,
  init,
  getStore,
  getSection,
  setSection,
  replaceStore,
  reset,
  createAppointment
};
