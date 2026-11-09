/**
 * Session endpoint logic for /api/session.
 *
 * The browser never sees the backend access token. It calls:
 *   GET    /api/session -> CurrentUser (direct object, no envelope)
 *   POST   /api/session -> { user, expiresAt } after a backend login
 *   DELETE /api/session -> 204 after the backend session is revoked
 *
 * The token returned by POST /auth/login is stored in an HttpOnly cookie by
 * this server and attached to backend calls on the server side only.
 */

import {
  CONFIG_ERROR_MESSAGE,
  MAX_LOGIN_BODY_BYTES,
  apiBaseUrl,
  parseApiBaseUrl,
  secureCookiesEnabled,
} from './config';
import { readBoundedBody } from './bounded-body';
import { errorResponse, jsonResponse, passthroughResponse } from './errors';
import { checkRequestOrigin } from './origin';
import {
  clearedSessionCookie,
  isCookieSafeToken,
  parseExpiresAt,
  readSessionToken,
  sessionCookie,
  sessionMaxAgeSeconds,
  setCookieHeader,
} from './session-cookie';
import { callUpstream, parseJsonBody, type FetchLike } from './upstream';

export interface ServerDeps {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  secureCookies?: boolean;
  now?: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface ParsedAuthSession {
  token: string;
  expiresAt: string;
  user: unknown;
}

/** Validates the browser-supplied login body before it reaches the backend. */
export function parseLoginBody(value: unknown): LoginCredentials | null {
  if (typeof value !== 'object' || value === null) return null;
  const { email, password } = value as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const trimmed = email.trim();
  if (trimmed === '' || trimmed.length > 320) return null;
  if (password.length < 1 || password.length > 200) return null;
  return { email: trimmed, password };
}

/** Validates the backend AuthSession payload before trusting it. */
export function parseAuthSession(value: unknown, now: number = Date.now()): ParsedAuthSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const session = value as Record<string, unknown>;
  const token = session.accessToken;
  const expiresAt = session.expiresAt;
  const user = session.user;
  if (!isCookieSafeToken(token)) return null;
  if (typeof expiresAt !== 'string') return null;
  // The expiry must be a real instant far enough in the future to be worth a
  // cookie. Accepting a vague string here would let the lifetime we store and
  // the expiry we report to the browser drift apart.
  if (parseExpiresAt(expiresAt) === null) return null;
  if (sessionMaxAgeSeconds(expiresAt, now) === null) return null;
  if (typeof user !== 'object' || user === null) return null;
  return { token, expiresAt, user };
}

function resolveBaseUrl(deps: ServerDeps): { baseUrl: string } | { error: Response } {
  try {
    // Both the env value and an injected override go through the same
    // http(s)-only validation.
    return { baseUrl: deps.baseUrl === undefined ? apiBaseUrl() : parseApiBaseUrl(deps.baseUrl) };
  } catch {
    // The thrown message names the variable but the browser gets none of it.
    return { error: errorResponse(500, 'CONFIG_ERROR', CONFIG_ERROR_MESSAGE) };
  }
}

function secureFor(deps: ServerDeps): boolean {
  return deps.secureCookies ?? secureCookiesEnabled();
}

function clearCookieHeaders(deps: ServerDeps): Record<string, string> {
  return setCookieHeader(clearedSessionCookie({ secure: secureFor(deps) }));
}

function unauthorized(deps: ServerDeps, message = 'Authentication required.'): Response {
  // Any cookie we hold is useless once the backend rejects it, so drop it.
  return errorResponse(401, 'UNAUTHORIZED', message, { headers: clearCookieHeaders(deps) });
}

/**
 * Server-side helper for route handlers or server components that need the
 * signed-in user. Returns null when there is no usable session.
 */
export async function getCurrentUser(
  token: string | null,
  deps: ServerDeps = {},
): Promise<unknown | null> {
  if (!token) return null;
  const resolved = resolveBaseUrl(deps);
  if ('error' in resolved) return null;

  const result = await callUpstream({
    baseUrl: resolved.baseUrl,
    path: '/auth/me',
    method: 'GET',
    token,
    fetchImpl: deps.fetchImpl,
  });
  if (!result.ok || result.status !== 200) return null;
  const parsed = parseJsonBody(result.bodyText);
  return typeof parsed === 'object' && parsed !== null ? parsed : null;
}

