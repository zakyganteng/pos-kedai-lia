/**
 * Deterministic EXTERNAL HTTP test double, loaded only by the black-box runner.
 * Not an application provider, bundled gateway service, or real QRIS payload.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

export async function startGateway({ port = 19091, apiKey, notificationKey }) {
  const intents = new Map();
  const requests = [];
  const stallAmounts = new Set();
  // Separate deterministic notification boundary; never a WhatsApp vendor claim.
  const messages = [];
  let rejectMessages = 0;
  const server = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method === 'GET' && req.url === '/__qa/state') {
        return send(200, { intents: [...intents.values()], requests });
      }
      if (req.method === 'GET' && req.url === '/__qa/messages') {
        return send(200, { messages, pendingRejections: rejectMessages });
      }
      if (req.method === 'POST' && req.url === '/__qa/reject-next-messages') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const { count } = JSON.parse(raw);
        if (!Number.isSafeInteger(count) || count < 0) return send(400, { error: 'integer count required' });
        rejectMessages = count;
        return send(202, { configured: count });
      }
      if (req.method === 'POST' && req.url === '/notify/v1/messages') {
        if (req.headers.authorization !== `Bearer ${notificationKey}`) return send(401, { error: 'invalid fixture notification credential' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 16_384) return send(413, { error: 'fixture body too large' });
        }
        const body = JSON.parse(raw);
        const idempotencyKey = req.headers['x-idempotency-key'];
        if (!idempotencyKey || req.headers['idempotency-key'] !== idempotencyKey) return send(400, { error: 'stable notification idempotency headers required' });
        if (typeof body.destination !== 'string' || !body.destination || typeof body.message !== 'string' || !body.message) {
          return send(400, { error: 'destination and message required' });
        }
        // Record every attempt, including rejected ones, so retry render stability is observable.
        const rejected = rejectMessages > 0;
        if (rejected) rejectMessages--;
        messages.push({ idempotencyKey, destination: body.destination, message: body.message, raw, rejected, receivedAt: new Date().toISOString() });
        if (rejected) return send(500, { error: 'deterministic transient provider failure' });
        return send(200, { status: 'sent', messageId: `qa-message-${messages.length}` });
      }
      if (req.method === 'POST' && req.url === '/__qa/stall-next-created-response') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const { amount } = JSON.parse(raw);
        if (!Number.isSafeInteger(amount)) return send(400, { error: 'integer amount required' });
        stallAmounts.add(amount);
        return send(202, { configured: true });
      }
      if (req.method !== 'POST' || req.url !== '/mock-gateway/v1/payments') return send(404, { error: 'test fixture route not found' });
      if (req.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: 'invalid fixture credential' });
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 16_384) return send(413, { error: 'fixture body too large' });
      }
      const body = JSON.parse(raw);
      if (!body.merchantReference || !Number.isSafeInteger(body.amount) || body.amount < 0 || body.currency !== 'IDR') {
        return send(400, { error: 'invalid normalized payment intent' });
      }
      if (req.headers['idempotency-key'] !== body.merchantReference || req.headers['x-idempotency-key'] !== body.merchantReference) {
        return send(400, { error: 'stable sale-scoped provider idempotency headers required' });
      }
      const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      requests.push({ merchantReference: body.merchantReference, amount: body.amount, currency: body.currency, idempotencyKey: req.headers['idempotency-key'], fingerprint });
      const previous = intents.get(body.merchantReference);
      if (previous) {
        if (previous.fingerprint !== fingerprint) return send(409, { error: 'changed payload for provider idempotency key' });
        return send(200, previous.response);
      }
      const response = {
        paymentId: `qa-payment-${body.merchantReference}`,
        merchantReference: body.merchantReference,
        amount: body.amount,
        currency: 'IDR',
        status: 'pending',
        qrContent: `TEST-ONLY-NOT-A-PAYABLE-QR:${body.merchantReference}`,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      };
      intents.set(body.merchantReference, { fingerprint, response });
      // Persist externally, then deliberately withhold the response. The real provider
      // client's timeout must handle ambiguity; stable retries receive the saved intent.
      if (stallAmounts.delete(body.amount)) return;
      return send(201, response);
    } catch {
      send(400, { error: 'invalid fixture request' });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}
