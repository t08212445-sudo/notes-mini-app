import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'notes-reminders';
const BOT_AUTH_MESSAGE = 'notes-bot-api-v2';
const LAUNCH_TTL = 15 * 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'Content-Type,X-Telegram-Init-Data,X-MiniApp-Launch,X-Bot-Auth,X-User-Id',
      'access-control-allow-origin': '*',
    },
  });
}

function hmacHex(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

function safeHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
  catch { return false; }
}

function botAuthorized(req) {
  const token = process.env.BOT_TOKEN || '';
  const supplied = req.headers.get('x-bot-auth') || '';
  if (!token || !supplied) return false;
  return safeHex(supplied, hmacHex(token, BOT_AUTH_MESSAGE));
}

function validateInitData(raw) {
  if (!raw || !process.env.BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(raw);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const check = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
    if (!safeHex(hash, expected)) return null;
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
    const user = JSON.parse(params.get('user') || '{}');
    return user?.id ? { id: Number(user.id), source: 'initData' } : null;
  } catch { return null; }
}

function decodeLaunch(raw) {
  if (!raw || !process.env.BOT_TOKEN) return null;
  try {
    const [payload, sig] = String(raw).split('.');
    if (!payload || !sig) return null;
    const expected = hmacHex(process.env.BOT_TOKEN, payload);
    if (!safeHex(sig, expected)) return null;
    const text = Buffer.from(payload, 'base64url').toString('utf8');
    const data = JSON.parse(text);
    if (!data.uid || !data.exp || Number(data.exp) < Math.floor(Date.now() / 1000)) return null;
    return { id: Number(data.uid), source: 'launch' };
  } catch { return null; }
}

function authenticate(req) {
  if (botAuthorized(req)) return { bot: true, id: null };
  const launch = decodeLaunch(req.headers.get('x-miniapp-launch') || '');
  if (launch) return { bot: false, id: launch.id };
  const init = validateInitData(req.headers.get('x-telegram-init-data') || '');
  if (init) return { bot: false, id: init.id };
  return null;
}

function validate(payload) {
  const text = String(payload?.text || '').trim();
  const time = String(payload?.time || '');
  const mode = payload?.mode;
  if (!text || text.length > 500) throw new Error('Текст должен содержать от 1 до 500 символов.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Некорректное время.');
  if (!['once', 'weekly', 'interval'].includes(mode)) throw new Error('Некорректный режим повторения.');
  if (mode === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ''))) throw new Error('Укажите дату.');
  if (mode === 'weekly' && (!Array.isArray(payload.weekdays) || !payload.weekdays.length)) throw new Error('Выберите дни недели.');
  if (mode === 'interval' && (!Number.isInteger(Number(payload.interval_days)) || Number(payload.interval_days) < 1 || Number(payload.interval_days) > 365 || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.start_date || '')))) throw new Error('Проверьте интервал и дату начала.');
}

const store = () => getStore(STORE_NAME);

async function readIndex(uid) {
  const value = await store().get(`u/${uid}`, { type: 'json' });
  return Array.isArray(value?.ids) ? value.ids.map(String) : [];
}

async function writeIndex(uid, ids) {
  const unique = [...new Set(ids.map(String))];
  await store().setJSON(`u/${uid}`, { user_id: Number(uid), ids: unique, updated_at: new Date().toISOString() });
  return unique;
}

async function readReminder(id) {
  return await store().get(`r/${String(id)}`, { type: 'json' });
}

async function getUserReminders(uid) {
  let ids = await readIndex(uid);
  let items = [];
  for (const id of ids) {
    const item = await readReminder(id);
    if (item && Number(item.user_id) === Number(uid)) items.push(item);
  }

  // Одноразовая миграция старых r/* записей, которые были созданы до индекса.
  // Она запускается только для конкретного пользователя и не является обычным путём.
  if (!items.length) {
    const legacy = await store().list({ prefix: 'r/' });
    const found = [];
    for (const entry of legacy.blobs || []) {
      const item = await readReminder(entry.key.slice(2));
      if (item && Number(item.user_id) === Number(uid)) found.push(item);
    }
    if (found.length) {
      ids = [...new Set([...ids, ...found.map(x => String(x.id))])];
      await writeIndex(uid, ids);
      items = found;
    }
  }
  items.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  return items;
}

