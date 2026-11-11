import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { allPages, businessDate, eventually, gatewayUrl, kedai, key, line, login, parseCsv, request, salon, uuid, webhook } from './support/api.mjs';

// Run only against a disposable database started by run.mjs. This suite is destructive.
assert.match(process.env.QA_ISOLATED_DATABASE || '', /^lia_pos_qa_\d+$/, 'Use node project/tests/run.mjs; never target a shared/production database');
const actors = {};
const expectedSales = new Map();
const startedDate = businessDate();
let productSequence = 0;

async function product(overrides = {}) {
  const body = { sku: `QA-${++productSequence}-${uuid()}`, name: 'QA iced tea', unit: 'glass', price: 7001, stockTracked: false, ...overrides };
  return (await request(line('/products', kedai), { method: 'POST', token: actors.owner.token, body, expected: 201 })).data;
}
async function service(overrides = {}) {
  return (await request(line('/services', salon), { method: 'POST', token: actors.owner.token, body: { name: `QA haircut ${uuid()}`, price: 25003, durationMinutes: 30, ...overrides }, expected: 201 })).data;
}
async function customer(businessLineId, overrides = {}, token = actors.owner.token) {
  return (await request(line('/customers', businessLineId), { method: 'POST', token, body: { name: `QA customer ${uuid()}`, ...overrides }, expected: 201 })).data;
}
async function receive(item, quantity = 1) {
  return (await request(line('/inventory/movements', kedai), { method: 'POST', token: actors.owner.token, body: { productId: item.id, type: 'receive', quantityDelta: quantity, reason: 'QA receiving stock' }, expected: 201 })).data;
}
function saleBody(item, { quantity = 1, method = 'cash', ...extra } = {}) {
  return { items: [{ itemType: item.businessLineId === salon ? 'service' : 'product', itemId: item.id, quantity }], paymentMethod: method, ...(method === 'cash' ? { cashReceived: item.price * quantity + 1000 } : {}), ...extra };
}
async function checkout(item, options = {}) {
  const { body: suppliedBody, token: _token, idempotencyKey: _key, total: _total, expectedItems: _items, ...saleOptions } = options;
  const body = suppliedBody || saleBody(item, saleOptions);
  const response = await request(line('/sales', item.businessLineId), {
    method: 'POST', token: options.token || actors.owner.token, body,
    headers: { 'X-Idempotency-Key': options.idempotencyKey || key() }, expected: 201,
  });
  const sale = response.data;
  const total = options.total ?? item.price * (options.quantity || 1);
  assert.equal(sale.total, total, 'Server-calculated sale total');
  assert.equal(sale.subtotal, total);
  assert.ok(Number.isSafeInteger(sale.total), 'Integer IDR total required');
  assert.equal(sale.payment.amount, total);
  assert.equal(sale.payment.currency, 'IDR');
  assert.equal(sale.businessLineId, item.businessLineId);
  assert.equal(sale.status, body.paymentMethod === 'cash' ? 'paid' : 'pending_payment');
  assert.equal(sale.payment.status, body.paymentMethod === 'cash' ? 'confirmed' : 'pending');
  const expectedItems = options.expectedItems || body.items.map(input => {
    assert.equal(input.itemId, item.id, 'Multi-item checkout fixtures must supply independent expectedItems');
    return { itemId: item.id, displayName: item.name, quantity: input.quantity, unitPrice: item.price, lineTotal: item.price * input.quantity };
  });
  assert.equal(expectedItems.reduce((sum, row) => sum + row.lineTotal, 0), total);
  for (const expected of expectedItems) {
    const actual = sale.items.find(row => row.itemId === expected.itemId);
    assert.ok(actual, 'Expected item snapshot not found');
    assert.equal(actual.staffId, null, 'New sales must not attribute staff');
    for (const field of ['unitPrice', 'quantity', 'lineTotal', 'displayName']) assert.equal(actual[field], expected[field], `Snapshot ${field}`);
  }
  expectedSales.set(sale.id, { sale, total, items: expectedItems, status: sale.payment.status });
  return { ...response, sale, body };
}
async function saleDetail(id, token = actors.owner.token) {
  return (await request(`/sales/${id}`, { token, expected: 200 })).data;
}
async function queue(body, { idempotencyKey = key(), token = actors.salonCashier.token } = {}) {
  return (await request(line('/salon/queue', salon), { method: 'POST', token, body, headers: { 'X-Idempotency-Key': idempotencyKey }, expected: 201 })).data;
}
async function patchQueue(id, body, expected = 200) {
  return (await request(`/salon/queue/${id}`, { method: 'PATCH', token: actors.salonCashier.token, body, expected })).data;
}

before(async () => {
  actors.owner = await login(process.env.QA_OWNER_EMAIL, process.env.QA_OWNER_PASSWORD);
  for (const [name, role, businessLineIds] of [
    ['admin', 'admin', [kedai, salon]], ['cashier', 'cashier', [kedai]], ['salonCashier', 'cashier', [salon]],
  ]) {
    const password = randomBytes(20).toString('base64url');
    const email = `qa-${name}-${uuid()}@example.test`;
    await request('/users', { method: 'POST', token: actors.owner.token, body: { name: `QA ${name}`, email, password, role, businessLineIds }, expected: 201 });
    actors[name] = await login(email, password);
  }
  for (const id of [kedai, salon]) {
    assert.equal((await allPages('/sales', id, actors.owner.token)).length, 0, 'A freshly migrated QA database must not contain historical sales');
  }
}, { timeout: 20_000 });

test('F01: real API health, authentication, scoped line discovery and revoked session', async t => {
  await t.test('liveness and DB readiness are publicly available', async () => {
    await request('/health/live', { expected: 200 });
    await request('/health/ready', { expected: 200 });
  });
  await t.test('protected routes reject missing/forged bearer credentials', async () => {
    for (const path of ['/auth/me', '/business-lines', line('/sales', kedai), line('/products', kedai)]) {
      await request(path, { expected: 401 });
    }
    await request('/auth/me', { token: 'not-a-real-session', expected: 401 });
    // Exactly one wrong-password attempt: do not consume the shared login limiter.
    await request('/auth/login', { method: 'POST', body: { email: process.env.QA_OWNER_EMAIL, password: 'incorrect-password' }, expected: 401 });
  });
  await t.test('cashier only discovers assigned business line', async () => {
    const { data } = await request('/business-lines', { token: actors.cashier.token, expected: 200 });
    assert.deepEqual(data.data.map(item => item.id), [kedai]);
    const { data: me } = await request('/auth/me', { token: actors.cashier.token, expected: 200 });
    assert.equal(me.role, 'cashier');
    assert.deepEqual(me.businessLines.map(item => item.id), [kedai]);
  });
  await t.test('logout revokes the session server-side', async () => {
    const session = await login(process.env.QA_OWNER_EMAIL, process.env.QA_OWNER_PASSWORD);
    await request('/auth/logout', { method: 'POST', token: session.token, expected: 204 });
    await request('/auth/me', { token: session.token, expected: 401 });
  });
});

