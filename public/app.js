const els = {
  baseUrl: document.getElementById('baseUrl'),
  useCurrent: document.getElementById('useCurrent'),
  refreshMeta: document.getElementById('refreshMeta'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  login: document.getElementById('login'),
  logout: document.getElementById('logout'),
  token: document.getElementById('token'),
  saveToken: document.getElementById('saveToken'),
  toggleRaw: document.getElementById('toggleRaw'),
  saveSectionTop: document.getElementById('saveSectionTop'),
  reloadSection: document.getElementById('reloadSection'),
  resetAll: document.getElementById('resetAll'),
  sectionTitle: document.getElementById('sectionTitle'),
  sectionBody: document.getElementById('sectionBody'),
  rawCard: document.getElementById('rawCard'),
  editor: document.getElementById('editor'),
  applyRaw: document.getElementById('applyRaw'),
  status: document.getElementById('status')
};

const state = {
  section: 'site',
  data: null,
  meta: null
};

function now() {
  return new Date().toISOString();
}

function setStatus(msg, obj) {
  const lines = [];
  lines.push(`[${now()}] ${msg}`);
  if (obj !== undefined) {
    try {
      lines.push(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
    } catch (e) {
      lines.push(String(obj));
    }
  }
  els.status.textContent = lines.join('\n');
}

function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return window.location.origin;
  return raw.replace(/\/+$/, '');
}

function getBaseUrl() {
  return normalizeBaseUrl(els.baseUrl.value);
}

function getToken() {
  return String(els.token.value || '').trim();
}

async function apiFetch(p, options) {
  const base = getBaseUrl();
  const url = `${base}${p}`;
  const headers = Object.assign(
    { 'x-admin-token': getToken() },
    options && options.headers ? options.headers : {}
  );

  const res = await fetch(url, Object.assign({}, options || {}, { headers }));
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = null;
  }
  if (!res.ok) {
    const err = json || { status: res.status, body: text };
    throw err;
  }
  return json;
}

function savePrefs() {
  localStorage.setItem('mowei_admin_baseUrl', String(els.baseUrl.value || ''));
  localStorage.setItem('mowei_admin_token', String(els.token.value || ''));
  localStorage.setItem('mowei_admin_username', String(els.username.value || ''));
}

