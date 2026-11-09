import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  REQUEST_UNRESOLVED,
  UPSTREAM_INVALID_RESPONSE,
  UPSTREAM_UNAVAILABLE,
  callUpstream,
  isJsonContentType,
  parseJsonBody,
  type FetchLike,
} from '../src/lib/server/upstream';

const BASE = 'http://127.0.0.1:8080/api/v1';

function recorder(response: Response | (() => Promise<Response>)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return typeof response === 'function' ? response() : response;
  };
  return { calls, fetchImpl };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('callUpstream attaches the bearer token and never follows redirects', async () => {
  const { calls, fetchImpl } = recorder(json({ data: [] }));
  const result = await callUpstream({
    baseUrl: BASE,
    path: '/products',
    method: 'GET',
    query: [['businessLineId', 'b1']],
    token: 'tok',
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/api/v1/products?businessLineId=b1');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer tok');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('callUpstream sends no credentials when there is no session token', async () => {
  const { calls, fetchImpl } = recorder(json({ ok: true }));
  await callUpstream({ baseUrl: BASE, path: '/auth/login', method: 'POST', bodyText: '{}', fetchImpl });

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal('authorization' in headers, false);
  assert.equal('cookie' in headers, false);
});

test('callUpstream forwards the idempotency key for writes', async () => {
  const { calls, fetchImpl } = recorder(json({ id: 's1' }, 201));
  await callUpstream({
    baseUrl: BASE,
    path: '/sales',
    method: 'POST',
    bodyText: '{"items":[]}',
    idempotencyKey: 'key-1',
    token: 'tok',
    mutation: true,
    fetchImpl,
  });

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['x-idempotency-key'], 'key-1');
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(calls[0].init.body, '{"items":[]}');
});

test('a 3xx from the backend is an error, not a followed redirect', async () => {
  const { fetchImpl } = recorder(new Response(null, { status: 302, headers: { location: 'http://evil.example' } }));
  const result = await callUpstream({ baseUrl: BASE, path: '/products', method: 'GET', token: 'tok', fetchImpl });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, UPSTREAM_INVALID_RESPONSE);
    assert.equal(result.status, 502);
  }
});

test('a non-JSON backend response is refused', async () => {
  const { fetchImpl } = recorder(new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  const result = await callUpstream({ baseUrl: BASE, path: '/products', method: 'GET', token: 'tok', fetchImpl });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, UPSTREAM_INVALID_RESPONSE);
});

test('a 200 with an empty body is refused instead of surfacing as undefined', async () => {
  const { fetchImpl } = recorder(new Response('', { status: 200, headers: { 'content-type': 'application/json' } }));
  const result = await callUpstream({ baseUrl: BASE, path: '/products', method: 'GET', token: 'tok', fetchImpl });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, UPSTREAM_INVALID_RESPONSE);
    assert.match(result.message, /empty/);
  }
});

test('a 200 with no content-type at all is refused', async () => {
  const { fetchImpl } = recorder(new Response('{"data":[]}', { status: 200 }));
  const result = await callUpstream({ baseUrl: BASE, path: '/products', method: 'GET', token: 'tok', fetchImpl });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, UPSTREAM_INVALID_RESPONSE);
});

test('a bodiless status is accepted without a body or content-type', async () => {
  for (const status of [204, 205]) {
    const { fetchImpl } = recorder(new Response(null, { status }));
    const result = await callUpstream({ baseUrl: BASE, path: '/sales', method: 'GET', token: 'tok', fetchImpl });

    assert.equal(result.ok, true, `expected ${status} to be accepted`);
    if (result.ok) {
      assert.equal(result.status, status);
      assert.equal(result.bodyText, '');
    }
  }
});

test('a 304 is treated as an unexpected 3xx, not as a cache hit to forward', async () => {
  const { fetchImpl } = recorder(new Response(null, { status: 304 }));
  const result = await callUpstream({ baseUrl: BASE, path: '/products', method: 'GET', token: 'tok', fetchImpl });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, UPSTREAM_INVALID_RESPONSE);
});