test('F01/F04: roles and line isolation are enforced by API, including record references', async t => {
  const hair = await service();
  const salonCustomer = await customer(salon);
  const drink = await product();
  const { sale: salonSale } = await checkout(hair);
  const queued = await queue({ serviceIds: [hair.id] });
  await t.test('cashier forbidden mutations and reporting/admin routes', async () => {
    for (const [method, path, body] of [
      ['POST', line('/products', kedai), { sku: 'FORBIDDEN', name: 'Forbidden', unit: 'each', price: 1, stockTracked: false }],
      ['PATCH', `/products/${drink.id}`, { price: 1 }],
      ['DELETE', `/products/${drink.id}`],
      ['POST', line('/inventory/movements', kedai), { productId: drink.id, type: 'adjustment', quantityDelta: 1, reason: 'forbidden' }],
      ['GET', '/users'],
      ['GET', '/integrations'],
      ['GET', line('/notifications', kedai)],
      ['GET', line('/payments/reconciliation', kedai)],
      ['GET', line('/reports/sales', kedai, { from: startedDate, to: startedDate, groupBy: 'item' })],
      ['GET', line('/reports/sales.csv', kedai, { from: startedDate, to: startedDate })],
    ]) await request(path, { method, token: actors.cashier.token, body, expected: 403 });
    await request('/users', { token: actors.admin.token, expected: 403 });
    await request('/integrations', { token: actors.admin.token, expected: 403 });
  });
  await t.test('unassigned line is forbidden on list/read/update/payment/queue routes', async () => {
    for (const path of [line('/services', salon), line('/customers', salon), line('/sales', salon), line('/salon/queue', salon)]) {
      await request(path, { token: actors.cashier.token, expected: 403 });
    }
    for (const path of [`/services/${hair.id}`, `/customers/${salonCustomer.id}`, `/sales/${salonSale.id}`, `/payments/${salonSale.payment.id}`]) {
      await request(path, { token: actors.cashier.token, expected: [403, 404] });
    }
    await request(`/salon/queue/${queued.id}`, { method: 'PATCH', token: actors.cashier.token, body: { status: 'in_service' }, expected: 403 });
    await request(line('/customers', salon), { method: 'POST', token: actors.cashier.token, body: { name: 'Leak attempt' }, expected: 403 });
  });
  await t.test('foreign customer/service IDs cannot be smuggled into authorized-line writes', async () => {
    for (const body of [
      saleBody(drink, { customerId: salonCustomer.id }),
      { items: [{ itemType: 'product', itemId: hair.id, quantity: 1 }], paymentMethod: 'cash', cashReceived: 100000 },
    ]) await request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body, headers: { 'X-Idempotency-Key': key() }, expected: [400, 403, 404] });
    const kedaiCustomer = await customer(kedai);
    await request(line('/salon/queue', salon), { method: 'POST', token: actors.salonCashier.token, body: { serviceIds: [hair.id], customerId: kedaiCustomer.id }, headers: { 'X-Idempotency-Key': key() }, expected: [400, 403, 404] });
  });
  await t.test('correct UUID does not override expected business-line type', async () => {
    await request(line('/products', salon), { method: 'POST', token: actors.owner.token, body: { sku: 'WRONG-LINE', name: 'Wrong type', price: 1, unit: 'each', stockTracked: false }, expected: 400 });
    await request(line('/services', kedai), { method: 'POST', token: actors.owner.token, body: { name: 'Wrong type', price: 1 }, expected: 400 });
    await request(line('/salon/queue', kedai), { method: 'POST', token: actors.owner.token, body: { serviceIds: [hair.id] }, headers: { 'X-Idempotency-Key': key() }, expected: 400 });
  });
});

test('F01/F02/F05: malformed identifiers, bounded pagination, strict JSON and integer validation', async t => {
  await t.test('bad UUIDs are validation failures, absent valid UUIDs are not found', async () => {
    for (const path of ['/products/not-a-uuid', '/services/not-a-uuid', '/customers/not-a-uuid', '/sales/not-a-uuid', '/payments/not-a-uuid']) {
      await request(path, { token: actors.owner.token, expected: 400 });
    }
    await request(`/products/${uuid()}`, { token: actors.owner.token, expected: 404 });
    await request('/products?businessLineId=bad', { token: actors.owner.token, expected: 400 });
  });
  await t.test('pagination limits are validated', async () => {
    for (const query of [{ page: '0' }, { page: '-1' }, { limit: '101' }, { limit: '0' }, { limit: 'not-an-integer' }]) {
      await request(line('/products', kedai, query), { token: actors.owner.token, expected: 400 });
    }
  });
  await t.test('strict JSON, unknown input fields, negative and fractional IDR rejected', async t => {
    const body = { sku: `QA-INVALID-${uuid()}`, name: 'Invalid', unit: 'each', price: 1, stockTracked: false };
    for (const invalid of [{ ...body, price: -1 }, { ...body, price: 1.25 }, { ...body, name: '' }, { ...body, unexpected: 'must not be accepted' }, { ...body, price: 9_007_199_254_740_991 }]) {
      await request(line('/products', kedai), { method: 'POST', token: actors.owner.token, body: invalid, expected: 400 });
    }
    for (const raw of ['{', '{} {}', 'null']) {
      await t.test(`rejects raw body ${JSON.stringify(raw)}`, () => request(line('/products', kedai), { method: 'POST', token: actors.owner.token, raw, expected: 400 }));
    }
  });
  await t.test('checkout rejects empty lines, invalid quantities, insufficient cash, no idempotency and forged totals', async () => {
    const drink = await product();
    for (const body of [
      { ...saleBody(drink), items: [] },
      ...[0, -1, 1.5, 1001].map(quantity => saleBody(drink, { quantity })),
      saleBody(drink, { cashReceived: 0 }),
      { ...saleBody(drink), total: 1 },
      { ...saleBody(drink), items: [{ ...saleBody(drink).items[0], unitPrice: 1 }] },
      { ...saleBody(drink), paymentMethod: 'card' },
    ]) await request(line('/sales', kedai), { method: 'POST', token: actors.owner.token, body, headers: { 'X-Idempotency-Key': key() }, expected: 400 });
    await request(line('/sales', kedai), { method: 'POST', token: actors.owner.token, body: saleBody(drink), expected: 400 });
  });
});

test('F02: product create/read/search/update/archive, unique SKU and receipt snapshots', async () => {
  const original = await product({ name: `QA Tea, "special" ${uuid()}`, price: 12347 });
  assert.equal(original.active, true);
  const found = await allPages('/products', kedai, actors.cashier.token, { search: original.sku });
  assert.deepEqual(found.map(row => row.id), [original.id]);
  await request(line('/products', kedai), { method: 'POST', token: actors.admin.token, body: { sku: original.sku, name: 'Duplicate', unit: 'cup', price: 1, stockTracked: false }, expected: 409 });
  const { sale } = await checkout(original, { quantity: 3, token: actors.cashier.token });
  assert.equal(sale.items[0].unitPrice, 12347);
  assert.equal(sale.items[0].lineTotal, 37041);
  assert.equal(sale.items[0].displayName, original.name);
  assert.equal(sale.changeDue, 1000);
  const { data: updated } = await request(`/products/${original.id}`, { method: 'PATCH', token: actors.admin.token, body: { name: 'Renamed tea', price: 14000 }, expected: 200 });
  assert.equal(updated.price, 14000);
  await request(`/products/${original.id}`, { method: 'DELETE', token: actors.admin.token, expected: 204 });
  const { data: archived } = await request(`/products/${original.id}`, { token: actors.owner.token, expected: 200 });
  assert.equal(archived.active, false);
  assert.equal((await allPages('/products', kedai, actors.owner.token, { active: 'true', search: original.sku })).length, 0);
  const receipt = await saleDetail(sale.id);
  assert.equal(receipt.items[0].unitPrice, 12347);
  assert.equal(receipt.items[0].displayName, original.name);
  assert.equal(receipt.total, 37041);
  await request(line('/sales', kedai), { method: 'POST', token: actors.owner.token, body: saleBody(original), headers: { 'X-Idempotency-Key': key() }, expected: [400, 409] });
});

test('F02/F04: service and customer CRUD retain historical references', async t => {
  const hair = await service();
  const guest = await customer(salon, { phone: '+6281234567890' }, actors.salonCashier.token);
  const body = saleBody(hair, { customerId: guest.id });
  const { sale } = await checkout(hair, { body, token: actors.salonCashier.token });
  await t.test('directory detail/search/update works for allowed roles', async () => {
    for (const [resource, record] of [['services', hair], ['customers', guest]]) {
      const { data } = await request(`/${resource}/${record.id}`, { token: actors.owner.token, expected: 200 });
      assert.equal(data.id, record.id);
      assert.equal(data.businessLineId, salon);
      const list = await allPages(`/${resource}`, salon, actors.owner.token, { search: record.name });
      assert.ok(list.some(row => row.id === record.id));
      const { data: updated } = await request(`/${resource}/${record.id}`, { method: 'PATCH', token: actors.admin.token, body: { name: `Updated ${record.name}` }, expected: 200 });
      assert.equal(updated.name, `Updated ${record.name}`);
    }
  });

  test('staff management and attribution are no longer accepted', async () => {
    for (const [method, path] of [
      ['GET', line('/staff', salon)],
      ['POST', line('/staff', salon)],
      ['GET', `/staff/${uuid()}`],
      ['PATCH', `/staff/${uuid()}`],
      ['DELETE', `/staff/${uuid()}`],
    ]) {
      await request(path, { method, token: actors.owner.token, expected: 404 });
    }
    const hair = await service();
    for (const staffId of [uuid(), null]) {
      const body = saleBody(hair);
      body.items[0].staffId = staffId;
      await request(line('/sales', salon), { method: 'POST', token: actors.owner.token, body, headers: { 'X-Idempotency-Key': key() }, expected: 400 });
      await request(line('/salon/queue', salon), { method: 'POST', token: actors.owner.token, body: { serviceIds: [hair.id], staffId }, headers: { 'X-Idempotency-Key': key() }, expected: 400 });
    }
    const entry = await queue({ serviceIds: [hair.id] });
    assert.equal(entry.staffId, null);
    await patchQueue(entry.id, { staffId: null }, 400);
  });
  await t.test('invalid phone and duration are rejected', async () => {
    await request(line('/customers', salon), { method: 'POST', token: actors.owner.token, body: { name: 'Invalid phone', phone: 'not a phone' }, expected: 400 });
    await request(line('/services', salon), { method: 'POST', token: actors.owner.token, body: { name: 'Invalid duration', price: 1000, durationMinutes: 0 }, expected: 400 });
  });
  await t.test('archiving both leaves receipt intact and rejects future sales', async () => {
    for (const [resource, record] of [['services', hair], ['customers', guest]]) {
      await request(`/${resource}/${record.id}`, { method: 'DELETE', token: actors.admin.token, expected: 204 });
      const { data } = await request(`/${resource}/${record.id}`, { token: actors.owner.token, expected: 200 });
      assert.equal(data.active, false);
    }
    const receipt = await saleDetail(sale.id);
    assert.equal(receipt.customerId, guest.id);
    assert.equal(receipt.items[0].staffId, null);
    assert.equal(receipt.items[0].displayName, hair.name);
    assert.equal(receipt.total, hair.price);
    await request(line('/sales', salon), { method: 'POST', token: actors.owner.token, body, headers: { 'X-Idempotency-Key': key() }, expected: [400, 409] });
  });
});

