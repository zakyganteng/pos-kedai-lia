import { strict as assert } from 'node:assert';
import test from 'node:test';

import { handleSession, parseAuthSession, parseLoginBody, getCurrentUser } from '../src/lib/server/session';
import type { FetchLike } from '../src/lib/server/upstream';

const BASE = 'http://127.0.0.1:8080/api/v1';
const DEPS = { baseUrl: BASE, secureCookies: false };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recorder(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function sessionRequest(method: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (method !== 'GET') {
    if (!headers.has('origin')) headers.set('origin', 'http://127.0.0.1:3000');
    if (!headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin');
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request('http://127.0.0.1:3000/api/session', { ...init, method, headers });
}

const AUTH_SESSION = {
  accessToken: 'opaque-token-123',
  tokenType: 'Bearer',
  expiresAt: '2099-01-01T00:00:00Z',
  user: { id: 'u1', name: 'Owner', email: 'owner@owner.com', role: 'owner', active: true, businessLines: [] },
};

test('parseLoginBody accepts credentials and rejects junk', () => {
  assert.deepEqual(parseLoginBody({ email: ' owner@owner.com ', password: 'pw' }), {
    email: 'owner@owner.com',
    password: 'pw',
  });
  for (const bad of [null, {}, { email: 'a@b.c' }, { email: 1, password: 'x' }, { email: 'a@b.c', password: '' }]) {
    assert.equal(parseLoginBody(bad), null);
  }
});

test('parseAuthSession requires a cookie-safe token, usable expiry and user', () => {
  assert.ok(parseAuthSession(AUTH_SESSION));
  assert.equal(parseAuthSession({ ...AUTH_SESSION, accessToken: 'bad;token' }), null);
  assert.equal(parseAuthSession({ ...AUTH_SESSION, expiresAt: '' }), null);
  assert.equal(parseAuthSession({ ...AUTH_SESSION, user: null }), null);
});

test('parseAuthSession refuses an expiry that is unparseable or already past', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.ok(parseAuthSession({ ...AUTH_SESSION, expiresAt: '2026-01-01T00:30:00Z' }, now));

  for (const bad of ['soon', 'tomorrow', '2025-12-31T23:00:00Z', '2026-01-01T00:00:10Z', 1767225600000]) {
    assert.equal(
      parseAuthSession({ ...AUTH_SESSION, expiresAt: bad }, now),
      null,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test('POST /api/session logs in, sets an HttpOnly cookie and hides the token', async () => {
  const { calls, fetchImpl } = recorder(() => json(AUTH_SESSION));
  const response = await handleSession(
    sessionRequest('POST', { body: JSON.stringify({ email: 'owner@owner.com', password: 'pw' }) }),
    { ...DEPS, fetchImpl },
  );

  assert.equal(response.status, 200);
  assert.equal(calls[0].url, `${BASE}/auth/login`);

  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /pos_session=opaque-token-123/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.equal(setCookie.includes('Secure'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'user']);
  assert.equal(JSON.stringify(body).includes('opaque-token-123'), false);
});

test('POST /api/session passes backend 401 and 429 through without a session cookie', async () => {
  for (const status of [401, 429]) {
    const { fetchImpl } = recorder(() =>
      json({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'RATE_LIMITED', message: 'nope', requestId: 'r1' } }, status),
    );
    const response = await handleSession(
      sessionRequest('POST', { body: JSON.stringify({ email: 'a@b.c', password: 'pw' }) }),
      { ...DEPS, fetchImpl },
    );

    assert.equal(response.status, status);
    assert.match(response.headers.get('set-cookie') ?? '', /pos_session=; .*Max-Age=0/);
    const body = (await response.json()) as { error: { requestId: string } };
    assert.equal(body.error.requestId, 'r1');
  }
});

test('POST /api/session rejects cross-origin logins before calling the backend', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json(AUTH_SESSION);
  };
  const request = new Request('http://127.0.0.1:3000/api/session', {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: 'a@b.c', password: 'pw' }),
  });

  const response = await handleSession(request, { ...DEPS, fetchImpl });
  assert.equal(response.status, 403);
  assert.equal(called, false);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'CROSS_ORIGIN_BLOCKED');
});

