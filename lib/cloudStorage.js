const cloudbase = require('@cloudbase/node-sdk');

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

function getCloudEnvId() {
  const env =
    process.env.CLOUD_ENV_ID ||
    process.env.TCB_ENV ||
    process.env.SCF_NAMESPACE ||
    '';
  return String(env || '').trim();
}

function hasCloudStorage() {
  return Boolean(getCloudEnvId());
}

function inferExt(mimetype, filename) {
  const mt = String(mimetype || '').toLowerCase();
  const name = String(filename || '');
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (ext) return ext;
  if (mt === 'image/jpeg') return '.jpg';
  if (mt === 'image/png') return '.png';
  if (mt === 'image/webp') return '.webp';
  if (mt === 'image/gif') return '.gif';
  return '';
}

function makeCloudPath(filename, mimetype) {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(16).slice(2);
  const ext = inferExt(mimetype, filename);
  return `uploads/${y}/${m}/${d}/${Date.now()}_${rand}${ext}`;
}

async function uploadImageToCloudStorage({ buffer, filename, mimetype }) {
  const env = getCloudEnvId();
  if (!env) {
    const err = new Error('cloud_env_not_configured');
    err.code = 'cloud_env_not_configured';
    throw err;
  }

  const app = cloudbase.init({ env });
  const cloudPath = makeCloudPath(filename, mimetype);
  const uploadTimeoutMs = process.env.CLOUD_UPLOAD_TIMEOUT_MS ? Number(process.env.CLOUD_UPLOAD_TIMEOUT_MS) : 15000;

  const r = await withTimeout(
    app.uploadFile({
      cloudPath,
      fileContent: buffer
    }),
    uploadTimeoutMs,
    'cloud_upload_timeout'
  );

  const cloudId = r && (r.fileID || r.fileId);
  if (!cloudId) {
    const err = new Error('cloud_upload_failed');
    err.code = 'cloud_upload_failed';
    throw err;
  }

  let tempUrl = '';
  const wantTempUrl = String(process.env.CLOUD_UPLOAD_RETURN_TEMP_URL || '').trim() === '1';
  if (wantTempUrl) {
    try {
      const tempTimeoutMs = process.env.CLOUD_TEMP_URL_TIMEOUT_MS ? Number(process.env.CLOUD_TEMP_URL_TIMEOUT_MS) : 5000;
      const temp = await withTimeout(app.getTempFileURL({ fileList: [cloudId] }), tempTimeoutMs, 'cloud_tempurl_timeout');
      const fileList = temp && temp.fileList ? temp.fileList : [];
      const first = fileList[0] || {};
      tempUrl = first.tempFileURL || first.tempFileUrl || '';
    } catch (_e) {
      tempUrl = '';
    }
  }

  return {
    key: cloudPath,
    cloudId,
    tempUrl
  };
}

async function getTempFileUrl(fileId) {
  const env = getCloudEnvId();
  if (!env) {
    const err = new Error('cloud_env_not_configured');
    err.code = 'cloud_env_not_configured';
    throw err;
  }
  const fid = String(fileId || '').trim();
  if (!fid) {
    const err = new Error('file_id_required');
    err.code = 'file_id_required';
    throw err;
  }

  const app = cloudbase.init({ env });
  const tempTimeoutMs = process.env.CLOUD_TEMP_URL_TIMEOUT_MS ? Number(process.env.CLOUD_TEMP_URL_TIMEOUT_MS) : 5000;
  const temp = await withTimeout(app.getTempFileURL({ fileList: [fid] }), tempTimeoutMs, 'cloud_tempurl_timeout');
  const fileList = temp && temp.fileList ? temp.fileList : [];
  const first = fileList[0] || {};
  const url = first.tempFileURL || first.tempFileUrl || '';
  return url;
}

module.exports = {
  getCloudEnvId,
  hasCloudStorage,
  uploadImageToCloudStorage,
  getTempFileUrl
};
