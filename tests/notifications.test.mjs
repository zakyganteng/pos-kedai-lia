import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { allPages, eventually, gatewayUrl, kedai, key, line, login, request, uuid, webhook } from './support/api.mjs';

// Phase 2 runs against its own disposable database and its own API process configured
// with the deterministic external notification HTTP boundary in support/gateway.mjs.
// That boundary is a test double for the provider transport only; it is not a WhatsApp
// vendor, not a deployment component, and a passing test is not delivery certification.
assert.match(process.env.QA_ISOLATED_DATABASE || '', /^lia_pos_qa_\d+$/, 'Use node project/tests/run.mjs; never target a shared/production database');
assert.equal(process.env.NOTIFICATION_PROVIDER, 'http', 'Phase 2 requires the HTTP notification boundary');
const destination = process.env.QA_NOTIFICATION_DESTINATION;
assert.ok(destination, 'QA_NOTIFICATION_DESTINATION is required');
const template = process.env.QA_NOTIFICATION_TEMPLATE;
assert.ok(template, 'QA_NOTIFICATION_TEMPLATE is required');
const render = sale => template
  .replaceAll('{{saleId}}', sale.id)
  .replaceAll('{{total}}', String(sale.total))
  .replaceAll('{{businessLineId}}', sale.businessLineId);

const actors = {};
let sequence = 0;

async function product(overrides = {}) {
  const body = { sku: `QA-N-${++sequence}-${uuid()}`, name: 'QA notified coffee', unit: 'cup', price: 15500, stockTracked: false, ...overrides };
  return (await request(line('/products', kedai), { method: 'POST', token: actors.owner.token, body, expected: 201 })).data;
}
async function checkout(item, { method = 'cash', quantity = 1 } = {}) {
  const body = {
    items: [{ itemType: 'product', itemId: item.id, quantity }],
    paymentMethod: method,
    ...(method === 'cash' ? { cashReceived: item.price * quantity } : {}),
  };
  const { data } = await request(line('/sales', kedai), {
    method: 'POST', token: actors.owner.token, body, headers: { 'X-Idempotency-Key': key() }, expected: 201,
  });
  return data;
}
const fixture = () => fetch(`${gatewayUrl}/__qa/messages`).then(response => response.json());
const attemptsFor = (state, id) => state.messages.filter(message => message.idempotencyKey === id);
async function notificationsFor(saleId, accept, options) {
  const rows = await eventually(`notification for sale ${saleId}`, () => allPages('/notifications', kedai, actors.owner.token), list => accept(list.filter(row => row.saleId === saleId)), options);
  return rows.filter(row => row.saleId === saleId);
}

before(async () => {
  actors.owner = await login(process.env.QA_OWNER_EMAIL, process.env.QA_OWNER_PASSWORD);
}, { timeout: 20_000 });

test('F07: a configured provider boundary receives exactly one rendered message per confirmed cash sale', async t => {
  const coffee = await product();
  const sale = await checkout(coffee);
  assert.equal(sale.payment.status, 'confirmed');
  const [notification] = await notificationsFor(sale.id, rows => rows.length === 1 && rows[0].status === 'sent', { attempts: 60, interval: 200 });
  await t.test('outbox row reports delivery without leaking the destination or provider secrets', async () => {
    assert.equal(notification.status, 'sent');
    assert.equal(notification.lastError, null);
    assert.ok(notification.attemptCount >= 1, 'A sent delivery must record at least one attempt');
    assert.equal(notification.destinationMasked, `***${destination.slice(-4)}`);
    const { text } = await request(line('/notifications', kedai, { page: '1', limit: '100' }), { token: actors.owner.token, expected: 200 });
    assert.doesNotMatch(text, new RegExp(destination.replace('+', '\\+')), 'Full destination must not be returned to clients');
    assert.doesNotMatch(text, /apiKey|webhookSecret|Bearer /i);
  });
  await t.test('the provider transport received one authenticated call keyed by the outbox record', async () => {
    const state = await fixture();
    const attempts = attemptsFor(state, notification.id);
    assert.equal(attempts.length, 1, 'One logical notification must not produce duplicate provider calls');
    assert.equal(attempts[0].destination, destination, 'Configured destination is sent to the provider, not to the browser');
    assert.equal(attempts[0].rejected, false);
    // The configured NOTIFICATION_TEMPLATE must be the message that is actually rendered,
    // with every supported placeholder substituted from server-side sale values only.
    assert.equal(attempts[0].message, render(sale), 'Rendered message must match the configured template exactly');
    assert.ok(template.includes('{{saleId}}'), 'QA template must exercise placeholder substitution');
    assert.doesNotMatch(attempts[0].message, /\{\{|\}\}|undefined|null|%!|<no value>/, 'Rendered message must not contain unresolved placeholders or nil formatting');
    assert.ok(attempts[0].message.includes(sale.id) && attempts[0].message.includes(String(sale.total)));
  });
  await t.test('an already-sent notification cannot be retried and payment stays confirmed', async () => {
    await request(`/notifications/${notification.id}/retry`, { method: 'POST', token: actors.owner.token, expected: 409 });
    const { data } = await request(`/payments/${sale.payment.id}`, { token: actors.owner.token, expected: 200 });
    assert.equal(data.status, 'confirmed');
    const state = await fixture();
    assert.equal(attemptsFor(state, notification.id).length, 1, 'A rejected retry must not reach the provider');
  });
  await t.test('integration status reports the configured provider without production claims', async () => {
    const { data, text } = await request('/integrations', { token: actors.owner.token, expected: 200 });
    assert.equal(data.notification.provider, 'http');
    assert.equal(data.notification.configured, true);
    assert.equal(data.notification.productionSupported, false);
    assert.equal(data.productionReady, false);
    assert.doesNotMatch(text, /apiKey|webhookSecret|password|Bearer /i);
  });
});

