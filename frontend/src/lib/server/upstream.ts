/**
 * Outbound calls from the Next server to the Go backend.
 *
 * Everything the browser sends is dropped here except an explicitly built set
 * of headers. In particular the browser's Cookie and Authorization headers are
 * never forwarded: the only credential that reaches the backend is the session
 * token this server read from its own HttpOnly cookie.
 */

import { CONFIG_ERROR_MESSAGE, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS, buildUpstreamUrl } from './config';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface UpstreamCall {
  baseUrl: string;
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Array<[string, string]>;
  /** Session token from the HttpOnly cookie, if the caller has one. */
  token?: string | null;
  bodyText?: string;
  idempotencyKey?: string;
  /** Mutations report an uncertain outcome differently from reads. */
  mutation?: boolean;
  /** Media type a successful response must carry. Errors are always JSON. */
  expect?: 'json' | 'csv';
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface UpstreamSuccess {
  ok: true;
  status: number;
  bodyText: string;
}

export interface UpstreamFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type UpstreamResult = UpstreamSuccess | UpstreamFailure;

/**
 * A write whose outcome we could not observe. The browser client must retry
 * with the same X-Idempotency-Key rather than starting a new sale, otherwise
 * a timed-out checkout can become two orders.
 */
export const REQUEST_UNRESOLVED = 'REQUEST_UNRESOLVED';
export const UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE';
export const UPSTREAM_INVALID_RESPONSE = 'UPSTREAM_INVALID_RESPONSE';

function unresolvedFailure(mutation: boolean, message: string): UpstreamFailure {
  return mutation
    ? { ok: false, status: 504, code: REQUEST_UNRESOLVED, message }
    : { ok: false, status: 502, code: UPSTREAM_UNAVAILABLE, message };
}

function invalidResponse(message: string): UpstreamFailure {
  return { ok: false, status: 502, code: UPSTREAM_INVALID_RESPONSE, message };
}

/**
 * Statuses that are defined to carry no body.
 *
 * 304 is deliberately absent: it is caught by the 3xx guard in `callUpstream`.
 * The proxy sends `cache: 'no-store'` and no conditional headers, so a 304
 * from the backend is a protocol surprise, not a cache hit to forward.
 */
const BODILESS_STATUSES = new Set([204, 205]);

/**
 * Exact media-type match rather than a substring test: `text/json-ish` and
 * `application/json-rpc-but-html` both contain "json" and neither is a body
 * this proxy should forward as JSON.
 */
export function isJsonContentType(value: string | null | undefined): boolean {
  const media = (value ?? '').split(';', 1)[0].trim().toLowerCase();
  return media === 'application/json' || media.endsWith('+json');
}

export function isCsvContentType(value: string | null | undefined): boolean {
  const media = (value ?? '').split(';', 1)[0].trim().toLowerCase();
  return media === 'text/csv';
}

/**
 * Rejects `promise` as soon as `signal` aborts.
 *
 * `fetch` honours the signal while it is establishing the response, but a body
 * that stalls mid-stream is a separate wait. Racing the signal keeps one timer
 * authoritative over the whole exchange, including stub fetch implementations
 * that never wire the signal into their own body stream.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function callUpstream(call: UpstreamCall): Promise<UpstreamResult> {
  const mutation = call.mutation ?? call.method !== 'GET';
  const fetchImpl = call.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = call.timeoutMs ?? (mutation ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);

  let url: string;
  try {
    url = buildUpstreamUrl(call.baseUrl, call.path, call.query);
  } catch {
    // The thrown detail names the misconfiguration but may contain internal
    // hostnames, so only the generic text travels onward.
    return { ok: false, status: 500, code: 'CONFIG_ERROR', message: CONFIG_ERROR_MESSAGE };
  }

  const expectCsv = call.expect === 'csv';
  const headers: Record<string, string> = {
    accept: expectCsv ? 'text/csv, application/json' : 'application/json',
  };
  if (call.token) headers.authorization = `Bearer ${call.token}`;
  if (call.bodyText !== undefined) headers['content-type'] = 'application/json';
  if (call.idempotencyKey) headers['x-idempotency-key'] = call.idempotencyKey;

  const controller = new AbortController();
  // One timer covers the whole exchange: connect, headers and body. It is
  // cleared only after the body has been read, so a backend that returns
  // headers promptly and then stalls cannot hold this request open.
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: call.method,
        headers,
        body: call.bodyText,
        // A 3xx must not be followed: a redirect to another host would replay the
        // Authorization header to that host.
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      return unresolvedFailure(
        mutation,
        controller.signal.aborted
          ? 'The request to the POS backend timed out.'
          : 'The POS backend could not be reached.',
      );
    }

    if (response.status >= 300 && response.status < 400) {
      return invalidResponse('The POS backend returned an unexpected redirect.');
    }

    let bodyText: string;
    try {
      bodyText = await untilAborted(response.text(), controller.signal);
    } catch {
      return unresolvedFailure(
        mutation,
        controller.signal.aborted
          ? 'The POS backend stopped sending its response before it was complete.'
          : 'The POS backend response could not be read.',
      );
    }

    if (BODILESS_STATUSES.has(response.status)) {
      // 204/205 carry no body by definition; anything sent anyway is dropped.
      return { ok: true, status: response.status, bodyText: '' };
    }

    const contentType = response.headers.get('content-type');
    if (expectCsv && response.ok && isCsvContentType(contentType)) {
      // A CSV with no matching sales is still a valid, header-only export.
      return { ok: true, status: response.status, bodyText };
    }

    if (bodyText === '') {
      // An empty 200 used to pass through and surface in the browser as an
      // undefined payload, which crashes the caller instead of failing here.
      return invalidResponse('The POS backend returned an empty response.');
    }
    if (!isJsonContentType(contentType)) {
      return invalidResponse('The POS backend returned a non-JSON response.');
    }

    return { ok: true, status: response.status, bodyText };
  } finally {
    clearTimeout(timer);
  }
}

/** Parses an upstream JSON body, returning undefined when it is not usable. */
export function parseJsonBody(bodyText: string): unknown {
  if (bodyText === '') return undefined;
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}