test('F05: sale idempotency replays original and conflicts on changed payload', async () => {
  const drink = await product();
  const idempotencyKey = key();
  const { sale, body } = await checkout(drink, { idempotencyKey, token: actors.cashier.token });
  for (let retry = 0; retry < 3; retry++) {
    const { data } = await request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body, headers: { 'X-Idempotency-Key': idempotencyKey }, expected: 201 });
    assert.deepEqual(data, sale, 'Replay returns the original outcome');
  }
  await request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body: saleBody(drink, { quantity: 2 }), headers: { 'X-Idempotency-Key': idempotencyKey }, expected: 409 });
  const recorded = await allPages('/sales', kedai, actors.owner.token);
  assert.equal(recorded.filter(row => row.id === sale.id).length, 1);
});

test('F05/F09: idempotency keys are scoped by user, line and operation', async () => {
  const drink = await product();
  const hair = await service();
  const idempotencyKey = key();
  const { sale: cashierSale } = await checkout(drink, { idempotencyKey, token: actors.cashier.token });
  const { sale: ownerSale } = await checkout(drink, { idempotencyKey });
  const { sale: salonSale } = await checkout(hair, { idempotencyKey });
  assert.equal(new Set([cashierSale.id, ownerSale.id, salonSale.id]).size, 3);
  const entry = await queue({ serviceIds: [hair.id] }, { idempotencyKey, token: actors.owner.token });
  assert.equal(entry.status, 'waiting');
  assert.notEqual(entry.id, salonSale.id);
});

test('F03: receiving and adjustment are auditable and cannot make stock negative', async () => {
  const drink = await product({ stockTracked: true });
  const movement = await receive(drink, 3);
  assert.equal(movement.quantityDelta, 3);
  assert.equal(movement.actorId, actors.owner.user.id);
  assert.ok(Date.parse(movement.createdAt));
  const input = { productId: drink.id, type: 'adjustment', quantityDelta: -1, reason: 'QA damaged glass' };
  await request(line('/inventory/movements', kedai), { method: 'POST', token: actors.owner.token, body: input, expected: 201 });
  await request(line('/inventory/movements', kedai), { method: 'POST', token: actors.owner.token, body: { ...input, quantityDelta: -3 }, expected: 409 });
  for (const body of [{ ...input, quantityDelta: 0 }, { ...input, reason: '' }, { ...input, type: 'sale' }]) {
    await request(line('/inventory/movements', kedai), { method: 'POST', token: actors.owner.token, body, expected: 400 });
  }
  const ledger = await allPages('/inventory/movements', kedai, actors.owner.token, { productId: drink.id });
  assert.equal(ledger.length, 2);
  assert.equal(ledger.reduce((sum, row) => sum + row.quantityDelta, 0), 2);
  const stock = await allPages('/inventory', kedai, actors.cashier.token);
  assert.equal(stock.find(row => row.productId === drink.id).quantity, 2);
});

test('F03/F05: 8 simultaneous duplicate submits persist one cash sale and one stock debit', async () => {
  const drink = await product({ stockTracked: true, price: 9989 });
  await receive(drink, 8);
  const idempotencyKey = key();
  const body = saleBody(drink, { quantity: 2 });
  const results = await Promise.all(Array.from({ length: 8 }, () => request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body, headers: { 'X-Idempotency-Key': idempotencyKey }, expected: 201 })));
  const ids = new Set(results.map(result => result.data.id));
  assert.equal(ids.size, 1);
  const sale = results[0].data;
  expectedSales.set(sale.id, { sale, total: 19978, items: [{ itemId: drink.id, staffId: null, quantity: 2, lineTotal: 19978 }], status: 'confirmed' });
  assert.equal(sale.total, 19978);
  const { data: updated } = await request(`/products/${drink.id}`, { token: actors.owner.token, expected: 200 });
  assert.equal(updated.stockOnHand, 6);
  const movements = await allPages('/inventory/movements', kedai, actors.owner.token, { productId: drink.id });
  assert.equal(movements.filter(row => row.type === 'sale').length, 1);
  assert.equal(movements.find(row => row.type === 'sale').quantityDelta, -2);
});

test('F03/F05: distinct concurrent cash sales cannot oversell last unit', async () => {
  const drink = await product({ stockTracked: true });
  await receive(drink, 1);
  const results = await Promise.all(Array.from({ length: 6 }, () => request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body: saleBody(drink), headers: { 'X-Idempotency-Key': key() }, expected: [201, 409] })));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 5);
  const sale = results.find(result => result.status === 201).data;
  expectedSales.set(sale.id, { sale, total: drink.price, items: [{ itemId: drink.id, staffId: null, quantity: 1, lineTotal: drink.price }], status: 'confirmed' });
  const { data } = await request(`/products/${drink.id}`, { token: actors.owner.token, expected: 200 });
  assert.equal(data.stockOnHand, 0);
  const movements = await allPages('/inventory/movements', kedai, actors.owner.token, { productId: drink.id });
  assert.equal(movements.filter(row => row.type === 'sale').length, 1);
  assert.equal(movements.reduce((sum, row) => sum + row.quantityDelta, 0), 0);
});

function eventFor(sale, status = 'succeeded', overrides = {}) {
  return { eventId: key(), paymentId: sale.payment.gatewayReference, merchantReference: sale.id, amount: sale.total, currency: 'IDR', status, occurredAt: new Date().toISOString(), ...overrides };
}
async function assertPayment(sale, status) {
  const { data } = await request(`/payments/${sale.payment.id}`, { token: actors.owner.token, expected: 200 });
  assert.equal(data.status, status);
  const detail = await saleDetail(sale.id);
  assert.equal(detail.status, status === 'confirmed' ? 'paid' : status === 'pending' ? 'pending_payment' : 'cancelled');
  expectedSales.get(sale.id).status = status;
  return detail;
}

test('F05/F06: pending QR uses one external logical intent under 8 duplicate submits', async () => {
  const drink = await product({ stockTracked: true });
  await receive(drink, 3);
  const idempotencyKey = key();
  const body = saleBody(drink, { method: 'qris' });
  const replies = await Promise.all(Array.from({ length: 8 }, () => request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body, headers: { 'X-Idempotency-Key': idempotencyKey }, expected: 201 })));
  assert.equal(new Set(replies.map(reply => reply.data.id)).size, 1);
  const sale = replies[0].data;
  expectedSales.set(sale.id, { sale, total: drink.price, status: 'pending' });
  assert.equal(sale.status, 'pending_payment');
  assert.equal(sale.payment.status, 'pending');
  assert.equal(sale.payment.amount, drink.price);
  assert.match(sale.payment.qrContent, /^TEST-ONLY-NOT-A-PAYABLE-QR:/);
  assert.ok(Date.parse(sale.payment.expiresAt) > Date.now());
  const gateway = await (await fetch(`${gatewayUrl}/__qa/state`)).json();
  const intents = gateway.intents.filter(intent => intent.response.merchantReference === sale.id);
  assert.equal(intents.length, 1, 'Only one logical provider intent');
  const calls = gateway.requests.filter(intent => intent.merchantReference === sale.id);
  assert.ok(calls.length >= 1, 'Real provider HTTP boundary was not called');
  assert.ok(calls.every(call => call.idempotencyKey === sale.id), 'Provider retries must share stable sale identity');
  assert.equal(new Set(calls.map(call => call.fingerprint)).size, 1, 'Provider retries must retain original amount/currency');
  assert.equal(intents[0].response.paymentId, sale.payment.gatewayReference);
  assert.equal(intents[0].response.amount, drink.price);
  await request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body: saleBody(drink, { quantity: 2, method: 'qris' }), headers: { 'X-Idempotency-Key': idempotencyKey }, expected: 409 });
  // Browser credentials cannot manufacture a confirmed payment.
  await request(`/payments/${sale.payment.id}`, { method: 'PATCH', token: actors.cashier.token, body: { status: 'confirmed' }, expected: [404, 405] });
  await assertPayment(sale, 'pending');
});

