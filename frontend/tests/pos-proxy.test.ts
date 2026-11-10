import { strict as assert } from 'node:assert';
import test from 'node:test';

import { handlePosProxy } from '../src/lib/server/pos-proxy';
import type { FetchLike } from '../src/lib/server/upstream';

const BASE = 'http://127.0.0.1:8080/api/v1';
const DEPS = { baseUrl: BASE, secureCookies: false };
const UUID = '11111111-2222-4333-8444-555555555555';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recorder(handler: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler();
  };
  return { calls, fetchImpl };
}

function proxyRequest(
  method: string,
  path: string,
  init: { cookie?: string; headers?: Record<string, string>; body?: string } = {},
): { request: Request; segments: string[] } {
  const url = new URL(`http://127.0.0.1:3000/api/pos${path}`);
  const headers = new Headers(init.headers);
  if (method !== 'GET') {
    if (!headers.has('origin')) headers.set('origin', 'http://127.0.0.1:3000');
    if (!headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin');
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  if (init.cookie !== undefined) headers.set('cookie', init.cookie);

  const segments = url.pathname.replace('/api/pos/', '').split('/').filter((s) => s !== '');
  return {
    request: new Request(url, { method, headers, body: init.body }),
    segments,
  };
}

test('an allowlisted read is forwarded with the cookie session as a bearer token', async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: [], pagination: {} }));
  const { request, segments } = proxyRequest('GET', `/products?businessLineId=${UUID}&limit=20`, {
    cookie: 'pos_session=tok',
  });

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });

  assert.equal(response.status, 200);
  assert.equal(calls[0].url, `${BASE}/products?businessLineId=${UUID}&limit=20`);
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer tok');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('client-supplied Cookie and Authorization headers are never forwarded', async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: [] }));
  const { request, segments } = proxyRequest('GET', '/products', {
    cookie: 'pos_session=tok; other=value',
    headers: { authorization: 'Bearer attacker-token', 'x-forwarded-for': '10.0.0.1' },
  });

  await handlePosProxy(request, segments, { ...DEPS, fetchImpl });

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer tok');
  assert.equal('cookie' in headers, false);
  assert.equal('x-forwarded-for' in headers, false);
});

test('requests without a session cookie are 401 and never reach the backend', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json({});
  };
  const { request, segments } = proxyRequest('GET', '/products');

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test('a backend 401 clears the session cookie and passes the envelope through', async () => {
  const { fetchImpl } = recorder(() => json({ error: { code: 'UNAUTHORIZED', message: 'expired', requestId: 'r9' } }, 401));
  const { request, segments } = proxyRequest('GET', '/products', { cookie: 'pos_session=stale' });

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });

  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie') ?? '', /pos_session=; .*Max-Age=0/);
  const body = (await response.json()) as { error: { requestId: string } };
  assert.equal(body.error.requestId, 'r9');
});

test('non-allowlisted routes are refused without any backend call', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json({});
  };

  for (const [method, path] of [
    ['POST', '/webhooks/payments/mock'],
    ['GET', '/auth/me'],
    ['POST', '/auth/login'],
    ['DELETE', `/sales/${UUID}`],
    ['GET', '/admin'],
  ] as const) {
    const { request, segments } = proxyRequest(method, path, { cookie: 'pos_session=tok' });
    const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
    assert.equal(response.status, 404, `expected ${method} ${path} to be refused`);
  }
  assert.equal(called, false);
});

test('a rejected query parameter never reaches the backend', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json({});
  };
  const { request, segments } = proxyRequest('GET', '/products?role=owner', { cookie: 'pos_session=tok' });

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
  assert.equal(response.status, 400);
  assert.equal(called, false);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'QUERY_PARAM_NOT_ALLOWED');
});

test('creating a sale forwards the body and the idempotency key', async () => {
  const { calls, fetchImpl } = recorder(() => json({ id: 's1', status: 'pending_payment' }, 201));
  const { request, segments } = proxyRequest('POST', `/sales?businessLineId=${UUID}`, {
    cookie: 'pos_session=tok',
    headers: { 'x-idempotency-key': 'checkout-1' },
    body: JSON.stringify({ items: [{ productId: UUID, quantity: 1 }] }),
  });

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });

  assert.equal(response.status, 201);
  assert.equal(calls[0].url, `${BASE}/sales?businessLineId=${UUID}`);
  assert.equal((calls[0].init.headers as Record<string, string>)['x-idempotency-key'], 'checkout-1');
  assert.equal(calls[0].init.body, '{"items":[{"productId":"11111111-2222-4333-8444-555555555555","quantity":1}]}');
});

