# POS implementation completion record

## Scope

This record covers the POS described by `../../prd-task/PRD.md`, implemented in `project/`. The interrupted session was resumed using the existing code and `IMPLEMENTATION.md` handoff; it was not replaced with a new implementation.

The standalone gateway described by `PRD-mock-payment-gateway.md` remains a separate project. POS-side adapters and deterministic test-only HTTP doubles are included; a deployed gateway service is not.

**Status: POS implementation and local automated verification complete, 2026-09-30.** The checks below passed against the resumed source. This is a development/test completion record, **not production approval**: real-provider integration, owner/staff UAT and hosting-environment gates remain external.

**Update 2026-11-05:** the Next.js frontend, its unit/Playwright tests, the browser test runner, the frontend and browser CI jobs, and `DESIGN.md` were removed so the frontend can be rewritten. Frontend entries in this record (traceability, verification rows and the `frontend/docs/*` evidence files) describe that removed implementation and no longer exist in this tree. Current stack verification is in [OPERATIONS.md](OPERATIONS.md#verification-evidence).

**Update 2026-11-09:** a new core Next.js frontend has been built in `frontend/`, using the Boutique Lia direction in `design.md`. It includes login, business switching, checkout, payment status, and receipts, not the historical full management UI. The new build passed 127 unit tests, 9 browser/integration scenarios, TypeScript, ESLint, production build, and Docker startup. Current frontend evidence is in [FRONTEND-VERIFICATION.md](FRONTEND-VERIFICATION.md); the older frontend paths and results below remain historical.

## Feature traceability

| Feature | Implementation | Verification locations |
| --- | --- | --- |
| F01 Identity, roles, business-line isolation | Backend service/transport/session repository; frontend login, protected shell and same-origin cookie proxy | Backend service/transport tests; API authorization scenarios; frontend proxy tests and `e2e/safety.spec.ts` |
| F02 Product/service catalog | Line-scoped catalog CRUD/archive, immutable sale snapshots; frontend catalog workspace | Backend PostgreSQL tests; API CRUD/snapshot scenarios; browser operations |
| F03 Inventory | Audited immutable stock ledger, reservations for pending QRIS, transactional cash/confirmed-QR debits | API concurrent checkout/reservation tests; backend ledger/constraint tests; inventory browser workflow |
| F04 Customers and staff | Scoped directories, normalized optional customer phone, archive retention and salon staff attribution | API directory/reference tests; frontend checkout lookups and directory workflows |
| F05 Checkout and sales | Server-calculated integer IDR totals, snapshot receipts, scoped idempotency, external QR intents and status polling | API cash/QR/idempotency/timeout cases; frontend unit tests and browser lost-response replay |
| F06 Webhooks/reconciliation | Exact-body HMAC adapter, deduplicated validated events, terminal-state policy, recovery and sanitized review history | API invalid/replayed/mismatched/late/early callbacks; backend provider/recovery tests |
| F07 Notifications | Transactional logical notification, persisted outbox, bounded retries, sanitized delivery history; disabled delivery never reports sent | Backend notification tests; API unavailable-provider and retry scenarios; browser notification history |
| F08 Reports | Confirmed-sales aggregation by day/method/item/staff, bounded timezone-aware filters, CSV and inventory views | API independently reconciled aggregates/CSV; backend reporting tests; browser report/export workflow |
| F09 Salon queue | Daily concurrent-safe numbering, validated transitions, optional customer/staff and confirmed-sale linkage | API queue concurrency/transition/link tests; backend queue tests; browser queue board |
| F10 Operations | Controlled migrations/provisioning, health/readiness, graceful shutdown, non-root Docker stack, backup/restore scripts and CI | Config/shell checks, real-image stack rehearsal, backup/restore/persistence rehearsal |
| FR12 API contract | Maintained `project/openapi.yaml`, generated frontend types | OpenAPI lint, generated-type drift check and frontend typecheck |

Detailed scenario definitions and owner/staff UAT cases are in [TEST-PLAN.md](TEST-PLAN.md). Deployment and restore evidence belongs in [OPERATIONS.md](OPERATIONS.md).

## Resumption work

The continuation closed these gaps:

- Added validated server-side `NOTIFICATION_TEMPLATE` configuration (`{{saleId}}`, `{{total}}`, `{{businessLineId}}`). Existing outbox jobs preserve their original rendered text and destination across retries; masked retry metadata describes the destination actually queued.
- Made frontend business-timezone formatting and date defaults runtime-configurable, matching the backend. Fixed the inclusive report-date bound across daylight-saving changes.
- Implemented reconciliation search across the full authorized history and explicit `outcome` filtering, with filtered pagination totals.
- Accepted and validated optional `provider: mock` metadata at the external gateway boundary; omitted metadata remains compatible.
- Fixed a receipt-refresh race that could resurrect a completed order after opening a new checkout.
- Added queue pagination/status controls so walk-ins beyond the first page are not silently hidden.
- Aligned OpenAPI pagination, input bounds, errors and provider-boundary documentation; regenerated frontend types and removed unsupported refund status controls.
- Extended public-API coverage for inventory reports, user lifecycle/session revocation, filtering and configured notification delivery/retry.
- Added a disposable Docker browser-test runner and CI browser job, shared timezone configuration and notification-template deployment checks.

Schema version is **3**. Existing development databases must run the normal controlled `pos migrate` step (the Compose backend runs it on every start) before readiness succeeds; no existing database was reset for verification.

## Verification results

The coordinator independently ran these checks against the completed working tree. Test databases and Compose projects were disposable and removed by their runners.

| Check | Observed result |
| --- | --- |
| Backend formatting, module verification, `go vet ./...` | Passed |
| `TEST_DATABASE_URL=postgres:///postgres go test -race -count=1 ./...` | Passed, including real PostgreSQL integration tests; no integration-test skip |
| `node --test project/tests/support.test.mjs` | **4 passed**, zero failed/skipped |
| `QA_API_PORT=18101 QA_GATEWAY_PORT=19101 node project/tests/run.mjs` | **93 API + 9 notification assertions passed**, zero failed/skipped; both databases dropped |
| Frontend `npm run typecheck`, `npm run lint`, `npm test` | Passed; **52 tests in 8 files** |
| Frontend `npm audit --audit-level=high` | **0 vulnerabilities** at verification time |
| OpenAPI lint | Valid, **0 errors**; one intentional localhost-server warning |
| Generate API types into a temporary file and compare with the checked-in generated file | Byte-identical |
| Shell syntax and deployment config tests | Passed; **7 config tests** |
| `make env config build` with a temporary private environment | Both production runtime images built successfully |
| `scripts/test-stack.sh` | Passed: repeated migrations, readiness, runtime role/non-root protections, owner provisioning, cookie/Origin/session behavior, non-default timezone, template validation, full-schema backup/restore |
| `scripts/test-backup-restore.sh` | Passed: checksum, safe new-database restore, target/corruption refusal, runtime-role access and restart persistence |
| `BROWSER_SKIP_INSTALL=1 ./scripts/test-browser.sh` | Rebuilt latest images and **3/3 Playwright scenarios passed** against a newly seeded isolated PostgreSQL stack |

The authoritative browser run completed at `2026-09-30T10:54:41Z`. It exercised 12 workspaces at 360px, 768px and 1440px, checked overflow, 44px visible interactive targets and keyboard/dialog behavior, and recorded no unexpected page/React console errors. It also verified lost-response checkout replay and cashier/session restrictions.

Evidence: `frontend/docs/browser-evidence.json`, `frontend/docs/idempotency-evidence.json`, `frontend/docs/authorization-evidence.json` and `frontend/docs/screenshots/`. Browser verification used disabled production integrations; signed QRIS and notification-provider behavior were exercised separately through deterministic HTTP boundaries in the API tests. No real bank transfer or WhatsApp delivery is claimed.

An earlier frontend audit run against a reused test database did not pass; the final isolated Docker run is the recorded acceptance result. Provider-side worker interruptions were recovered without discarding saved code. See `TEST-PLAN.md` for deliberately bounded follow-up fault scenarios; passing this suite is not exhaustive security/load testing.

## External release gates — not completed by automated tests

- Select and implement a real QRIS vendor adapter and verify its sandbox/signature/expiry semantics. The development mock is not real QRIS.
- Select the WhatsApp vendor and approve templates, destination/consent rules and delivery/idempotency semantics. The generic HTTP test adapter is not vendor certification.
- Obtain owner approval of account/line assignments, receipts, refund/void policy and expense/cost-basis semantics. Reports currently show revenue, not net profit; refund money movement is intentionally absent.
- Run owner/staff UAT for both businesses, including the under-ten-minute reconciliation target and actual operating devices/volume.
- Configure production HTTPS, immutable releases, secret rotation, monitoring, encrypted off-host backup schedules and owner-approved retention/recovery objectives.
- Rehearse restore in the actual hosting environment. A disposable local Docker rehearsal is not staging/production signoff.
- Execute CI on the actual hosted repository. Local equivalents do not prove that a GitHub-hosted workflow has run.
