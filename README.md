# Lia POS

A shared counter POS for Kedai Lia 287 and Lia Salon, built with a Next.js + TypeScript frontend, Go API, and PostgreSQL. `openapi.yaml` is the versioned API contract; implementation and verification notes are in `docs/`. The frontend uses the Boutique Lia theme from [design.md](design.md) and covers every browser-facing API operation: checkout, receipts and voids, salon queue, reports with CSV export, stock, catalog (products, categories, services), customers, notifications, payment reconciliation, user administration and system status. Navigation is filtered by role and business-line type, matching the backend's own checks.

## Layout

```text
project/
  backend/       Go API, application/domain layers, PostgreSQL adapters and migrations
  frontend/      Next.js App Router POS, same-origin session/API routes, browser and unit tests
  tests/         Independent API black-box tests and test-only provider doubles
  data/          Supplied food/drink menu and prices for repeatable catalog import
  docs/          Architecture, security, operations and verification evidence
  compose.yaml   Local stack: PostgreSQL (db) + Go API (backend) + Next.js (frontend)
  Makefile       make dev / down / logs / psql / backup / restore / test
  openapi.yaml   OpenAPI 3.1 contract
```

QRIS supports Borderpay through a server-side adapter. The optional standalone mock payment gateway remains an external development dependency. Tests use deterministic HTTP doubles that do not collect money or generate real QRIS.

## Start locally with Docker

Requires Docker with Compose v2 and Make (`curl` for the examples below).

```sh
cd project
make dev
```

This builds the backend/frontend images and starts PostgreSQL, the API, and Next.js from `compose.yaml`; the backend applies migrations every time it starts. No `.env` file or prompt is needed: the POS is at **http://localhost:3000**, and the API is at **http://127.0.0.1:8080/api/v1**. The first migration creates the two business lines and one owner account, **`owner@owner.com` / `owner-password-123`**; there is no other sample data. Once any user exists, re-running migrations never recreates that owner or resets its password. Change the password before real use.

```sh
curl -s http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@owner.com","password":"owner-password-123"}'
# Send the returned accessToken as: Authorization: Bearer <token>
```

Only an active owner can add, change or disable users. Add a cashier with the owner's token (password 12-72 bytes, one or two business lines):

```sh
curl -s http://127.0.0.1:8080/api/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Kedai cashier","email":"cashier@example.test","password":"cashier-password-123","role":"cashier","businessLineIds":["11111111-1111-4111-8111-111111111111"]}'
```

Business line IDs: kedai `11111111-1111-4111-8111-111111111111`, salon `22222222-2222-4222-8222-222222222222`. Use `PATCH /api/v1/users/{id}` to change a user (including the owner's own password) and `DELETE /api/v1/users/{id}` to disable one.

PostgreSQL is at `127.0.0.1:5432`, database `pos`, user `postgres`, password `postgres` unless `.env` sets `POSTGRES_PASSWORD` (`make psql` opens a shell). To change ports, that password or provider settings, copy `.env.example` to `.env` and edit it; the password applies only when the database volume is first created.

All three ports bind to host loopback only: `FRONTEND_PORT` (default 3000), `BACKEND_PORT` (default 8080), and `DB_PORT` (default 5432). The API sends no CORS headers. Next.js provides a same-origin, allowlisted proxy; authentication tokens stay in HTTP-only cookies and are attached to Go requests on the server. Production deployment requires HTTPS.

Cash checkout works without integration credentials. QRIS supports `PAYMENT_PROVIDER=borderpay` with a project API key, slug, and webhook verification token; see [Borderpay setup and sandbox verification](docs/OPERATIONS.md#borderpay-qris). The existing cashier QRIS flow is unchanged. Notifications remain visibly undelivered until an adapter is configured. `make down` stops the stack without deleting its database volume; `docker compose down -v` deletes it, and the next `make dev` starts fresh with only the business lines and the default owner. See [operations](docs/OPERATIONS.md) for configuration, first-deployment owner setup, and backup/restore.

## Frontend development

Requires Node.js 24 and npm. With the Go API running:

```sh
cd frontend
npm ci
npm run dev
# Open http://127.0.0.1:3000
```

The server-only `POS_API_URL` defaults to `http://127.0.0.1:8080/api/v1`; see `frontend/.env.example`. Fonts are bundled locally rather than downloaded at runtime. There is no fabricated catalog data: an empty database produces an empty catalog. Owners/admins create and edit products, categories and salon services in Katalog. The supplied kedai menu is already imported into the original local database and classified as Makanan/Minuman; Snack starts empty for manual assignment. A fresh clone has no catalog records until you run the importer with `data/menu.md`; see `frontend/README.md`.

Verification commands:

```sh
make frontend-check  # TypeScript, ESLint, unit tests, production build
make frontend-e2e    # Chromium checks with a unique disposable DB and real Go API
```

Browser tests require the existing Docker DB/backend stack, Go, and Chromium. On macOS the runner uses installed Google Chrome; elsewhere run `cd frontend && npx playwright install chromium`. Tests use their own database and test-only provider boundary, not the existing POS database. See [frontend documentation](frontend/README.md) for scope, retry behavior, and verification details.

## Bruno API collection

The request collection is in `backend/bruno/`. Copy `backend/bruno/environments/local.example.bru` to `local.bru`, select that environment in Bruno, and run Login before authenticated requests. Local environment files can contain saved bearer tokens and are excluded from Git and Docker build contexts. The example has no token.

## Backend commands

From `project/backend`:

```sh
go build -o pos ./cmd/pos
# DATABASE_URL must point to a dedicated Lia POS database.
./pos migrate   # on an empty users table this also creates owner@owner.com
./pos serve
```

Configuration is environment-based. `HTTP_ADDR` defaults to `:8080`; timestamps are UTC and business reports default to `Asia/Jakarta`.

## Operational workflows

- Switch between assigned business lines without mixing records.
- Sell products at the kedai and services at the salon. Cash confirmation is atomic; QRIS remains pending until a verified provider confirmation.
- Receive/adjust tracked stock with a reason and movement ledger; concurrent sales must not oversell.
- Look up optional customers. Salon checkout and queues do not require staff records or attribution, matching kedai checkout.
- Manage daily salon walk-ins through waiting, in service, completed or cancelled states.
- Review confirmed-sales reports and export CSV. Revenue is not described as profit.
- Review notification delivery failures without blocking completed payments.

Cashier permissions are enforced by the API, not just navigation. Catalog/stock administration, user management and integration visibility are role restricted.

## Verification and operations

See [completion and PRD traceability](docs/COMPLETION.md) for scope, verification status and remaining release gates; `docs/IMPLEMENTATION.md` for architecture and invariant decisions; `docs/SECURITY.md` for threat boundaries; and `docs/OPERATIONS.md` for deployment/backup/restore commands. Detailed API and UAT scenarios are in `docs/TEST-PLAN.md`. No unrun checks are claimed.

## Before live production use

A production-shaped implementation is not a certified live payment system. Borderpay QRIS is implemented, but deployment still requires sandbox verification with the merchant's own project, webhook delivery through the actual HTTPS proxy, WhatsApp provider/templates/consent rules, owner-approved cancellation/accounting policies, staging backup restoration and successful owner/staff UAT. Defaults remain disabled; mock payments and generic HTTP notifications are development-only.
