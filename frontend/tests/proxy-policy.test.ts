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
    '/business-lines',
    '/products',
    `/products/${UUID}`,
    '/services',
    `/services/${UUID}`,
    '/customers',
    `/customers/${UUID}`,
    '/staff',
    `/staff/${UUID}`,
    '/inventory',
    '/inventory/movements',
    '/sales',
    `/sales/${UUID}`,
    `/payments/${UUID}`,
    '/payments/reconciliation',
    '/notifications',
    '/reports/sales',
    '/reports/inventory',
    '/reports/sales.csv',
    '/salon/queue',
    '/users',
    `/users/${UUID}`,
    '/integrations',
    '/categories',
    `/categories/${UUID}`,
    '/health/live',
    '/health/ready',
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

test('every documented write is reachable at its exact resource path', () => {
  const writes: Array<[string, string]> = [
    ['POST', '/sales?businessLineId=' + UUID],
    ['POST', '/categories?businessLineId=' + UUID],
    ['POST', '/products?businessLineId=' + UUID],
    ['POST', '/services?businessLineId=' + UUID],
    ['POST', '/customers?businessLineId=' + UUID],
    ['POST', '/staff?businessLineId=' + UUID],
    ['POST', '/inventory/movements?businessLineId=' + UUID],
    ['POST', '/salon/queue?businessLineId=' + UUID],
    ['POST', `/sales/${UUID}/void`],
    ['POST', `/notifications/${UUID}/retry`],
    ['POST', '/users'],
    ['PATCH', `/products/${UUID}`],
    ['PATCH', `/services/${UUID}`],
    ['PATCH', `/customers/${UUID}`],
    ['PATCH', `/staff/${UUID}`],
    ['PATCH', `/categories/${UUID}`],
    ['PATCH', `/salon/queue/${UUID}`],
    ['PATCH', `/users/${UUID}`],
    ['DELETE', `/products/${UUID}`],
    ['DELETE', `/services/${UUID}`],
    ['DELETE', `/customers/${UUID}`],
    ['DELETE', `/staff/${UUID}`],
    ['DELETE', `/categories/${UUID}`],
    ['DELETE', `/users/${UUID}`],
  ];
  for (const [method, path] of writes) {
    const decision = decide(method, path);
    assert.equal(decision.ok, true, `expected ${method} ${path} to be allowed`);
    if (decision.ok) assert.equal(decision.mutation, true);
  }
});

test('only checkout and queue creation require an idempotency key', () => {
  const sale = decide('POST', '/sales');
  const queue = decide('POST', '/salon/queue');
  const product = decide('POST', '/products');
  assert.equal(sale.ok && sale.idempotent, true);
  assert.equal(queue.ok && queue.idempotent, true);
  assert.equal(product.ok && product.idempotent, false);
});

test('the sales export is the only CSV route', () => {
  const csv = decide('GET', '/reports/sales.csv');
  assert.equal(csv.ok && csv.csv, true);
  const json = decide('GET', '/reports/sales');
  assert.equal(json.ok && json.csv, false);
});

test('writes on collection or wrong paths are refused', () => {
  for (const [method, path] of [
    ['DELETE', '/products'],
    ['PATCH', '/products'],
    ['DELETE', '/categories'],
    ['DELETE', `/sales/${UUID}`],
    ['PATCH', `/sales/${UUID}`],
    ['DELETE', `/salon/queue/${UUID}`],
    ['POST', `/payments/${UUID}`],
    ['POST', '/integrations'],
    ['POST', '/reports/sales'],
  ]) {
    assert.equal(decide(method, path).ok, false, `expected ${method} ${path} to be refused`);
  }
});

test('auth endpoints and provider webhooks are not reachable', () => {
  const blocked = [
    '/webhooks/payments/mock',
    '/auth/login',
    '/auth/logout',
    '/auth/me',
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

test('category filters apply only to products and cannot contradict each other', () => {
  assert.equal(decide('GET', `/products?categoryId=${UUID}`).ok, true);
  assert.equal(decide('GET', '/products?uncategorized=true').ok, true);
  assert.equal(decide('GET', `/products?categoryId=${UUID}&uncategorized=true`).ok, false);
  assert.equal(decide('GET', `/services?categoryId=${UUID}`).ok, false);
  assert.equal(decide('GET', `/categories?categoryId=${UUID}`).ok, false);
  assert.equal(decide('GET', '/products?categoryId=bad').ok, false);
});

test('query parameters are scoped to the route that accepts them', () => {
  assert.equal(decide('GET', `/reports/sales?businessLineId=${UUID}&from=2026-01-01&to=2026-01-31&groupBy=item`).ok, true);
  assert.equal(decide('GET', '/reports/sales?groupBy=week').ok, false);
  assert.equal(decide('GET', '/salon/queue?status=in_service&date=2026-02-01').ok, true);
  assert.equal(decide('GET', '/salon/queue?status=paid').ok, false);
  assert.equal(decide('GET', '/sales?status=in_service').ok, false);
  assert.equal(decide('GET', '/notifications?status=failed').ok, true);
  assert.equal(decide('GET', '/payments/reconciliation?outcome=mismatch&search=abc').ok, true);
  assert.equal(decide('GET', '/payments/reconciliation?outcome=nope').ok, false);
  assert.equal(decide('GET', '/users?businessLineId=' + UUID).ok, false);
  assert.equal(decide('GET', '/inventory?search=kopi').ok, false);
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