test('POST /api/session validates the body before reaching the backend', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json(AUTH_SESSION);
  };
  const response = await handleSession(
    sessionRequest('POST', { body: JSON.stringify({ email: 'a@b.c' }) }),
    { ...DEPS, fetchImpl },
  );

  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test('POST /api/session refuses a login response without a usable token', async () => {
  const { fetchImpl } = recorder(() => json({ ...AUTH_SESSION, accessToken: '' }));
  const response = await handleSession(
    sessionRequest('POST', { body: JSON.stringify({ email: 'a@b.c', password: 'pw' }) }),
    { ...DEPS, fetchImpl },
  );

  assert.equal(response.status, 502);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('POST /api/session refuses a login response whose expiry is already past', async () => {
  // No cookie may be minted for a token the backend will reject immediately.
  const { fetchImpl } = recorder(() => json({ ...AUTH_SESSION, expiresAt: '2020-01-01T00:00:00Z' }));
  const response = await handleSession(
    sessionRequest('POST', { body: JSON.stringify({ email: 'a@b.c', password: 'pw' }) }),
    { ...DEPS, fetchImpl },
  );

  assert.equal(response.status, 502);
  assert.equal(response.headers.get('set-cookie'), null);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'UPSTREAM_INVALID_RESPONSE');
});

test('POST /api/session refuses a login response with an unparseable expiry', async () => {
  const { fetchImpl } = recorder(() => json({ ...AUTH_SESSION, expiresAt: 'in a little while' }));
  const response = await handleSession(
    sessionRequest('POST', { body: JSON.stringify({ email: 'a@b.c', password: 'pw' }) }),
    { ...DEPS, fetchImpl },
  );

  assert.equal(response.status, 502);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('POST /api/session sets a cookie lifetime that matches the backend expiry', async () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const { fetchImpl } = recorder(() => json({ ...AUTH_SESSION, expiresAt: '2026-01-01T00:30:00Z' }));
  const response = await handleSession(
    sessionRequest('POST', { body: JSON.stringify({ email: 'a@b.c', password: 'pw' }) }),
    { ...DEPS, fetchImpl, now },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=1800/);
  const body = (await response.json()) as { expiresAt: string };
  assert.equal(body.expiresAt, '2026-01-01T00:30:00Z');
});

test('POST /api/session refuses an over-sized login body before parsing it', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json(AUTH_SESSION);
  };
  const response = await handleSession(
    sessionRequest('POST', {
      body: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(64 * 1024) }),
    }),
    { ...DEPS, fetchImpl },
  );

  assert.equal(response.status, 413);
  assert.equal(called, false);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('POST /api/session requires a JSON content type', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json(AUTH_SESSION);
  };
  const response = await handleSession(
    sessionRequest('POST', {
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ email: 'a@b.c', password: 'pw' }),
    }),
    { ...DEPS, fetchImpl },
  );

  assert.equal(response.status, 415);
  assert.equal(called, false);
});

test('GET /api/session returns the current user directly', async () => {
  const { calls, fetchImpl } = recorder(() => json(AUTH_SESSION.user));
  const response = await handleSession(sessionRequest('GET', { cookie: 'pos_session=tok' }), {
    ...DEPS,
    fetchImpl,
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].url, `${BASE}/auth/me`);
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer tok');

  const body = (await response.json()) as { id: string };
  assert.equal(body.id, 'u1');
});

test('GET /api/session without a cookie is 401 and never calls the backend', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return json(AUTH_SESSION.user);
  };
  const response = await handleSession(sessionRequest('GET'), { ...DEPS, fetchImpl });

  assert.equal(response.status, 401);
  assert.equal(called, false);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('GET /api/session clears the cookie when the backend rejects the token', async () => {
  const { fetchImpl } = recorder(() => json({ error: { code: 'UNAUTHORIZED', message: 'x', requestId: 'r' } }, 401));
  const response = await handleSession(sessionRequest('GET', { cookie: 'pos_session=stale' }), {
    ...DEPS,
    fetchImpl,
  });

  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie') ?? '', /pos_session=; .*Max-Age=0/);
});