test('F06: exact-body HMAC, prefix support, replay and changed event payload', async t => {
  const drink = await product();
  const { sale } = await checkout(drink, { method: 'qris' });
  const event = eventFor(sale);
  await t.test('forged signature and byte-different body do not confirm', async () => {
    await webhook(event, { signatureOverride: '0'.repeat(64), expected: 401 });
    await webhook(event, { signatureOverride: '', expected: 401 });
    await webhook(event, { raw: JSON.stringify(event, null, 2), signedRaw: JSON.stringify(event), expected: 401 });
    await assertPayment(sale, 'pending');
  });
  await t.test('idempotency header must identify the signed event', async () => {
    await webhook(event, { eventKey: 'different-event-key', expected: 400 });
    await webhook(event, { eventKey: null, expected: 400 });
    await assertPayment(sale, 'pending');
  });
  await t.test('pretty-printed exact body succeeds with sha256 prefix', async () => {
    const response = await webhook(event, { raw: JSON.stringify(event, null, 2), signaturePrefix: 'sha256=' });
    assert.ok(response.elapsed < 2_000, `Webhook blocked on disabled WhatsApp: ${response.elapsed}ms`);
    const detail = await assertPayment(sale, 'confirmed');
    assert.ok(Date.parse(detail.payment.confirmedAt));
  });
  await t.test('repeated identical signed bytes have one payment effect', async () => {
    await Promise.all(Array.from({ length: 6 }, () => webhook(event, { raw: JSON.stringify(event, null, 2), signaturePrefix: 'sha256=' })));
    await assertPayment(sale, 'confirmed');
    const events = await allPages('/payments/reconciliation', kedai, actors.admin.token);
    assert.equal(events.filter(row => row.eventId === event.eventId).length, 1);
    assert.equal(events.find(row => row.eventId === event.eventId).outcome, 'applied');
    assert.doesNotMatch(JSON.stringify(events), /signature|qrContent|apiKey|secret/i);
  });
  await t.test('same event key with changed signed payload is a conflict', async () => {
    await webhook({ ...event, amount: event.amount + 1 }, { expected: 409 });
    await assertPayment(sale, 'confirmed');
  });
});

test('F06: amount, currency, merchant and provider reference mismatches never confirm', async t => {
  for (const [name, overrides] of [
    ['amount', sale => ({ amount: sale.total + 1 })],
    ['currency', () => ({ currency: 'USD' })],
    ['merchantReference', () => ({ merchantReference: uuid() })],
    ['paymentId', () => ({ paymentId: `unknown-${uuid()}` })],
  ]) {
    await t.test(name, async () => {
      const drink = await product();
      const { sale } = await checkout(drink, { method: 'qris' });
      const event = eventFor(sale, 'succeeded', overrides(sale));
      await webhook(event, { expected: 409 });
      await assertPayment(sale, 'pending');
      const notifications = await allPages('/notifications', kedai, actors.owner.token);
      assert.equal(notifications.filter(row => row.saleId === sale.id).length, 0);
    });
  }
});

test('F03/F06: concurrent QR reservation prevents oversell and terminal failure releases once', async () => {
  const drink = await product({ stockTracked: true });
  await receive(drink, 1);
  const results = await Promise.all(Array.from({ length: 6 }, () => request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body: saleBody(drink, { method: 'qris' }), headers: { 'X-Idempotency-Key': key() }, expected: [201, 409] })));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 5);
  const sale = results.find(result => result.status === 201).data;
  expectedSales.set(sale.id, { sale, total: drink.price, status: 'pending' });
  const failure = eventFor(sale, 'failed');
  await webhook(failure);
  await webhook(failure);
  await assertPayment(sale, 'failed');
  // Exactly one available unit after cancellation; a second release would permit both.
  const outcomes = await Promise.all(Array.from({ length: 2 }, () => request(line('/sales', kedai), { method: 'POST', token: actors.cashier.token, body: saleBody(drink), headers: { 'X-Idempotency-Key': key() }, expected: [201, 409] })));
  assert.equal(outcomes.filter(result => result.status === 201).length, 1);
  const paid = outcomes.find(result => result.status === 201).data;
  expectedSales.set(paid.id, { sale: paid, total: drink.price, items: [{ itemId: drink.id, staffId: null, quantity: 1, lineTotal: drink.price }], status: 'confirmed' });
  await webhook(eventFor(sale), { expected: 409 });
  await assertPayment(sale, 'failed');
  const { data } = await request(`/products/${drink.id}`, { token: actors.owner.token, expected: 200 });
  assert.equal(data.stockOnHand, 0);
});

test('F06: expired cannot reopen, confirmed cannot fail, and late terminal events remain visible', async t => {
  const drink = await product();
  const { sale: expired } = await checkout(drink, { method: 'qris' });
  const expiry = eventFor(expired, 'expired');
  await webhook(expiry);
  await webhook(expiry);
  await assertPayment(expired, 'expired');
  const late = eventFor(expired);
  await webhook(late, { expected: 409 });
  await assertPayment(expired, 'expired');
  await t.test('expiry followed by success retained for reconciliation', async () => {
    const events = await allPages('/payments/reconciliation', kedai, actors.admin.token);
    assert.equal(events.find(row => row.eventId === late.eventId)?.outcome, 'terminal_conflict');
  });
  await t.test('confirmed payment does not regress or release sold stock', async () => {
    const stocked = await product({ stockTracked: true });
    await receive(stocked, 1);
    const { sale } = await checkout(stocked, { method: 'qris' });
    await webhook(eventFor(sale));
    await assertPayment(sale, 'confirmed');
    await webhook(eventFor(sale, 'failed'), { expected: 409 });
    await webhook(eventFor(sale, 'expired'), { expected: 409 });
    await assertPayment(sale, 'confirmed');
    const { data } = await request(`/products/${stocked.id}`, { token: actors.owner.token, expected: 200 });
    assert.equal(data.stockOnHand, 0);
    const movements = await allPages('/inventory/movements', kedai, actors.owner.token, { productId: stocked.id });
    assert.equal(movements.filter(row => row.type === 'sale').length, 1);
  });
});

test('F05/F06: external create response timeout recovers one sale and preserves early valid callback', async () => {
  const drink = await product({ stockTracked: true, price: 91009 });
  await receive(drink, 1);
  const control = await fetch(`${gatewayUrl}/__qa/stall-next-created-response`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: drink.price }) });
  assert.equal(control.status, 202);
  const idempotencyKey = key();
  const body = saleBody(drink, { method: 'qris' });
  const submit = { method: 'POST', token: actors.cashier.token, body, headers: { 'X-Idempotency-Key': idempotencyKey } };
  // Handle promise rejection immediately while the early callback races provider I/O.
  const initial = request(line('/sales', kedai), { ...submit, expected: [201, 502, 503, 504], timeout: 20_000 }).then(value => ({ value }), error => ({ error }));
  const state = await eventually('external provider persisted intent before response timeout', () => fetch(`${gatewayUrl}/__qa/state`).then(response => response.json()), value => value.intents.some(intent => intent.response.amount === drink.price));
  const intent = state.intents.find(intent => intent.response.amount === drink.price).response;
  const event = { eventId: key(), paymentId: intent.paymentId, merchantReference: intent.merchantReference, amount: intent.amount, currency: 'IDR', status: 'succeeded', occurredAt: new Date().toISOString() };
  const early = await webhook(event, { expected: [200, 409], timeout: 20_000 });
  if (early.status === 409) {
    const events = await allPages('/payments/reconciliation', kedai, actors.admin.token);
    assert.ok(events.some(row => row.eventId === event.eventId), 'Early authenticated callback must be retained for recovery');
  }
  const first = await initial;
  if (first.error) throw first.error;
  const { data: recovered } = await request(line('/sales', kedai), { ...submit, expected: 201, timeout: 10_000 });
  assert.equal(recovered.id, intent.merchantReference, 'Retry must retain original sale and external intent identity');
  assert.equal(recovered.payment.gatewayReference, intent.paymentId);
  assert.equal(recovered.total, drink.price);
  expectedSales.set(recovered.id, { sale: recovered, total: drink.price, items: [{ itemId: drink.id, staffId: null, quantity: 1, lineTotal: drink.price }], status: recovered.payment.status });
  // The same signed event must remain applicable after recovery, not become a
  // permanently consumed 'unmatched' event or a falsely cancelled payment.
  await webhook(event);
  await assertPayment(recovered, 'confirmed');
  const final = await (await fetch(`${gatewayUrl}/__qa/state`)).json();
  assert.equal(final.intents.filter(row => row.response.merchantReference === recovered.id).length, 1);
  const stock = await request(`/products/${drink.id}`, { token: actors.owner.token, expected: 200 });
  assert.equal(stock.data.stockOnHand, 0);
  const ledger = await allPages('/inventory/movements', kedai, actors.owner.token, { productId: drink.id });
  assert.equal(ledger.filter(row => row.type === 'sale').length, 1);
});

