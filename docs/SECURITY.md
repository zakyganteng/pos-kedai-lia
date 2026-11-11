# Security model and production release checklist

## Trust boundaries

Clients call the Go API with an opaque bearer token returned by login. There is currently no frontend; a browser frontend added later must keep that token out of JavaScript-readable storage (for example, a same-origin proxy holding it in an HttpOnly cookie). A signed payment provider webhook enters Go separately. PostgreSQL holds credentials (bcrypt hashes), revocable sessions (token hashes), customer contact information, immutable sale snapshots and stock movements. Notification/provider adapters make outbound calls to operator-configured endpoints, never to client-supplied URLs.

## Assets and abuse cases

| Asset/boundary | Threat | Required control and verification |
| --- | --- | --- |
| User password/session | Impersonation, token theft, brute force | Bcrypt, cryptographic token, hash at rest, bounded expiry/revocation, rate-limited login, generic login errors. |
| Business-line data | Cashier reads or sells another line | Membership checks on lists and every referenced ID; restricted-line fixture tests. |
| Administrative actions | Cashier changes price, stock, users or secrets | Server-side role checks; API denies requests even if client navigation is bypassed. |
| Checkout | Tampered amount, retry double booking, stock races | Server loads active catalog prices, immutable snapshots, bounded integer arithmetic, transaction/locks, payload-fingerprinted idempotency, concurrency tests. |
| Webhook | Forged success, changed amount, repeated/out-of-order event | Mock exact-body HMAC; Borderpay timing-safe token verification plus authenticated status lookup and project/mode/amount checks. Transactional event deduplication and reconciliation history. Borderpay late paid after expiry requires available stock and atomic fulfillment. |
| Customer contact data | Injection or unintended disclosure | Strict validated JSON, parameterized SQL, line scope, minimal response fields, role restrictions, no raw payloads in logs. |
| Cross-origin browser request | Cross-site request forgery, token theft | API accepts bearer credentials only, never ambient cookies, and sends no CORS headers. A future cookie-based frontend must add SameSite cookies and same-origin mutation Origin validation. |
| Provider transport | SSRF, token leakage, false provider response | Operator-only configured endpoints, no client-controlled URLs, timeouts/bounded bodies/no secret logs. TLS in production. Mock adapter refused in production. |
| Outbox | Duplicate notifications, stuck jobs | Unique logical sale notification, transactional enqueue, leased/locked worker claiming, bounded retries and visible failure. External exactly-once delivery requires vendor idempotency support. |
| HTTP/CSV | DoS, XSS, spreadsheet formulas | Request size and query bounds, timeouts, security headers, CSV formula neutralization on text columns. A future frontend must escape API data and avoid raw HTML. |

## Production gates

Application build/test evidence does not authorize a live deployment. Before real transactions:

- Validate the implemented Borderpay adapter with the merchant's own sandbox project: retries, token-authenticated public webhook delivery, terminal states, expiry/reconciliation, and actual QRIS payload acceptance. Local HTTP doubles do not prove provider acceptance.
- Select the WhatsApp provider, approved templates, destination rules and consent requirements. Verify provider idempotency and delivery status. Disabled or unavailable delivery must not report success.
- Agree owner/Admin/Cashier assignments and line membership. Replace the default owner credentials (`owner@owner.com` / `owner-password-123`, published in this repository) with a unique secret before go-live.
- Approve refund/void/stock reversal policy before exposing money-moving refund actions. No automatic refunds are implemented solely from a browser request.
- Approve expense categories/cost basis before reporting net profit; current reports are revenue, not profit.
- Terminate HTTPS at a trusted reverse proxy, use secure cookies, private database networking and restricted ingress. Rotate database/provider credentials, do not publish backend or database ports unnecessarily.
- Specify retention and recovery objectives with the owner. Encrypt/restrict backup storage, schedule backups and test restoration in staging.
- Run owner/staff UAT with realistic counter workflows, devices and operating-day volume. Confirm receipts/timezone and reconciliation under 10 minutes.
- Review dependency audits, access logs, incident contacts and operational alert thresholds. Full penetration testing is not claimed.

## Logging and incidents

Log request ID, route, status, duration and sanitized operation identifiers. Never log credentials, bearer/cookie headers, webhook signatures, complete provider payloads, passwords or customer phone numbers. Errors returned to clients must not include SQL details or stack traces. If a credential is exposed, revoke/rotate it immediately; removing the file is not sufficient.
