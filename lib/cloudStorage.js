const cloudbase = require('@cloudbase/node-sdk');

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

  const r = await app.uploadFile({
    cloudPath,
    fileContent: buffer
  });

  const cloudId = r && (r.fileID || r.fileId);
  if (!cloudId) {
    const err = new Error('cloud_upload_failed');
    err.code = 'cloud_upload_failed';
    throw err;
  }

  const temp = await app.getTempFileURL({ fileList: [cloudId] });
  const fileList = temp && temp.fileList ? temp.fileList : [];
  const first = fileList[0] || {};
  const tempUrl = first.tempFileURL || first.tempFileUrl || '';

  return {
    key: cloudPath,
    cloudId,
    tempUrl
  };
}

module.exports = {
  getCloudEnvId,
  hasCloudStorage,
  uploadImageToCloudStorage
};

