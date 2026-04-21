const contentStore = require('./contentStore');

function nowIso() {
  return new Date().toISOString();
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeStr(v) {
  return String(v || '').trim();
}

function getByPath(obj, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (!cur) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function pickQuery(q, item, fields) {
  const query = normalizeStr(q);
  if (!query) return true;
  const s = fields
    .map((f) => normalizeStr(item && item[f]))
    .filter(Boolean)
    .join(' ');
  return s.toLowerCase().includes(query.toLowerCase());
}

function paginate(items, limit, offset) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);
  return {
    items: items.slice(skip, skip + take),
    total: items.length
  };
}

async function listArray({ sectionKey, arrayPath, q, limit, offset, qFields, ensureIdPrefix }) {
  const section = (await contentStore.getSection(sectionKey)) || {};
  const arr = ensureArray(getByPath(section, arrayPath));
  let patched = false;
  if (ensureIdPrefix) {
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      if (!normalizeStr(it.id)) {
        it.id = genId(ensureIdPrefix);
        patched = true;
      }
    }
  }
  if (patched) {
    setByPath(section, arrayPath, arr);
    await contentStore.setSection(sectionKey, section);
  }
  const filtered = q ? arr.filter((it) => pickQuery(q, it, qFields || ['id'])) : arr;
  return paginate(filtered, limit, offset);
}

async function createArrayItem({ sectionKey, arrayPath, payload, idPrefix }) {
  const section = (await contentStore.getSection(sectionKey)) || {};
  const arr = ensureArray(getByPath(section, arrayPath));
  const next = Object.assign({}, payload || {});
  next.id = normalizeStr(next.id) || genId(idPrefix || sectionKey);
  arr.push(next);
  setByPath(section, arrayPath, arr);
  await contentStore.setSection(sectionKey, section);
  return next;
}

async function updateArrayItem({ sectionKey, arrayPath, id, payload }) {
  const section = (await contentStore.getSection(sectionKey)) || {};
  const arr = ensureArray(getByPath(section, arrayPath));
  const idx = arr.findIndex((it) => String(it && it.id) === String(id));
  if (idx < 0) return null;
  const next = Object.assign({}, arr[idx], payload || {}, { id: arr[idx].id });
  arr[idx] = next;
  setByPath(section, arrayPath, arr);
  await contentStore.setSection(sectionKey, section);
  return next;
}

async function deleteArrayItem({ sectionKey, arrayPath, id }) {
  const section = (await contentStore.getSection(sectionKey)) || {};
  const arr = ensureArray(getByPath(section, arrayPath));
  const next = arr.filter((it) => String(it && it.id) !== String(id));
  setByPath(section, arrayPath, next);
  await contentStore.setSection(sectionKey, section);
  return true;
}

async function getMiniappSettings() {
  const [site, home, cases, designers, about, contact] = await Promise.all([
    contentStore.getSection('site'),
    contentStore.getSection('home'),
    contentStore.getSection('cases'),
    contentStore.getSection('designers'),
    contentStore.getSection('about'),
    contentStore.getSection('contact')
  ]);
  return {
    updatedAt: nowIso(),
    site: site || {},
    home: home || {},
    cases: cases || {},
    designers: designers || {},
    about: about || {},
    contact: contact || {}
  };
}

async function updateMiniappSettings(payload) {
  const next = payload && typeof payload === 'object' ? payload : {};
  const writes = [];
  if (Object.prototype.hasOwnProperty.call(next, 'site')) writes.push(contentStore.setSection('site', next.site || {}));
  if (Object.prototype.hasOwnProperty.call(next, 'home')) writes.push(contentStore.setSection('home', next.home || {}));
  if (Object.prototype.hasOwnProperty.call(next, 'cases')) writes.push(contentStore.setSection('cases', next.cases || {}));
  if (Object.prototype.hasOwnProperty.call(next, 'designers')) writes.push(contentStore.setSection('designers', next.designers || {}));
  if (Object.prototype.hasOwnProperty.call(next, 'about')) writes.push(contentStore.setSection('about', next.about || {}));
  if (Object.prototype.hasOwnProperty.call(next, 'contact')) writes.push(contentStore.setSection('contact', next.contact || {}));
  await Promise.all(writes);
  return getMiniappSettings();
}

async function getStats() {
  const store = await contentStore.getStore();
  const home = store.home || {};
  const cases = store.cases || {};
  const designers = store.designers || {};
  return {
    homeBanners: ensureArray(home.banners).length,
    homeNavs: ensureArray(home.navs).length,
    homeServices: ensureArray(home.services).length,
    homeAdvantages: ensureArray(home.advantages).length,
    cases: ensureArray(cases.items).length,
    designers: ensureArray(designers.items).length,
    appointments: ensureArray(store.appointments).length
  };
}

function normalizeLeadStatus(status) {
  const s = String(status || '').trim();
  return s === 'contacted' ? 'contacted' : 'pending';
}

function leadFromAppointment(it) {
  return {
    id: it.id,
    nickName: it.name,
    avatarUrl: '',
    phone: it.phone,
    visitorId: '',
    source: '预约',
    status: normalizeLeadStatus(it.status),
    contactedAt: it.contactedAt || '',
    meta: { community: it.community || '', area: it.area || '', demand: it.demand || '' },
    createdAt: it.createdAt
  };
}

async function listLeads(q, limit, offset, status) {
  const items = await contentStore.getSection('appointments');
  const arr = ensureArray(items);
  const query = normalizeStr(q);
  const statusFilter = String(status || '').trim();
  const filtered = arr.filter((it) => {
    if ((statusFilter === 'pending' || statusFilter === 'contacted') && normalizeLeadStatus(it.status) !== statusFilter) return false;
    if (query) {
        const s = `${normalizeStr(it.name)} ${normalizeStr(it.phone)} ${normalizeStr(it.community)} ${normalizeStr(it.area)} ${normalizeStr(it.demand)}`;
        return s.toLowerCase().includes(query.toLowerCase());
    }
    return true;
  });
  const paged = paginate(filtered, limit, offset);
  return {
    items: paged.items.map(leadFromAppointment),
    total: paged.total
  };
}

async function updateLeadStatus(id, status) {
  const item = await contentStore.updateAppointmentStatus(id, status);
  return item ? leadFromAppointment(item) : null;
}

module.exports = {
  listArray,
  createArrayItem,
  updateArrayItem,
  deleteArrayItem,
  getMiniappSettings,
  updateMiniappSettings,
  getStats,
  listLeads,
  updateLeadStatus
};
