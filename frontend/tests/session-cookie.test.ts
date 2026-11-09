import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  MAX_SESSION_SECONDS,
  MIN_SESSION_SECONDS,
  SESSION_COOKIE_NAME,
  clearedSessionCookie,
  isCookieSafeToken,
  parseExpiresAt,
  readCookie,
  serializeCookie,
  sessionCookie,
  sessionMaxAgeSeconds,
} from '../src/lib/server/session-cookie';

const NOW = Date.parse('2026-01-01T00:00:00Z');

test('sessionMaxAgeSeconds derives the lifetime from expiresAt', () => {
  assert.equal(sessionMaxAgeSeconds('2026-01-01T00:30:00Z', NOW), 30 * 60);
});

test('sessionMaxAgeSeconds clamps a far-future expiry but never extends a short one', () => {
  assert.equal(sessionMaxAgeSeconds('2030-01-01T00:00:00Z', NOW), MAX_SESSION_SECONDS);
  assert.equal(sessionMaxAgeSeconds('2026-01-01T00:00:45Z', NOW), 45);
});

test('sessionMaxAgeSeconds refuses an expired token instead of flooring it', () => {
  // An already-past expiry used to mint a 30s cookie for a token the backend
  // would reject on the next request.
  assert.equal(sessionMaxAgeSeconds('2025-12-31T23:00:00Z', NOW), null);
  assert.equal(sessionMaxAgeSeconds('2026-01-01T00:00:00Z', NOW), null);
  assert.equal(sessionMaxAgeSeconds('2026-01-01T00:00:29Z', NOW), null);
  assert.equal(sessionMaxAgeSeconds(`2026-01-01T00:00:${MIN_SESSION_SECONDS}Z`, NOW), MIN_SESSION_SECONDS);
});

test('sessionMaxAgeSeconds has no fallback for a missing or unparseable expiry', () => {
  assert.equal(sessionMaxAgeSeconds(undefined, NOW), null);
  assert.equal(sessionMaxAgeSeconds(null, NOW), null);
  assert.equal(sessionMaxAgeSeconds('', NOW), null);
  assert.equal(sessionMaxAgeSeconds('not-a-date', NOW), null);
});

test('parseExpiresAt accepts only a readable instant', () => {
  assert.equal(parseExpiresAt('2026-01-01T00:30:00Z'), Date.parse('2026-01-01T00:30:00Z'));
  for (const bad of [undefined, null, '', '   ', 'soon', 42, {}]) {
    assert.equal(parseExpiresAt(bad), null, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test('isCookieSafeToken rejects header-splitting and separator characters', () => {
  assert.equal(isCookieSafeToken('opaque-token.123'), true);
  for (const bad of ['', 'a b', 'a;b', 'a,b', 'a"b', 'a\\b', 'a\nb', 'a\r\nSet-Cookie: x=y', 'x'.repeat(5000)]) {
    assert.equal(isCookieSafeToken(bad), false, `expected rejection for ${JSON.stringify(bad)}`);
  }
  assert.equal(isCookieSafeToken(undefined), false);
});

test('sessionCookie is HttpOnly, SameSite=Lax and path-scoped', () => {
  const cookie = sessionCookie('tok', '2026-01-01T00:30:00Z', { secure: true, now: NOW });
  assert.equal(cookie.name, SESSION_COOKIE_NAME);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(cookie.secure, true);
  assert.equal(cookie.path, '/');
  assert.equal(cookie.maxAge, 1800);

  const header = serializeCookie(cookie);
  assert.match(header, /^pos_session=tok; Path=\/; Max-Age=1800; SameSite=Lax; HttpOnly; Secure$/);
});

test('sessionCookie omits Secure in development', () => {
  const header = serializeCookie(sessionCookie('tok', '2026-01-01T00:30:00Z', { secure: false, now: NOW }));
  assert.equal(header.includes('Secure'), false);
  assert.equal(header.includes('HttpOnly'), true);
});

test('sessionCookie refuses an unsafe token instead of emitting a broken header', () => {
  assert.throws(() => sessionCookie('bad;token', '2026-01-01T00:30:00Z', { secure: false, now: NOW }), /cookie-safe/);
});

test('sessionCookie refuses an expiry it cannot use rather than inventing one', () => {
  for (const bad of [null, undefined, '', 'not-a-date', '2025-12-31T23:00:00Z']) {
    assert.throws(
      () => sessionCookie('tok', bad, { secure: false, now: NOW }),
      /session expiry/,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test('clearedSessionCookie expires the cookie immediately', () => {
  const header = serializeCookie(clearedSessionCookie({ secure: false }));
  assert.match(header, /^pos_session=; Path=\/; Max-Age=0; SameSite=Lax; HttpOnly; Expires=/);
});

test('readCookie extracts one named cookie from a raw header', () => {
  assert.equal(readCookie('a=1; pos_session=tok; b=2', SESSION_COOKIE_NAME), 'tok');
  assert.equal(readCookie('pos_session=', SESSION_COOKIE_NAME), null);
  assert.equal(readCookie('other=1', SESSION_COOKIE_NAME), null);
  assert.equal(readCookie(null, SESSION_COOKIE_NAME), null);
  assert.equal(readCookie('pos_session_extra=nope', SESSION_COOKIE_NAME), null);
});
