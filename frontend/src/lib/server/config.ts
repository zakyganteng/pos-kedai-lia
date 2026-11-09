/**
 * Server-only configuration for the POS backend origin.
 *
 * POS_API_URL is read on the server exclusively. It is never exposed to the
 * browser (no NEXT_PUBLIC_ prefix) because the browser always talks to the
 * same-origin Next route handlers under /api.
 */

export const DEFAULT_POS_API_URL = 'http://127.0.0.1:8080/api/v1';

/** Request timeouts. Writes get a longer budget than reads. */
export const READ_TIMEOUT_MS = 10_000;
export const WRITE_TIMEOUT_MS = 20_000;

/** Largest JSON body the proxy will accept from the browser. */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

/**
 * Largest body accepted by the unauthenticated login endpoint.
 *
 * POST /api/session is reachable without a session, so it gets a far tighter
 * bound than the authenticated proxy. The largest legitimate payload is an
 * email (320 chars) plus a password (200 chars) with JSON escaping, which
 * cannot approach this.
 */
export const MAX_LOGIN_BODY_BYTES = 8 * 1024;

/**
 * What the browser is told when POS_API_URL is unusable.
 *
 * The thrown messages below name the variable but never echo its value: a
 * misconfigured URL can contain internal hostnames or credentials, and a 500
 * body is the wrong place to disclose them. The detail stays server-side.
 */
export const CONFIG_ERROR_MESSAGE = 'The POS backend is misconfigured.';

/**
 * Validates and normalizes a backend base URL.
 *
 * Only http(s) is accepted: a misconfigured file:, data: or gopher: URL would
 * turn the proxy into an arbitrary-scheme fetcher. Query strings, fragments
 * and credentials are rejected so that path joining stays predictable.
 *
 * Failures throw with a value-free message so the text is safe to log.
 */
export function parseApiBaseUrl(raw: string | undefined | null): string {
  const value = (raw ?? '').trim() === '' ? DEFAULT_POS_API_URL : (raw as string).trim();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('POS_API_URL is not an absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('POS_API_URL must use http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('POS_API_URL must not embed credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('POS_API_URL must not contain a query string or fragment');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname}`;
}

export function apiBaseUrl(): string {
  return parseApiBaseUrl(process.env.POS_API_URL);
}

/**
 * Cookies are marked Secure in production. POS_COOKIE_SECURE is an explicit
 * override for isolated test environments, never a reason to disable Secure
 * behind a production TLS-terminating proxy.
 */
export function secureCookiesEnabled(): boolean {
  const override = process.env.POS_COOKIE_SECURE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * Joins the backend base URL with an already-allowlisted API path.
 *
 * The path is re-checked here rather than trusted: this is the single place
 * where a user-influenced string becomes an outbound URL.
 */
export function buildUpstreamUrl(
  baseUrl: string,
  path: string,
  query?: Array<[string, string]>,
): string {
  if (!path.startsWith('/')) {
    throw new Error('upstream path must start with "/"');
  }
  if (path.startsWith('//') || path.includes('..') || path.includes('\\')) {
    throw new Error('upstream path is not acceptable');
  }
  if (/[^A-Za-z0-9/_.~-]/.test(path)) {
    throw new Error('upstream path contains unexpected characters');
  }

  const base = parseApiBaseUrl(baseUrl);
  let url = `${base}${path}`;
  if (query && query.length > 0) {
    const search = new URLSearchParams(query);
    url += `?${search.toString()}`;
  }
  return url;
}
