const express = require('express');
const path = require('path');
const multer = require('multer');
const { adminAuth, getAdminToken, getAdminEmail, verifyAdminLogin } = require('./lib/adminAuth');
const contentStore = require('./lib/contentStore');
const { hasMySQLConfig } = require('./lib/mysql');
const { uploadImage, hasCOSConfig, getCredentials, debugWxOpenApi } = require('./lib/cos');
const miniappAdmin = require('./lib/miniappAdmin');
const { hasCloudStorage, getCloudEnvId, uploadImageToCloudStorage, getTempFileUrl } = require('./lib/cloudStorage');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const RELEASE = 'cos-openapi-20260420-5';

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

process.on('unhandledRejection', (reason) => {
  try {
    console.error('unhandledRejection', reason && reason.stack ? reason.stack : reason);
  } catch (_e) {
    console.error('unhandledRejection');
  }
});

process.on('uncaughtException', (err) => {
  try {
    console.error('uncaughtException', err && err.stack ? err.stack : err);
  } catch (_e) {
    console.error('uncaughtException');
  }
});

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

app.get('/api/public/version', (req, res) => {
  res.json({ ok: true, release: RELEASE });
});

function apiOk(res, data) {
  res.json({ ok: true, data });
}

function apiErr(res, status, message) {
  res.status(status).json({ ok: false, message: message || 'Request failed' });
}

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
    const stats = await miniappAdmin.getStats();
    apiOk(res, stats);
  } catch (e) {
    apiErr(res, 500, 'stats_failed');
  }
});

app.get('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const settings = await miniappAdmin.getMiniappSettings();
    apiOk(res, settings);
  } catch (e) {
    apiErr(res, 500, 'settings_failed');
  }
});

app.put('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const settings = await miniappAdmin.updateMiniappSettings(req.body || {});
    apiOk(res, settings);
  } catch (e) {
    apiErr(res, 500, 'settings_failed');
  }
});

app.get('/api/admin/leads', adminAuth, async (req, res) => {
  try {
    const { q, limit, offset } = req.query || {};
    const r = await miniappAdmin.listLeads(q, limit, offset);
    apiOk(res, r);
  } catch (e) {
    apiErr(res, 500, 'leads_failed');
  }
});

function handleArrayEntity({ entity, sectionKey, arrayPath, qFields, idPrefix }) {
  app.get(`/api/admin/${entity}`, adminAuth, async (req, res) => {
    try {
      const { q, limit, offset } = req.query || {};
      const r = await miniappAdmin.listArray({ sectionKey, arrayPath, q, limit, offset, qFields, ensureIdPrefix: idPrefix });
      apiOk(res, r);
    } catch (e) {
      apiErr(res, 500, 'list_failed');
    }
  });

  app.post(`/api/admin/${entity}`, adminAuth, async (req, res) => {
    try {
      const item = await miniappAdmin.createArrayItem({ sectionKey, arrayPath, payload: req.body || {}, idPrefix });
      apiOk(res, item);
    } catch (e) {
      apiErr(res, 400, 'create_failed');
    }
  });

  app.put(`/api/admin/${entity}/:id`, adminAuth, async (req, res) => {
    try {
      const item = await miniappAdmin.updateArrayItem({
        sectionKey,
        arrayPath,
        id: String(req.params.id || ''),
        payload: req.body || {}
      });
      if (!item) return apiErr(res, 404, 'not_found');
      apiOk(res, item);
    } catch (e) {
      apiErr(res, 400, 'update_failed');
    }
  });

  app.delete(`/api/admin/${entity}/:id`, adminAuth, async (req, res) => {
    try {
      await miniappAdmin.deleteArrayItem({ sectionKey, arrayPath, id: String(req.params.id || '') });
      apiOk(res, {});
    } catch (e) {
      apiErr(res, 500, 'delete_failed');
    }
  });
}

