import { strict as assert } from 'node:assert';
import test from 'node:test';

import { checkRequestOrigin, checkSameOrigin, configuredAppOrigins, selfOriginsFor } from '../src/lib/server/origin';

const SELF = ['http://127.0.0.1:3000'];

test('safe methods are never blocked', () => {
  assert.deepEqual(
    checkSameOrigin({ method: 'GET', origin: 'https://evil.example', secFetchSite: 'cross-site', selfOrigins: SELF }),
    { ok: true },
  );
});

test('same-origin mutations are allowed', () => {
  assert.deepEqual(
    checkSameOrigin({
      method: 'POST',
      origin: 'http://127.0.0.1:3000',
      secFetchSite: 'same-origin',
      selfOrigins: SELF,
    }),
    { ok: true },
  );
});

test('cross-site and same-site mutations are rejected via Sec-Fetch-Site', () => {
  for (const site of ['cross-site', 'same-site', 'none']) {
    const result = checkSameOrigin({
      method: 'POST',
      origin: 'http://127.0.0.1:3000',
      secFetchSite: site,
      selfOrigins: SELF,
    });
    assert.equal(result.ok, false, `expected ${site} to be rejected`);
  }
});

test('a foreign Origin is rejected even without Sec-Fetch-Site', () => {
  const result = checkSameOrigin({
    method: 'POST',
    origin: 'https://evil.example',
    secFetchSite: null,
    selfOrigins: SELF,
  });
  assert.equal(result.ok, false);
});

test('a mutation with no Origin and no Sec-Fetch-Site is rejected', () => {
  const result = checkSameOrigin({ method: 'DELETE', origin: null, secFetchSite: null, selfOrigins: SELF });
  assert.equal(result.ok, false);
});

test('an opaque Origin is accepted only when Sec-Fetch-Site proves same-origin', () => {
  assert.equal(
    checkSameOrigin({ method: 'POST', origin: 'null', secFetchSite: 'same-origin', selfOrigins: SELF }).ok,
    true,
  );
  assert.equal(
    checkSameOrigin({ method: 'POST', origin: 'null', secFetchSite: null, selfOrigins: SELF }).ok,
    false,
  );
});

test('selfOriginsFor uses the target Host and ignores forwarded headers', () => {
  const request = new Request('http://127.0.0.1:3000/api/session', {
    headers: { host: '127.0.0.1:3000', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example' },
  });
  const origins = selfOriginsFor(request, []);

  assert.ok(origins.includes('http://127.0.0.1:3000'));
  assert.equal(origins.includes('https://127.0.0.1:3000'), false);
  assert.equal(origins.some((o) => o.includes('evil.example')), false);
});

test('Next localhost-normalized URLs accept the actual loopback target, not a foreign initiator', () => {
  const request = new Request('http://localhost:3000/api/session', {
    method: 'POST',
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
  });
  assert.deepEqual(selfOriginsFor(request, []), ['http://127.0.0.1:3000']);
  assert.equal(checkRequestOrigin(request).ok, true);
  assert.equal(checkRequestOrigin(new Request(request, { headers: { host: '127.0.0.1:3000', origin: 'http://localhost:3000' } })).ok, false);
});

test('configured public origins are authoritative, not added to an arbitrary Host', () => {
  const request = new Request('http://localhost:3000/api/session', { headers: { host: 'untrusted.example' } });
  assert.deepEqual(selfOriginsFor(request, ['https://pos.example.test']), ['https://pos.example.test']);
});

test('malformed Host authorities do not introduce origins', () => {
  for (const host of ['evil.example/path', 'user@evil.example', 'evil.example%2F', 'evil.example?x=1']) {
    assert.deepEqual(selfOriginsFor(new Request('http://localhost:3000/api/session', { headers: { host } }), []), []);
  }
});

test('configuredAppOrigins accepts http(s) entries and drops the rest', () => {
  assert.deepEqual(configuredAppOrigins('https://pos.example.test, http://localhost:3000'), [
    'https://pos.example.test',
    'http://localhost:3000',
  ]);
  assert.deepEqual(configuredAppOrigins('file:///x, not-a-url, '), []);
  assert.deepEqual(configuredAppOrigins(undefined), []);
});

test('an explicitly configured public origin is accepted', () => {
  const request = new Request('http://127.0.0.1:3000/api/session', {
    method: 'POST',
    headers: { origin: 'https://pos.example.test', 'sec-fetch-site': 'same-origin' },
  });
  const result = checkSameOrigin({
    method: 'POST',
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    selfOrigins: selfOriginsFor(request, ['https://pos.example.test']),
  });
  assert.equal(result.ok, true);
});

test('checkRequestOrigin reads the real request headers', () => {
  const blocked = new Request('http://127.0.0.1:3000/api/pos/sales', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(checkRequestOrigin(blocked).ok, false);

  const allowed = new Request('http://127.0.0.1:3000/api/pos/sales', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(checkRequestOrigin(allowed).ok, true);
});
