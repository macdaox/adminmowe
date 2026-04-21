const http = require('http');
const https = require('https');
const contentStore = require('./contentStore');

const CONFIG_KEY = 'leadNotify';

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

function normalizeConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const mentionedMobileList = Array.isArray(src.mentionedMobileList)
    ? src.mentionedMobileList
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  return {
    enabled: Boolean(src.enabled),
    webhookUrl: String(src.webhookUrl || '').trim(),
    mentionAll: Boolean(src.mentionAll),
    mentionedMobileList
  };
}

function isWebhookUrl(url) {
  const v = String(url || '').trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'qyapi.weixin.qq.com' && u.pathname.includes('/webhook/send');
  } catch (_e) {
    return false;
  }
}

function maskWebhookUrl(url) {
  const v = String(url || '').trim();
  if (!v) return '';
  return v.replace(/([?&]key=)([^&]+)/, (_m, p, key) => `${p}${String(key).slice(0, 6)}***${String(key).slice(-4)}`);
}

async function getConfig() {
  const raw = await contentStore.getSection(CONFIG_KEY);
  return normalizeConfig(raw || {});
}

async function saveConfig(payload) {
  const next = normalizeConfig(payload);
  if (next.webhookUrl && !isWebhookUrl(next.webhookUrl)) {
    const err = new Error('wecom_webhook_invalid');
    err.code = 'wecom_webhook_invalid';
    throw err;
  }
  await contentStore.setSection(CONFIG_KEY, next);
  return next;
}

function publicConfig(config) {
  const c = normalizeConfig(config);
  return Object.assign({}, c, {
    webhookUrlMasked: maskWebhookUrl(c.webhookUrl)
  });
}

function formatAppointment(appointment) {
  const a = appointment && typeof appointment === 'object' ? appointment : {};
  const lines = [
    '新的预约线索',
    '',
    `客户：${a.name || '-'}`,
    `电话：${a.phone || '-'}`,
    `小区：${a.community || '-'}`,
    `面积：${a.area || '-'}`,
    `需求：${a.demand || '-'}`,
    `提交时间：${a.createdAt ? new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }) : new Date().toLocaleString('zh-CN', { hour12: false })}`
  ];
  return lines.join('\n');
}

function postJson(url, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = client.request(
      u,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.length)
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch (_e) {}
          if (!(res.statusCode && res.statusCode >= 200 && res.statusCode < 300)) {
            const err = new Error(`http_${res.statusCode || 0}`);
            err.code = `http_${res.statusCode || 0}`;
            return reject(err);
          }
          const errcode = json.errcode ?? json.errCode ?? 0;
          if (Number(errcode) !== 0) {
            const err = new Error(String(json.errmsg || json.errMsg || 'wecom_robot_error'));
            err.code = `wecom_robot_${String(errcode)}`;
            return reject(err);
          }
          resolve(json);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs || 5000, () => req.destroy(new Error('wecom_robot_timeout')));
    req.write(body);
    req.end();
  });
}

async function sendText(config, content) {
  const c = normalizeConfig(config);
  if (!c.enabled || !c.webhookUrl) return { skipped: true };
  if (!isWebhookUrl(c.webhookUrl)) return { skipped: true };

  const mentioned = c.mentionAll ? ['@all'] : c.mentionedMobileList;
  const payload = {
    msgtype: 'text',
    text: {
      content: String(content || ''),
      mentioned_mobile_list: mentioned
    }
  };
  await withTimeout(postJson(c.webhookUrl, payload, 5000), 6000, 'wecom_robot_timeout');
  return { skipped: false };
}

async function notifyAppointment(appointment) {
  try {
    const config = await getConfig();
    return await sendText(config, formatAppointment(appointment));
  } catch (e) {
    console.error('wecom_notify_err', {
      code: e && e.code ? String(e.code) : null,
      message: e && e.message ? String(e.message) : String(e)
    });
    return { skipped: true, error: e && e.code ? String(e.code) : 'wecom_notify_failed' };
  }
}

async function sendTest() {
  const config = await getConfig();
  if (!config.enabled) {
    const err = new Error('wecom_robot_disabled');
    err.code = 'wecom_robot_disabled';
    throw err;
  }
  if (!config.webhookUrl) {
    const err = new Error('wecom_webhook_required');
    err.code = 'wecom_webhook_required';
    throw err;
  }
  await sendText(config, `预约通知测试\n\n发送时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  return true;
}

module.exports = {
  getConfig,
  saveConfig,
  publicConfig,
  notifyAppointment,
  sendTest
};
