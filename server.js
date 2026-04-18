const express = require('express');
const path = require('path');
const multer = require('multer');
const { adminAuth, getAdminToken, getAdminEmail, verifyAdminLogin } = require('./lib/adminAuth');
const contentStore = require('./lib/contentStore');
const { hasMySQLConfig } = require('./lib/mysql');
const { uploadImage, hasCOSConfig, getCredentials } = require('./lib/cos');
const adminCms = require('./lib/adminCms');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-admin-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

function apiOk(res, data) {
  res.json({ ok: true, data });
}

function apiErr(res, status, message) {
  res.status(status).json({ ok: false, message: message || 'Request failed' });
}

app.post('/api/admin/login', async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || body.username || '').trim();
  const password = String(body.password || '');
  const r = verifyAdminLogin(email, password);
  if (!r.ok) return apiErr(res, 401, r.reason || 'invalid_credentials');
  apiOk(res, { token: getAdminToken(), email: getAdminEmail() });
});

app.get('/api/admin/me', adminAuth, async (req, res) => {
  apiOk(res, { email: getAdminEmail() });
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const stats = await adminCms.getStats();
    apiOk(res, stats);
  } catch (e) {
    apiErr(res, 500, 'stats_failed');
  }
});

app.get('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const settings = await adminCms.getSettings();
    apiOk(res, settings);
  } catch (e) {
    apiErr(res, 500, 'settings_failed');
  }
});

app.put('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const settings = await adminCms.updateSettings(req.body || {});
    apiOk(res, settings);
  } catch (e) {
    apiErr(res, 500, 'settings_failed');
  }
});

app.get('/api/admin/categories', adminAuth, async (req, res) => {
  try {
    const { q, limit, offset } = req.query || {};
    const r = await adminCms.listCategories(q, limit, offset);
    apiOk(res, r);
  } catch (e) {
    apiErr(res, 500, 'categories_failed');
  }
});

app.post('/api/admin/categories', adminAuth, async (req, res) => {
  try {
    const item = await adminCms.createCategory(req.body || {});
    apiOk(res, item);
  } catch (e) {
    apiErr(res, 400, e && e.code ? String(e.code) : 'create_failed');
  }
});

app.put('/api/admin/categories/:id', adminAuth, async (req, res) => {
  try {
    const item = await adminCms.updateCategory(String(req.params.id || ''), req.body || {});
    apiOk(res, item);
  } catch (e) {
    apiErr(res, e && e.code === 'not_found' ? 404 : 400, e && e.code ? String(e.code) : 'update_failed');
  }
});

app.delete('/api/admin/categories/:id', adminAuth, async (req, res) => {
  try {
    await adminCms.deleteCategory(String(req.params.id || ''));
    apiOk(res, {});
  } catch (e) {
    apiErr(res, 500, 'delete_failed');
  }
});

app.get('/api/admin/leads', adminAuth, async (req, res) => {
  try {
    const { q, limit, offset } = req.query || {};
    const r = await adminCms.listLeads(q, limit, offset);
    apiOk(res, r);
  } catch (e) {
    apiErr(res, 500, 'leads_failed');
  }
});

function handleContentEntity(entity) {
  app.get(`/api/admin/${entity}`, adminAuth, async (req, res) => {
    try {
      const { q, limit, offset } = req.query || {};
      const r = await adminCms.listContent(entity, q, limit, offset);
      apiOk(res, r);
    } catch (e) {
      apiErr(res, 400, e && e.code ? String(e.code) : 'list_failed');
    }
  });

  app.post(`/api/admin/${entity}`, adminAuth, async (req, res) => {
    try {
      const item = await adminCms.createContent(entity, req.body || {});
      apiOk(res, item);
    } catch (e) {
      apiErr(res, 400, e && e.code ? String(e.code) : 'create_failed');
    }
  });

  app.put(`/api/admin/${entity}/:id`, adminAuth, async (req, res) => {
    try {
      const item = await adminCms.updateContent(entity, String(req.params.id || ''), req.body || {});
      apiOk(res, item);
    } catch (e) {
      apiErr(res, e && e.code === 'not_found' ? 404 : 400, e && e.code ? String(e.code) : 'update_failed');
    }
  });

  app.delete(`/api/admin/${entity}/:id`, adminAuth, async (req, res) => {
    try {
      await adminCms.deleteContent(entity, String(req.params.id || ''));
      apiOk(res, {});
    } catch (e) {
      apiErr(res, 500, 'delete_failed');
    }
  });
}

['products', 'cases', 'designs', 'posts', 'store-cards'].forEach(handleContentEntity);

function pickHotCases(store) {
  const map = new Map((store.cases.items || []).map((c) => [c.id, c]));
  const hot = (store.home.hotCaseIds || []).map((id) => map.get(id)).filter(Boolean);
  return hot.map((c) => ({
    id: c.id,
    name: c.title,
    style: c.style,
    area: c.area,
    image: c.coverUrl || ''
  }));
}

app.get('/api/public/site', async (req, res) => {
  const site = await contentStore.getSection('site');
  res.json(site || {});
});

