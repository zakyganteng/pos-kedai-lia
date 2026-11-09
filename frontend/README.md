# Lia POS frontend

Next.js App Router + TypeScript, connected to the existing Go API. Visual direction: [Boutique Lia](../design.md), with locally bundled Lato and Lora fonts. The user-facing interface is Indonesian.

## Start

```sh
# From project/: start the Go API and database if they are not already running.
docker compose up -d --wait db backend

cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:3000. On a newly migrated database, use the development owner account documented in the root README. No credentials are prefilled in the UI. Change the default password before real use.

`POS_API_URL` is server-only and defaults to `http://127.0.0.1:8080/api/v1`. Copy `.env.example` to `.env.local` to change it. The URL must use HTTP or HTTPS and must not contain embedded credentials or a query string. Browser requests never go directly to the Go API.

The whole stack can also run with `make dev` from the project root. The frontend image uses Next.js standalone output and runs as a non-root user. Production uses secure cookies and requires HTTPS; the local Docker endpoint is intended for a localhost browser, not exposure on a LAN.

## Core scope

- `/login`: sign in with an existing account.
- `/kasir`: switch assigned business lines, search products or salon services, review quantities, optionally associate an existing customer and salon staff, then submit cash or available QRIS checkout.
- `/struk`: view line-scoped transaction records and reopen a saved receipt or pending payment.
- `/struk/[id]`: show the persisted transaction, inspect live pending payment status, and print confirmed receipts.

- `/katalog`: owner/admin category creation, rename, archive/restore, and product-category assignment for the kedai. Cashiers use category filters in Kasir but cannot manage them. Salon services do not have categories.

This stage does not include product/service creation, stock receiving, customer/staff administration, queue management, reports, or user management. These remain available through the appropriate authorized backend endpoints, not invented frontend links. A fresh database has no products or services; an empty catalog is an intentional state.

## Touchscreen tablet layout

Landscape tablets are the primary checkout layout. Around 960px wide and above, the catalog and order stay side by side. With enough viewport height, catalog results and order items scroll independently while pagination, totals, and payment actions remain outside those scroll areas. Portrait/narrow screens retain the order-review pane; short viewports fall back to document scrolling.

Standard controls use at least 56px touch targets; checkout is at least 64px tall. Quantity and remove actions are separated, clearing the order requires confirmation, and cash entry includes a touch keypad alongside the editable amount field. Dialog action rows remain outside their scrolling bodies. Frozen/unknown payment requests lock draft editing until resolved.

Every product/service card currently uses a local, dimensioned SVG placeholder labeled `Foto belum tersedia`, as requested. These are not product photos or loading skeletons. Product names/prices still come from PostgreSQL through the Go API; no catalog data was replaced with frontend constants. A real photo/upload field is not yet part of the catalog API.

`e2e/tablet.spec.ts` covers touch taps, image sizing, separate swipe scrolling, cash keypad entry, clear confirmation, portrait fallback, reduced-height layouts, and text resizing. These are Chromium touch-emulation tests, not physical-tablet UAT.

## Import the supplied kedai menu

[`data/menu.md`](../data/menu.md) at the project root contains the supplied food/drink names and prices, bundled from the original `manu.md` so this repository works independently. The importer creates kedai products through the authorized Go API; it never copies the estimated sales counts from the other menu files.

Set `POS_IMPORT_EMAIL` and `POS_IMPORT_PASSWORD` securely in your shell environment for an owner/admin account assigned to Kedai Lia 287. Then, from `frontend/`:

```sh
node --test scripts/import-menu.test.mjs
node scripts/import-menu.mjs          # Dry run; reports missing products
node scripts/import-menu.mjs --apply  # Add missing products
```

The API URL defaults to `http://127.0.0.1:8080/api/v1`; `POS_API_URL` overrides it. `POS_MENU_FILE` can override the source path. Existing matching names/SKUs, prices, active states, stock policies, and user-selected categories are left untouched. New items use active Makanan/Minuman categories when those names are available; renamed or archived defaults are not recreated. Ambiguous names or conflicting SKUs stop preflight rather than overwrite records. New products use the neutral unit `item` and have stock tracking off because packaging and physical stock quantities are not specified in the price list. No sales or inventory movements are created.

