const { getPool, hasMySQLConfig, ensureSchema } = require('./mysql');

const SETTINGS_ID = 'default';

let initPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function toIso(v) {
  if (!v) return nowIso();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await ensureSchema();
    if (!hasMySQLConfig()) return { mode: 'file' };
    const pool = getPool();
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM admin_settings WHERE id = ?', [SETTINGS_ID]);
    const count = rows && rows[0] ? Number(rows[0].c) : 0;
    if (count > 0) return { mode: 'mysql' };

    const seed = {
      id: SETTINGS_ID,
      shopName: '默维高颜整家定制',
      phone: '',
      wechatId: '',
      address: '',
      latitude: null,
      longitude: null,
      homeBanners: [],
      homeNavTitle: '分类导航',
      homeSearchPlaceholder: '搜索案例',
      homeCaseTitle: '热门案例',
      homeCaseSubTitle: '',
      homeDesignTitle: '设计方案',
      homeDesignSubTitle: '',
      homeProductsTitle: '品质定制'
    };

    await pool.query('INSERT INTO admin_settings (id, v) VALUES (?, ?)', [SETTINGS_ID, JSON.stringify(seed)]);
    return { mode: 'mysql' };
  })();
  return initPromise;
}

async function requireMySQL() {
  await init();
  if (!hasMySQLConfig()) {
    const err = new Error('mysql_not_configured');
    err.code = 'mysql_not_configured';
    throw err;
  }
  return getPool();
}

async function getSettings() {
  const pool = await requireMySQL();
  const [rows] = await pool.query('SELECT v, updated_at FROM admin_settings WHERE id = ?', [SETTINGS_ID]);
  const row = rows && rows[0] ? rows[0] : null;
  const v = row && row.v ? (typeof row.v === 'string' ? JSON.parse(row.v) : row.v) : {};
  return Object.assign({}, v, { id: SETTINGS_ID, updatedAt: toIso(row && row.updated_at) });
}

async function updateSettings(payload) {
  const pool = await requireMySQL();
  const current = await getSettings();
  const next = Object.assign({}, current, payload || {});
  delete next.updatedAt;
  await pool.query('UPDATE admin_settings SET v = ? WHERE id = ?', [JSON.stringify(next), SETTINGS_ID]);
  return getSettings();
}

async function listCategories(q, limit, offset) {
  const pool = await requireMySQL();
  const query = String(q || '').trim();
  const like = `%${query}%`;
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);

  const where = query ? 'WHERE name LIKE ? OR id LIKE ?' : '';
  const params = query ? [like, like] : [];

  const [rows] = await pool.query(
    `SELECT id, name, icon, sort, status, created_at, updated_at FROM admin_categories ${where} ORDER BY COALESCE(sort, 999999) ASC, updated_at DESC LIMIT ? OFFSET ?`,
    params.concat([take, skip])
  );
  const [cntRows] = await pool.query(`SELECT COUNT(*) AS c FROM admin_categories ${where}`, params);
  const total = cntRows && cntRows[0] ? Number(cntRows[0].c) : 0;
  const items = (rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon || '',
    sort: r.sort === null || typeof r.sort === 'undefined' ? null : Number(r.sort),
    status: r.status,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at)
  }));

  return { items, total };
}

async function createCategory(payload) {
  const pool = await requireMySQL();
  const id = genId('cat');
  const name = String(payload && payload.name ? payload.name : '').trim();
  const icon = String(payload && payload.icon ? payload.icon : '').trim();
  const sort = payload && payload.sort !== undefined ? payload.sort : null;
  const status = payload && payload.status === 'disabled' ? 'disabled' : 'enabled';
  if (!name) {
    const err = new Error('name_required');
    err.code = 'name_required';
    throw err;
  }
  await pool.query('INSERT INTO admin_categories (id, name, icon, sort, status) VALUES (?, ?, ?, ?, ?)', [
    id,
    name,
    icon,
    sort === null || sort === '' ? null : Number(sort),
    status
  ]);
  const [rows] = await pool.query('SELECT id, name, icon, sort, status, created_at, updated_at FROM admin_categories WHERE id = ?', [id]);
  const r = rows && rows[0] ? rows[0] : null;
  return {
    id,
    name,
    icon,
    sort: r && (r.sort === null || typeof r.sort === 'undefined') ? null : Number(r.sort),
    status,
    createdAt: toIso(r && r.created_at),
    updatedAt: toIso(r && r.updated_at)
  };
}