test('F06: stale signed terminal event is retained without reversing confirmed payment', async () => {
  const drink = await product();
  const { sale } = await checkout(drink, { method: 'qris' });
  await webhook(eventFor(sale));
  await assertPayment(sale, 'confirmed');
  const occurredAt = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const late = eventFor(sale, 'expired', { occurredAt });
  await webhook(late, { expected: 409 });
  const events = await allPages('/payments/reconciliation', kedai, actors.admin.token);
  const retained = events.find(row => row.eventId === late.eventId);
  assert.ok(retained, 'Stale authenticated event must remain available for admin review');
  assert.equal(retained.outcome, 'stale');
  assert.equal(Date.parse(retained.occurredAt), Date.parse(occurredAt));
  await assertPayment(sale, 'confirmed');
});

test('F07: WhatsApp unavailable is observable, nonblocking, once per confirmation and retry protected', async () => {
  const drink = await product();
  const { sale, elapsed } = await checkout(drink, { token: actors.cashier.token });
  assert.ok(elapsed < 2_000, `Cash checkout blocked on disabled WhatsApp: ${elapsed}ms`);
  const history = await eventually('disabled WhatsApp records failure', () => allPages('/notifications', kedai, actors.admin.token), rows => rows.some(row => row.saleId === sale.id && row.status === 'failed'), { attempts: 60, interval: 100 });
  const matching = history.filter(row => row.saleId === sale.id);
  assert.equal(matching.length, 1);
  const notification = matching[0];
  assert.ok(notification.lastError, 'Unavailable delivery must have visible sanitized error');
  assert.notEqual(notification.status, 'sent');
  await request(`/notifications/${notification.id}/retry`, { method: 'POST', token: actors.cashier.token, expected: 403 });
  await request(`/notifications/${notification.id}/retry`, { method: 'POST', expected: 401 });
  // Current catalog changes must not mutate an already-created logical outbox record.
  await request(`/products/${drink.id}`, { method: 'PATCH', token: actors.owner.token, body: { name: 'Changed after payment', price: drink.price + 500 }, expected: 200 });
  const disabled = process.env.NOTIFICATION_PROVIDER === 'disabled';
  const retry = await request(`/notifications/${notification.id}/retry`, { method: 'POST', token: actors.admin.token, expected: disabled ? 503 : 202 });
  if (disabled) assert.equal(retry.data.error.code, 'NOTIFICATION_DISABLED');
  const retried = disabled
    ? await allPages('/notifications', kedai, actors.owner.token)
    : await eventually('authorized retry finishes without false sent', () => allPages('/notifications', kedai, actors.owner.token), rows => rows.some(row => row.id === notification.id && row.status === 'failed' && row.attemptCount > notification.attemptCount), { attempts: 60, interval: 100 });
  assert.equal(retried.filter(row => row.saleId === sale.id).length, 1, 'Retry must reuse logical notification');
  const stable = retried.find(row => row.id === notification.id);
  for (const field of ['id', 'saleId', 'createdAt', 'destinationMasked']) assert.deepEqual(stable[field], notification[field], `Retry must preserve outbox ${field}`);
  await assertPayment(sale, 'confirmed');
  for (const businessLineId of [kedai, salon]) {
    const notifications = await allPages('/notifications', businessLineId, actors.owner.token);
    for (const expected of expectedSales.values()) {
      if (expected.sale.businessLineId !== businessLineId) continue;
      assert.equal(notifications.filter(row => row.saleId === expected.sale.id).length, expected.status === 'confirmed' ? 1 : 0, `Logical notification count for sale ${expected.sale.id}`);
    }
  }
  const { data: integrations, text } = await request('/integrations', { token: actors.owner.token, expected: 200 });
  assert.equal(integrations.productionReady, false);
  assert.equal(integrations.notification.provider, process.env.NOTIFICATION_PROVIDER);
  assert.doesNotMatch(text, /apiKey|webhookSecret|password|Bearer /i);
});

test('F09: queue idempotency and concurrent daily number allocation', async t => {
  const hair = await service();
  const body = { serviceIds: [hair.id], note: 'Walk-in' };
  await t.test('simultaneous retries issue one queue entry and changed payload conflicts', async () => {
    const idempotencyKey = key();
    const responses = await Promise.all(Array.from({ length: 6 }, () => queue(body, { idempotencyKey })));
    assert.equal(new Set(responses.map(row => row.id)).size, 1);
    assert.equal(new Set(responses.map(row => row.queueNumber)).size, 1);
    await request(line('/salon/queue', salon), { method: 'POST', token: actors.salonCashier.token, body: { ...body, note: 'Changed customer request' }, headers: { 'X-Idempotency-Key': idempotencyKey }, expected: 409 });
  });
  await t.test('12 distinct concurrent walk-ins get unique contiguous daily numbers', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => queue(body)));
    const numbers = responses.map(row => row.queueNumber).sort((a, b) => a - b);
    assert.equal(new Set(numbers).size, 12);
    for (let i = 0; i < numbers.length; i++) assert.equal(numbers[i], numbers[0] + i);
    const { data } = await request(line('/salon/queue', salon, { date: startedDate }), { token: actors.salonCashier.token, expected: 200 });
    for (const entry of responses) assert.equal(data.data.filter(row => row.id === entry.id).length, 1);
  });
});

test('F09: queue lifecycle, sale association and terminal-state protection', async t => {
  const hair = await service();
  const guest = await customer(salon);
  const entry = await queue({ serviceIds: [hair.id], customerId: guest.id });
  assert.equal(entry.status, 'waiting');
  await t.test('cannot jump waiting to completed or reverse in-service', async () => {
    await patchQueue(entry.id, { status: 'completed' }, 409);
    const started = await patchQueue(entry.id, { status: 'in_service' });
    assert.equal(started.status, 'in_service');
    assert.ok(Date.parse(started.startedAt));
    await patchQueue(entry.id, { status: 'waiting' }, 409);
  });
  await t.test('cannot link sale from another line', async () => {
    const drink = await product();
    const { sale } = await checkout(drink);
    await patchQueue(entry.id, { status: 'completed', saleId: sale.id }, [400, 403, 409]);
  });
  await t.test('completed entry links paid salon sale and cannot be cancelled', async () => {
    const { sale } = await checkout(hair, { body: saleBody(hair, { customerId: guest.id }) });
    const done = await patchQueue(entry.id, { status: 'completed', saleId: sale.id });
    assert.equal(done.status, 'completed');
    assert.equal(done.saleId, sale.id);
    assert.ok(Date.parse(done.completedAt));
    await patchQueue(entry.id, { status: 'cancelled' }, 409);
  });
  await t.test('waiting cancellation is terminal and invalid service IDs rejected', async () => {
    const cancelled = await queue({ serviceIds: [hair.id] });
    await patchQueue(cancelled.id, { status: 'cancelled' });
    await patchQueue(cancelled.id, { status: 'in_service' }, 409);
    for (const serviceIds of [[], ['bad-uuid'], [uuid()]]) {
      await request(line('/salon/queue', salon), { method: 'POST', token: actors.salonCashier.token, body: { serviceIds }, headers: { 'X-Idempotency-Key': key() }, expected: [400, 404] });
    }
  });
});

