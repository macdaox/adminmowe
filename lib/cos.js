const COS = require('cos-nodejs-sdk-v5');
const http = require('http');
const https = require('https');
const path = require('path');

function hasCOSConfig() {
  return Boolean(process.env.COS_BUCKET && process.env.COS_REGION);
}

function validateBucket(bucket) {
  const b = String(bucket || '').trim();
  if (!b) return false;
  return /.+-\d+$/.test(b);
}

function validateRegion(region) {
  const r = String(region || '').trim();
  if (!r) return false;
  return /^[a-z0-9-]+$/.test(r);
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
    const u = String(url || '');
    const client = u.startsWith('https://') ? https : http;
    const req = client.get(url, (res) => {
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

async function getOpenApiCredentials() {
  const endpoint = String(process.env.WXCLOUDRUN_STS_ENDPOINT || '').trim();
  if (!endpoint) return null;
  const auth = String(process.env.WXCLOUDRUN_STS_AUTH || '').trim();
  const timeoutMs = process.env.WXCLOUDRUN_STS_TIMEOUT_MS ? Number(process.env.WXCLOUDRUN_STS_TIMEOUT_MS) : 2000;

  const raw = await new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(
      endpoint,
      {
        method: 'GET',
        headers: Object.assign({}, auth ? { Authorization: auth } : {})
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) return resolve(body);
          reject(new Error(`openapi_http_${res.statusCode || 0}`));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('openapi_timeout'));
    });
    req.end();
  });

  const json = JSON.parse(String(raw || '{}'));
  const data = json && json.data ? json.data : json;
  const secretId = data.tmpSecretId || data.TmpSecretId || data.secretId || data.SecretId || '';
  const secretKey = data.tmpSecretKey || data.TmpSecretKey || data.secretKey || data.SecretKey || '';
  const token =
    data.sessionToken ||
    data.SessionToken ||
    data.token ||
    data.Token ||
    data.securityToken ||
    data.SecurityToken ||
    data.XCosSecurityToken ||
    '';
  const startTime = data.startTime || data.StartTime || null;
  const expiredTime = data.expiredTime || data.ExpiredTime || null;

  if (!secretId || !secretKey) return null;
  return {
    secretId,
    secretKey,
    token: token || null,
    expireAtMs: expiredTime ? Number(expiredTime) * 1000 : null,
    startTime,
    source: 'openapi'
  };
}

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
    const openapi = await getOpenApiCredentials();
    if (openapi) return openapi;
  } catch (e) {
    return null;
  }
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
  const timeoutMs = process.env.COS_CREDENTIALS_TIMEOUT_MS ? Number(process.env.COS_CREDENTIALS_TIMEOUT_MS) : 2000;
  let creds = null;
  try {
    creds = await withTimeout(getCredentials(), timeoutMs, 'cos_credentials_timeout');
  } catch (e) {
    const err = new Error('cos_credentials_timeout');
    err.code = 'cos_credentials_timeout';
    throw err;
  }
  if (!creds) {
    const err = new Error('cos_credentials_unavailable');
    err.code = 'cos_credentials_unavailable';
    throw err;
  }
  const cfg = {
    SecretId: creds.secretId,
    SecretKey: creds.secretKey,
    Timeout: process.env.COS_UPLOAD_TIMEOUT_MS ? Number(process.env.COS_UPLOAD_TIMEOUT_MS) : 15000
  };
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

async function uploadImage({ buffer, contentType, filename }) {
  if (!hasCOSConfig()) {
    const err = new Error('cos_not_configured');
    err.code = 'cos_not_configured';
    throw err;
  }

  const Bucket = process.env.COS_BUCKET;
  const Region = process.env.COS_REGION;
  if (!validateBucket(Bucket)) {
    const err = new Error('cos_bucket_invalid');
    err.code = 'cos_bucket_invalid';
    throw err;
  }
  if (!validateRegion(Region)) {
    const err = new Error('cos_region_invalid');
    err.code = 'cos_region_invalid';
    throw err;
  }

  const client = await getCOSClient();
  if (!client) {
    const err = new Error('cos_credentials_unavailable');
    err.code = 'cos_credentials_unavailable';
    throw err;
  }
  const Key = makeKey(filename, contentType);

  const timeoutMs = process.env.COS_UPLOAD_TIMEOUT_MS ? Number(process.env.COS_UPLOAD_TIMEOUT_MS) : 15000;
  await withTimeout(
    new Promise((resolve, reject) => {
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
    }),
    timeoutMs,
    'cos_upload_timeout'
  );

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