async function updateCategory(id, payload) {
  const pool = await requireMySQL();
  const name = String(payload && payload.name ? payload.name : '').trim();
  const icon = String(payload && payload.icon ? payload.icon : '').trim();
  const sort = payload && payload.sort !== undefined ? payload.sort : null;
  const status = payload && payload.status === 'disabled' ? 'disabled' : 'enabled';
  if (!name) {
    const err = new Error('name_required');
    err.code = 'name_required';
    throw err;
  }
  await pool.query('UPDATE admin_categories SET name=?, icon=?, sort=?, status=? WHERE id=?', [
    name,
    icon,
    sort === null || sort === '' ? null : Number(sort),
    status,
    id
  ]);
  const [rows] = await pool.query('SELECT id, name, icon, sort, status, created_at, updated_at FROM admin_categories WHERE id = ?', [id]);
  const r = rows && rows[0] ? rows[0] : null;
  if (!r) {
    const err = new Error('not_found');
    err.code = 'not_found';
    throw err;
  }
  return {
    id: r.id,
    name: r.name,
    icon: r.icon || '',
    sort: r.sort === null || typeof r.sort === 'undefined' ? null : Number(r.sort),
    status: r.status,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at)
  };
}

async function deleteCategory(id) {
  const pool = await requireMySQL();
  await pool.query('DELETE FROM admin_categories WHERE id=?', [id]);
  return true;
}

function normalizeEntity(entity) {
  if (entity === 'store-cards') return 'store-cards';
  if (entity === 'products') return 'products';
  if (entity === 'cases') return 'cases';
  if (entity === 'designs') return 'designs';
  if (entity === 'posts') return 'posts';
  return '';
}

function extractTitle(entity, payload) {
  if (entity === 'store-cards') return String(payload && payload.storeName ? payload.storeName : '').trim();
  return String(payload && payload.title ? payload.title : '').trim();
}

function normalizeStatus(payload) {
  return payload && payload.status === 'disabled' ? 'disabled' : 'enabled';
}

function mapContentRow(r) {
  const v = r && r.v ? (typeof r.v === 'string' ? JSON.parse(r.v) : r.v) : {};
  return Object.assign({}, v, {
    id: r.id,
    status: r.status,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at)
  });
}