app.get('/api/public/home', async (req, res) => {
  const store = await contentStore.getStore();
  const home = store.home || {};
  res.json({
    banners: (home.banners || []).map((b) => ({
      id: b.id,
      title: b.title,
      desc: b.desc,
      image: b.imageUrl || ''
    })),
    navs: (home.navs || []).map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      icon: n.iconUrl || ''
    })),
    cases: pickHotCases(store),
    services: (home.services || []).map((s) => ({
      id: s.id,
      name: s.name,
      desc: s.desc,
      image: s.imageUrl || ''
    })),
    advantages: (home.advantages || []).map((a) => ({
      id: a.id,
      title: a.title,
      desc: a.desc
    })),
    cta: home.cta || {},
    footer: {
      brandName: (store.site && store.site.brandName) || '',
      phone: (store.site && store.site.primaryPhone) || '',
      copyrightText: (store.site && store.site.copyrightText) || ''
    },
    header: {
      logoUrl: (store.site && store.site.logoUrl) || '',
      brandEn: (store.site && store.site.brandEn) || '',
      slogan: (store.site && store.site.slogan) || ''
    }
  });
});

app.get('/api/public/cases', async (req, res) => {
  const style = String(req.query.style || '').trim();
  const cases = await contentStore.getSection('cases');
  const filters = (cases && cases.filters) || [];
  const items = ((cases && cases.items) || []).filter((c) => {
    if (!style || style === '全部') return true;
    return c.style === style;
  });

  res.json({
    filters,
    items: items.map((c) => ({
      id: c.id,
      title: c.title,
      style: c.style,
      area: c.area,
      room: c.room,
      desc: c.desc,
      image: c.coverUrl || ''
    }))
  });
});

app.get('/api/public/designers', async (req, res) => {
  const designers = await contentStore.getSection('designers');
  const ds = designers || {};
  res.json({
    introText: ds.introText || '',
    items: (ds.items || []).map((d) => ({
      id: d.id,
      name: d.name,
      level: d.level,
      tags: d.tags || [],
      desc: d.desc,
      cases: d.cases,
      years: d.years,
      like: d.like,
      avatar: d.avatarUrl || ''
    }))
  });
});

app.get('/api/public/about', async (req, res) => {
  const about = await contentStore.getSection('about');
  res.json(about || {});
});

app.get('/api/public/contact', async (req, res) => {
  const contact = await contentStore.getSection('contact');
  res.json(contact || {});
});

function isValidPhone(phone) {
  const v = String(phone || '').trim();
  if (!v) return false;
  return /^[0-9+\- ]{6,20}$/.test(v);
}

app.post('/api/public/appointments', async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const community = String(body.community || '').trim();
  const area = String(body.area || '').trim();
  const demand = String(body.demand || '').trim();

  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!isValidPhone(phone)) return res.status(400).json({ error: 'phone_invalid' });

  const appointment = {
    id: `ap_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name,
    phone,
    community,
    area,
    demand,
    createdAt: new Date().toISOString()
  };

  await contentStore.createAppointment(appointment);

  res.json({ ok: true, id: appointment.id });
});

app.get('/api/admin/meta', adminAuth, async (req, res) => {
  await contentStore.init();
  const cosCreds = hasCOSConfig() ? await getCredentials() : null;
  apiOk(res, {
    mode: hasMySQLConfig() ? 'mysql' : 'file',
    mysqlConfigured: hasMySQLConfig(),
    cosConfigured: hasCOSConfig(),
    cosCredentialSource: cosCreds ? cosCreds.source : null,
    adminEmail: getAdminEmail(),
    storePath: hasMySQLConfig() ? null : require('./lib/store').STORE_PATH
  });
});

app.get('/api/admin/store', adminAuth, async (req, res) => {
  const store = await contentStore.getStore();
  res.json(store);
});

app.put('/api/admin/store', adminAuth, async (req, res) => {
  const next = req.body;
  if (!next || typeof next !== 'object') return res.status(400).json({ error: 'invalid_body' });
  await contentStore.replaceStore(next);
  const store = await contentStore.getStore();
  res.json(store);
});

app.get('/api/admin/section/:key', adminAuth, async (req, res) => {
  const key = String(req.params.key || '').trim();
  const value = await contentStore.getSection(key);
  if (value === null) return res.status(404).json({ error: 'not_found' });
  res.json(value);
});

app.put('/api/admin/section/:key', adminAuth, async (req, res) => {
  const key = String(req.params.key || '').trim();
  const value = req.body;
  if (!key) return res.status(400).json({ error: 'invalid_key' });
  if (value === null || value === undefined) return res.status(400).json({ error: 'invalid_body' });

  const ok = await contentStore.setSection(key, value);
  if (!ok) return res.status(400).json({ error: 'read_only' });
  const saved = await contentStore.getSection(key);
  res.json(saved);
});

app.post('/api/admin/reset', adminAuth, async (req, res) => {
  await contentStore.reset();
  const store = await contentStore.getStore();
  res.json({ ok: true, store });
});

app.post('/api/admin/upload', adminAuth, upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) return apiErr(res, 400, 'file_required');
  const mt = String(f.mimetype || '').toLowerCase();
  if (!mt.startsWith('image/')) return apiErr(res, 400, 'image_only');
  try {
    const result = await uploadImage({ buffer: f.buffer, contentType: f.mimetype, filename: f.originalname });
    apiOk(res, { url: result.url, key: result.key });
  } catch (e) {
    if (e && e.code === 'cos_not_configured') return apiErr(res, 500, 'cos_not_configured');
    if (e && e.code === 'cos_credentials_unavailable') return apiErr(res, 500, 'cos_credentials_unavailable');
    apiErr(res, 500, 'upload_failed');
  }
});

const publicDir = path.resolve(__dirname, 'public');
app.use(express.static(publicDir));

app.get(/^\/(?!api|healthz).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`admin-backend listening on ${port}`);
});