test('a sale without a valid idempotency key is refused', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json({}, 201);
  };

  const variants: Array<Record<string, string>> = [
    {},
    { 'x-idempotency-key': 'bad key' },
    { 'x-idempotency-key': '' },
  ];
  for (const headers of variants) {
    const { request, segments } = proxyRequest('POST', '/sales', {
      cookie: 'pos_session=tok',
      headers,
      body: '{}',
    });
    const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  assert.equal(called, false);
});

test('a cross-origin sale is blocked before the backend is called', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json({}, 201);
  };
  const { request, segments } = proxyRequest('POST', '/sales', {
    cookie: 'pos_session=tok',
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'x-idempotency-key': 'k1' },
    body: '{}',
  });

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
  assert.equal(response.status, 403);
  assert.equal(called, false);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'CROSS_ORIGIN_BLOCKED');
});

test('a non-JSON write body is refused', async () => {
  const { request, segments } = proxyRequest('POST', '/sales', {
    cookie: 'pos_session=tok',
    headers: { 'content-type': 'text/plain', 'x-idempotency-key': 'k1' },
    body: 'items=1',
  });
  const response = await handlePosProxy(request, segments, DEPS);
  assert.equal(response.status, 415);
});

test('an unresolved checkout is reported as REQUEST_UNRESOLVED', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('socket hang up');
  };
  const { request, segments } = proxyRequest('POST', `/sales?businessLineId=${UUID}`, {
    cookie: 'pos_session=tok',
    headers: { 'x-idempotency-key': 'checkout-1' },
    body: '{}',
  });

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
  assert.equal(response.status, 504);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'REQUEST_UNRESOLVED');
});

test('the backend 502 PAYMENT_PROVIDER_ERROR envelope is passed through intact', async () => {
  // This is the code the backend puts on the wire for an unresolved intent.
  const envelope = {
    error: { code: 'PAYMENT_PROVIDER_ERROR', message: 'retry same key', requestId: 'r7' },
  };
  const { fetchImpl } = recorder(() => json(envelope, 502));
  const { request, segments } = proxyRequest('POST', '/sales', {
    cookie: 'pos_session=tok',
    headers: { 'x-idempotency-key': 'checkout-1' },
    body: '{}',
  });

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), envelope);
});

test('an oversized write body is refused', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json({}, 201);
  };
  const { request, segments } = proxyRequest('POST', '/sales', {
    cookie: 'pos_session=tok',
    headers: { 'x-idempotency-key': 'k1' },
    body: JSON.stringify({ note: 'x'.repeat(300 * 1024) }),
  });
  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });

  assert.equal(response.status, 413);
  assert.equal(called, false);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('an oversized Content-Length is refused before the body is consumed', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json({}, 201);
  };
  // The declared length alone is disqualifying; nothing needs to be buffered.
  const { request, segments } = proxyRequest('POST', '/sales', {
    cookie: 'pos_session=tok',
    headers: { 'x-idempotency-key': 'k1', 'content-length': String(64 * 1024 * 1024) },
    body: '{}',
  });
  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });

  assert.equal(response.status, 413);
  assert.equal(called, false);
  assert.equal(request.bodyUsed, false, 'expected the body never to be drained');
});

test('a misconfigured backend URL does not leak its value through the proxy', async () => {
  const { request, segments } = proxyRequest('GET', '/products', { cookie: 'pos_session=tok' });
  const response = await handlePosProxy(request, segments, {
    baseUrl: 'ftp://svc:hunter2@internal-pos.corp.example/api/v1',
    secureCookies: false,
  });

  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(text.includes('hunter2'), false);
  assert.equal(text.includes('internal-pos.corp.example'), false);
  const body = JSON.parse(text) as { error: { code: string } };
  assert.equal(body.error.code, 'CONFIG_ERROR');
});

test('category creation does not require a checkout idempotency key', async () => {
  const { calls, fetchImpl } = recorder(() => json({ id: UUID, name: 'Snack' }, 201));
  const { request, segments } = proxyRequest('POST', `/categories?businessLineId=${UUID}`, { cookie: 'pos_session=tok', body: '{"name":"Snack"}' });
  assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 201);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"name":"Snack"}');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-idempotency-key'], undefined);
});

test('category archive forwards DELETE without requiring a JSON body', async () => {
  const { calls, fetchImpl } = recorder(() => new Response(null, { status: 204 }));
  const { request, segments } = proxyRequest('DELETE', `/categories/${UUID}`, { cookie: 'pos_session=tok' });
  request.headers.delete('content-type');
  assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 204);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.body, undefined);
});

