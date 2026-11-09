# Implementation contract and ownership

## Scope
Implement prd-task/PRD.md in project/backend (Go) using PostgreSQL. project/openapi.yaml starts as the supplied OpenAPI 3.1 contract. The external mock gateway is NOT implemented or bundled. Unknown production vendors remain explicit release dependencies; no fake successful payments or notifications.

**2026-11-05:** the Next.js frontend, its browser tests and `DESIGN.md` were removed so the frontend can be rewritten. Frontend references in the historical sections below describe the removed implementation.

## Architecture
Backend: HTTP transport -> application services -> domain rules/repository interfaces -> PostgreSQL repositories and provider adapters. Separate packages, constructor dependency injection, no SQL in handlers, no HTTP in domain. Use Go stdlib HTTP and pgx, bcrypt passwords. UTC storage, Asia/Jakarta default reporting timezone, integer IDR with bounded/overflow-safe arithmetic.
Frontend: Next.js App Router + TypeScript in `frontend/`, rebuilt for core POS on 2026-11-09 using Boutique Lia (`design.md`). HTTP-only session cookies and an allowlisted same-origin proxy keep bearer tokens out of JavaScript-readable storage. Drafts and frozen checkout attempts use user/business-scoped sessionStorage; unknown outcomes retain the original request key/body. Login, Kasir, Struk, and owner/admin Katalog are the approved routes. Katalog supports kedai category management and product assignment; other management UI remains later-stage work. See [FRONTEND-VERIFICATION.md](FRONTEND-VERIFICATION.md) for current runtime evidence.

## Kedai categories

Additive schema version 4 permits `categories` records and nullable product `categoryId` references. Categories are food/beverage-line scoped, names are unique per line after case/whitespace normalization, and all references are canonical UUIDs. Owners/admins manage categories and assignments; assigned cashiers can read/filter. Archive requires no assigned products, including inactive products, and shared/exclusive row locks plus database constraints prevent archive/assignment races. Existing imported MENU-F/MENU-D products gain Makanan/Minuman categories once; Snack starts empty. Replay never resets category edits or assignments. See [CATEGORY-VERIFICATION.md](CATEGORY-VERIFICATION.md).

## Safety decisions
- Owner manages users/integration status; admin manages operational resources; cashier checks out, creates/looks up customers, operates queue and reads operational stock/sales. Cashier denied staff administration, inventory mutations, catalog mutations, notifications and reports beyond permitted operational totals.
- Every line record reference is checked for caller membership and expected line type. Products only food_beverage; services/queue only salon.
- No refund/void money movement endpoint until owner approves policy and real provider supports it. No dishonest stock reversal. Pending failed/expired QR payments cancel sale and release any stock reservation exactly once; confirmed sales cannot be cancelled via browser.
- QR stock is reserved transactionally before provider call so pending concurrent intents cannot oversell; report on-hand and reservation semantics documented. Cash stock decremented and ledger recorded in same sale transaction.
- Persist idempotency key + request fingerprint scoped to user/line/operation. Retries replay original result; changed request with same key returns 409. QR provider intent calls reuse stable sale identity and provider idempotency key.
- Normalized webhook adapter for EXTERNAL mock service: HMAC SHA256 exact body in X-Webhook-Signature (hex, optional sha256= prefix), X-Idempotency-Key equal to eventId; JSON eventId/paymentId/merchantReference/amount/currency/status/occurredAt, provider mock; succeeded maps to confirmed. Reject amount/currency/reference mismatch; store sanitized reconciliation metadata. Conflicting/late terminal events retained for admin review, never silently reopen terminal payment.
- Payment/WhatsApp production adapters are not vendor compatibility claims. External mock adapter allowed only non-production. Provider credentials env-only. Disabled WhatsApp records observable undelivered/failed status rather than fabricating sent.
- Expenses/net profit deferred pending accounting policy. Report confirmed sales only, not profit. Max inclusive report range 366 days.
- Secure sessions: revocable expiring server session, short-lived access, refresh only if actually implemented safely; API spec updated for chosen token format if opaque sessions. Login rate limiting, request size caps, strict JSON, structured sanitized errors/logs, health/readiness and graceful shutdown.

## Original-session ownership (historical handoff)

The following assignments describe the interrupted session, not running processes or prerequisites for development. Temporary design-skill paths and `DESIGN.md` mentioned here are historical; `DESIGN.md` was removed with the frontend.

1. backend-sol: owns all project/backend code/schema/tests and project/openapi.yaml contract extensions. Implement F01-F09. Dockerfile comes from infra agent. Communicate chosen commands/env to coordinator early. Complete tests, not stubs.
2. frontend-sol: owns all project/frontend except Dockerfile. Full operational UI against contract; generated types from project/openapi.yaml; real API only. Read DESIGN.md and /tmp/tio-anti-slop/skills/{antislop,antislop-ui,antislop-human,antislop-layoutmobile}/SKILL.md fully. During mode and owner direction already resolved; no installer wizard/global changes. Do not mutate spec, request needed additions from backend/coordinator. Production build and frontend tests.
3. infra-astra: owns project/compose.yaml, project/{frontend,backend}/Dockerfile, project/.env.example, project/Makefile, project/.dockerignore, project/scripts/*, project/docs/OPERATIONS.md, project/.github/* and root .github workflow if needed. Coordinate backend startup commands; no code changes.
4. qa-astra: owns project/tests/* and project/docs/TEST-PLAN.md only. Build API black-box test suite with isolated DB assumptions, security negatives, checkout idempotency, stock concurrency, webhook signatures/replay/mismatch, queue transitions/number concurrency and report reconciliation. No backend or frontend edits. Coordinate fixture/env/commands with backend.
Coordinator owns this plan, DESIGN.md, README and readiness evidence, integration review and fixes after ownership handoffs.

## Resumption ownership and outcome

The continuation is complete for local development/test verification; see [COMPLETION.md](COMPLETION.md) for final observed results and external production gates. Provider-side worker interruptions were recovered from the saved files, and the coordinator independently ran the backend, API, frontend, Docker and browser checks.

The continuation preserves the existing architecture and implementation rather than restarting it. Edits are split to avoid conflicting writes:

- `resume-backend`: backend implementation and its unit/PostgreSQL tests (excluding Dockerfile).
- `resume-frontend`: frontend implementation, generated API types and browser tests (excluding Dockerfile).
- `resume-qa`: independent public-API tests and `TEST-PLAN.md`.
- `resume-ops`: Compose, Dockerfiles, scripts, CI and `OPERATIONS.md`; `ops-final` assisted the evidence handoff, and the coordinator completed independent deployment/browser verification.
- `resume-contract`: `project/openapi.yaml`; frontend regenerates types after contract changes.
- Coordinator: cross-feature review, README, this handoff and final completion evidence.

The source brief in `prd-task/` is retained; `project/openapi.yaml` is the maintained implementation contract. Test databases and Compose projects must be newly created and disposable; an existing development database or server is not a test fixture.

## Verification
- Backend gofmt, go vet ./..., go test -race ./..., PostgreSQL integration tests.
- OpenAPI lint and dependency audit.
- Docker compose config and actual build/start where possible; verify isolated persistent PostgreSQL and backup/restore.
- Black-box API suite: login, line isolation, checkout/receipt, catalog, inventory, customer/staff, queue, reports/export and notification failure visibility; unauthorized and error responses.
- Record actual results and remaining release gates. Never equate build completion with real-provider approval or UAT.
