const els = {
  baseUrl: document.getElementById('baseUrl'),
  useCurrent: document.getElementById('useCurrent'),
  token: document.getElementById('token'),
  saveToken: document.getElementById('saveToken'),
  uploadFile: document.getElementById('uploadFile'),
  uploadBtn: document.getElementById('uploadBtn'),
  uploadUrl: document.getElementById('uploadUrl'),
  copyUrl: document.getElementById('copyUrl'),
  section: document.getElementById('section'),
  load: document.getElementById('load'),
  save: document.getElementById('save'),
  reset: document.getElementById('reset'),
  editor: document.getElementById('editor'),
  status: document.getElementById('status')
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

function getToken() {
  return String(els.token.value || '').trim();
}

function getBaseUrl() {
  return normalizeBaseUrl(els.baseUrl.value);
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

async function uploadImage() {
  const file = els.uploadFile && els.uploadFile.files && els.uploadFile.files[0];
  if (!file) {
    setStatus('请选择图片文件');
    return;
  }

  setStatus(`上传中：${file.name}...`);
  const base = getBaseUrl();
  const url = `${base}/api/admin/upload`;
  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-admin-token': getToken() },
      body: fd
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw json || { status: res.status, body: text };
    els.uploadUrl.value = json.url || '';
    setStatus('上传成功', json);
  } catch (e) {
    setStatus('上传失败', e);
  }
}

async function copyUploadUrl() {
  const v = String(els.uploadUrl.value || '').trim();
  if (!v) {
    setStatus('暂无可复制的链接');
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(v);
    } else {
      els.uploadUrl.focus();
      els.uploadUrl.select();
      document.execCommand('copy');
    }
    setStatus('已复制图片链接');
  } catch (e) {
    setStatus('复制失败，请手动复制');
  }
}

function savePrefs() {
  localStorage.setItem('mowei_admin_baseUrl', String(els.baseUrl.value || ''));
  localStorage.setItem('mowei_admin_token', String(els.token.value || ''));
}

function loadPrefs() {
  const baseUrl = localStorage.getItem('mowei_admin_baseUrl');
  const token = localStorage.getItem('mowei_admin_token');
  els.baseUrl.value = baseUrl || window.location.origin;
  els.token.value = token || (window.__ADMIN_DEFAULT_TOKEN__ || '');
}

async function loadSection() {
  const key = String(els.section.value || '').trim();
  if (!key) return;
  setStatus(`加载 ${key}...`);
  try {
    const data = await apiFetch(`/api/admin/section/${encodeURIComponent(key)}`, {
      method: 'GET'
    });
    els.editor.value = JSON.stringify(data, null, 2);
    setStatus(`加载成功：${key}`);
  } catch (e) {
    setStatus(`加载失败：${key}`, e);
  }
}

async function saveSection() {
  const key = String(els.section.value || '').trim();
  if (!key) return;
  if (key === 'appointments') {
    setStatus('appointments 为只读（通过小程序提交预约自动写入）');
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(els.editor.value || 'null');
  } catch (e) {
    setStatus('JSON 解析失败，请检查格式');
    return;
  }

  setStatus(`保存 ${key}...`);
  try {
    const data = await apiFetch(`/api/admin/section/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    });
    els.editor.value = JSON.stringify(data, null, 2);
    setStatus(`保存成功：${key}`);
  } catch (e) {
    setStatus(`保存失败：${key}`, e);
  }
}

async function resetAll() {
  setStatus('恢复默认数据（全量重置）...');
  try {
    await apiFetch('/api/admin/reset', { method: 'POST' });
    setStatus('恢复默认成功');
    await loadSection();
  } catch (e) {
    setStatus('恢复默认失败', e);
  }
}

els.useCurrent.addEventListener('click', () => {
  els.baseUrl.value = window.location.origin;
  savePrefs();
  setStatus('已设置为当前域名');
});

els.saveToken.addEventListener('click', () => {
  savePrefs();
  setStatus('已保存');
});

els.uploadBtn.addEventListener('click', async () => {
  savePrefs();
  await uploadImage();
});

els.copyUrl.addEventListener('click', async () => {
  await copyUploadUrl();
});

els.load.addEventListener('click', async () => {
  savePrefs();
  await loadSection();
});

els.save.addEventListener('click', async () => {
  savePrefs();
  await saveSection();
});

els.reset.addEventListener('click', async () => {
  savePrefs();
  if (!confirm('确认恢复默认？将覆盖所有已编辑内容。')) return;
  await resetAll();
});

loadPrefs();
loadSection();