function loadPrefs() {
  const baseUrl = localStorage.getItem('mowei_admin_baseUrl');
  const token = localStorage.getItem('mowei_admin_token');
  const username = localStorage.getItem('mowei_admin_username');
  els.baseUrl.value = baseUrl || window.location.origin;
  els.token.value = token || (window.__ADMIN_DEFAULT_TOKEN__ || '');
  els.username.value = username || 'admin';
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function getPath(obj, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const key = /^\d+$/.test(p) ? Number(p) : p;
    cur = cur[key];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (parts.length === 0) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    const key = /^\d+$/.test(p) ? Number(p) : p;
    const nextIsIndex = /^\d+$/.test(next);

    if (cur[key] == null) cur[key] = nextIsIndex ? [] : {};
    if (nextIsIndex && !Array.isArray(cur[key])) cur[key] = [];
    if (!nextIsIndex && !isObject(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  const last = parts[parts.length - 1];
  const lastKey = /^\d+$/.test(last) ? Number(last) : last;
  cur[lastKey] = value;
}

function delAtPath(obj, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (parts.length === 0) return;
  const parentPath = parts.slice(0, -1).join('.');
  const last = parts[parts.length - 1];
  const parent = parentPath ? getPath(obj, parentPath) : obj;
  if (Array.isArray(parent)) {
    const idx = Number(last);
    if (!Number.isFinite(idx)) return;
    parent.splice(idx, 1);
  } else if (isObject(parent)) {
    delete parent[last];
  }
}

function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
  }
  (children || []).forEach((c) => {
    if (c == null) return;
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  });
  return el;
}

function inputField({ label, path, type, placeholder, valueType, multiline }) {
  const input = multiline
    ? h('textarea', { class: 'input', dataset: { path, valueType: valueType || '' }, placeholder: placeholder || '' })
    : h('input', { class: 'input', dataset: { path, valueType: valueType || '' }, placeholder: placeholder || '', type: type || 'text' });
  const v = getPath(state.data, path);
  if (multiline) input.value = v == null ? '' : String(v);
  else input.value = v == null ? '' : String(v);
  return h('div', { class: 'field' }, [
    h('div', { class: 'label', text: label }),
    h('div', { class: 'control' }, [input])
  ]);
}

function imageField({ label, path }) {
  const v = getPath(state.data, path);
  const img = h('img', { class: 'thumb', src: v ? String(v) : '' });
  const input = h('input', { class: 'input', dataset: { path }, placeholder: 'https://...' });
  input.value = v == null ? '' : String(v);
  const btn = h('button', { class: 'btn', text: '上传', dataset: { uploadPath: path } });
  const clear = h('button', { class: 'btn', text: '清空', dataset: { clearPath: path } });
  return h('div', { class: 'field' }, [
    h('div', { class: 'label', text: label }),
    h('div', { class: 'control' }, [img, input, btn, clear])
  ]);
}

function group(title, children, actions) {
  return h('div', { class: 'group' }, [
    h('div', { class: 'group-head' }, [
      h('div', { class: 'group-title', text: title }),
      h('div', { class: 'card-actions' }, actions || [])
    ]),
    h('div', { class: 'section' }, children || [])
  ]);
}

function listGroup({ title, listPath, kind, renderItem }) {
  const list = getPath(state.data, listPath);
  const arr = Array.isArray(list) ? list : [];
  const items = arr.map((_, idx) => renderItem(idx));
  const addBtn = h('button', { class: 'btn', text: '新增', dataset: { addList: listPath, addKind: kind } });
  return group(title, [
    h('div', { class: 'list' }, items)
  ], [addBtn]);
}

function csvField({ label, path, placeholder }) {
  const v = getPath(state.data, path);
  const input = h('input', { class: 'input', dataset: { path, valueType: 'csv' }, placeholder: placeholder || '用逗号分隔' });
  input.value = Array.isArray(v) ? v.join(',') : String(v || '');
  return h('div', { class: 'field' }, [
    h('div', { class: 'label', text: label }),
    h('div', { class: 'control' }, [input])
  ]);
}

function renderSite() {
  return h('div', { class: 'section' }, [
    group('品牌信息', [
      inputField({ label: '品牌名称', path: 'brandName' }),
      inputField({ label: '英文名', path: 'brandEn' }),
      inputField({ label: 'Slogan', path: 'slogan' }),
      imageField({ label: 'Logo', path: 'logoUrl' }),
      inputField({ label: '客服电话', path: 'primaryPhone' }),
      inputField({ label: '版权文案', path: 'copyrightText' })
    ])
  ]);
}

function renderHome() {
  return h('div', { class: 'section' }, [
    listGroup({
      title: '轮播图',
      listPath: 'banners',
      kind: 'banner',
      renderItem: (idx) => {
        const base = `banners.${idx}`;
        const id = getPath(state.data, `${base}.id`) || '';
        const removeBtn = h('button', { class: 'btn danger', text: '删除', dataset: { removePath: base } });
        return h('div', { class: 'item' }, [
          h('div', { class: 'item-head' }, [h('div', { class: 'item-title', text: id ? `#${id}` : `第 ${idx + 1} 条` }), removeBtn]),
          h('div', { class: 'grid' }, [
            inputField({ label: 'ID', path: `${base}.id` }),
            inputField({ label: '标题', path: `${base}.title` }),
            inputField({ label: '描述', path: `${base}.desc` }),
            imageField({ label: '图片', path: `${base}.imageUrl` })
          ])
        ]);
      }
    }),
    listGroup({
      title: '分类导航',
      listPath: 'navs',
      kind: 'nav',
      renderItem: (idx) => {
        const base = `navs.${idx}`;
        const removeBtn = h('button', { class: 'btn danger', text: '删除', dataset: { removePath: base } });
        return h('div', { class: 'item' }, [
          h('div', { class: 'item-head' }, [h('div', { class: 'item-title', text: `第 ${idx + 1} 条` }), removeBtn]),
          h('div', { class: 'grid' }, [
            inputField({ label: 'ID', path: `${base}.id` }),
            inputField({ label: 'type', path: `${base}.type` }),
            inputField({ label: '名称', path: `${base}.name` }),
            imageField({ label: '图标', path: `${base}.iconUrl` })
          ])
        ]);
      }
    }),
    csvField({ label: '热门案例ID列表', path: 'hotCaseIds', placeholder: '例如 c1,c2,c3' }),
    listGroup({
      title: '品质定制',
      listPath: 'services',
      kind: 'service',
      renderItem: (idx) => {
        const base = `services.${idx}`;
        const removeBtn = h('button', { class: 'btn danger', text: '删除', dataset: { removePath: base } });
        return h('div', { class: 'item' }, [
          h('div', { class: 'item-head' }, [h('div', { class: 'item-title', text: `第 ${idx + 1} 条` }), removeBtn]),
          h('div', { class: 'grid' }, [
            inputField({ label: 'ID', path: `${base}.id` }),
            inputField({ label: '名称', path: `${base}.name` }),
            inputField({ label: '描述', path: `${base}.desc` }),
            imageField({ label: '图片', path: `${base}.imageUrl` })
          ])
        ]);
      }
    }),
    listGroup({
      title: '品牌优势',
      listPath: 'advantages',
      kind: 'advantage',
      renderItem: (idx) => {
        const base = `advantages.${idx}`;
        const removeBtn = h('button', { class: 'btn danger', text: '删除', dataset: { removePath: base } });
        return h('div', { class: 'item' }, [
          h('div', { class: 'item-head' }, [h('div', { class: 'item-title', text: `第 ${idx + 1} 条` }), removeBtn]),
          h('div', { class: 'grid' }, [
            inputField({ label: 'ID', path: `${base}.id` }),
            inputField({ label: '标题', path: `${base}.title` }),
            inputField({ label: '描述', path: `${base}.desc` })
          ])
        ]);
      }
    }),
    group('底部 CTA', [
      inputField({ label: '标题', path: 'cta.title' }),
      inputField({ label: '副标题', path: 'cta.subtitle' }),
      inputField({ label: '按钮文字', path: 'cta.buttonText' })
    ])
  ]);
}

function renderCases() {
  return h('div', { class: 'section' }, [
    csvField({ label: '筛选标签', path: 'filters', placeholder: '例如 全部,现代简约,欧式古典' }),
    listGroup({
      title: '案例列表',
      listPath: 'items',
      kind: 'case',
      renderItem: (idx) => {
        const base = `items.${idx}`;
        const removeBtn = h('button', { class: 'btn danger', text: '删除', dataset: { removePath: base } });
        return h('div', { class: 'item' }, [
          h('div', { class: 'item-head' }, [h('div', { class: 'item-title', text: `第 ${idx + 1} 条` }), removeBtn]),
          h('div', { class: 'grid' }, [
            inputField({ label: 'ID', path: `${base}.id` }),
            inputField({ label: '标题', path: `${base}.title` }),
            inputField({ label: '风格', path: `${base}.style` }),
            inputField({ label: '面积', path: `${base}.area` }),
            inputField({ label: '户型', path: `${base}.room` }),
            inputField({ label: '简介', path: `${base}.desc` }),
            imageField({ label: '封面', path: `${base}.coverUrl` })
          ])
        ]);
      }
    })
  ]);
}

function renderDesigners() {
  return h('div', { class: 'section' }, [
    inputField({ label: '顶部文案', path: 'introText' }),
    listGroup({
      title: '设计师列表',
      listPath: 'items',
      kind: 'designer',
      renderItem: (idx) => {
        const base = `items.${idx}`;
        const removeBtn = h('button', { class: 'btn danger', text: '删除', dataset: { removePath: base } });
        const tagsInput = h('input', { class: 'input', dataset: { path: `${base}.tags`, valueType: 'csv' }, placeholder: '用逗号分隔' });
        const tags = getPath(state.data, `${base}.tags`);
        tagsInput.value = Array.isArray(tags) ? tags.join(',') : String(tags || '');
        return h('div', { class: 'item' }, [
          h('div', { class: 'item-head' }, [h('div', { class: 'item-title', text: `第 ${idx + 1} 条` }), removeBtn]),
          h('div', { class: 'grid' }, [
            inputField({ label: 'ID', path: `${base}.id` }),
            inputField({ label: '姓名', path: `${base}.name` }),
            inputField({ label: '职位', path: `${base}.level` }),
            h('div', { class: 'field' }, [h('div', { class: 'label', text: '标签' }), h('div', { class: 'control' }, [tagsInput])]),
            inputField({ label: '简介', path: `${base}.desc` }),
            inputField({ label: '案例数', path: `${base}.cases`, type: 'number', valueType: 'number' }),
            inputField({ label: '年经验', path: `${base}.years`, type: 'number', valueType: 'number' }),
            inputField({ label: '好评率', path: `${base}.like`, type: 'number', valueType: 'number' }),
            imageField({ label: '头像', path: `${base}.avatarUrl` })
          ])
        ]);
      }
    })
  ]);
}

function renderAbout() {
  return h('div', { class: 'section' }, [
    group('基础信息', [
      imageField({ label: 'Banner', path: 'bannerUrl' }),
      inputField({ label: '品牌名称', path: 'brandName' }),
      inputField({ label: '品牌口号', path: 'brandSlogan' }),
      inputField({ label: '介绍文案', path: 'introText', multiline: true })
    ]),
    listGroup({
      title: '品牌优势块',
      listPath: 'infos',
      kind: 'aboutInfo',
      renderItem: (idx) => {
        const base = `infos.${idx}`;
        const removeBtn = h('button', { class: 'btn danger', text: '删除', dataset: { removePath: base } });
        return h('div', { class: 'item' }, [
          h('div', { class: 'item-head' }, [h('div', { class: 'item-title', text: `第 ${idx + 1} 条` }), removeBtn]),
          h('div', { class: 'grid' }, [
            inputField({ label: '图标', path: `${base}.icon` }),
            inputField({ label: '标题', path: `${base}.title` }),
            inputField({ label: '描述', path: `${base}.desc` })
          ])
        ]);
      }
    }),
    listGroup({
      title: '发展历程',
      listPath: 'history',
      kind: 'aboutHistory',
      renderItem: (idx) => {
        const base = `history.${idx}`;
        const removeBtn = h('button', { class: 'btn danger', text: '删除', dataset: { removePath: base } });
        return h('div', { class: 'item' }, [
          h('div', { class: 'item-head' }, [h('div', { class: 'item-title', text: `第 ${idx + 1} 条` }), removeBtn]),
          h('div', { class: 'grid' }, [
            inputField({ label: '年份', path: `${base}.year` }),
            inputField({ label: '事件', path: `${base}.event` })
          ])
        ]);
      }
    }),
    csvField({ label: '荣誉资质', path: 'honors', placeholder: '用逗号分隔' }),
    group('联系我们', [
      inputField({ label: '地址', path: 'contact.address' }),
      inputField({ label: '电话', path: 'contact.phone' }),
      inputField({ label: '邮箱', path: 'contact.email' })
    ])
  ]);
}

function renderContact() {
  return h('div', { class: 'section' }, [
    group('联系信息', [
      imageField({ label: '地图图', path: 'mapImageUrl' }),
      inputField({ label: '地址', path: 'address' }),
      inputField({ label: '电话', path: 'phone' }),
      inputField({ label: '邮箱', path: 'email' }),
      inputField({ label: '官网', path: 'website' }),
      imageField({ label: '公众号二维码', path: 'wechatQrUrl' })
    ])
  ]);
}

function renderAppointments() {
  const items = Array.isArray(state.data) ? state.data : [];
  const head = h('tr', null, [
    h('th', { text: '时间' }),
    h('th', { text: '姓名' }),
    h('th', { text: '电话' }),
    h('th', { text: '小区' }),
    h('th', { text: '面积' }),
    h('th', { text: '需求' })
  ]);
  const rows = items.map((it) =>
    h('tr', null, [
      h('td', { text: String(it.createdAt || '') }),
      h('td', { text: String(it.name || '') }),
      h('td', { text: String(it.phone || '') }),
      h('td', { text: String(it.community || '') }),
      h('td', { text: String(it.area || '') }),
      h('td', { text: String(it.demand || '') })
    ])
  );
  return h('div', { class: 'section' }, [h('table', { class: 'table' }, [h('thead', null, [head]), h('tbody', null, rows)])]);
}

function sectionLabel(key) {
  return {
    site: '全局信息',
    home: '首页',
    cases: '案例',
    designers: '设计师',
    about: '关于',
    contact: '联系',
    appointments: '预约'
  }[key] || key;
}

function render() {
  els.sectionTitle.textContent = sectionLabel(state.section);
  els.sectionBody.innerHTML = '';

  const node =
    state.section === 'site'
      ? renderSite()
      : state.section === 'home'
      ? renderHome()
      : state.section === 'cases'
      ? renderCases()
      : state.section === 'designers'
      ? renderDesigners()
      : state.section === 'about'
      ? renderAbout()
      : state.section === 'contact'
      ? renderContact()
      : renderAppointments();

  els.sectionBody.appendChild(node);
  try {
    els.editor.value = JSON.stringify(state.data, null, 2);
  } catch (e) {
    els.editor.value = '';
  }
}

function ensureSectionDefaults(key, data) {
  if (key === 'site') return isObject(data) ? data : {};
  if (key === 'home') return isObject(data) ? Object.assign({ banners: [], navs: [], hotCaseIds: [], services: [], advantages: [], cta: {} }, data) : { banners: [], navs: [], hotCaseIds: [], services: [], advantages: [], cta: {} };
  if (key === 'cases') return isObject(data) ? Object.assign({ filters: [], items: [] }, data) : { filters: [], items: [] };
  if (key === 'designers') return isObject(data) ? Object.assign({ introText: '', items: [] }, data) : { introText: '', items: [] };
  if (key === 'about') return isObject(data) ? Object.assign({ infos: [], history: [], honors: [], contact: {} }, data) : { infos: [], history: [], honors: [], contact: {} };
  if (key === 'contact') return isObject(data) ? data : {};
  if (key === 'appointments') return Array.isArray(data) ? data : [];
  return data;
}

async function loadSection(key) {
  const k = key || state.section;
  setStatus(`加载 ${sectionLabel(k)}...`);
  try {
    const data = await apiFetch(`/api/admin/section/${encodeURIComponent(k)}`, { method: 'GET' });
    state.section = k;
    state.data = ensureSectionDefaults(k, data);
    render();
    setStatus(`加载成功：${sectionLabel(k)}`);
  } catch (e) {
    setStatus(`加载失败：${sectionLabel(k)}`, e);
  }
}

async function saveSection() {
  const k = state.section;
  if (k === 'appointments') return setStatus('预约为只读');
  setStatus(`保存 ${sectionLabel(k)}...`);
  try {
    const data = await apiFetch(`/api/admin/section/${encodeURIComponent(k)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.data)
    });
    state.data = ensureSectionDefaults(k, data);
    render();
    setStatus(`保存成功：${sectionLabel(k)}`);
  } catch (e) {
    setStatus(`保存失败：${sectionLabel(k)}`, e);
  }
}

async function resetAll() {
  if (!confirm('确认恢复默认？将覆盖所有内容与预约列表。')) return;
  setStatus('恢复默认中...');
  try {
    await apiFetch('/api/admin/reset', { method: 'POST' });
    setStatus('恢复默认成功');
    await loadSection(state.section);
  } catch (e) {
    setStatus('恢复默认失败', e);
  }
}

async function doLogin() {
  const username = String(els.username.value || '').trim();
  const password = String(els.password.value || '');
  if (!username) return setStatus('请输入用户名');
  if (!password) return setStatus('请输入密码');
  setStatus('登录中...');
  try {
    const data = await apiFetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    els.token.value = data.token || '';
    els.password.value = '';
    savePrefs();
    setStatus('登录成功');
    await loadSection(state.section);
  } catch (e) {
    setStatus('登录失败', e);
  }
}

function doLogout() {
  els.token.value = '';
  savePrefs();
  setStatus('已退出');
}

async function refreshMeta() {
  setStatus('检测连接...');
  try {
    const meta = await apiFetch('/api/admin/meta', { method: 'GET' });
    state.meta = meta;
    setStatus('连接正常', meta);
    if (meta && meta.adminUsername) els.username.value = els.username.value || meta.adminUsername;
  } catch (e) {
    setStatus('连接失败', e);
  }
}

const uploadInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
document.body.appendChild(uploadInput);

function openFile() {
  return new Promise((resolve) => {
    uploadInput.value = '';
    uploadInput.onchange = () => {
      const f = uploadInput.files && uploadInput.files[0];
      resolve(f || null);
    };
    uploadInput.click();
  });
}

async function uploadFileToCOS(file) {
  const base = getBaseUrl();
  const url = `${base}/api/admin/upload`;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(url, { method: 'POST', headers: { 'x-admin-token': getToken() }, body: fd });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw json || { status: res.status, body: text };
  return json;
}

function defaultItem(kind) {
  if (kind === 'banner') return { id: genId('b'), title: '', desc: '', imageUrl: '' };
  if (kind === 'nav') return { id: genId('n'), type: '', name: '', iconUrl: '' };
  if (kind === 'service') return { id: genId('s'), name: '', desc: '', imageUrl: '' };
  if (kind === 'advantage') return { id: genId('a'), title: '', desc: '' };
  if (kind === 'case') return { id: genId('c'), title: '', style: '', area: '', room: '', desc: '', coverUrl: '' };
  if (kind === 'designer') return { id: genId('d'), name: '', level: '', tags: [], desc: '', cases: 0, years: 0, like: 0, avatarUrl: '' };
  if (kind === 'aboutInfo') return { icon: '🏭', title: '', desc: '' };
  if (kind === 'aboutHistory') return { year: '', event: '' };
  return {};
}

function updateValueByInput(target) {
  const path = target.dataset.path;
  if (!path) return;
  const vt = target.dataset.valueType || '';
  let v = target.value;
  if (vt === 'number') {
    const n = Number(v);
    v = Number.isFinite(n) ? n : 0;
  } else if (vt === 'csv') {
    v = String(v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  setPath(state.data, path, v);
  if (els.rawCard && !els.rawCard.classList.contains('hidden')) {
    try {
      els.editor.value = JSON.stringify(state.data, null, 2);
    } catch (e) {}
  }
}

els.sectionBody.addEventListener('input', (e) => {
  const t = e.target;
  if (!t || !t.dataset) return;
  if (t.dataset.path) updateValueByInput(t);
});

els.sectionBody.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t || !t.dataset) return;

  if (t.dataset.addList) {
    const listPath = t.dataset.addList;
    const kind = t.dataset.addKind;
    const arr = getPath(state.data, listPath);
    const next = Array.isArray(arr) ? arr : [];
    next.push(defaultItem(kind));
    setPath(state.data, listPath, next);
    render();
    return;
  }

  if (t.dataset.removePath) {
    delAtPath(state.data, t.dataset.removePath);
    render();
    return;
  }

  if (t.dataset.clearPath) {
    setPath(state.data, t.dataset.clearPath, '');
    render();
    return;
  }

  if (t.dataset.uploadPath) {
    const path = t.dataset.uploadPath;
    const file = await openFile();
    if (!file) return;
    setStatus(`上传中：${file.name}...`);
    try {
      const r = await uploadFileToCOS(file);
      setPath(state.data, path, r.url || '');
      render();
      setStatus('上传成功', r);
    } catch (err) {
      setStatus('上传失败', err);
    }
  }
});

document.querySelectorAll('.side-item').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.side-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const key = btn.dataset.section;
    if (!key) return;
    await loadSection(key);
  });
});

els.useCurrent.addEventListener('click', () => {
  els.baseUrl.value = window.location.origin;
  savePrefs();
  setStatus('已设置为当前域名');
});

els.refreshMeta.addEventListener('click', async () => {
  savePrefs();
  await refreshMeta();
});

els.login.addEventListener('click', async () => {
  savePrefs();
  await doLogin();
});

els.logout.addEventListener('click', () => {
  doLogout();
});

els.saveToken.addEventListener('click', () => {
  savePrefs();
  setStatus('已保存');
});

els.reloadSection.addEventListener('click', async () => {
  savePrefs();
  await loadSection(state.section);
});

els.resetAll.addEventListener('click', async () => {
  savePrefs();
  await resetAll();
});

els.saveSectionTop.addEventListener('click', async () => {
  savePrefs();
  await saveSection();
});

els.toggleRaw.addEventListener('click', () => {
  els.rawCard.classList.toggle('hidden');
  if (!els.rawCard.classList.contains('hidden')) {
    try {
      els.editor.value = JSON.stringify(state.data, null, 2);
    } catch (e) {}
  }
});

els.applyRaw.addEventListener('click', () => {
  try {
    const parsed = JSON.parse(els.editor.value || 'null');
    state.data = ensureSectionDefaults(state.section, parsed);
    render();
    setStatus('已应用 JSON');
  } catch (e) {
    setStatus('JSON 解析失败');
  }
});

loadPrefs();
refreshMeta();
loadSection('site');
