/**
 * Proxy logic for /api/pos/[...path].
 *
 * Browser requests carry no credentials of their own: the session token comes
 * from this server's HttpOnly cookie. Paths and query parameters are checked
 * against an allowlist (see proxy-policy.ts) before any outbound request.
 */

import {
  CONFIG_ERROR_MESSAGE,
  MAX_REQUEST_BODY_BYTES,
  apiBaseUrl,
  parseApiBaseUrl,
  secureCookiesEnabled,
} from './config';
import { readBoundedBody } from './bounded-body';
import { errorResponse, passthroughResponse } from './errors';
import { checkRequestOrigin } from './origin';
import { isValidIdempotencyKey, resolveProxyRequest } from './proxy-policy';
import { clearedSessionCookie, readSessionToken, setCookieHeader } from './session-cookie';
import { callUpstream } from './upstream';
import type { ServerDeps } from './session';

export async function handlePosProxy(
  request: Request,
  segments: string[],
  deps: ServerDeps = {},
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method !== 'GET' && !checkRequestOrigin(request).ok) {
    return errorResponse(403, 'CROSS_ORIGIN_BLOCKED', 'Request origin is not allowed.');
  }

  let search: URLSearchParams;
  try {
    search = new URL(request.url).searchParams;
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request URL could not be parsed.');
  }

  const decision = resolveProxyRequest(method, segments, search);
  if (!decision.ok) {
    return errorResponse(decision.status, decision.code, decision.message);
  }

  const token = readSessionToken(request);
  if (!token) {
    return errorResponse(401, 'UNAUTHORIZED', 'No active session.');
  }

  let bodyText: string | undefined;
  let idempotencyKey: string | undefined;

  if (method === 'POST' || method === 'PATCH') {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be JSON.');
    }

    if (method === 'POST' && decision.path === '/sales') {
      const key = request.headers.get('x-idempotency-key');
      if (!isValidIdempotencyKey(key)) {
        return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'X-Idempotency-Key must be 1-200 characters of [A-Za-z0-9._:-].');
      }
      idempotencyKey = key;
    }

    // Bounded while reading: an over-sized body is refused from its
    // Content-Length or cut off mid-stream, never buffered in full first.
    const body = await readBoundedBody(request, MAX_REQUEST_BODY_BYTES);
    if (!body.ok) {
      return errorResponse(body.status, body.code, body.message);
    }
    bodyText = body.text;

    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return errorResponse(400, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
    }
    if (method === 'PATCH' && decision.path.startsWith('/products/')) {
      // This frontend exposes category assignment, not general catalog writes.
      const object = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
      const id = object?.categoryId;
      if (!object || Object.keys(object).length !== 1 || !Object.hasOwn(object, 'categoryId') ||
          !(id === null || (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Only a UUID or null categoryId may be assigned through this frontend.');
      }
    }
  }

  let baseUrl: string;
  try {
    baseUrl = deps.baseUrl === undefined ? apiBaseUrl() : parseApiBaseUrl(deps.baseUrl);
  } catch {
    // Detail stays server-side: the message can name internal hosts.
    return errorResponse(500, 'CONFIG_ERROR', CONFIG_ERROR_MESSAGE);
  }

  const result = await callUpstream({
    baseUrl,
    path: decision.path,
    method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
    query: decision.query,
    token,
    bodyText,
    idempotencyKey,
    mutation: decision.mutation,
    fetchImpl: deps.fetchImpl,
  });

  if (!result.ok) {
    return errorResponse(result.status, result.code, result.message);
  }

  if (result.status === 401) {
    const secure = deps.secureCookies ?? secureCookiesEnabled();
    return passthroughResponse(
      401,
      result.bodyText,
      setCookieHeader(clearedSessionCookie({ secure })),
    );
  }

  return passthroughResponse(result.status, result.bodyText);
}
