/**
 * Session cookie handling.
 *
 * The backend session token lives in an HttpOnly, SameSite=Lax cookie that is
 * only ever read by server code in this app. It is never written to
 * localStorage, never returned to the browser in a response body, and never
 * readable from client JavaScript.
 */

export const SESSION_COOKIE_NAME = 'pos_session';

/**
 * A token with less than this much life left is treated as unusable rather
 * than rounded up: minting a cookie for a token the backend will immediately
 * reject just produces a confusing 401 on the next click.
 */
export const MIN_SESSION_SECONDS = 30;
/** Upper bound regardless of what the backend reports. */
export const MAX_SESSION_SECONDS = 12 * 60 * 60;

export interface CookieAttributes {
  name: string;
  value: string;
  maxAge: number;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
}

/**
 * Parses the backend's `expiresAt` into an epoch-millisecond instant.
 *
 * Strict on purpose: only an RFC 3339 / ISO 8601 string that Date can read is
 * accepted. There is no fallback lifetime, because guessing a TTL means the
 * cookie's real lifetime and the expiry advertised to the browser disagree.
 */
export function parseExpiresAt(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Derives the cookie lifetime from the backend's `expiresAt`.
 *
 * Returns null when the token is unusable: unparseable, already expired, or
 * expiring too soon to be worth storing. The cookie must never outlive the
 * token, so the only clamp is the upper one.
 */
export function sessionMaxAgeSeconds(
  expiresAt: string | undefined | null,
  now: number = Date.now(),
): number | null {
  const expiryMs = parseExpiresAt(expiresAt);
  if (expiryMs === null) return null;

  const seconds = Math.floor((expiryMs - now) / 1000);
  if (seconds < MIN_SESSION_SECONDS) return null;
  return seconds > MAX_SESSION_SECONDS ? MAX_SESSION_SECONDS : seconds;
}

/**
 * Rejects token values that cannot be safely placed in a Set-Cookie header.
 * The backend issues opaque tokens; anything with separators or control
 * characters indicates corruption or an injection attempt.
 */
export function isCookieSafeToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    token.length > 0 &&
    token.length <= 4096 &&
    !/[\x00-\x20"\\,;\x7f]/.test(token)
  );
}

export function sessionCookie(
  token: string,
  expiresAt: string | undefined | null,
  options: { secure: boolean; now?: number },
): CookieAttributes {
  if (!isCookieSafeToken(token)) {
    throw new Error('session token is not cookie-safe');
  }
  const maxAge = sessionMaxAgeSeconds(expiresAt, options.now ?? Date.now());
  if (maxAge === null) {
    // Callers validate the expiry first; this is the backstop that keeps an
    // unusable lifetime from silently becoming a default one.
    throw new Error('session expiry is missing, unparseable or already past');
  }
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    maxAge,
    path: '/',
    httpOnly: true,
    secure: options.secure,
    sameSite: 'Lax',
  };
}

export function clearedSessionCookie(options: { secure: boolean }): CookieAttributes {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    maxAge: 0,
    path: '/',
    httpOnly: true,
    secure: options.secure,
    sameSite: 'Lax',
  };
}

export function serializeCookie(cookie: CookieAttributes): string {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAge}`,
    `SameSite=${cookie.sameSite}`,
  ];
  if (cookie.httpOnly) parts.push('HttpOnly');
  if (cookie.secure) parts.push('Secure');
  if (cookie.maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return parts.join('; ');
}

/** Reads one cookie out of a raw Cookie request header. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    const value = pair.slice(index + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

export function readSessionToken(request: Request): string | null {
  return readCookie(request.headers.get('cookie'), SESSION_COOKIE_NAME);
}

export function setCookieHeader(cookie: CookieAttributes): Record<string, string> {
  return { 'set-cookie': serializeCookie(cookie) };
}
