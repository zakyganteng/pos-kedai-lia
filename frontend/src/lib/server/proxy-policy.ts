/**
 * Allowlist policy for the /api/pos/[...path] proxy.
 *
 * The proxy is deliberately not generic. Only the read endpoints the POS UI
 * needs, checkout creation, and the explicitly scoped category-management
 * writes are reachable; everything else (webhooks, users, CSV export) returns 404
 * from this app. A generic pass-through would let any authenticated browser
 * session reach every backend route and would turn the Next server into an
 * SSRF relay for whatever path the client supplied.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;

export const SALE_STATUSES = ['pending_payment', 'paid', 'cancelled', 'voided'] as const;

/** A path pattern: literal segments, or ":uuid" for a UUID path parameter. */
type PathPattern = readonly string[];

const GET_PATHS: readonly PathPattern[] = [
  ['products'],
  ['services'],
  ['customers'],
  ['staff'],
  ['inventory'],
  ['sales'],
  ['sales', ':uuid'],
  ['payments', ':uuid'],
  ['integrations'],
  ['categories'],
  ['categories', ':uuid'],
];

const WRITE_PATHS: Record<string, readonly PathPattern[]> = {
  POST: [['sales'], ['categories']],
  PATCH: [['categories', ':uuid'], ['products', ':uuid']],
  DELETE: [['categories', ':uuid']],
};

type QueryValidator = (value: string) => boolean;

const isUuid: QueryValidator = (v) => UUID_RE.test(v);
const isBoolean: QueryValidator = (v) => v === 'true' || v === 'false';
const isDate: QueryValidator = (v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const isSearch: QueryValidator = (v) => v.length > 0 && v.length <= 100;
const isSaleStatus: QueryValidator = (v) => (SALE_STATUSES as readonly string[]).includes(v);

function boundedInt(min: number, max: number): QueryValidator {
  return (value) => {
    if (!/^\d{1,7}$/.test(value)) return false;
    const n = Number(value);
    return n >= min && n <= max;
  };
}

/**
 * Query parameters the proxy will forward, with the bounds from openapi.yaml.
 * Anything not listed is rejected rather than silently dropped, so a UI bug
 * that sends an unexpected filter fails loudly instead of returning data the
 * user did not ask for.
 */
const QUERY_PARAMS: Record<string, QueryValidator> = {
  businessLineId: isUuid,
  page: boundedInt(1, 1_000_000),
  limit: boundedInt(1, 100),
  search: isSearch,
  active: isBoolean,
  lowStock: isBoolean,
  productId: isUuid,
  categoryId: isUuid,
  uncategorized: isBoolean,
  status: isSaleStatus,
  from: isDate,
  to: isDate,
};

export interface ProxyRejection {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface ProxyTarget {
  ok: true;
  /** Backend path, relative to the API base URL, e.g. "/sales/<uuid>". */
  path: string;
  query: Array<[string, string]>;
  /** True when the request mutates backend state. */
  mutation: boolean;
}

export type ProxyDecision = ProxyTarget | ProxyRejection;

function matches(pattern: PathPattern, segments: string[]): boolean {
  if (pattern.length !== segments.length) return false;
  return pattern.every((part, i) => (part === ':uuid' ? UUID_RE.test(segments[i]) : part === segments[i]));
}

export function isPathAllowed(method: string, segments: string[]): boolean {
  const patterns = method === 'GET' ? GET_PATHS : WRITE_PATHS[method] ?? [];
  return patterns.some((pattern) => matches(pattern, segments));
}

/** Validates and normalizes query parameters against the allowlist. */
export function resolveQuery(params: URLSearchParams): Array<[string, string]> | ProxyRejection {
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const [name, value] of params.entries()) {
    const validator = QUERY_PARAMS[name];
    if (!validator) {
      return {
        ok: false,
        status: 400,
        code: 'QUERY_PARAM_NOT_ALLOWED',
        message: `Query parameter "${name}" is not accepted by this endpoint.`,
      };
    }
    if (seen.has(name)) {
      return {
        ok: false,
        status: 400,
        code: 'QUERY_PARAM_REPEATED',
        message: `Query parameter "${name}" was supplied more than once.`,
      };
    }
    if (!validator(value)) {
      return {
        ok: false,
        status: 400,
        code: 'QUERY_PARAM_INVALID',
        message: `Query parameter "${name}" has an unacceptable value.`,
      };
    }
    seen.add(name);
    out.push([name, value]);
  }

  return out;
}

export function resolveProxyRequest(
  method: string,
  segments: string[],
  params: URLSearchParams,
): ProxyDecision {
  const upper = method.toUpperCase();

  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(upper)) {
    return {
      ok: false,
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
      message: `${upper} is not supported by the POS proxy.`,
    };
  }

  if (
    segments.length === 0 ||
    segments.length > 4 ||
    segments.some((s) => s === '' || s === '.' || s === '..' || /[^A-Za-z0-9._-]/.test(s))
  ) {
    return {
      ok: false,
      status: 404,
      code: 'ROUTE_NOT_ALLOWED',
      message: 'This API route is not available through the POS proxy.',
    };
  }

  if (!isPathAllowed(upper, segments)) {
    return {
      ok: false,
      status: 404,
      code: 'ROUTE_NOT_ALLOWED',
      message: 'This API route is not available through the POS proxy.',
    };
  }

  if ((params.has('categoryId') || params.has('uncategorized')) && (upper !== 'GET' || segments.join('/') !== 'products')) {
    return { ok: false, status: 400, code: 'QUERY_PARAM_NOT_ALLOWED', message: 'Category filters apply only to product listing.' };
  }
  if (params.has('categoryId') && params.has('uncategorized')) {
    return { ok: false, status: 400, code: 'QUERY_PARAM_INVALID', message: 'Choose a category or uncategorized products, not both.' };
  }

  const query = resolveQuery(params);
  if (!Array.isArray(query)) return query;

  return {
    ok: true,
    path: `/${segments.join('/')}`,
    query,
    mutation: upper !== 'GET',
  };
}

export function isValidIdempotencyKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_RE.test(value);
}