async function upsert(item, uid) {
  validate(item);
  const id = String(item.id || `r_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`);
  const existing = await readReminder(id);
  if (existing && Number(existing.user_id) !== Number(uid)) throw new Error('forbidden');
  const now = new Date().toISOString();
  const result = {
    ...item,
    id,
    user_id: Number(uid),
    text: String(item.text).trim().slice(0, 500),
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    created_at: existing?.created_at || item.created_at || now,
    updated_at: now,
  };
  if (existing) {
    result.last_sent = item.last_sent ?? existing.last_sent ?? null;
    result.delivery_key = item.delivery_key ?? existing.delivery_key ?? null;
  } else {
    result.last_sent = item.last_sent ?? null;
    result.delivery_key = item.delivery_key ?? null;
  }
  await store().setJSON(`r/${id}`, result);
  const ids = await readIndex(uid);
  if (!ids.includes(id)) ids.push(id);
  await writeIndex(uid, ids);
  return result;
}

async function remove(id, uid, isBot) {
  const rid = String(id);
  const existing = await readReminder(rid);
  if (!existing) return false;
  if (!isBot && Number(existing.user_id) !== Number(uid)) return false;
  const owner = Number(existing.user_id);
  const ids = await readIndex(owner);
  await writeIndex(owner, ids.filter(x => x !== rid));
  await store().delete(`r/${rid}`);
  await store().setJSON(`d/${rid}`, { id: rid, user_id: owner, deleted_at: new Date().toISOString() });
  return true;
}

async function getAllForBot() {
  const result = [];
  const seen = new Set();
  const indexes = await store().list({ prefix: 'u/' });
  for (const entry of indexes.blobs || []) {
    const uid = entry.key.slice(2);
    const items = await getUserReminders(uid);
    for (const item of items) { seen.add(String(item.id)); result.push(item); }
  }
  // Миграция старой базы: если индексов ещё нет, подхватываем старые r/*
  // записи и сразу создаём новые пользовательские индексы.
  if (!(indexes.blobs || []).length) {
    const legacy = await store().list({ prefix: 'r/' });
    const byUser = new Map();
    for (const entry of legacy.blobs || []) {
      const item = await readReminder(entry.key.slice(2));
      if (!item?.id || item.user_id == null || seen.has(String(item.id))) continue;
      result.push(item);
      seen.add(String(item.id));
      const uid = String(item.user_id);
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(String(item.id));
    }
    for (const [uid, ids] of byUser) await writeIndex(uid, ids);
  }
  return result;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' } });
  try {
    const auth = authenticate(req);
    if (!auth) return json({ ok: false, error: 'forbidden' }, 403);

    if (req.method === 'GET') {
      if (auth.bot && new URL(req.url).searchParams.get('all') === '1') {
        return json({ ok: true, reminders: await getAllForBot() });
      }
      const uid = auth.bot ? Number(new URL(req.url).searchParams.get('user_id')) : auth.id;
      if (!uid) return json({ ok: false, error: 'missing_user_id' }, 400);
      return json({ ok: true, user_id: uid, reminders: await getUserReminders(uid) });
    }

    const body = await req.json().catch(() => ({}));
    if (req.method === 'POST') {
      const uid = auth.bot ? Number(body.user_id) : auth.id;
      if (!uid) return json({ ok: false, error: 'missing_user_id' }, 400);
      if (body.action === 'upsert') {
        const item = await upsert(body.item || {}, uid);
        return json({ ok: true, item });
      }
      const item = await upsert(body, uid);
      return json({ ok: true, item });
    }

    if (req.method === 'DELETE') {
      const ok = await remove(body.id, auth.bot ? Number(body.user_id || 0) : auth.id, auth.bot);
      return json({ ok: true, deleted: ok ? String(body.id) : null, not_found: !ok });
    }

    return json({ ok: false, error: 'method_not_allowed' }, 405);
  } catch (e) {
    console.error('reminders error:', e);
    return json({ ok: false, error: e.message || 'server_error' }, 500);
  }
};