test('DELETE /api/session revokes the backend session and clears the cookie', async () => {
  const { calls, fetchImpl } = recorder(() => new Response(null, { status: 204 }));
  const response = await handleSession(sessionRequest('DELETE', { cookie: 'pos_session=tok' }), {
    ...DEPS,
    fetchImpl,
  });

  assert.equal(response.status, 204);
  assert.equal(calls[0].url, `${BASE}/auth/logout`);
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer tok');
  assert.match(response.headers.get('set-cookie') ?? '', /pos_session=; .*Max-Age=0/);
});

test('DELETE /api/session still clears the cookie when revocation is unconfirmed', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('ECONNREFUSED');
  };
  const response = await handleSession(sessionRequest('DELETE', { cookie: 'pos_session=tok' }), {
    ...DEPS,
    fetchImpl,
  });

  assert.equal(response.status, 502);
  assert.match(response.headers.get('set-cookie') ?? '', /pos_session=; .*Max-Age=0/);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'LOGOUT_UNRESOLVED');
});

test('DELETE /api/session does not claim revocation on a backend error status', async () => {
  for (const status of [500, 503, 400]) {
    const { fetchImpl } = recorder(() => json({ error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } }, status));
    const response = await handleSession(sessionRequest('DELETE', { cookie: 'pos_session=tok' }), {
      ...DEPS,
      fetchImpl,
    });

    assert.equal(response.status, 502, `expected backend ${status} to be reported as unresolved`);
    assert.match(response.headers.get('set-cookie') ?? '', /pos_session=; .*Max-Age=0/);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'LOGOUT_UNRESOLVED');
  }
});

test('DELETE /api/session treats an already-invalid token as logged out', async () => {
  const { fetchImpl } = recorder(() => json({ error: { code: 'UNAUTHORIZED', message: 'x', requestId: 'r' } }, 401));
  const response = await handleSession(sessionRequest('DELETE', { cookie: 'pos_session=stale' }), {
    ...DEPS,
    fetchImpl,
  });

  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie') ?? '', /pos_session=; .*Max-Age=0/);
});

test('DELETE /api/session clears the cookie even when the backend URL is misconfigured', async () => {
  const response = await handleSession(sessionRequest('DELETE', { cookie: 'pos_session=tok' }), {
    baseUrl: 'file:///etc/passwd',
    secureCookies: false,
  });

  assert.equal(response.status, 500);
  assert.match(response.headers.get('set-cookie') ?? '', /pos_session=; .*Max-Age=0/);
  const body = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'CONFIG_ERROR');
  assert.equal(body.error.message.includes('file:'), false);
});

test('a misconfigured backend URL never leaks its value to the browser', async () => {
  const leaky = 'ftp://svc:hunter2@internal-pos.corp.example/api/v1';
  for (const method of ['GET', 'POST'] as const) {
    const response = await handleSession(
      sessionRequest(method, {
        cookie: 'pos_session=tok',
        body: method === 'POST' ? JSON.stringify({ email: 'a@b.c', password: 'pw' }) : undefined,
      }),
      { baseUrl: leaky, secureCookies: false },
    );

    assert.equal(response.status, 500);
    const text = await response.text();
    assert.equal(text.includes('hunter2'), false, `${method} leaked credentials`);
    assert.equal(text.includes('internal-pos.corp.example'), false, `${method} leaked the host`);
    assert.equal(text.includes('ftp'), false, `${method} leaked the scheme`);
  }
});

test('DELETE /api/session rejects cross-origin logout attempts', async () => {
  const request = new Request('http://127.0.0.1:3000/api/session', {
    method: 'DELETE',
    headers: { origin: 'https://evil.example', cookie: 'pos_session=tok' },
  });
  const response = await handleSession(request, DEPS);
  assert.equal(response.status, 403);
});

test('unsupported methods are refused with Allow', async () => {
  const response = await handleSession(sessionRequest('PUT'), DEPS);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST, DELETE');
});

test('getCurrentUser helper returns null without a token or on rejection', async () => {
  assert.equal(await getCurrentUser(null, DEPS), null);

  const { fetchImpl } = recorder(() => json({ error: { code: 'UNAUTHORIZED' } }, 401));
  assert.equal(await getCurrentUser('tok', { ...DEPS, fetchImpl }), null);

  const ok = recorder(() => json(AUTH_SESSION.user));
  assert.deepEqual(await getCurrentUser('tok', { ...DEPS, fetchImpl: ok.fetchImpl }), AUTH_SESSION.user);
});
