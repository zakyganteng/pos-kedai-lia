import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  isValidIdempotencyKey,
  resolveProxyRequest,
  resolveQuery,
} from '../src/lib/server/proxy-policy';

const UUID = '11111111-2222-4333-8444-555555555555';

function decide(method: string, path: string) {
  const [pathPart, queryPart = ''] = path.split('?');
  const segments = pathPart.split('/').filter((s) => s !== '');
  return resolveProxyRequest(method, segments, new URLSearchParams(queryPart));
}

test('allowlisted reads resolve to the matching backend path', () => {
  const allowed = [
    '/products',
    '/services',
    '/customers',
    '/staff',
    '/inventory',
    '/sales',
    `/sales/${UUID}`,
    `/payments/${UUID}`,
    '/integrations',
    '/categories',
    `/categories/${UUID}`,
  ];
  for (const path of allowed) {
    const decision = decide('GET', path);
    assert.equal(decision.ok, true, `expected ${path} to be allowed`);
    if (decision.ok) {
      assert.equal(decision.path, path);
      assert.equal(decision.mutation, false);
    }
  }
});

test('POST is limited to checkout and category creation', () => {
  const sale = decide('POST', '/sales?businessLineId=' + UUID);
  assert.equal(sale.ok, true);
  if (sale.ok) assert.equal(sale.mutation, true);
  assert.equal(decide('POST', '/categories?businessLineId=' + UUID).ok, true);

  for (const path of ['/products', '/customers', `/sales/${UUID}/void`, '/inventory/movements']) {
    const decision = decide('POST', path);
    assert.equal(decision.ok, false, `expected POST ${path} to be refused`);
  }
});

test('sensitive and administrative routes are not reachable', () => {
  const blocked = [
    '/webhooks/payments/mock',
    '/users',
    `/users/${UUID}`,
    '/auth/login',
    '/auth/me',
    '/reports/sales',
    '/reports/sales.csv',
    '/payments/reconciliation',
    '/health/ready',
    '/notifications',
  ];
  for (const path of blocked) {
    for (const method of ['GET', 'POST']) {
      const decision = decide(method, path);
      assert.equal(decision.ok, false, `expected ${method} ${path} to be refused`);
    }
  }
});

test('path traversal and encoded separators are refused', () => {
  for (const segments of [['..', 'users'], ['sales', '..', '..', 'users'], ['sales%2F..'], ['']]) {
    const decision = resolveProxyRequest('GET', segments, new URLSearchParams());
    assert.equal(decision.ok, false, `expected ${segments.join('/')} to be refused`);
    if (!decision.ok) assert.equal(decision.status, 404);
  }
});

test('an id-shaped segment must be a UUID', () => {
  assert.equal(decide('GET', '/sales/not-a-uuid').ok, false);
  assert.equal(decide('GET', '/payments/1').ok, false);
  assert.equal(decide('GET', `/sales/${UUID}`).ok, true);
});

test('unsupported methods are refused with 405', () => {
  for (const method of ['PUT', 'OPTIONS', 'TRACE']) {
    const decision = decide(method, '/products');
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 405);
  }
});

test('category writes are allowed only at their exact resource paths', () => {
  assert.equal(decide('PATCH', `/categories/${UUID}`).ok, true);
  assert.equal(decide('DELETE', `/categories/${UUID}`).ok, true);
  assert.equal(decide('PATCH', `/products/${UUID}`).ok, true);
  for (const [method, path] of [['DELETE', `/products/${UUID}`], ['PATCH', '/products'], ['DELETE', '/categories'], ['PATCH', `/services/${UUID}`]]) {
    assert.equal(decide(method, path).ok, false);
  }
});

test('category filters apply only to products and cannot contradict each other', () => {
  assert.equal(decide('GET', `/products?categoryId=${UUID}`).ok, true);
  assert.equal(decide('GET', '/products?uncategorized=true').ok, true);
  assert.equal(decide('GET', `/products?categoryId=${UUID}&uncategorized=true`).ok, false);
  assert.equal(decide('GET', `/services?categoryId=${UUID}`).ok, false);
  assert.equal(decide('GET', `/categories?categoryId=${UUID}`).ok, false);
  assert.equal(decide('GET', '/products?categoryId=bad').ok, false);
});

test('paging, filter and date parameters pass with valid values', () => {
  const query = resolveQuery(
    new URLSearchParams({
      businessLineId: UUID,
      page: '2',
      limit: '50',
      search: 'kopi',
      active: 'true',
      status: 'paid',
      from: '2026-01-01',
      to: '2026-01-31',
      lowStock: 'false',
      productId: UUID,
    }),
  );
  assert.ok(Array.isArray(query));
  assert.equal((query as Array<[string, string]>).length, 10);
});

test('unknown query parameters are refused rather than dropped', () => {
  const result = resolveQuery(new URLSearchParams({ role: 'owner' }));
  assert.equal(Array.isArray(result), false);
  if (!Array.isArray(result)) {
    assert.equal(result.status, 400);
    assert.equal(result.code, 'QUERY_PARAM_NOT_ALLOWED');
  }
});

test('out-of-range and malformed query values are refused', () => {
  const cases: Array<[string, string]> = [
    ['limit', '101'],
    ['limit', '0'],
    ['page', '0'],
    ['page', '-1'],
    ['businessLineId', 'not-a-uuid'],
    ['active', 'yes'],
    ['status', 'refunded'],
    ['from', '01-01-2026'],
    ['search', 'x'.repeat(101)],
  ];
  for (const [name, value] of cases) {
    const result = resolveQuery(new URLSearchParams([[name, value]]));
    assert.equal(Array.isArray(result), false, `expected ${name}=${value} to be refused`);
  }
});

test('repeated query parameters are refused', () => {
  const result = resolveQuery(
    new URLSearchParams([
      ['businessLineId', UUID],
      ['businessLineId', UUID],
    ]),
  );
  assert.equal(Array.isArray(result), false);
  if (!Array.isArray(result)) assert.equal(result.code, 'QUERY_PARAM_REPEATED');
});

test('idempotency keys are bounded and header-safe', () => {
  assert.equal(isValidIdempotencyKey('sale-2026-01-01:abc_1.2'), true);
  assert.equal(isValidIdempotencyKey(''), false);
  assert.equal(isValidIdempotencyKey(null), false);
  assert.equal(isValidIdempotencyKey('key with space'), false);
  assert.equal(isValidIdempotencyKey('a\r\nX-Role: owner'), false);
  assert.equal(isValidIdempotencyKey('x'.repeat(201)), false);
});
