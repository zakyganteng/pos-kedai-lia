import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ApiError,
  NETWORK_ERROR,
  PAYMENT_PROVIDER_ERROR,
  PAYMENT_UNAVAILABLE,
  REQUEST_UNRESOLVED,
  api,
  errorFromPayload,
  isUnresolvedWrite,
  sessionApi,
  toProxyUrl,
} from '../src/lib/api';

type FetchCall = { url: string; init: RequestInit };

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('toProxyUrl prefixes backend-relative paths and keeps the query string', () => {
  assert.equal(toProxyUrl('/products?businessLineId=abc'), '/api/pos/products?businessLineId=abc');
  assert.equal(toProxyUrl('sales'), '/api/pos/sales');
});

test('toProxyUrl refuses absolute and protocol-relative paths', () => {
  for (const bad of ['http://evil.example/steal', '//evil.example/steal', 'HTTPS://evil.example']) {
    assert.throws(() => toProxyUrl(bad), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'INVALID_PATH');
      assert.equal(error.status, 0);
      return true;
    });
  }
});

test('api sends same-origin, uncached requests to the proxy', async () => {
  const calls = stubFetch(() => json({ data: [] }));
  const result = await api<{ data: unknown[] }>('/products?businessLineId=x');

  assert.deepEqual(result, { data: [] });
  assert.equal(calls[0].url, '/api/pos/products?businessLineId=x');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.redirect, 'error');
});

test('api forwards method, pre-stringified body and the idempotency header', async () => {
  const calls = stubFetch(() => json({ id: 'sale-1' }, 201));
  await api('/sales?businessLineId=x', {
    method: 'POST',
    body: JSON.stringify({ items: [] }),
    headers: { 'X-Idempotency-Key': 'key-1' },
  });

  const headers = new Headers(calls[0].init.headers);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"items":[]}');
  assert.equal(headers.get('x-idempotency-key'), 'key-1');
  assert.equal(headers.get('content-type'), 'application/json');
});

test('api parses the backend error envelope including requestId and details', async () => {
  stubFetch(() =>
    json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'businessLineId is required',
          requestId: 'req-42',
          details: [{ field: 'businessLineId', message: 'required' }],
        },
      },
      400,
    ),
  );

  await assert.rejects(
    () => api('/products'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.equal(error.message, 'businessLineId is required');
      assert.equal(error.requestId, 'req-42');
      assert.deepEqual(error.details, [{ field: 'businessLineId', message: 'required' }]);
      return true;
    },
  );
});

test('api falls back to an HTTP code when the error body is not an envelope', async () => {
  stubFetch(() => new Response('', { status: 503 }));
  await assert.rejects(
    () => api('/products'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'HTTP_503');
      assert.equal(error.status, 503);
      return true;
    },
  );
});

test('api reports a transport failure as NETWORK_ERROR with status 0', async () => {
  stubFetch(() => {
    throw new TypeError('Failed to fetch');
  });

  await assert.rejects(
    () => api('/products'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.equal(error.code, NETWORK_ERROR);
      return true;
    },
  );
});

test('api returns undefined for 204 responses', async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  assert.equal(await api<void>('/sales'), undefined);
});

test('isUnresolvedWrite covers proxy, backend and transport uncertainty', () => {
  assert.equal(isUnresolvedWrite(new ApiError(504, REQUEST_UNRESOLVED, 'x')), true);
  assert.equal(isUnresolvedWrite(new ApiError(0, NETWORK_ERROR, 'x')), true);
  // The code the backend actually emits for an unresolved payment intent.
  assert.equal(isUnresolvedWrite(new ApiError(502, PAYMENT_PROVIDER_ERROR, 'x')), true);
});

test('isUnresolvedWrite treats any unrecognised 5xx as uncertain', () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(
      isUnresolvedWrite(new ApiError(status, `HTTP_${status}`, 'x')),
      true,
      `expected ${status} to be uncertain`,
    );
  }
});

test('isUnresolvedWrite knows a 503 PAYMENT_UNAVAILABLE committed nothing', () => {
  // Raised inside the backend transaction before any row is written, so a new
  // idempotency key cannot collide with a half-finished sale.
  assert.equal(isUnresolvedWrite(new ApiError(503, PAYMENT_UNAVAILABLE, 'x')), false);
});

test('isUnresolvedWrite leaves definitive client errors alone', () => {
  for (const [status, code] of [
    [409, 'CONFLICT'],
    [400, 'VALIDATION_ERROR'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ] as const) {
    assert.equal(isUnresolvedWrite(new ApiError(status, code, 'x')), false, `expected ${status} to be definitive`);
  }
  assert.equal(isUnresolvedWrite(new Error('boom')), false);
  assert.equal(isUnresolvedWrite(null), false);
});

test('errorFromPayload keeps the unresolved code the proxy reports', () => {
  const error = errorFromPayload(504, {
    error: { code: REQUEST_UNRESOLVED, message: 'timed out', requestId: 'fe-1' },
  });
  assert.equal(error.code, REQUEST_UNRESOLVED);
  assert.equal(error.status, 504);
  assert.equal(error.requestId, 'fe-1');
});

test('sessionApi GET returns the current user directly', async () => {
  const calls = stubFetch(() => json({ id: 'u1', role: 'owner' }));
  const user = await sessionApi<{ id: string }>('GET');

  assert.deepEqual(user, { id: 'u1', role: 'owner' });
  assert.equal(calls[0].url, '/api/session');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
});

test('sessionApi POST stringifies credentials and returns user plus expiry', async () => {
  const calls = stubFetch(() => json({ user: { id: 'u1' }, expiresAt: '2026-01-01T00:00:00Z' }));
  const result = await sessionApi<{ user: { id: string }; expiresAt: string }>('POST', {
    email: 'owner@owner.com',
    password: 'secret',
  });

  assert.equal(calls[0].init.body, '{"email":"owner@owner.com","password":"secret"}');
  assert.equal(result.expiresAt, '2026-01-01T00:00:00Z');
  assert.equal('accessToken' in (result as Record<string, unknown>), false);
});

test('sessionApi DELETE sends no body and tolerates 204', async () => {
  const calls = stubFetch(() => new Response(null, { status: 204 }));
  assert.equal(await sessionApi<void>('DELETE'), undefined);
  assert.equal(calls[0].init.body, undefined);
});
