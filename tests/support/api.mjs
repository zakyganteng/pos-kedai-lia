import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const apiUrl = process.env.QA_API_URL || 'http://127.0.0.1:18081/api/v1';
export const gatewayUrl = process.env.QA_GATEWAY_URL || 'http://127.0.0.1:19091';
export const kedai = '11111111-1111-4111-8111-111111111111';
export const salon = '22222222-2222-4222-8222-222222222222';
export const uuid = randomUUID;
export const key = () => `qa-${randomUUID()}`;
export const line = (path, businessLineId, query = {}) => `${path}?${new URLSearchParams({ businessLineId, ...query })}`;
export const businessDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function request(path, { method = 'GET', token, body, raw, headers = {}, expected, timeout = 5_000 } = {}) {
  const start = performance.now();
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((body !== undefined || raw !== undefined) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  }).catch(error => {
    throw new Error(`${method} ${path}: ${error.name || 'NetworkError'} after ${Math.round(performance.now() - start)}ms (${error.message || 'no response'})`, { cause: error });
  });
  const text = await response.text();
  let data;
  if (text && response.headers.get('content-type')?.includes('json')) {
    try { data = JSON.parse(text); } catch { assert.fail(`${method} ${path}: response is not valid JSON: ${text.slice(0, 250)}`); }
  }
  if (expected !== undefined) {
    const statuses = Array.isArray(expected) ? expected : [expected];
    assert.ok(statuses.includes(response.status), `${method} ${path}: expected ${statuses.join('/')}, got ${response.status}: ${text.slice(0, 500)}`);
  }
  if (response.status >= 400) {
    assert.equal(typeof data?.error?.code, 'string', `${method} ${path}: structured error.code missing`);
    assert.equal(typeof data?.error?.message, 'string', `${method} ${path}: structured error.message missing`);
    assert.ok(data.error.requestId, `${method} ${path}: error.requestId missing`);
    assert.doesNotMatch(text, /password_hash|SQLSTATE|panic:|stack trace|PAYMENT_API_KEY|WEBHOOK_SECRET/i, 'Error leaked implementation or secret details');
  }
  return { status: response.status, data, text, headers: response.headers, elapsed: performance.now() - start };
}

export async function login(email, password) {
  const { data } = await request('/auth/login', { method: 'POST', body: { email, password }, expected: 200 });
  assert.ok(data.accessToken, 'Login access token missing');
  assert.equal(data.tokenType, 'Bearer');
  assert.ok(Date.parse(data.expiresAt) > Date.now(), 'Session must expire in the future');
  assert.doesNotMatch(JSON.stringify(data.user), /password|hash|secret/i);
  return { token: data.accessToken, user: data.user };
}

export async function allPages(path, businessLineId, token, query = {}) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const { data } = await request(line(path, businessLineId, { ...query, page: String(page), limit: '100' }), { token, expected: 200 });
    assert.ok(Array.isArray(data.data), `${path}: data is not an array`);
    assert.equal(data.pagination.page, page);
    assert.equal(data.pagination.limit, 100);
    assert.ok(Number.isSafeInteger(data.pagination.total));
    rows.push(...data.data);
    if (page >= data.pagination.totalPages) {
      assert.equal(rows.length, data.pagination.total, `${path}: pagination total mismatch`);
      return rows;
    }
  }
  assert.fail(`${path}: pagination exceeded safety bound`);
}

export async function eventually(description, inspect, accept, { attempts = 30, interval = 100 } = {}) {
  let value;
  for (let attempt = 0; attempt < attempts; attempt++) {
    value = await inspect();
    if (accept(value)) return value;
    if (attempt + 1 < attempts) await delay(interval);
  }
  assert.fail(`${description} did not settle within ${attempts * interval}ms; last value ${JSON.stringify(value)}`);
}

export function signature(raw) {
  assert.ok(process.env.QA_WEBHOOK_SECRET, 'QA_WEBHOOK_SECRET is required');
  return createHmac('sha256', process.env.QA_WEBHOOK_SECRET).update(raw).digest('hex');
}

export async function webhook(event, { raw = JSON.stringify(event), signedRaw = raw, signaturePrefix = '', signatureOverride, eventKey = event.eventId, expected = 200, provider = 'mock', timeout = 5_000 } = {}) {
  return request(`/webhooks/payments/${provider}`, {
    method: 'POST', raw,
    headers: {
      'X-Webhook-Signature': signatureOverride ?? `${signaturePrefix}${signature(signedRaw)}`,
      ...(eventKey != null ? { 'X-Idempotency-Key': eventKey } : {}),
    },
    expected, timeout,
  });
}

// RFC 4180 parser: quoted commas, CRLF, double quotes, and embedded newlines.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  assert.equal(quoted, false, 'CSV ended inside quoted field');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (rows.length) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
  return rows;
}