test('F08: each report remains internally consistent during concurrent payment confirmations', async () => {
  const drink = await product({ price: 5003 });
  const batch = [];
  for (let i = 0; i < 8; i++) batch.push((await checkout(drink, { method: 'qris' })).sale);
  const query = { from: startedDate, to: startedDate, groupBy: 'day' };
  const { data: baseline } = await request(line('/reports/sales', kedai, query), { token: actors.admin.token, expected: 200 });
  const operations = [];
  for (let i = 0; i < batch.length; i++) {
    // Interleave launches rather than completing all confirmations before reads.
    for (const groupBy of ['day', 'item', 'paymentMethod']) {
      operations.push(request(line('/reports/sales', kedai, { ...query, groupBy }), { token: actors.admin.token, expected: 200 }).then(response => ({ kind: 'report', groupBy, data: response.data })));
    }
    operations.push(webhook(eventFor(batch[i])).then(() => ({ kind: 'confirmed', sale: batch[i] })));
  }
  const results = await Promise.all(operations);
  for (const result of results) {
    if (result.kind === 'confirmed') { await assertPayment(result.sale, 'confirmed'); continue; }
    const report = result.data;
    assert.equal(report.groups.reduce((sum, group) => sum + group.amount, 0), report.totalSales, `Concurrent ${result.groupBy} report mixed database snapshots`);
    assert.ok(report.totalSales >= baseline.totalSales && report.totalSales <= baseline.totalSales + 8 * drink.price);
    assert.ok(report.transactionCount >= baseline.transactionCount && report.transactionCount <= baseline.transactionCount + 8);
    if (result.groupBy !== 'item') assert.equal(report.groups.reduce((sum, group) => sum + group.count, 0), report.transactionCount);
  }
  const { data: final } = await request(line('/reports/sales', kedai, query), { token: actors.admin.token, expected: 200 });
  assert.equal(final.totalSales, baseline.totalSales + 8 * drink.price);
  assert.equal(final.transactionCount, baseline.transactionCount + 8);
});

test('F08: report date/group inputs and line membership are bounded', async () => {
  for (const query of [
    { from: 'not-a-date', to: startedDate },
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-10-01', to: '2026-09-01' },
    { from: '2025-01-01', to: '2026-01-02' },
    { from: startedDate },
    { from: startedDate, to: startedDate, groupBy: 'profit' },
    { from: startedDate, to: startedDate, groupBy: 'staff' },
  ]) {
    await request(line('/reports/sales', kedai, query), { token: actors.owner.token, expected: 400 });
  }
  await request(line('/reports/sales.csv', kedai, { from: '2025-01-01', to: '2026-01-02' }), { token: actors.owner.token, expected: 400 });
  await request(line('/reports/sales', salon, { from: startedDate, to: startedDate }), { token: actors.cashier.token, expected: 403 });
  const { data } = await request(line('/reports/sales', kedai, { from: '2000-01-01', to: '2000-01-01' }), { token: actors.owner.token, expected: 200 });
  assert.equal(data.totalSales, 0);
  assert.equal(data.transactionCount, 0);
  assert.deepEqual(data.groups, []);
  // Exactly 366 inclusive days is permitted; 367 above is not.
  await request(line('/reports/sales', kedai, { from: '2024-01-01', to: '2024-12-31' }), { token: actors.owner.token, expected: 200 });
});

function reportExpectation(businessLineId, groupBy) {
  const sales = [...expectedSales.values()].filter(expected => expected.sale.businessLineId === businessLineId && expected.status === 'confirmed');
  const groups = new Map();
  function add(key, amount, saleId) {
    if (!groups.has(key)) groups.set(key, { key, amount: 0, sales: new Set() });
    const group = groups.get(key);
    group.amount += amount;
    group.sales.add(saleId);
  }
  for (const expected of sales) {
    if (groupBy === 'day') add(startedDate, expected.total, expected.sale.id);
    else if (groupBy === 'paymentMethod') add(expected.sale.payment.method, expected.total, expected.sale.id);
    else for (const item of expected.items) add(item.itemId, item.lineTotal, expected.sale.id);
  }
  return {
    totalSales: sales.reduce((sum, expected) => sum + expected.total, 0),
    transactionCount: sales.length,
    groups: [...groups.values()].map(group => ({ key: group.key, amount: group.amount, count: group.sales.size })).sort((a, b) => a.key.localeCompare(b.key)),
    sales,
  };
}

test('F08: confirmed-only reports reconcile independently across all grouping dimensions and CSV', async t => {
  assert.equal(businessDate(), startedDate, 'Suite crossed Jakarta midnight; rerun so same-day fixture assertions are meaningful');
  // Two items in one transaction and multiple salon services distinguish
  // item quantity / joined row count from the required DISTINCT sale count.
  const first = await product({ price: 714 });
  const second = await product({ price: 1337 });
  await checkout(first, {
    total: 2765,
    body: { items: [{ itemType: 'product', itemId: first.id, quantity: 2 }, { itemType: 'product', itemId: second.id, quantity: 1 }], paymentMethod: 'cash', cashReceived: 3000 },
    expectedItems: [{ itemId: first.id, staffId: null, quantity: 2, unitPrice: 714, displayName: first.name, lineTotal: 1428 }, { itemId: second.id, staffId: null, quantity: 1, unitPrice: 1337, displayName: second.name, lineTotal: 1337 }],
  });
  const cut = await service({ price: 17777 });
  const wash = await service({ price: 8881 });
  await checkout(cut, {
    total: 44435,
    body: { items: [{ itemType: 'service', itemId: cut.id, quantity: 2 }, { itemType: 'service', itemId: wash.id, quantity: 1 }], paymentMethod: 'cash', cashReceived: 50000 },
    expectedItems: [{ itemId: cut.id, quantity: 2, unitPrice: 17777, displayName: cut.name, lineTotal: 35554 }, { itemId: wash.id, quantity: 1, unitPrice: 8881, displayName: wash.name, lineTotal: 8881 }],
  });
  for (const businessLineId of [kedai, salon]) {
    for (const groupBy of ['day', 'paymentMethod', 'item']) {
      await t.test(`${businessLineId === kedai ? 'kedai' : 'salon'} grouped by ${groupBy}`, async () => {
        const expected = reportExpectation(businessLineId, groupBy);
        const { data } = await request(line('/reports/sales', businessLineId, { from: startedDate, to: startedDate, groupBy }), { token: actors.admin.token, expected: 200 });
        assert.equal(data.businessLineId, businessLineId);
        assert.equal(data.from, startedDate);
        assert.equal(data.to, startedDate);
        assert.equal(data.totalSales, expected.totalSales);
        assert.equal(data.transactionCount, expected.transactionCount);
        const groups = data.groups.map(({ key, amount, count }) => ({ key, amount, count })).sort((a, b) => a.key.localeCompare(b.key));
        assert.deepEqual(groups, expected.groups);
        assert.equal(groups.reduce((sum, group) => sum + group.amount, 0), expected.totalSales);
      });
    }
    await t.test(`${businessLineId === kedai ? 'kedai' : 'salon'} CSV has exactly confirmed filtered sale IDs and totals`, async () => {
      const expected = reportExpectation(businessLineId, 'day');
      const response = await request(line('/reports/sales.csv', businessLineId, { from: startedDate, to: startedDate }), { token: actors.admin.token, expected: 200 });
      assert.match(response.headers.get('content-type'), /^text\/csv/i);
      const [headers, ...rows] = parseCsv(response.text);
      assert.deepEqual(headers, ['saleId', 'businessLineId', 'createdAt', 'paymentMethod', 'total']);
      const idColumn = headers.indexOf('saleId');
      const totalColumn = headers.indexOf('total');
      assert.ok(idColumn >= 0, `CSV saleId column missing: ${headers}`);
      assert.ok(totalColumn >= 0, `CSV total column missing: ${headers}`);
      assert.equal(rows.length, expected.transactionCount);
      assert.deepEqual(rows.map(row => row[idColumn]).sort(), expected.sales.map(entry => entry.sale.id).sort());
      for (const row of rows) {
        assert.equal(row.length, headers.length);
        assert.equal(row[headers.indexOf('businessLineId')], businessLineId);
        assert.equal(row[headers.indexOf('paymentMethod')], expectedSales.get(row[idColumn]).sale.payment.method);
        assert.ok(Date.parse(row[headers.indexOf('createdAt')]));
        assert.match(row[totalColumn], /^\d+$/);
        assert.equal(Number(row[totalColumn]), expectedSales.get(row[idColumn]).total);
      }
      assert.equal(rows.reduce((sum, row) => sum + Number(row[totalColumn]), 0), expected.totalSales);
    });
  }
});

