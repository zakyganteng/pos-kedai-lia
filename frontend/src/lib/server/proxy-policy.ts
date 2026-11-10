/**
 * Allowlist policy for the /api/pos/[...path] proxy.
 *
 * The proxy is deliberately not generic. Each browser-reachable backend
 * operation from openapi.yaml is listed below with the exact query parameters
 * it accepts. Everything else (provider webhooks, auth endpoints that are
 * served by /api/session, unknown paths) returns 404 from this app. A generic
 * pass-through would turn the Next server into an SSRF relay for whatever path
 * the client supplied.
 *
 * Role checks stay in the backend: the proxy only decides which routes exist,
 * never who may call them.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;

export const SALE_STATUSES = ['pending_payment', 'paid', 'cancelled', 'voided'] as const;
export const QUEUE_STATUSES = ['waiting', 'in_service', 'completed', 'cancelled'] as const;
export const NOTIFICATION_STATUSES = ['queued', 'sent', 'failed'] as const;
export const REPORT_GROUPS = ['day', 'paymentMethod', 'item', 'staff'] as const;
export const RECONCILIATION_OUTCOMES = [
  'applied',
  'duplicate_state',
  'mismatch',
  'terminal_conflict',
  'unmatched',
  'stale',
  'unresolved',
] as const;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** A path pattern: literal segments, or ":uuid" for a UUID path parameter. */
type PathPattern = readonly string[];

type QueryValidator = (value: string) => boolean;

const isUuid: QueryValidator = (v) => UUID_RE.test(v);
const isBoolean: QueryValidator = (v) => v === 'true' || v === 'false';
const isDate: QueryValidator = (v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const isSearch: QueryValidator = (v) => v.length > 0 && v.length <= 100;
const oneOf =
  (values: readonly string[]): QueryValidator =>
  (v) =>
    values.includes(v);

function boundedInt(min: number, max: number): QueryValidator {
  return (value) => {
    if (!/^\d{1,7}$/.test(value)) return false;
    const n = Number(value);
    return n >= min && n <= max;
  };
}

/** Shared validators, bounded as in openapi.yaml. */
const Q = {
  businessLineId: isUuid,
  page: boundedInt(1, 1_000_000),
  limit: boundedInt(1, 100),
  search: isSearch,
  active: isBoolean,
  lowStock: isBoolean,
  productId: isUuid,
  categoryId: isUuid,
  uncategorized: isBoolean,
  from: isDate,
  to: isDate,
  date: isDate,
} satisfies Record<string, QueryValidator>;

const PAGED = { businessLineId: Q.businessLineId, page: Q.page, limit: Q.limit };
const LINE = { businessLineId: Q.businessLineId };

type QuerySpec = Readonly<Record<string, QueryValidator>>;

export interface RouteSpec {
  method: Method;
  pattern: PathPattern;
  query: QuerySpec;
  /** Requires a client-supplied X-Idempotency-Key, forwarded upstream. */
  idempotent?: boolean;
  /** The upstream answers with text/csv rather than JSON. */
  csv?: boolean;
}

const route = (
  method: Method,
  path: string,
  query: QuerySpec = {},
  flags: { idempotent?: boolean; csv?: boolean } = {},
): RouteSpec => ({ method, pattern: path.split('/').filter((s) => s !== ''), query, ...flags });

/**
 * Every browser-reachable operation. `/auth/*` lives behind /api/session and
 * the provider webhook is server-to-server only, so neither appears here.
 */
export const ROUTES: readonly RouteSpec[] = [
  route('GET', 'business-lines'),

  // Catalog: products (kedai) and services (salon)
  route('GET', 'products', {
    ...PAGED,
    search: Q.search,
    active: Q.active,
    categoryId: Q.categoryId,
    uncategorized: Q.uncategorized,
  }),
  route('POST', 'products', LINE),
  route('GET', 'products/:uuid'),
  route('PATCH', 'products/:uuid'),
  route('DELETE', 'products/:uuid'),

  route('GET', 'categories', { ...PAGED, search: Q.search, active: Q.active }),
  route('POST', 'categories', LINE),
  route('GET', 'categories/:uuid'),
  route('PATCH', 'categories/:uuid'),
  route('DELETE', 'categories/:uuid'),

  route('GET', 'services', { ...PAGED, search: Q.search, active: Q.active }),
  route('POST', 'services', LINE),
  route('GET', 'services/:uuid'),
  route('PATCH', 'services/:uuid'),
  route('DELETE', 'services/:uuid'),

  // Customers and staff
  route('GET', 'customers', { ...PAGED, search: Q.search, active: Q.active }),
  route('POST', 'customers', LINE),
  route('GET', 'customers/:uuid'),
  route('PATCH', 'customers/:uuid'),
  route('DELETE', 'customers/:uuid'),

  route('GET', 'staff', { ...PAGED, search: Q.search, active: Q.active }),
  route('POST', 'staff', LINE),
  route('GET', 'staff/:uuid'),
  route('PATCH', 'staff/:uuid'),
  route('DELETE', 'staff/:uuid'),

  // Inventory
  route('GET', 'inventory', { ...PAGED, lowStock: Q.lowStock }),
  route('GET', 'inventory/movements', { ...PAGED, productId: Q.productId }),
  route('POST', 'inventory/movements', LINE),

  // Sales and payments
  route('GET', 'sales', { ...PAGED, from: Q.from, to: Q.to, status: oneOf(SALE_STATUSES) }),
  route('POST', 'sales', LINE, { idempotent: true }),
  route('GET', 'sales/:uuid'),
  route('POST', 'sales/:uuid/void'),
  route('GET', 'payments/reconciliation', {
    ...PAGED,
    search: Q.search,
    outcome: oneOf(RECONCILIATION_OUTCOMES),
  }),
  route('GET', 'payments/:uuid'),

  // Notifications
  route('GET', 'notifications', { ...PAGED, status: oneOf(NOTIFICATION_STATUSES) }),
  route('POST', 'notifications/:uuid/retry'),

  // Reports
  route('GET', 'reports/sales', {
    ...LINE,
    from: Q.from,
    to: Q.to,
    groupBy: oneOf(REPORT_GROUPS),
  }),
  route('GET', 'reports/inventory', { ...LINE, lowStock: Q.lowStock }),
  route('GET', 'reports/sales.csv', { ...LINE, from: Q.from, to: Q.to }, { csv: true }),

  // Salon queue
  route('GET', 'salon/queue', { ...PAGED, date: Q.date, status: oneOf(QUEUE_STATUSES) }),
  route('POST', 'salon/queue', LINE, { idempotent: true }),
  route('PATCH', 'salon/queue/:uuid'),

  // Owner administration
  route('GET', 'users', { page: Q.page, limit: Q.limit, search: Q.search }),
  route('POST', 'users'),
  route('GET', 'users/:uuid'),
  route('PATCH', 'users/:uuid'),
  route('DELETE', 'users/:uuid'),
  route('GET', 'integrations'),

  // Health probes, shown on the owner's system screen
  route('GET', 'health/live'),
  route('GET', 'health/ready'),
];

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
  /** The client must supply an X-Idempotency-Key that is forwarded upstream. */
  idempotent: boolean;
  /** Upstream answers with CSV rather than JSON. */
  csv: boolean;
}