[
  { entity: 'home-banners', sectionKey: 'home', arrayPath: 'banners', qFields: ['id', 'title', 'desc'], idPrefix: 'b' },
  { entity: 'home-navs', sectionKey: 'home', arrayPath: 'navs', qFields: ['id', 'type', 'name'], idPrefix: 'n' },
  { entity: 'home-services', sectionKey: 'home', arrayPath: 'services', qFields: ['id', 'name', 'desc'], idPrefix: 's' },
  { entity: 'home-advantages', sectionKey: 'home', arrayPath: 'advantages', qFields: ['id', 'title', 'desc'], idPrefix: 'a' },
  { entity: 'cases', sectionKey: 'cases', arrayPath: 'items', qFields: ['id', 'title', 'style', 'area', 'room', 'desc'], idPrefix: 'c' },
  { entity: 'designers', sectionKey: 'designers', arrayPath: 'items', qFields: ['id', 'name', 'level', 'desc'], idPrefix: 'd' },
  { entity: 'about-infos', sectionKey: 'about', arrayPath: 'infos', qFields: ['title', 'desc', 'icon'], idPrefix: 'ai' },
  { entity: 'about-history', sectionKey: 'about', arrayPath: 'history', qFields: ['year', 'event'], idPrefix: 'ah' }
].forEach(handleArrayEntity);

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

app.get('/api/public/site', wrap(async (req, res) => {
  const site = await contentStore.getSection('site');
  res.json(site || {});
}));

app.get('/api/public/home', wrap(async (req, res) => {
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
}));

app.get('/api/public/cases', wrap(async (req, res) => {
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
}));

app.get('/api/public/designers', wrap(async (req, res) => {
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
}));

app.get('/api/public/about', wrap(async (req, res) => {
  const about = await contentStore.getSection('about');
  res.json(about || {});
}));

app.get('/api/public/contact', wrap(async (req, res) => {
  const contact = await contentStore.getSection('contact');
  res.json(contact || {});
}));

function isValidPhone(phone) {
  const v = String(phone || '').trim();
  if (!v) return false;
  return /^[0-9+\- ]{6,20}$/.test(v);
}

app.post('/api/public/appointments', wrap(async (req, res) => {
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
}));

app.get('/api/admin/meta', adminAuth, wrap(async (req, res) => {
  let storeInitOk = true;
  let storeInitError = null;
  try {
    await withTimeout(contentStore.init(), 4000, 'store_init_timeout');
  } catch (e) {
    storeInitOk = false;
    storeInitError = e && e.code ? String(e.code) : (e && e.message ? String(e.message) : 'init_failed');
  }

  let cosCreds = null;
  let cosCredentialError = null;
  if (hasCOSConfig()) {
    try {
      cosCreds = await withTimeout(getCredentials(), 800, 'cos_credentials_timeout');
    } catch (e) {
      cosCreds = null;
      cosCredentialError = e && e.code ? String(e.code) : (e && e.message ? String(e.message) : 'cos_credentials_failed');
    }
  }
  const mysqlConfigured = hasMySQLConfig();
  apiOk(res, {
    release: RELEASE,
    mode: mysqlConfigured ? (storeInitOk ? 'mysql' : 'mysql_error') : 'file',
    mysqlConfigured,
    storeInitOk,
    storeInitError,
    cosConfigured: hasCOSConfig(),
    cosCredentialSource: cosCreds ? cosCreds.source : null,
    cosCredentialError,
    cloudStorageEnabled: hasCloudStorage(),
    cloudEnvId: getCloudEnvId() || null,
    adminEmail: getAdminEmail(),
    storePath: mysqlConfigured ? null : require('./lib/store').STORE_PATH
  });
}));

app.get('/api/admin/file-url', adminAuth, async (req, res) => {
  try {
    if (!hasCloudStorage()) return apiErr(res, 400, 'cloud_storage_disabled');
    const fileId = String((req.query && (req.query.fileId || req.query.cloudId)) || '').trim();
    if (!fileId) return apiErr(res, 400, 'file_id_required');
    const url = await getTempFileUrl(fileId);
    apiOk(res, { url });
  } catch (e) {
    apiErr(res, 500, 'temp_url_failed');
  }
});

app.get('/api/admin/openapi-debug', adminAuth, wrap(async (req, res) => {
  const r = await debugWxOpenApi(['/_/cos/getauth', '/_/cos/sts', '/_/cos/metaid/encode']);
  apiOk(res, r);
}));

app.get('/api/admin/store', adminAuth, wrap(async (req, res) => {
  const store = await contentStore.getStore();
  res.json(store);
}));

app.put('/api/admin/store', adminAuth, wrap(async (req, res) => {
  const next = req.body;
  if (!next || typeof next !== 'object') return res.status(400).json({ error: 'invalid_body' });
  await contentStore.replaceStore(next);
  const store = await contentStore.getStore();
  res.json(store);
}));

