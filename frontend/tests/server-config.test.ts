import { strict as assert } from 'node:assert';
import test from 'node:test';

import { DEFAULT_POS_API_URL, buildUpstreamUrl, parseApiBaseUrl } from '../src/lib/server/config';

test('parseApiBaseUrl falls back to the loopback backend', () => {
  assert.equal(parseApiBaseUrl(undefined), DEFAULT_POS_API_URL);
  assert.equal(parseApiBaseUrl('   '), DEFAULT_POS_API_URL);
});

test('parseApiBaseUrl trims trailing slashes but keeps the API prefix', () => {
  assert.equal(parseApiBaseUrl('http://api.internal:8080/api/v1/'), 'http://api.internal:8080/api/v1');
  assert.equal(parseApiBaseUrl('https://api.example.test/api/v1'), 'https://api.example.test/api/v1');
});

test('parseApiBaseUrl rejects non-http schemes, credentials and query strings', () => {
  for (const bad of [
    'file:///etc/passwd',
    'gopher://api.internal',
    'ftp://api.internal/api/v1',
    'http://user:pass@api.internal/api/v1',
    'http://api.internal/api/v1?token=x',
    'not-a-url',
  ]) {
    assert.throws(() => parseApiBaseUrl(bad), /POS_API_URL/, `expected rejection for ${bad}`);
  }
});

test('parseApiBaseUrl names the variable but never echoes its value', () => {
  // The message reaches server logs and must be safe to read there; the value
  // can hold internal hostnames or credentials.
  for (const bad of [
    'ftp://svc:hunter2@internal-pos.corp.example/api/v1',
    'gopher://internal-pos.corp.example',
    'not-a-url-but-secret',
  ]) {
    assert.throws(
      () => parseApiBaseUrl(bad),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /POS_API_URL/);
        assert.equal(error.message.includes('hunter2'), false);
        assert.equal(error.message.includes('internal-pos.corp.example'), false);
        assert.equal(error.message.includes('secret'), false);
        return true;
      },
      `expected a value-free message for ${bad}`,
    );
  }
});

test('buildUpstreamUrl joins the base with an allowlisted path and query', () => {
  const url = buildUpstreamUrl('http://127.0.0.1:8080/api/v1', '/sales', [
    ['businessLineId', 'b1'],
    ['limit', '20'],
  ]);
  assert.equal(url, 'http://127.0.0.1:8080/api/v1/sales?businessLineId=b1&limit=20');
});

test('buildUpstreamUrl refuses traversal, host swapping and odd characters', () => {
  const base = 'http://127.0.0.1:8080/api/v1';
  for (const bad of ['sales', '//evil.example/sales', '/../../admin', '/sales?x=1', '/sales#frag', '/sa les']) {
    assert.throws(() => buildUpstreamUrl(base, bad), /upstream path/, `expected rejection for ${bad}`);
  }
});

test('buildUpstreamUrl does not echo the rejected path back in its message', () => {
  assert.throws(
    () => buildUpstreamUrl('http://127.0.0.1:8080/api/v1', '/../../admin?secret=1'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes('secret'), false);
      return true;
    },
  );
});
