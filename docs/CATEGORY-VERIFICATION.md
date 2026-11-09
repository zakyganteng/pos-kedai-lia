# Kedai category implementation and verification

## Scope

Editable categories apply to kedai products only. Default categories are **Makanan**, **Minuman**, and **Snack**. The owner approved a **Katalog** screen for owners/admins; cashiers use category filters in Kasir without category-management permission. Salon services remain unchanged.

Each product has one nullable `categoryId`. Unassigned products remain visible under Semua and Tanpa kategori. Category names are not a fixed enum: owners/admins can create and rename categories.

## Backend and contract

- Category records are persisted in PostgreSQL alongside existing line-scoped records.
- `GET /categories`, `GET /categories/{categoryId}`, `POST /categories`, `PATCH /categories/{categoryId}`, and archive via `DELETE /categories/{categoryId}` are documented in root/backend `openapi.yaml`.
- Product create/patch supports nullable `categoryId`; list filtering supports `categoryId` or `uncategorized`, never both.
- Names are unique per line, case-insensitively after whitespace normalization. Archived categories keep their names reserved.
- Category reads are available to assigned cashiers. Mutations require owner/admin authorization and an assigned food/beverage line.
- Archive refuses a category while any product is assigned, including inactive products. Restore is supported.
- Shared/exclusive row locks and database constraints prevent concurrent assignment/archive from leaving dangling or archived references.
- UUID references are canonicalized. Counts and filters remain correct for uppercase request UUIDs; direct noncanonical stored references are refused by the database.
- Category edits do not change product prices, stock settings, inventory quantities, or persisted sale snapshots.

The Next.js proxy allows the category endpoints and **category-only** product patches. It does not expose price/stock editing through Katalog. Same-origin checks, HTTP-only authentication cookies, bounded bodies, structured errors, and existing checkout idempotency remain intact.

## Migration and local data

The additive `category_schema.sql` is replayed after the base schema on every migration run. Seed/backfill happens only when schema version 4 is first installed. Readiness requires version 4.

The first migration seeds three categories and assigns only the existing imported MENU-F/MENU-D products to Makanan/Minuman. Snack membership is not guessed. Later migrations preserve category names, archives, and assignments.

Before upgrading the existing local database, a private temporary directory with prefix `lia-before-categories-` was created. It contains a mode-600 PostgreSQL backup and a product/inventory checksum snapshot. The backup path was printed in the session, not exposed by the app.

After rollout, checksums confirmed that existing product fields other than `categoryId`, product count, and inventory quantities/reservations/thresholds were unchanged:

| Category | Assigned local products |
| --- | ---: |
| Makanan | 22 |
| Minuman | 21 |
| Snack | 0 |

All 43 products remain in the existing POS database. Snack products can be assigned in Katalog. The importer preserves existing user assignments; new imports use active Makanan/Minuman categories when those names are available, without recreating renamed/archived defaults.

## Frontend

- Kasir has touch-friendly Semua, active-category, and Tanpa kategori filters backed by the API.
- Category filtering combines with search, resets paging, and displays contextual empty/error/loading states. Stale rows cannot be added while a new filtered result is loading.
- Katalog supports create, rename, archive, restore, and per-product category assignment/clearing.
- Category counts explicitly include inactive products. Product management lists inactive products too, so used categories can be emptied before archival.
- Writes show success only after the server confirms. Unknown outcomes offer rechecking rather than falsely claiming nothing changed.
- Category pagination resets after successful category mutations. Category selectors and filters can load additional API pages instead of silently omitting categories.
- Header navigation reflows at narrow widths and 200% text size. Existing tablet layout and image placeholders remain intact.

## Executed verification

| Check | Result |
| --- | --- |
| Go vet and race tests | PASS |
| Go race tests with `TEST_DATABASE_URL` and isolated real PostgreSQL databases | PASS, including category CRUD, scope, validation, counts, snapshots, migration replay, UUID normalization, and concurrency |
| Frontend TypeScript and ESLint | PASS |
| Frontend unit tests | PASS: 133 tests |
| Menu importer tests | PASS: 6 tests |
| Full browser/API suite | PASS: 22 scenarios |
| Next.js production build | PASS |
| Backend/frontend Docker builds and healthy startup | PASS |
| Root/backend OpenAPI and additive SQL mirror checks | PASS |
| Local migration preservation checks | PASS |

Tests write fixtures only into disposable databases. Production smoke testing performed login, category filtering, Katalog reads, and logout; it did not create test categories, change catalog records, or submit sales in the existing database.

Browser coverage includes:

- Create, rename, assign, detach, archive refusal while used, successful archive after clearing, and restore.
- Duplicate/blank names, invalid/missing references, mutually exclusive filters, and foreign-origin writes.
- Cashier read/filter permissions and denial of category/product mutations; admin mutation success.
- Concurrent archive/assignment and uppercase UUID handling.
- Kasir category/search combinations, unassigned products, salon exclusion, category read failures, and role-restricted Katalog navigation.
- Existing cash/QRIS/lost-response/idempotency, print-media, session, business switching, touch scrolling/keypad, and 200% text-resizing regressions.

One regression run found horizontal header overflow at 200% text size after adding Katalog. Navigation wrapping was corrected. Selected-chip hover styling was also corrected to retain a dark surface behind the white label, with a browser regression assertion. The final full run passed all 22 scenarios. Worker-provider failures were recovered from saved source; no agent completion or unrun tests were assumed.

## Production smoke and screenshots

The running application is at **http://localhost:3000**. Production touch checks confirmed the Makanan/Minuman/Snack filters, the Katalog counts 22/21/0, Secure/HTTP-only cookies, and logout with no uncaught browser errors.

Local gitignored evidence:

- `frontend/test-results/kedai-categories-tablet.png`
- `frontend/test-results/kedai-katalog-management.png`
- `frontend/test-results/katalog-categories.png` (disposable test data)

## Delivery gate

- **Hard gate PASS:** owner-approved Katalog navigation, real persisted categories/products, role enforcement, bounded/cross-origin mutation checks, recoverable states, touch/keyboard/reflow tests, and no fabricated category membership or business metrics.
- **Purpose gate PASS:** category filters narrow selection; Katalog separates administration from checkout; archive guards preserve references; status/count labels reflect actual API data. Existing palette and approved image placeholders were reused without new decorative assets.
- **Liveliness PASS:** Boutique Lia remains ENERGY 2 / RHYTHM 1 / MOTION 1, with familiar headings, readable rows, restrained burgundy actions, and stable touch controls.
- **Craftsmanship PASS:** real PostgreSQL, API/browser, build, migration, and production smoke evidence is recorded above. Prices and stock were verified unchanged, and previous checkout safety tests still pass.

These checks are not physical-tablet UAT, real payment-provider certification, external HTTPS staging verification, a security certification, or measured field performance.
