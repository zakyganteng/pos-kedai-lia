import { strict as assert } from 'node:assert';
import test from 'node:test';

import { declaredBodyBytes, readBoundedBody } from '../src/lib/server/bounded-body';

const LIMIT = 1024;

function requestWith(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:3000/api/pos/sales', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

/** A body that reports a huge Content-Length but is never actually sent. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test('declaredBodyBytes parses only a well-formed Content-Length', () => {
  assert.equal(declaredBodyBytes('0'), 0);
  assert.equal(declaredBodyBytes('1024'), 1024);
  assert.equal(declaredBodyBytes('  1024  '), 1024);
  for (const bad of [null, undefined, '', 'abc', '-1', '1.5', '1024, 2048', '9'.repeat(20)]) {
    assert.equal(declaredBodyBytes(bad), null, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test('a body within the limit is returned verbatim', async () => {
  const text = JSON.stringify({ items: [{ quantity: 1 }] });
  const result = await readBoundedBody(requestWith(text), LIMIT);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.text, text);
    assert.equal(result.bytes, Buffer.byteLength(text));
  }
});

test('an oversized Content-Length is refused before the body is touched', async () => {
  // Duck-typed so body access is observable: undici pulls a real stream body
  // during Request construction, which would mask what is being asserted.
  let bodyRead = false;
  const request = {
    headers: new Headers({
      'content-type': 'application/json',
      'content-length': String(LIMIT * 100),
    }),
    get body(): ReadableStream<Uint8Array> {
      bodyRead = true;
      return streamOf([new Uint8Array(LIMIT * 100)]);
    },
  } as unknown as Request;

  const result = await readBoundedBody(request, LIMIT);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
    assert.equal(result.code, 'PAYLOAD_TOO_LARGE');
  }
  assert.equal(bodyRead, false, 'expected the body stream never to be accessed');
});

test('a body that lies about its length is still cut off mid-stream', async () => {
  // No Content-Length at all: only the streaming limit can stop this.
  const chunk = new Uint8Array(256).fill(0x61);
  const chunks = Array.from({ length: 100 }, () => chunk);
  const request = new Request('http://127.0.0.1:3000/api/pos/sales', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: streamOf(chunks),
    // @ts-expect-error duplex is required by undici for a stream body
    duplex: 'half',
  });

  const result = await readBoundedBody(request, LIMIT);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
    assert.equal(result.code, 'PAYLOAD_TOO_LARGE');
  }
});

test('the limit counts bytes, not characters', async () => {
  // Four-byte code points: 300 characters are 1200 bytes.
  const text = '\u{1F600}'.repeat(300);
  assert.ok(text.length < LIMIT, 'character count alone would pass');
  assert.ok(Buffer.byteLength(text) > LIMIT, 'byte count must not');

  const result = await readBoundedBody(requestWith(text), LIMIT);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 413);
});

test('a multi-byte body split across chunks decodes correctly', async () => {
  const text = 'Ringkasan: Rp\u00a010.000 \u2014 sel\u0065sai';
  const encoded = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < encoded.length; i += 3) chunks.push(encoded.slice(i, i + 3));

  const request = new Request('http://127.0.0.1:3000/api/pos/sales', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: streamOf(chunks),
    // @ts-expect-error duplex is required by undici for a stream body
    duplex: 'half',
  });

  const result = await readBoundedBody(request, LIMIT);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.text, text);
});

test('a body exactly at the limit is accepted', async () => {
  const text = 'x'.repeat(LIMIT);
  const result = await readBoundedBody(requestWith(text), LIMIT);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.bytes, LIMIT);
});

test('a request without a body reads as empty', async () => {
  const request = new Request('http://127.0.0.1:3000/api/pos/products', { method: 'GET' });
  const result = await readBoundedBody(request, LIMIT);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.text, '');
    assert.equal(result.bytes, 0);
  }
});

test('a stream that errors mid-transfer is reported as unreadable', async () => {
  const request = new Request('http://127.0.0.1:3000/api/pos/sales', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"items"'));
        controller.error(new Error('connection reset'));
      },
    }),
    // @ts-expect-error duplex is required by undici for a stream body
    duplex: 'half',
  });

  const result = await readBoundedBody(request, LIMIT);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.code, 'VALIDATION_ERROR');
  }
});
