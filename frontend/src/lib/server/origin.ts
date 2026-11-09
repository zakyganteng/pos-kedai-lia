/** Same-origin enforcement for cookie-authenticated mutation requests. */
export interface OriginCheckInput {
  method: string;
  origin: string | null;
  secFetchSite: string | null;
  selfOrigins: string[];
}
export type OriginCheckResult = { ok: true } | { ok: false; reason: string };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/** Public origins explicitly declared by the deployer, never forwarded headers. */
export function configuredAppOrigins(raw: string | undefined = process.env.POS_APP_ORIGIN): string[] {
  if (!raw) return [];
  return raw.split(',').flatMap(entry => {
    try {
      const url = new URL(entry.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return [];
      return [url.origin];
    } catch {
      return [];
    }
  });
}

/**
 * Next.js can normalize request.url to localhost even when the browser visits
 * 127.0.0.1. The HTTP Host authority identifies the browser's target, while
 * Origin identifies the initiator; browsers cannot set Host arbitrarily.
 * This is a CSRF comparison, not an authorization or trusted-host assertion.
 * A reverse proxy with a different public origin must set POS_APP_ORIGIN and
 * validate incoming Host itself. X-Forwarded-* is deliberately not consulted.
 */
export function selfOriginsFor(request: Request, configuredOrigins?: string[]): string[] {
  const configured = configuredOrigins ?? configuredAppOrigins();
  if (configured.length > 0) return configured;
  try {
    const url = new URL(request.url);
    const host = request.headers.get('host');
    if (!host) return [url.origin];
    // An authority only: never permit credentials, paths, whitespace or escapes.
    if (/[^A-Za-z0-9.\-:\[\]]/.test(host)) return [];
    const target = new URL(`${url.protocol}//${host}`);
    if (target.host.toLowerCase() !== host.toLowerCase() || target.username || target.password) return [];
    return [target.origin];
  } catch {
    return [];
  }
}

export function checkSameOrigin(input: OriginCheckInput): OriginCheckResult {
  if (isSafeMethod(input.method)) return { ok: true };
  const site = input.secFetchSite?.toLowerCase() ?? null;
  if (site !== null && site !== 'same-origin') return { ok: false, reason: `Sec-Fetch-Site is ${site}` };
  if (input.origin === null || input.origin === 'null') {
    if (site === null) return { ok: false, reason: 'missing Origin and Sec-Fetch-Site' };
    return { ok: true };
  }
  if (!input.selfOrigins.includes(input.origin)) return { ok: false, reason: 'Origin does not match this host' };
  return { ok: true };
}

export function checkRequestOrigin(request: Request): OriginCheckResult {
  return checkSameOrigin({
    method: request.method,
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    selfOrigins: selfOriginsFor(request),
  });
}