test('F03/F08: inventory report exposes tracked stock, reservations and low-stock filtering', async t => {
  const stocked = await product({ stockTracked: true, name: `QA stocked ${uuid()}` });
  const empty = await product({ stockTracked: true, name: `QA empty ${uuid()}` });
  const untracked = await product({ stockTracked: false, name: `QA untracked ${uuid()}` });
  await receive(stocked, 5);
  const read = (query = {}, token = actors.owner.token, businessLineId = kedai, expected = 200) =>
    request(line('/reports/inventory', businessLineId, query), { token, expected });
  await t.test('snapshot lists only tracked products with integer quantities', async () => {
    const { data } = await read();
    assert.ok(Array.isArray(data.data));
    const row = data.data.find(item => item.productId === stocked.id);
    assert.ok(row, 'Received tracked product missing from inventory report');
    assert.equal(row.productName, stocked.name);
    for (const field of ['quantity', 'reservedQuantity', 'availableQuantity', 'lowStockThreshold']) {
      assert.ok(Number.isSafeInteger(row[field]), `${field} must be an integer`);
    }
    assert.equal(row.quantity, 5);
    assert.equal(row.reservedQuantity, 0);
    assert.equal(row.availableQuantity, 5);
    assert.ok(data.data.some(item => item.productId === empty.id), 'Zero-stock tracked product must still be visible');
    assert.equal(data.data.filter(item => item.productId === untracked.id).length, 0, 'Untracked products are not inventory');
  });
  await t.test('a pending QR intent is reported as reserved, not as available stock', async () => {
    const { sale } = await checkout(stocked, { method: 'qris', quantity: 2 });
    const { data } = await read();
    const row = data.data.find(item => item.productId === stocked.id);
    assert.equal(row.quantity, 5, 'Reservation must not debit on-hand stock');
    assert.equal(row.reservedQuantity, 2);
    assert.equal(row.availableQuantity, 3);
    await webhook(eventFor(sale));
    await assertPayment(sale, 'confirmed');
    const { data: after } = await read();
    const settled = after.data.find(item => item.productId === stocked.id);
    assert.equal(settled.quantity, 3);
    assert.equal(settled.reservedQuantity, 0);
    assert.equal(settled.availableQuantity, 3);
  });
  await t.test('lowStock returns only items at or below their threshold', async () => {
    const { data: all } = await read();
    const { data: low } = await read({ lowStock: 'true' });
    const ids = new Set(low.data.map(item => item.productId));
    assert.ok(ids.has(empty.id), 'Zero-available tracked product must appear in the low-stock view');
    for (const item of low.data) assert.ok(item.availableQuantity <= item.lowStockThreshold, `${item.productId} is not low stock`);
    for (const item of all.data) {
      if (item.availableQuantity <= item.lowStockThreshold) assert.ok(ids.has(item.productId), `${item.productId} missing from low-stock view`);
    }
    assert.ok(low.data.length <= all.data.length);
  });
  await t.test('report is line-scoped, type-checked and validates its own inputs', async () => {
    await read({}, actors.cashier.token);
    await read({}, actors.cashier.token, salon, 403);
    await read({}, actors.salonCashier.token, salon, 400);
    await read({ lowStock: 'maybe' }, actors.owner.token, kedai, 400);
    await request('/reports/inventory', { token: actors.owner.token, expected: 400 });
  });
});

test('F01: owner-only user administration, session revocation and last-owner protection', async t => {
  const email = `qa-managed-${uuid()}@example.test`;
  const password = randomBytes(20).toString('base64url');
  const { data: managed } = await request('/users', { method: 'POST', token: actors.owner.token, body: { name: 'QA managed cashier', email, password, role: 'cashier', businessLineIds: [kedai] }, expected: 201 });
  await t.test('created user is listed and readable without any credential material', async () => {
    const { text } = await request('/users?page=1&limit=100', { token: actors.owner.token, expected: 200 });
    assert.doesNotMatch(text, /password|passwordHash|\$2[aby]\$/i, 'User payloads must never expose credentials');
    const users = await request('/users?page=1&limit=100', { token: actors.owner.token, expected: 200 });
    assert.ok(users.data.data.some(row => row.id === managed.id));
    assert.equal(users.data.pagination.limit, 100);
    const { data } = await request(`/users/${managed.id}`, { token: actors.owner.token, expected: 200 });
    assert.equal(data.email, email.toLowerCase());
    assert.equal(data.role, 'cashier');
    assert.deepEqual(data.businessLines.map(row => row.id), [kedai]);
    await request(`/users/${uuid()}`, { token: actors.owner.token, expected: 404 });
    await request('/users/not-a-uuid', { token: actors.owner.token, expected: 400 });
  });
  await t.test('invalid user input is rejected without partially creating an account', async () => {
    for (const body of [
      { name: 'QA', email, password: randomBytes(20).toString('base64url'), role: 'cashier', businessLineIds: [kedai] },
      { name: 'QA', email: `qa-${uuid()}@example.test`, password: 'short', role: 'cashier', businessLineIds: [kedai] },
      { name: 'QA', email: `qa-${uuid()}@example.test`, password, role: 'superuser', businessLineIds: [kedai] },
      { name: 'QA', email: `qa-${uuid()}@example.test`, password, role: 'cashier', businessLineIds: [] },
      { name: 'QA', email: `qa-${uuid()}@example.test`, password, role: 'cashier', businessLineIds: [uuid()] },
      { name: 'QA', email: 'not-an-email', password, role: 'cashier', businessLineIds: [kedai] },
      { name: '', email: `qa-${uuid()}@example.test`, password, role: 'cashier', businessLineIds: [kedai] },
    ]) await request('/users', { method: 'POST', token: actors.owner.token, body, expected: [400, 409] });
  });
  await t.test('admin and cashier cannot read or mutate any user record', async () => {
    for (const token of [actors.admin.token, actors.cashier.token]) {
      await request('/users', { token, expected: 403 });
      await request(`/users/${managed.id}`, { token, expected: 403 });
      await request(`/users/${managed.id}`, { method: 'PATCH', token, body: { role: 'owner' }, expected: 403 });
      await request(`/users/${managed.id}`, { method: 'DELETE', token, expected: 403 });
    }
    await request(`/users/${managed.id}`, { method: 'PATCH', body: { role: 'owner' }, expected: 401 });
  });
  await t.test('changing assigned lines revokes live sessions and applies on next login', async () => {
    const session = await login(email, password);
    assert.deepEqual(session.user.businessLines.map(row => row.id), [kedai]);
    await request(line('/services', salon), { token: session.token, expected: 403 });
    const { data: patched } = await request(`/users/${managed.id}`, { method: 'PATCH', token: actors.owner.token, body: { businessLineIds: [kedai, salon] }, expected: 200 });
    assert.deepEqual(patched.businessLines.map(row => row.id).sort(), [kedai, salon].sort());
    await request('/auth/me', { token: session.token, expected: 401 });
    const renewed = await login(email, password);
    assert.deepEqual(renewed.user.businessLines.map(row => row.id).sort(), [kedai, salon].sort());
    await request(line('/services', salon, { page: '1', limit: '20' }), { token: renewed.token, expected: 200 });
  });
  await t.test('archiving a user revokes access immediately and blocks re-login', async () => {
    const session = await login(email, password);
    await request(`/users/${managed.id}`, { method: 'DELETE', token: actors.owner.token, expected: 204 });
    await request('/auth/me', { token: session.token, expected: 401 });
    await request('/auth/login', { method: 'POST', body: { email, password }, expected: 401 });
    const { data } = await request(`/users/${managed.id}`, { token: actors.owner.token, expected: 200 });
    assert.equal(data.active, false);
  });
  await t.test('the last active owner cannot be demoted or archived', async () => {
    const { data: me } = await request('/auth/me', { token: actors.owner.token, expected: 200 });
    await request(`/users/${me.id}`, { method: 'PATCH', token: actors.owner.token, body: { role: 'admin' }, expected: 409 });
    await request(`/users/${me.id}`, { method: 'DELETE', token: actors.owner.token, expected: 409 });
    await request('/auth/me', { token: actors.owner.token, expected: 200 });
  });
});