test('product patch forwards the full catalog body; invalid JSON is refused locally', async () => {
  for (const body of [`{"categoryId":"${UUID}"}`, '{"categoryId":null}', '{"price":1500,"name":"Kopi"}']) {
    const { calls, fetchImpl } = recorder(() => json({ id: UUID, categoryId: null }));
    const { request, segments } = proxyRequest('PATCH', `/products/${UUID}`, { cookie: 'pos_session=tok', body });
    assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 200);
    assert.equal(calls[0].init.method, 'PATCH');
    assert.equal(calls[0].init.body, body);
  }
  const { calls, fetchImpl } = recorder(() => json({}));
  const { request, segments } = proxyRequest('PATCH', `/products/${UUID}`, { cookie: 'pos_session=tok', body: '{bad' });
  assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 400);
  assert.equal(calls.length, 0);
});

test('queue creation requires and forwards an idempotency key', async () => {
  const missing = recorder(() => json({}, 201));
  const first = proxyRequest('POST', `/salon/queue?businessLineId=${UUID}`, { cookie: 'pos_session=tok', body: '{"serviceIds":[]}' });
  assert.equal((await handlePosProxy(first.request, first.segments, { ...DEPS, fetchImpl: missing.fetchImpl })).status, 400);
  assert.equal(missing.calls.length, 0);

  const { calls, fetchImpl } = recorder(() => json({ id: UUID }, 201));
  const { request, segments } = proxyRequest('POST', `/salon/queue?businessLineId=${UUID}`, {
    cookie: 'pos_session=tok',
    body: `{"serviceIds":["${UUID}"]}`,
    headers: { 'x-idempotency-key': 'queue-1' },
  });
  assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 201);
  assert.equal((calls[0].init.headers as Record<string, string>)['x-idempotency-key'], 'queue-1');
});

test('an action POST without a body is forwarded without one', async () => {
  const { calls, fetchImpl } = recorder(() => json({ status: 'queued' }, 202));
  const { request, segments } = proxyRequest('POST', `/notifications/${UUID}/retry`, { cookie: 'pos_session=tok' });
  assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 202);
  assert.equal(calls[0].init.body, undefined);
});

test('the sales CSV export is delivered as a CSV download', async () => {
  const csv = 'saleId,businessLineId,createdAt,paymentMethod,total\n';
  const { calls, fetchImpl } = recorder(
    () => new Response(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } }),
  );
  const { request, segments } = proxyRequest(
    'GET',
    `/reports/sales.csv?businessLineId=${UUID}&from=2026-01-01&to=2026-01-31`,
    { cookie: 'pos_session=tok' },
  );
  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/csv/);
  assert.match(response.headers.get('content-disposition') ?? '', /attachment/);
  assert.equal(await response.text(), csv);
  assert.match((calls[0].init.headers as Record<string, string>).accept, /text\/csv/);
});

test('a CSV body on a JSON route is still refused', async () => {
  const { fetchImpl } = recorder(
    () => new Response('a,b\n', { status: 200, headers: { 'content-type': 'text/csv' } }),
  );
  const { request, segments } = proxyRequest('GET', `/reports/sales?businessLineId=${UUID}`, { cookie: 'pos_session=tok' });
  assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 502);
});

test('category mutations retain same-origin checks and backend role denials', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const path = method === 'POST' ? '/categories' : `/categories/${UUID}`;
    const { calls, fetchImpl } = recorder(() => json({ error: { code: 'FORBIDDEN', message: 'not permitted' } }, 403));
    const { request, segments } = proxyRequest(method, path, { cookie: 'pos_session=tok', body: method === 'DELETE' ? undefined : '{"name":"Snack"}', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 403);
    assert.equal(calls.length, 0);
  }
  const { fetchImpl } = recorder(() => json({ error: { code: 'FORBIDDEN', message: 'not permitted' } }, 403));
  const { request, segments } = proxyRequest('PATCH', `/categories/${UUID}`, { cookie: 'pos_session=tok', body: '{"name":"Snack"}' });
  assert.equal((await handlePosProxy(request, segments, { ...DEPS, fetchImpl })).status, 403);
});

test('a backend 204 is passed through without a body', async () => {
  const { fetchImpl } = recorder(() => new Response(null, { status: 204 }));
  const { request, segments } = proxyRequest('GET', `/sales/${UUID}`, { cookie: 'pos_session=tok' });

  const response = await handlePosProxy(request, segments, { ...DEPS, fetchImpl });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
});
