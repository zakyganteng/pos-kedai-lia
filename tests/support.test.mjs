import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { parseCsv } from './support/api.mjs';
import { startGateway } from './support/gateway.mjs';

test('CSV parser preserves quoted commas, quotes, CRLF and embedded newlines', () => {
  assert.deepEqual(parseCsv('\uFEFFsaleId,name,total\r\n1,"Tea, ""special""",7001\r\n2,"two\nlines",2\r\n'), [
    ['saleId', 'name', 'total'], ['1', 'Tea, "special"', '7001'], ['2', 'two\nlines', '2'],
  ]);
  assert.deepEqual(parseCsv('saleId,total\n1,2'), [['saleId', 'total'], ['1', '2']]);
  assert.deepEqual(parseCsv(''), []);
  assert.throws(() => parseCsv('a,"unclosed'), /inside quoted field/);
});

test('test-only gateway enforces normalized contract and stable idempotency', async t => {
  const fixture = await startGateway({ port: 0, apiKey: 'ephemeral-fixture-key' });
  t.after(() => fixture.close());
  const merchantReference = randomUUID();
  const body = { merchantReference, amount: 7001, currency: 'IDR' };
  const headers = { Authorization: 'Bearer ephemeral-fixture-key', 'Content-Type': 'application/json', 'Idempotency-Key': merchantReference, 'X-Idempotency-Key': merchantReference };
  const endpoint = `${fixture.url}/mock-gateway/v1/payments`;
  const first = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(first.status, 201);
  const intent = await first.json();
  assert.equal(intent.status, 'pending');
  assert.equal(intent.amount, 7001);
  assert.equal(intent.merchantReference, merchantReference);
  const replay = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), intent);
  const changed = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...body, amount: 8000 }) });
  assert.equal(changed.status, 409);
  const unauthorized = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
  assert.equal(unauthorized.status, 401);
  const noStableKey = await fetch(endpoint, { method: 'POST', headers: { Authorization: headers.Authorization }, body: JSON.stringify(body) });
  assert.equal(noStableKey.status, 400);
  const state = await (await fetch(`${fixture.url}/__qa/state`)).json();
  assert.equal(state.intents.length, 1);
  assert.equal(state.requests.length, 3);
  assert.equal(state.intents[0].response.paymentId, intent.paymentId);
});

test('gateway fault persists external intent before timeout and replays it on retry', async t => {
  const fixture = await startGateway({ port: 0, apiKey: 'ephemeral-fixture-key' });
  t.after(() => fixture.close());
  const control = await fetch(`${fixture.url}/__qa/stall-next-created-response`, { method: 'POST', body: JSON.stringify({ amount: 91009 }) });
  assert.equal(control.status, 202);
  const merchantReference = randomUUID();
  const body = JSON.stringify({ merchantReference, amount: 91009, currency: 'IDR' });
  const headers = { Authorization: 'Bearer ephemeral-fixture-key', 'Content-Type': 'application/json', 'Idempotency-Key': merchantReference, 'X-Idempotency-Key': merchantReference };
  const endpoint = `${fixture.url}/mock-gateway/v1/payments`;
  await assert.rejects(fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(100) }), { name: 'TimeoutError' });
  const state = await (await fetch(`${fixture.url}/__qa/state`)).json();
  assert.equal(state.intents.length, 1, 'Timed out client must not erase external persistence');
  const retry = await fetch(endpoint, { method: 'POST', headers, body });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), state.intents[0].response);
});

test('test-only notification boundary authenticates, records attempts and rejects deterministically', async t => {
  const fixture = await startGateway({ port: 0, apiKey: 'ephemeral-fixture-key', notificationKey: 'ephemeral-notify-key' });
  t.after(() => fixture.close());
  const endpoint = `${fixture.url}/notify/v1/messages`;
  const key = randomUUID();
  const headers = { Authorization: 'Bearer ephemeral-notify-key', 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Idempotency-Key': key };
  const body = JSON.stringify({ destination: '+628119999QA00', message: 'Payment confirmed.' });
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: headers.Authorization, 'Content-Type': 'application/json' }, body })).status, 400);
  assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ destination: '' }) })).status, 400);
  const configure = await fetch(`${fixture.url}/__qa/reject-next-messages`, { method: 'POST', body: JSON.stringify({ count: 1 }) });
  assert.equal(configure.status, 202);
  assert.equal((await fetch(endpoint, { method: 'POST', headers, body })).status, 500);
  const accepted = await fetch(endpoint, { method: 'POST', headers, body });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).status, 'sent');
  const state = await (await fetch(`${fixture.url}/__qa/messages`)).json();
  const attempts = state.messages.filter(message => message.idempotencyKey === key);
  assert.equal(attempts.length, 2, 'Both the rejected and accepted attempts must be observable');
  assert.deepEqual(attempts.map(message => message.rejected), [true, false]);
  assert.equal(attempts[0].raw, attempts[1].raw, 'Fixture must retain exact request bytes for render-stability assertions');
  assert.equal(state.pendingRejections, 0);
});