The supplied menu was imported into the local kedai catalog: 22 foods and 21 drinks. The version-4 migration assigns imported MENU-F/MENU-D SKUs to Makanan/Minuman once and creates an empty Snack category. Future migrations never reset category names, archive states, or assignments. Refresh Kasir with Kedai Lia 287 selected to load them. Re-importing is safe for unchanged menu entries; the dry run skips all 43 existing products.

## Authentication and integration

`/api/session` logs in, reads the current user, and signs out. Access tokens are kept in an HTTP-only, SameSite=Lax cookie. The login response exposed to browser JavaScript includes the user and expiry, not the token. `/api/pos/*` forwards core POS reads, sale creation, and the explicitly scoped category-management operations, attaching the cookie token on the server. The backend remains responsible for authorization and authoritative pricing.

The proxy exposes category GET/POST/PATCH/DELETE endpoints and a category-only PATCH for products. It does not expose product price or stock editing; those remain authorized backend operations. Only sale creation requires the checkout idempotency header. All mutations require the same-origin check. Behind a trusted reverse proxy, set server-only `POS_APP_ORIGIN` to the public origin if it differs from the origin Next.js receives; arbitrary forwarded headers are not trusted. The proxy validates endpoint paths, query values, body size, and sale idempotency keys. It does not expose provider webhooks, user administration, or unrelated catalog/stock writes, follow redirects to another upstream host, or forward client-supplied bearer tokens. Responses are not cached.

Core API types are generated from the root `openapi.yaml`:

```sh
npm run generate:api
```

Commit the generated `src/lib/api-schema.ts` with API contract changes. Thin aliases in `src/lib/types.ts` keep components readable without duplicating the API schema.

## Checkout safety

A submitted sale freezes its request body and `X-Idempotency-Key`. An uncertain response keeps both together so retries replay the same logical operation. A reload must not turn a potentially committed sale into a new request. Validation failures and a disabled provider are distinct from an unresolved outcome.

Drafts and unresolved requests use tab-scoped browser storage, not authentication storage. Only the original user and business-line context may restore an attempt, because backend idempotency is user-scoped. Closing the tab, clearing site storage, or switching devices can remove that local recovery context. Before making another sale after losing it, inspect the persisted transaction records. Offline checkout is not supported.

QRIS availability reflects backend/provider capability. Cashiers cannot read owner-only integration configuration; the UI must not infer global provider state from a forbidden configuration request. A gateway-disabled response explains that QRIS is unavailable. Pending payment is never marked paid from the browser. If a status check fails, the last known payment state is preserved. Test gateway payloads are labeled as test-only and are not real payable QRIS.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

The E2E runner creates a uniquely named PostgreSQL database, builds/runs the real Go backend on port 18181, starts a deterministic external test gateway on 19191, and serves Next.js on 3100. All seeded records are explicitly labeled `[UJI E2E]`. The existing POS database is not used for test writes. Processes and the database are cleaned up on completion.

Requirements: the Docker `db` and `backend` containers must be running, Go must be available, and Chromium must be installed. Installed Google Chrome is used automatically on macOS; elsewhere use `npx playwright install chromium` or set `E2E_CHROME_PATH`. Ports can be changed with `E2E_API_PORT`, `E2E_GATEWAY_PORT`, and `E2E_WEB_PORT`.

Tests use the existing backend container's connection configuration internally to connect to the disposable database; database/provider credentials are not printed. Do not run these tests against an unrelated Docker project. Screenshots and traces under `test-results/` may contain test session details and are gitignored.

Runtime verification evidence is recorded in [docs/FRONTEND-VERIFICATION.md](../docs/FRONTEND-VERIFICATION.md) when the implemented UI has been exercised. A passing build alone does not prove keyboard, mobile, or payment behavior.

## Font licenses

Lato is distributed under the SIL Open Font License 1.1, and Lora under the SIL Open Font License 1.1. The bundled `@fontsource/lato` and `@fontsource/lora` packages include their license files; copies are distributed under `public/licenses/` in the standalone image. These fonts are served as local WOFF2 assets by Next.js; no runtime Google Fonts requests are required.
