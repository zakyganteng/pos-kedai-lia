/**
 * Browser API client.
 *
 * The browser never talks to the Go backend directly and never holds a token.
 * `api()` calls the same-origin Next proxy at /api/pos, which attaches the
 * session from an HttpOnly cookie. `sessionApi()` drives /api/session.
 *
 * Paths are written exactly as in openapi.yaml, e.g.
 *   api<ProductPage>('/products?businessLineId=' + id)
 *   api<Sale>('/sales?businessLineId=' + id, { method: 'POST', ... })
 */

export const POS_API_PREFIX = '/api/pos';
export const SESSION_ENDPOINT = '/api/session';

/** Transport failure in the browser: the request may or may not have run. */
export const NETWORK_ERROR = 'NETWORK_ERROR';
/** The proxy could not determine the outcome of a write. Retry the same key. */
export const REQUEST_UNRESOLVED = 'REQUEST_UNRESOLVED';
/**
 * Backend 502 on POST /sales: the payment intent could not be resolved.
 *
 * This is the code the backend actually puts on the wire. `INTENT_UNRESOLVED`
 * is a value it stores on the sale's payment record, never an error code, so
 * matching on it here would miss every real occurrence.
 */
export const PAYMENT_PROVIDER_ERROR = 'PAYMENT_PROVIDER_ERROR';
/** Backend 503 on POST /sales: refused before anything was committed. */
export const PAYMENT_UNAVAILABLE = 'PAYMENT_UNAVAILABLE';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; requestId?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
    if (options.requestId !== undefined) this.requestId = options.requestId;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * True when a failed write may already have been applied by the backend.
 *
 * Only meaningful for mutations. The caller must retry with the same
 * X-Idempotency-Key so the backend replays the original outcome instead of
 * creating a second sale.
 *
 * Every 5xx is uncertain by default, because a write can be committed before
 * the response that would have reported it is lost. The one exception is a
 * 503 PAYMENT_UNAVAILABLE, which the backend raises inside the transaction
 * before any row is written, so no sale exists to collide with.
 */
export function isUnresolvedWrite(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.status === 0 || error.code === NETWORK_ERROR || error.code === REQUEST_UNRESOLVED) {
    return true;
  }
  if (error.status === 503 && error.code === PAYMENT_UNAVAILABLE) return false;
  return error.status >= 500;
}

/** Stable key for a logical mutation; reuse it across retries of that mutation. */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Turns an openapi-relative path into a same-origin proxy URL.
 * Absolute and protocol-relative values are refused so a caller cannot send
 * the session cookie's requests off-origin by mistake.
 */
export function toProxyUrl(path: string): string {
  if (typeof path !== 'string' || path === '') {
    throw new ApiError(0, 'INVALID_PATH', 'API path must be a non-empty string.');
  }
  if (path.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new ApiError(0, 'INVALID_PATH', `API path must be relative: ${path}`);
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${POS_API_PREFIX}${normalized}`;
}

interface ParsedErrorBody {
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
  details?: unknown;
}

/** Reads the shared `{ error: { code, message, requestId, details } }` envelope. */
export function errorFromPayload(status: number, payload: unknown): ApiError {
  const envelope =
    typeof payload === 'object' && payload !== null
      ? ((payload as { error?: unknown }).error as ParsedErrorBody | undefined)
      : undefined;

  const code =
    envelope && typeof envelope.code === 'string' && envelope.code !== ''
      ? envelope.code
      : `HTTP_${status}`;
  const message =
    envelope && typeof envelope.message === 'string' && envelope.message !== ''
      ? envelope.message
      : `Request failed with status ${status}.`;
  const requestId =
    envelope && typeof envelope.requestId === 'string' && envelope.requestId !== ''
      ? envelope.requestId
      : undefined;

  return new ApiError(status, code, message, {
    details: envelope?.details,
    requestId,
  });
}

function buildHeaders(options: RequestInit | undefined, hasBody: boolean): Headers {
  const headers = new Headers(options?.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (hasBody && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return headers;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned a response that could not be read.',
      { cause },
    );
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined && options.body !== null;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: buildHeaders(options, hasBody),
      // Session state must never be served from the HTTP cache.
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });
  } catch (cause) {
    throw new ApiError(
      0,
      NETWORK_ERROR,
      'The server could not be reached. Check the connection and try again.',
      { cause },
    );
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await readJson(response);
    } catch {
      payload = undefined;
    }
    throw errorFromPayload(response.status, payload);
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }
  return (await readJson(response)) as T;
}

/**
 * Calls a POS backend endpoint through the same-origin proxy.
 * `path` is backend-relative, e.g. `/sales?businessLineId=<uuid>`.
 */
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  return request<T>(toProxyUrl(path), options);
}

/**
 * Session endpoint.
 *   GET    -> CurrentUser
 *   POST   -> { user, expiresAt }   (body: { email, password })
 *   DELETE -> void
 * No access token is ever returned to the browser.
 */
export async function sessionApi<T>(
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const options: RequestInit = { method };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return request<T>(SESSION_ENDPOINT, options);
}