test('F05/F08: sale and queue list filters are applied by the server, with a documented default page size', async t => {
  await t.test('omitting limit uses the documented default of 20', async () => {
    const { data } = await request(line('/sales', kedai), { token: actors.owner.token, expected: 200 });
    assert.equal(data.pagination.limit, 20);
    assert.equal(data.pagination.page, 1);
    assert.ok(data.data.length <= 20);
    const { data: products } = await request(line('/products', kedai), { token: actors.owner.token, expected: 200 });
    assert.equal(products.pagination.limit, 20);
  });
  await t.test('sale status and date filters partition the same ledger', async () => {
    const everything = await allPages('/sales', kedai, actors.owner.token);
    const byStatus = {};
    for (const status of ['paid', 'pending_payment', 'cancelled']) {
      byStatus[status] = await allPages('/sales', kedai, actors.owner.token, { status });
      for (const row of byStatus[status]) assert.equal(row.status, status, `status=${status} returned ${row.status}`);
    }
    const partitioned = Object.values(byStatus).flat();
    assert.deepEqual(partitioned.map(row => row.id).sort(), everything.map(row => row.id).sort(), 'Status filters must partition the ledger exactly');
    await request(line('/sales', kedai, { status: 'refunded' }), { token: actors.owner.token, expected: 400 });
    const today = await allPages('/sales', kedai, actors.owner.token, { from: startedDate, to: startedDate });
    assert.deepEqual(today.map(row => row.id).sort(), everything.map(row => row.id).sort(), 'All fixture sales were created on the current business date');
    const historic = await allPages('/sales', kedai, actors.owner.token, { from: '2000-01-01', to: '2000-01-02' });
    assert.equal(historic.length, 0);
    await request(line('/sales', kedai, { from: 'not-a-date', to: startedDate }), { token: actors.owner.token, expected: 400 });
  });
  await t.test('queue status and date filters are applied server-side', async () => {
    const { data: all } = await request(line('/salon/queue', salon, { date: startedDate }), { token: actors.salonCashier.token, expected: 200 });
    assert.ok(all.data.length > 0, 'Earlier scenarios must have created queue entries today');
    let partitioned = 0;
    for (const status of ['waiting', 'in_service', 'completed', 'cancelled']) {
      const { data } = await request(line('/salon/queue', salon, { date: startedDate, status }), { token: actors.salonCashier.token, expected: 200 });
      for (const row of data.data) assert.equal(row.status, status);
      partitioned += data.data.length;
    }
    assert.equal(partitioned, all.data.length, 'Queue status filters must partition the day exactly');
    const { data: historic } = await request(line('/salon/queue', salon, { date: '2000-01-01' }), { token: actors.salonCashier.token, expected: 200 });
    assert.deepEqual(historic.data, []);
    await request(line('/salon/queue', salon, { date: startedDate, status: 'no_show' }), { token: actors.salonCashier.token, expected: 400 });
    await request(line('/salon/queue', salon, { date: 'not-a-date' }), { token: actors.salonCashier.token, expected: 400 });
  });
});

test('F06: reconciliation search and outcome filters are server-side, line-scoped and paginate', async t => {
  const hair = await service();
  const { sale: salonSale } = await checkout(hair, { method: 'qris' });
  const salonEvent = eventFor(salonSale);
  await webhook(salonEvent);
  await assertPayment(salonSale, 'confirmed');
  const kedaiEvents = await allPages('/payments/reconciliation', kedai, actors.admin.token);
  const salonEvents = await allPages('/payments/reconciliation', salon, actors.admin.token);
  assert.ok(kedaiEvents.length > 1 && salonEvents.length >= 1, 'Both lines need retained events for this scenario');
  const applied = kedaiEvents.find(row => row.outcome === 'applied');
  const conflicting = kedaiEvents.find(row => row.outcome !== 'applied');
  assert.ok(applied && conflicting, `Need both applied and non-applied kedai events: ${[...new Set(kedaiEvents.map(row => row.outcome))]}`);
  const filtered = (businessLineId, query, token = actors.admin.token, expected = 200) =>
    request(line('/payments/reconciliation', businessLineId, { page: '1', limit: '100', ...query }), { token, expected });
  await t.test('search matches event, sale and provider payment references as substrings', async () => {
    for (const [name, term, matches] of [
      ['eventId', applied.eventId, row => row.eventId === applied.eventId],
      ['saleId', applied.saleId, row => row.saleId === applied.saleId],
      ['providerPaymentId', applied.providerPaymentId, row => row.providerPaymentId === applied.providerPaymentId],
      ['substring', applied.eventId.slice(4, 20), row => row.eventId.includes(applied.eventId.slice(4, 20))],
    ]) {
      const { data } = await filtered(kedai, { search: term });
      assert.ok(data.data.length >= 1, `search by ${name} returned nothing`);
      assert.equal(data.pagination.total, data.data.length, `search by ${name} must paginate the filtered set, not the full table`);
      for (const row of data.data) assert.ok(matches(row), `search by ${name} returned unrelated event ${row.eventId}`);
      assert.ok(data.data.some(row => row.eventId === applied.eventId), `search by ${name} lost the target event`);
    }
    const { data: none } = await filtered(kedai, { search: `absent-${uuid()}` });
    assert.deepEqual(none.data, []);
    assert.equal(none.pagination.total, 0);
  });
  await t.test('outcome is an explicit validated enum, not a status alias', async () => {
    const { data } = await filtered(kedai, { outcome: 'applied' });
    assert.ok(data.data.length >= 1);
    for (const row of data.data) assert.equal(row.outcome, 'applied');
    assert.equal(data.pagination.total, kedaiEvents.filter(row => row.outcome === 'applied').length);
    const { data: other } = await filtered(kedai, { outcome: conflicting.outcome });
    assert.ok(other.data.every(row => row.outcome === conflicting.outcome));
    assert.equal(other.pagination.total, kedaiEvents.filter(row => row.outcome === conflicting.outcome).length);
    assert.ok(data.pagination.total + other.pagination.total <= kedaiEvents.length);
    await filtered(kedai, { outcome: 'not-an-outcome' }, actors.admin.token, 400);
    await filtered(kedai, { outcome: '' }, actors.admin.token, [200, 400]);
  });
  await t.test('combined filters still paginate correctly at limit 1', async () => {
    const expected = kedaiEvents.filter(row => row.outcome === 'applied').map(row => row.eventId).sort();
    const collected = [];
    let totalPages = 1;
    for (let page = 1; page <= expected.length + 1 && page <= totalPages; page++) {
      const { data } = await request(line('/payments/reconciliation', kedai, { outcome: 'applied', page: String(page), limit: '1' }), { token: actors.admin.token, expected: 200 });
      assert.equal(data.pagination.limit, 1);
      assert.equal(data.pagination.total, expected.length);
      totalPages = data.pagination.totalPages;
      assert.equal(totalPages, expected.length);
      assert.equal(data.data.length, 1);
      collected.push(data.data[0].eventId);
    }
    assert.deepEqual(collected.sort(), expected, 'Paging a filtered reconciliation view must return each event exactly once');
  });
  await t.test('filters never leak events from an unauthorized or unselected line', async () => {
    const { data } = await filtered(kedai, { search: salonEvent.eventId });
    assert.deepEqual(data.data, [], 'A salon event must not be reachable through the kedai filter');
    const { data: owned } = await filtered(salon, { search: salonEvent.eventId });
    assert.equal(owned.data.length, 1);
    assert.equal(owned.data[0].eventId, salonEvent.eventId);
    await filtered(salon, { search: salonEvent.eventId }, actors.salonCashier.token, 403);
    await filtered(kedai, { outcome: 'applied' }, actors.cashier.token, 403);
    assert.doesNotMatch((await filtered(salon, {})).text, /signature|qrContent|apiKey|secret/i);
  });
});

test('F01/F10: transport rejects oversized, mistyped and unknown requests without leaking internals', async t => {
  await t.test('bodies above the documented 1 MiB cap are refused', async () => {
    const oversized = JSON.stringify({ sku: `QA-BIG-${uuid()}`, name: 'x'.repeat(2 * 1024 * 1024), unit: 'each', price: 1, stockTracked: false });
    assert.ok(oversized.length > 1 << 20);
    await request(line('/products', kedai), { method: 'POST', token: actors.owner.token, raw: oversized, expected: [400, 413], timeout: 15_000 });
  });
  await t.test('non-JSON content types and empty bodies are validation failures', async () => {
    for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/x-www-form-urlencoded' }, { 'Content-Type': '' }]) {
      await request(line('/products', kedai), { method: 'POST', token: actors.owner.token, raw: '{"sku":"x"}', headers, expected: 400 });
    }
    await request(line('/products', kedai), { method: 'POST', token: actors.owner.token, raw: '', expected: 400 });
  });
  await t.test('unknown routes, methods and webhook providers do not return server errors', async () => {
    await request(`/does-not-exist-${uuid()}`, { token: actors.owner.token, expected: 404 });
    await request('/auth/me', { method: 'DELETE', token: actors.owner.token, expected: [404, 405] });
    const event = { eventId: key(), paymentId: 'qa', merchantReference: uuid(), amount: 1, currency: 'IDR', status: 'succeeded', occurredAt: new Date().toISOString() };
    const response = await webhook(event, { provider: `unknown-${uuid()}`, expected: [400, 401, 404] });
    assert.ok(response.status < 500, `Unknown provider returned ${response.status}`);
  });
});
