const COS = require('cos-nodejs-sdk-v5');
const http = require('http');
const path = require('path');

function hasCOSConfig() {
  return Boolean(process.env.COS_BUCKET && process.env.COS_REGION);
}

function getEnvCredentials() {
  const secretId =
    process.env.COS_SECRET_ID ||
    process.env.TENCENTCLOUD_SECRET_ID ||
    process.env.TENCENTCLOUD_SECRETID ||
    '';
  const secretKey =
    process.env.COS_SECRET_KEY ||
    process.env.TENCENTCLOUD_SECRET_KEY ||
    process.env.TENCENTCLOUD_SECRETKEY ||
    '';
  const token =
    process.env.TENCENTCLOUD_SESSION_TOKEN ||
    process.env.TENCENTCLOUD_SESSIONTOKEN ||
    '';

  if (!secretId || !secretKey) return null;
  return { secretId, secretKey, token: token || null, source: 'env' };
}

function httpGetText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) return resolve(body);
        reject(new Error(`http_${res.statusCode || 0}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 1500, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

let cachedMetaCredentials = null;

async function getMetadataCredentials() {
  const base = String(process.env.TENCENTCLOUD_METADATA_URL || 'http://metadata.tencentyun.com').replace(/\/+$/, '');
  const now = Date.now();
  if (cachedMetaCredentials && cachedMetaCredentials.expireAtMs && cachedMetaCredentials.expireAtMs - now > 60 * 1000) {
    return cachedMetaCredentials;
  }

  const roleListUrl = `${base}/latest/meta-data/cam/security-credentials/`;
  const roleListText = await httpGetText(roleListUrl, 1500);
  const roleName = String(roleListText || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!roleName) return null;

  const credUrl = `${base}/latest/meta-data/cam/security-credentials/${encodeURIComponent(roleName)}`;
  const raw = await httpGetText(credUrl, 1500);
  const json = JSON.parse(raw);

  const secretId = json.TmpSecretId || json.tmpSecretId || json.SecretId || json.secretId || '';
  const secretKey = json.TmpSecretKey || json.tmpSecretKey || json.SecretKey || json.secretKey || '';
  const token = json.Token || json.token || json.SessionToken || json.sessionToken || json.SecurityToken || json.securityToken || '';

  let expireAtMs = null;
  if (json.ExpiredTime || json.expiredTime) {
    const t = Number(json.ExpiredTime || json.expiredTime);
    if (Number.isFinite(t) && t > 0) expireAtMs = t * 1000;
  }
  if (!expireAtMs && (json.Expiration || json.expiration)) {
    const d = Date.parse(String(json.Expiration || json.expiration));
    if (Number.isFinite(d)) expireAtMs = d;
  }

  if (!secretId || !secretKey) return null;
  cachedMetaCredentials = { secretId, secretKey, token: token || null, expireAtMs, source: 'metadata' };
  return cachedMetaCredentials;
}

async function getCredentials() {
  const env = getEnvCredentials();
  if (env) return env;
  try {
    const meta = await getMetadataCredentials();
    if (meta) return meta;
  } catch (e) {
    return null;
  }
  return null;
}

async function getCOSClient() {
  if (!hasCOSConfig()) return null;
  const creds = await getCredentials();
  if (!creds) return null;
  const cfg = { SecretId: creds.secretId, SecretKey: creds.secretKey };
  if (creds.token) cfg.SecurityToken = creds.token;
  return new COS(cfg);
}

function getPublicUrl(bucket, region, key) {
  const base = String(process.env.COS_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (base) return `${base}/${key}`;
  return `https://${bucket}.cos.${region}.myqcloud.com/${key}`;
}

function inferExt(filename, mimetype) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (ext) return ext;
  const mt = String(mimetype || '').toLowerCase();
  if (mt === 'image/jpeg') return '.jpg';
  if (mt === 'image/png') return '.png';
  if (mt === 'image/webp') return '.webp';
  if (mt === 'image/gif') return '.gif';
  return '';
}

function makeKey(originalname, mimetype) {
  const ext = inferExt(originalname, mimetype);
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(16).slice(2);
  return `uploads/${y}/${m}/${d}/${Date.now()}_${rand}${ext}`;
}

async function uploadImage({ buffer, contentType, filename }) {
  if (!hasCOSConfig()) {
    const err = new Error('cos_not_configured');
    err.code = 'cos_not_configured';
    throw err;
  }

  const client = await getCOSClient();
  if (!client) {
    const err = new Error('cos_credentials_unavailable');
    err.code = 'cos_credentials_unavailable';
    throw err;
  }
  const Bucket = process.env.COS_BUCKET;
  const Region = process.env.COS_REGION;
  const Key = makeKey(filename, contentType);

  await new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket,
        Region,
        Key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream'
      },
      (err) => {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });

  return {
    key: Key,
    url: getPublicUrl(Bucket, Region, Key)
  };
}

module.exports = {
  hasCOSConfig,
  uploadImage,
  getCredentials
};