async function listContent(entity, q, limit, offset) {
  const pool = await requireMySQL();
  const type = normalizeEntity(entity);
  if (!type) {
    const err = new Error('invalid_type');
    err.code = 'invalid_type';
    throw err;
  }
  const query = String(q || '').trim();
  const like = `%${query}%`;
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);

  const where = query ? 'AND (title LIKE ? OR id LIKE ?)' : '';
  const params = [type].concat(query ? [like, like] : []);

  const [rows] = await pool.query(
    `SELECT id, type, title, status, v, created_at, updated_at FROM admin_content WHERE type=? ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    params.concat([take, skip])
  );
  const [cntRows] = await pool.query(`SELECT COUNT(*) AS c FROM admin_content WHERE type=? ${where}`, params);
  const total = cntRows && cntRows[0] ? Number(cntRows[0].c) : 0;
  const items = (rows || []).map(mapContentRow);
  return { items, total };
}

async function createContent(entity, payload) {
  const pool = await requireMySQL();
  const type = normalizeEntity(entity);
  if (!type) {
    const err = new Error('invalid_type');
    err.code = 'invalid_type';
    throw err;
  }
  const title = extractTitle(type, payload);
  if (!title) {
    const err = new Error('title_required');
    err.code = 'title_required';
    throw err;
  }
  const status = normalizeStatus(payload);
  const id = genId(type === 'store-cards' ? 'store' : type.slice(0, 2));
  const v = Object.assign({}, payload || {});
  const json = JSON.stringify(v);
  await pool.query('INSERT INTO admin_content (id, type, title, status, v) VALUES (?, ?, ?, ?, ?)', [
    id,
    type,
    title,
    status,
    json
  ]);
  const [rows] = await pool.query('SELECT id, type, title, status, v, created_at, updated_at FROM admin_content WHERE id=?', [id]);
  return mapContentRow(rows && rows[0]);
}

async function updateContent(entity, id, payload) {
  const pool = await requireMySQL();
  const type = normalizeEntity(entity);
  if (!type) {
    const err = new Error('invalid_type');
    err.code = 'invalid_type';
    throw err;
  }
  const title = extractTitle(type, payload);
  const status = normalizeStatus(payload);
  const v = Object.assign({}, payload || {});
  await pool.query('UPDATE admin_content SET title=?, status=?, v=? WHERE id=? AND type=?', [
    title,
    status,
    JSON.stringify(v),
    id,
    type
  ]);
  const [rows] = await pool.query('SELECT id, type, title, status, v, created_at, updated_at FROM admin_content WHERE id=? AND type=?', [id, type]);
  const row = rows && rows[0] ? rows[0] : null;
  if (!row) {
    const err = new Error('not_found');
    err.code = 'not_found';
    throw err;
  }
  return mapContentRow(row);
}

async function deleteContent(entity, id) {
  const pool = await requireMySQL();
  const type = normalizeEntity(entity);
  if (!type) {
    const err = new Error('invalid_type');
    err.code = 'invalid_type';
    throw err;
  }
  await pool.query('DELETE FROM admin_content WHERE id=? AND type=?', [id, type]);
  return true;
}

async function listLeads(q, limit, offset) {
  const pool = await requireMySQL();
  const query = String(q || '').trim();
  const like = `%${query}%`;
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);
  const where = query ? 'WHERE name LIKE ? OR phone LIKE ? OR community LIKE ?' : '';
  const params = query ? [like, like, like] : [];

  const [rows] = await pool.query(
    `SELECT id, name, phone, community, area, demand, created_at FROM appointments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params.concat([take, skip])
  );
  const [cntRows] = await pool.query(`SELECT COUNT(*) AS c FROM appointments ${where}`, params);
  const total = cntRows && cntRows[0] ? Number(cntRows[0].c) : 0;
  const items = (rows || []).map((r) => ({
    id: r.id,
    nickName: r.name,
    avatarUrl: '',
    phone: r.phone,
    visitorId: '',
    source: '预约',
    meta: { community: r.community || '', area: r.area || '', demand: r.demand || '' },
    createdAt: toIso(r.created_at)
  }));
  return { items, total };
}

async function getStats() {
  const pool = await requireMySQL();
  const [rows] = await pool.query('SELECT type, COUNT(*) AS c FROM admin_content GROUP BY type');
  const map = new Map((rows || []).map((r) => [r.type, Number(r.c)]));
  const [catRows] = await pool.query('SELECT COUNT(*) AS c FROM admin_categories');
  const [leadRows] = await pool.query('SELECT COUNT(*) AS c FROM appointments');
  return {
    products: map.get('products') || 0,
    cases: map.get('cases') || 0,
    designs: map.get('designs') || 0,
    posts: map.get('posts') || 0,
    storeCards: map.get('store-cards') || 0,
    categories: catRows && catRows[0] ? Number(catRows[0].c) : 0,
    leads: leadRows && leadRows[0] ? Number(leadRows[0].c) : 0
  };
}

module.exports = {
  init,
  getSettings,
  updateSettings,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listContent,
  createContent,
  updateContent,
  deleteContent,
  listLeads,
  getStats
};