test('F07: a gateway-confirmed QR sale notifies exactly once through the same boundary', async () => {
  const coffee = await product({ price: 22222 });
  const sale = await checkout(coffee, { method: 'qris' });
  assert.equal(sale.payment.status, 'pending');
  assert.equal((await allPages('/notifications', kedai, actors.owner.token)).filter(row => row.saleId === sale.id).length, 0, 'Pending QR must not notify');
  const event = { eventId: key(), paymentId: sale.payment.gatewayReference, merchantReference: sale.id, amount: sale.total, currency: 'IDR', status: 'succeeded', occurredAt: new Date().toISOString() };
  const response = await webhook(event);
  assert.ok(response.elapsed < 2_000, `Webhook blocked on provider delivery: ${response.elapsed}ms`);
  const [notification] = await notificationsFor(sale.id, rows => rows.length === 1 && rows[0].status === 'sent', { attempts: 60, interval: 200 });
  // Replaying the same signed event must not create a second logical notification or call.
  await webhook(event);
  await webhook(event);
  const settled = (await allPages('/notifications', kedai, actors.owner.token)).filter(row => row.saleId === sale.id);
  assert.equal(settled.length, 1, 'Webhook replay must reuse the single logical notification');
  const state = await fixture();
  assert.equal(attemptsFor(state, notification.id).length, 1, 'Webhook replay must not re-send to the provider');
});

test('F07: a transient provider rejection retries the identical rendered payload and converges to one sent delivery', async () => {
  const coffee = await product({ price: 31007 });
  const configure = await fetch(`${gatewayUrl}/__qa/reject-next-messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 1 }) });
  assert.equal(configure.status, 202);
  const sale = await checkout(coffee);
  assert.equal(sale.payment.status, 'confirmed', 'Provider unavailability must not block checkout');
  const [queued] = await notificationsFor(sale.id, rows => rows.length === 1, { attempts: 60, interval: 200 });
  const first = await eventually('first provider attempt rejected', fixture, state => attemptsFor(state, queued.id).length >= 1, { attempts: 60, interval: 200 });
  const rejected = attemptsFor(first, queued.id)[0];
  assert.equal(rejected.rejected, true, 'Fixture must reject the first attempt deterministically');
  // Catalog changes between attempts must not re-render a different outbound payload.
  await request(`/products/${coffee.id}`, { method: 'PATCH', token: actors.owner.token, body: { name: 'Renamed after payment', price: coffee.price + 9000 }, expected: 200 });
  // Backoff is 30s for the first failure; the worker ticks every 2s. Bound the wait explicitly.
  const retried = await eventually('scheduled provider retry', fixture, state => attemptsFor(state, queued.id).length >= 2, { attempts: 150, interval: 500 });
  const attempts = attemptsFor(retried, queued.id);
  assert.equal(attempts.length, 2, 'Exactly one scheduled retry is expected in this window');
  assert.equal(attempts[1].rejected, false);
  assert.equal(attempts[1].raw, attempts[0].raw, 'Retry must resend the identical rendered bytes, not a re-rendered message');
  assert.equal(attempts[1].message, render(sale), 'Retry payload must still match the template rendered from the original sale');
  assert.equal(attempts[1].idempotencyKey, queued.id, 'Retry must reuse the outbox idempotency key');
  const [settled] = await notificationsFor(sale.id, rows => rows.length === 1 && rows[0].status === 'sent', { attempts: 60, interval: 200 });
  assert.equal(settled.id, queued.id, 'Retry must reuse the logical outbox record');
  assert.ok(settled.attemptCount >= 2, `Visible attempt count must include the failed attempt: ${settled.attemptCount}`);
  assert.equal(settled.lastError, null);
  assert.equal(settled.createdAt, queued.createdAt);
  assert.equal(settled.destinationMasked, queued.destinationMasked);
  const { data: payment } = await request(`/payments/${sale.payment.id}`, { token: actors.owner.token, expected: 200 });
  assert.equal(payment.status, 'confirmed', 'Payment must stay confirmed regardless of notification outcome');
}, { timeout: 150_000 });

test('F07/F10: the service refuses to start on an unusable notification template', async t => {
  const binary = process.env.QA_POS_BINARY;
  const cwd = process.env.QA_BACKEND_DIR;
  assert.ok(binary && cwd, 'Runner must expose the built binary for configuration validation');
  const start = template => spawnSync(binary, ['serve'], {
    cwd, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, NOTIFICATION_TEMPLATE: template, HTTP_ADDR: '127.0.0.1:0' },
  });
  await t.test('unsupported, malformed, blank and control-character templates are rejected', async () => {
    // An absent or empty variable means "use the documented default" and is not tested here;
    // only values the operator actually supplied must fail loudly at startup.
    for (const invalid of ['Payment for {{apiKey}}', 'Broken {{saleId}', '   ', `Line one\u0007 {{saleId}}`, `x${'y'.repeat(600)} {{saleId}}`]) {
      const result = start(invalid);
      assert.notEqual(result.status, 0, `Template ${JSON.stringify(invalid.slice(0, 40))} must not start the service`);
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      assert.match(output, /NOTIFICATION_TEMPLATE/, `Startup failure must name the offending setting: ${output.slice(0, 300)}`);
      assert.doesNotMatch(output, /panic:|goroutine \d|SQLSTATE/, 'Configuration errors must not surface as panics');
      assert.doesNotMatch(output, new RegExp(process.env.NOTIFICATION_API_KEY), 'Configuration errors must not echo credentials');
    }
  });
}, { timeout: 150_000 });