async function handleGet(request: Request, deps: ServerDeps): Promise<Response> {
  const token = readSessionToken(request);
  if (!token) return unauthorized(deps, 'No active session.');

  const resolved = resolveBaseUrl(deps);
  if ('error' in resolved) return resolved.error;
  const result = await callUpstream({
    baseUrl: resolved.baseUrl,
    path: '/auth/me',
    method: 'GET',
    token,
    fetchImpl: deps.fetchImpl,
  });

  if (!result.ok) {
    return errorResponse(result.status, result.code, result.message);
  }
  if (result.status === 401 || result.status === 403) {
    return unauthorized(deps, 'Session is no longer valid.');
  }
  if (result.status !== 200) {
    return passthroughResponse(result.status, result.bodyText);
  }

  const user = parseJsonBody(result.bodyText);
  if (typeof user !== 'object' || user === null) {
    return errorResponse(502, 'UPSTREAM_INVALID_RESPONSE', 'Current user could not be read.');
  }
  // CurrentUser is returned directly, matching the agreed browser contract.
  return jsonResponse(user, 200);
}

async function handlePost(request: Request, deps: ServerDeps): Promise<Response> {
  const origin = checkRequestOrigin(request);
  if (!origin.ok) {
    return errorResponse(403, 'CROSS_ORIGIN_BLOCKED', 'Request origin is not allowed.');
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be JSON.');
  }

  // This endpoint is reachable without a session, so the body is bounded
  // while it is being read rather than measured after it has been buffered.
  const body = await readBoundedBody(request, MAX_LOGIN_BODY_BYTES);
  if (!body.ok) {
    return errorResponse(body.status, body.code, body.message);
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(body.text);
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body must be JSON.');
  }

  const credentials = parseLoginBody(rawBody);
  if (!credentials) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Email and password are required.');
  }

  const resolved = resolveBaseUrl(deps);
  if ('error' in resolved) return resolved.error;

  const result = await callUpstream({
    baseUrl: resolved.baseUrl,
    path: '/auth/login',
    method: 'POST',
    bodyText: JSON.stringify(credentials),
    mutation: true,
    fetchImpl: deps.fetchImpl,
  });

  if (!result.ok) {
    return errorResponse(result.status, result.code, result.message);
  }
  if (result.status !== 200) {
    // 400 / 401 / 429 are passed through so the UI can show the real reason.
    return passthroughResponse(result.status, result.bodyText, clearCookieHeaders(deps));
  }

  const session = parseAuthSession(parseJsonBody(result.bodyText), deps.now ?? Date.now());
  if (!session) {
    return errorResponse(502, 'UPSTREAM_INVALID_RESPONSE', 'Login response was not usable.');
  }

  const cookie = sessionCookie(session.token, session.expiresAt, {
    secure: secureFor(deps),
    now: deps.now,
  });
  // accessToken is intentionally absent from this body.
  return jsonResponse({ user: session.user, expiresAt: session.expiresAt }, 200, setCookieHeader(cookie));
}

async function handleDelete(request: Request, deps: ServerDeps): Promise<Response> {
  const origin = checkRequestOrigin(request);
  if (!origin.ok) {
    return errorResponse(403, 'CROSS_ORIGIN_BLOCKED', 'Request origin is not allowed.');
  }

  const token = readSessionToken(request);
  const headers = clearCookieHeaders(deps);
  if (!token) {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...headers } });
  }

  const resolved = resolveBaseUrl(deps);
  if ('error' in resolved) {
    // The browser session ends regardless; the cookie is cleared even though
    // the backend could not be contacted.
    return errorResponse(
      500,
      'CONFIG_ERROR',
      'Signed out locally. The backend URL is misconfigured, so the server session was not revoked.',
      { headers },
    );
  }

  const result = await callUpstream({
    baseUrl: resolved.baseUrl,
    path: '/auth/logout',
    method: 'POST',
    token,
    mutation: true,
    fetchImpl: deps.fetchImpl,
  });

  // 204 is a confirmed revocation. 401 means the token was already invalid,
  // which is the same end state. Anything else (500, 503, transport failure)
  // leaves the backend session possibly alive, so it is not reported as a
  // successful logout even though the cookie is dropped.
  const revoked = result.ok && (result.status === 204 || result.status === 401);
  if (!revoked) {
    const message = result.ok
      ? `Signed out locally, but the server session was not confirmed as revoked (backend status ${result.status}).`
      : 'Signed out locally, but the server session could not be confirmed as revoked.';
    return errorResponse(502, 'LOGOUT_UNRESOLVED', message, { headers });
  }

  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...headers } });
}

export async function handleSession(request: Request, deps: ServerDeps = {}): Promise<Response> {
  switch (request.method.toUpperCase()) {
    case 'GET':
      return handleGet(request, deps);
    case 'POST':
      return handlePost(request, deps);
    case 'DELETE':
      return handleDelete(request, deps);
    default:
      return errorResponse(405, 'METHOD_NOT_ALLOWED', `${request.method} is not supported.`, {
        headers: { allow: 'GET, POST, DELETE' },
      });
  }
}
