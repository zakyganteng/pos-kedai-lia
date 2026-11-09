/**
 * Error envelope helpers shared by the Next route handlers.
 *
 * The shape matches the backend `Error` schema in openapi.yaml so the browser
 * client has exactly one error format to parse, whether the failure happened
 * in the backend or in this proxy.
 */

export interface ErrorDetail {
  field?: string;
  message?: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export function newRequestId(): string {
  // randomUUID exists in Node 19+ and in the Edge runtime.
  return `fe-${globalThis.crypto.randomUUID()}`;
}

export function errorEnvelope(
  code: string,
  message: string,
  options: { requestId?: string; details?: unknown } = {},
): ErrorEnvelope {
  const envelope: ErrorEnvelope = {
    error: {
      code,
      message,
      requestId: options.requestId ?? newRequestId(),
    },
  };
  if (options.details !== undefined) {
    envelope.error.details = options.details;
  }
  return envelope;
}

/** JSON response with caching disabled; every POS response is per-session. */
export function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  options: { requestId?: string; details?: unknown; headers?: Record<string, string> } = {},
): Response {
  return jsonResponse(
    errorEnvelope(code, message, { requestId: options.requestId, details: options.details }),
    status,
    options.headers,
  );
}

/** Passes an upstream JSON payload through unchanged, with no-store caching. */
export function passthroughResponse(
  status: number,
  bodyText: string,
  extraHeaders?: Record<string, string>,
): Response {
  const hasBody = status !== 204 && status !== 205 && status !== 304 && bodyText !== '';
  return new Response(hasBody ? bodyText : null, {
    status,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