export type ProxyDecision = ProxyTarget | ProxyRejection;

function matches(pattern: PathPattern, segments: string[]): boolean {
  if (pattern.length !== segments.length) return false;
  return pattern.every((part, i) => (part === ':uuid' ? UUID_RE.test(segments[i]) : part === segments[i]));
}

export function findRoute(method: string, segments: string[]): RouteSpec | null {
  const upper = method.toUpperCase();
  return ROUTES.find((spec) => spec.method === upper && matches(spec.pattern, segments)) ?? null;
}

export function isPathAllowed(method: string, segments: string[]): boolean {
  return findRoute(method, segments) !== null;
}

/**
 * Validates and normalizes query parameters against a route's allowlist.
 * Without a spec, the union of every route's parameters is used; that form
 * exists for unit tests of the individual validators.
 */
export function resolveQuery(
  params: URLSearchParams,
  spec?: QuerySpec,
): Array<[string, string]> | ProxyRejection {
  const allowed: QuerySpec = spec ?? ALL_QUERY;
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const [name, value] of params.entries()) {
    const validator = Object.hasOwn(allowed, name) ? allowed[name] : undefined;
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

/** Union of the per-route specs, with `status` accepting any known status. */
const ALL_QUERY: QuerySpec = {
  ...Q,
  status: oneOf([...SALE_STATUSES, ...QUEUE_STATUSES, ...NOTIFICATION_STATUSES]),
  groupBy: oneOf(REPORT_GROUPS),
  outcome: oneOf(RECONCILIATION_OUTCOMES),
};

const NOT_ALLOWED: ProxyRejection = {
  ok: false,
  status: 404,
  code: 'ROUTE_NOT_ALLOWED',
  message: 'This API route is not available through the POS proxy.',
};

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
    return NOT_ALLOWED;
  }

  const spec = findRoute(upper, segments);
  if (spec === null) return NOT_ALLOWED;

  if (params.has('categoryId') && params.has('uncategorized')) {
    return { ok: false, status: 400, code: 'QUERY_PARAM_INVALID', message: 'Choose a category or uncategorized products, not both.' };
  }

  const query = resolveQuery(params, spec.query);
  if (!Array.isArray(query)) return query;

  return {
    ok: true,
    path: `/${segments.join('/')}`,
    query,
    mutation: upper !== 'GET',
    idempotent: spec.idempotent === true,
    csv: spec.csv === true,
  };
}

export function isValidIdempotencyKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_RE.test(value);
}