app.get('/api/admin/section/:key', adminAuth, wrap(async (req, res) => {
  const key = String(req.params.key || '').trim();
  const value = await contentStore.getSection(key);
  if (value === null) return res.status(404).json({ error: 'not_found' });
  res.json(value);
}));

app.put('/api/admin/section/:key', adminAuth, wrap(async (req, res) => {
  const key = String(req.params.key || '').trim();
  const value = req.body;
  if (!key) return res.status(400).json({ error: 'invalid_key' });
  if (value === null || value === undefined) return res.status(400).json({ error: 'invalid_body' });

  const ok = await contentStore.setSection(key, value);
  if (!ok) return res.status(400).json({ error: 'read_only' });
  const saved = await contentStore.getSection(key);
  res.json(saved);
}));

app.post('/api/admin/reset', adminAuth, wrap(async (req, res) => {
  await contentStore.reset();
  const store = await contentStore.getStore();
  res.json({ ok: true, store });
}));

app.post('/api/admin/upload', adminAuth, upload.single('file'), async (req, res) => {
  const started = Date.now();
  const f = req.file;
  if (!f) return apiErr(res, 400, 'file_required');
  const mt = String(f.mimetype || '').toLowerCase();
  if (!mt.startsWith('image/')) return apiErr(res, 400, 'image_only');
  try {
    if (hasCloudStorage()) {
      const r = await uploadImageToCloudStorage({ buffer: f.buffer, filename: f.originalname, mimetype: f.mimetype });
      console.log('upload_ok', { mode: 'cloud', ms: Date.now() - started, key: r.key });
      apiOk(res, { key: r.key, cloudId: r.cloudId, url: r.tempUrl || '' });
      return;
    }

    const openid = req.header('x-wx-openid') || req.header('x-wx-openid'.toUpperCase()) || 'admin';
    const result = await uploadImage({ buffer: f.buffer, contentType: f.mimetype, filename: f.originalname, openid });
    console.log('upload_ok', { mode: 'cos', ms: Date.now() - started, key: result.key });
    apiOk(res, { url: result.url, key: result.key, cloudId: result.cloudId || null });
  } catch (e) {
    console.error('upload_err', {
      ms: Date.now() - started,
      code: e && e.code ? e.code : null,
      detailCode: e && e.detailCode ? e.detailCode : null,
      message: e && e.message ? e.message : String(e)
    });
    if (e && e.code === 'cloud_env_not_configured') return apiErr(res, 500, 'cloud_env_not_configured');
    if (e && e.code === 'cloud_upload_failed') {
      const suffix = e && e.detailCode ? `:${String(e.detailCode)}` : '';
      return apiErr(res, 500, `cloud_upload_failed${suffix}`);
    }
    if (e && e.code === 'cloud_upload_timeout') return apiErr(res, 504, 'cloud_upload_timeout');
    if (e && e.code === 'cos_not_configured') return apiErr(res, 500, 'cos_not_configured');
    if (e && e.code === 'cos_bucket_invalid') return apiErr(res, 400, 'cos_bucket_invalid');
    if (e && e.code === 'cos_region_invalid') return apiErr(res, 400, 'cos_region_invalid');
    if (e && e.code === 'cos_credentials_unavailable') return apiErr(res, 500, 'cos_credentials_unavailable');
    if (e && e.code === 'cos_credentials_timeout') return apiErr(res, 504, 'cos_credentials_timeout');
    if (e && e.code === 'cos_metaid_failed') return apiErr(res, 500, 'cos_metaid_failed');
    if (e && e.code === 'cos_upload_timeout') return apiErr(res, 504, 'cos_upload_timeout');
    if (e && String(e.code || '').startsWith('openapi_')) return apiErr(res, 500, String(e.code));
    apiErr(res, 500, 'upload_failed');
  }
});

const publicDir = path.resolve(__dirname, 'public');
app.use(express.static(publicDir));

app.get(/^\/(?!api|healthz).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  try {
    console.error('route_error', err && err.stack ? err.stack : err);
  } catch (_e) {
    console.error('route_error');
  }
  if (res.headersSent) return next(err);
  apiErr(res, 500, 'server_error');
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`admin-backend listening on ${port}`);
});