test('isJsonContentType matches the media type rather than searching for "json"', () => {
  for (const good of ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON', 'application/problem+json']) {
    assert.equal(isJsonContentType(good), true, `expected ${good} to be accepted`);
  }
  for (const bad of ['text/json-ish', 'application/json-rpc', 'text/html', '', null, undefined]) {
    assert.equal(isJsonContentType(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test('a failed read reports UPSTREAM_UNAVAILABLE', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('ECONNREFUSED');
  };
  const result = await callUpstream({ baseUrl: BASE, path: '/products', method: 'GET', token: 'tok', fetchImpl });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, UPSTREAM_UNAVAILABLE);
    assert.equal(result.status, 502);
  }
});

test('a failed write reports REQUEST_UNRESOLVED so the key can be reused', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('socket hang up');
  };
  const result = await callUpstream({
    baseUrl: BASE,
    path: '/sales',
    method: 'POST',
    bodyText: '{}',
    mutation: true,
    fetchImpl,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, REQUEST_UNRESOLVED);
    assert.equal(result.status, 504);
  }
});

test('a write that exceeds the timeout is unresolved, and the request is aborted', async () => {
  let abortReason: unknown;
  const fetchImpl: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signal.addEventListener('abort', () => {
        abortReason = 'aborted';
        reject(new DOMException('aborted', 'AbortError'));
      });
    });

  const result = await callUpstream({
    baseUrl: BASE,
    path: '/sales',
    method: 'POST',
    bodyText: '{}',
    mutation: true,
    timeoutMs: 10,
    fetchImpl,
  });

  assert.equal(abortReason, 'aborted');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, REQUEST_UNRESOLVED);
    assert.match(result.message, /timed out/);
  }
});

test('the timeout also covers a body that stalls after the headers arrive', async () => {
  // Headers land immediately, then the body never finishes. The old timer was
  // already cleared at this point and the request hung indefinitely.
  const stalled = new Response(
    new ReadableStream<Uint8Array>({ start() {} }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  const fetchImpl: FetchLike = async () => stalled;

  const started = Date.now();
  const result = await callUpstream({
    baseUrl: BASE,
    path: '/sales',
    method: 'POST',
    bodyText: '{}',
    mutation: true,
    timeoutMs: 25,
    fetchImpl,
  });

  assert.ok(Date.now() - started < 2000, 'expected the stalled body to be cut off by the timeout');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 504);
    assert.equal(result.code, REQUEST_UNRESOLVED);
  }
});

test('a stalled read body is UPSTREAM_UNAVAILABLE rather than unresolved', async () => {
  const stalled = new Response(
    new ReadableStream<Uint8Array>({ start() {} }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  const fetchImpl: FetchLike = async () => stalled;

  const result = await callUpstream({
    baseUrl: BASE,
    path: '/products',
    method: 'GET',
    token: 'tok',
    timeoutMs: 25,
    fetchImpl,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 502);
    assert.equal(result.code, UPSTREAM_UNAVAILABLE);
  }
});

test('a misconfigured backend URL fails before any network call', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json({});
  };
  const result = await callUpstream({ baseUrl: 'file:///etc/passwd', path: '/products', method: 'GET', fetchImpl });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'CONFIG_ERROR');
    // The failing URL must not travel back toward the browser.
    assert.equal(result.message.includes('file:'), false);
    assert.equal(result.message.includes('/etc/passwd'), false);
  }
});

test('backend error bodies are returned verbatim for the caller to pass through', async () => {
  const body = { error: { code: 'FORBIDDEN', message: 'no access', requestId: 'r1' } };
  const { fetchImpl } = recorder(json(body, 403));
  const result = await callUpstream({ baseUrl: BASE, path: '/products', method: 'GET', token: 'tok', fetchImpl });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, 403);
    assert.deepEqual(parseJsonBody(result.bodyText), body);
  }
});

test('parseJsonBody tolerates empty and malformed payloads', () => {
  assert.equal(parseJsonBody(''), undefined);
  assert.equal(parseJsonBody('{oops'), undefined);
  assert.deepEqual(parseJsonBody('{"a":1}'), { a: 1 });
});
