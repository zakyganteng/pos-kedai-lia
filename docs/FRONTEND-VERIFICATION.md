# Core frontend verification

## Scope and environment

Next.js 16.4.5, React 19.3.1, TypeScript, App Router. The core frontend is in `frontend/` and follows the user-selected Boutique Lia theme from `design.md`.

Approved screens: login, Kasir, Struk list/detail, and owner/admin Katalog for kedai categories and product assignments. Cashier navigation contains Kasir, Struk, assigned business-line selection, and logout. Queue, product creation, stock administration, reports, and user/integration management remain outside the frontend scope.

Verification used installed Google Chrome through Playwright, the real Go API, and PostgreSQL. Browser-test fixtures were written only to a uniquely named disposable database. The test gateway is an external deterministic HTTP boundary from `tests/support/gateway.mjs`, not a real QRIS provider.

The production Docker image was also built and started against the existing backend. Its smoke test performed login, session read, and logout only; no test sales or catalog fixtures were written to the existing POS database.

## Executed checks

| Check | Result | Evidence |
| --- | --- | --- |
| `cd frontend && npm run typecheck` | PASS | TypeScript completed without errors. |
| `cd frontend && npm run lint` | PASS | ESLint completed without errors or warnings. |
| `cd frontend && npm test` | PASS | 133 tests passed, none failed or skipped. |
| `cd frontend && npm run build` | PASS | Optimized Next.js build produced all approved routes. |
| `cd frontend && npm run test:e2e` | PASS | All 22 browser/API scenarios passed, including touchscreen and category management. |
| `cd backend && go vet ./... && go test -race ./...` | PASS | 28 existing backend tests passed across 19 packages. |
| `docker compose config --quiet` | PASS | Compose configuration accepted. |
| `docker compose up -d --build --wait frontend` | PASS | Frontend image built; database, backend, and frontend were healthy. |
| `npm audit --omit=dev --audit-level=high` | PASS | Registry audit reported zero vulnerabilities in runtime dependencies at verification time. This is not a security certification. |

The local frontend is running at **http://localhost:3000**. The API remains at **http://127.0.0.1:8080/api/v1**.

Do not run the host production build and the host dev-based E2E runner simultaneously: they share `.next/`. Verification commands above were rerun sequentially after detecting that artifact conflict.

## Browser scenarios and click-through evidence

Sources: `frontend/e2e/pos.spec.ts` and `frontend/e2e/security.spec.ts`.

### 1. Login and cash checkout

- Empty login submission displayed a visible validation error.
- Email/password entry and Enter on the submit button opened Kasir.
- Catalog search with no matching item displayed the filtered-empty state.
- Hapus pencarian restored the catalog; selecting a product added it to the order.
- Quantity editing combined the order under one item ID.
- Pilih pelanggan opened a dialog; choosing an existing customer associated the correct API customer ID.
- Insufficient cash kept Selesaikan pembayaran disabled; sufficient cash enabled it.
- Cash submission returned a persisted paid sale with confirmed payment, correct quantity, server total, customer ID, and change.
- The receipt showed persisted item snapshots and amounts.
- Cetak struk invoked `window.print`; print-media emulation hid navigation and retained the receipt. A physical print job was not performed.
- Kembali ke kasir showed an empty next order rather than reusing the paid draft.
- Struk navigation, status filtering, Hapus filter, and reopening the persisted receipt all worked.

### 2. Business switching and salon attribution

- Switching while a draft existed opened a confirmation dialog.
- Escape cancelled the switch without changing the selected business.
- Confirming the switch opened the salon catalog with a fresh search context.
- The kedai draft remained scoped to the kedai; it was neither moved nor merged into the salon order.
- The previous staff-attribution check is superseded: salon sales now use the same staff-free checkout flow as kedai. Regression coverage checks the absence of staff controls and attribution on new sales.
- Returning to the kedai restored its separate unfinished draft.

### 3. Uncertain successful checkout

- The test allowed the real API to commit a cash sale, then dropped the response before the browser received it.
- The UI reported an unknown outcome and blocked a new checkout.
- Escape closed the dialog without discarding the frozen request; recovery remained available on the page.
- Reloading, losing the cookie, and signing back in as the same user retained the request body and idempotency key.
- Kirim ulang permintaan yang sama sent the original key, returned the original sale ID, and increased the server's transaction count by exactly one overall.

### 4. QRIS confirmation and failed status checks

- QRIS checkout returned a pending sale from the real API and test gateway.
- The opaque server payload was rendered locally as a dimensioned QR image and clearly labeled non-payable test data.
- Pending payment could not print a paid receipt.
- A deliberately failed manual status check retained the previous pending state and displayed a separate status-check warning.
- A correctly signed event sent directly to the real backend changed the payment to confirmed.
- The frontend fetched the confirmed state, removed the pending QR surface, and enabled printing. No browser mark-paid action exists.

### 5. Responsive layout, keyboard, and retries

- Verified page reflow at 360, 640, 768, 1024, and 1440 CSS-pixel widths without page-level horizontal overflow.
- Phone Tinjau pesanan and Kembali ke katalog switched the visible pane.
- Long item names wrapped without clipping the name or amount controls.
- Tab/Shift+Tab remained inside the payment dialog; Escape closed it.
- Search focus had a visible outline; the primary checkout target was at least 44px tall.
- At 200% root text size, the desktop and 360px catalog/order/payment views remained within page width.
- The receipt was also checked at 360px and 200% text size; its contained table scroll region was keyboard-focusable.
- Catalog paging moved between pages 1 and 2 and back.
- A simulated catalog read failure showed Coba lagi; retry after restoring the API route returned actual catalog rows.

This verifies text resizing, not a physical-device pinch-zoom or on-screen keyboard test.

### 6. Logout and user-scoped recovery

- Logout while an unknown request existed opened a warning dialog.
- Escape kept the user signed in; Keluar sekarang signed out while preserving the unknown request.
- A different cashier on the same business line inherited neither the prior user's draft nor recovery controls.
- A one-line cashier had no second-business selector.
- Signing back in as the original user restored the frozen request.

### 7. Definitive and conflict errors

- The real API rejected an oversize tracked-stock order with 409.
- The UI did not silently replace the request key; it offered inspection and an explicit acknowledgment before discarding the attempt.
- The test opened Struk, returned to Kasir, acknowledged inspection, and corrected the quantity.
- A simulated `503 PAYMENT_UNAVAILABLE` response was treated as a definitive pre-commit rejection, not as an unknown charge. Perbaiki pesanan returned to an editable order.

### 8. Cookie and proxy boundaries

- Login exposed user/expiry to JavaScript, not the bearer token.
- The browser session cookie was HTTP-only and SameSite=Lax.
- Non-allowlisted user administration requests were rejected by the frontend proxy.
- A foreign-Origin checkout was rejected before reaching the backend.
- Logout cleared the browser cookie; the old bearer token was rejected by the real API.

### 9. Cashier authorization

- A cashier assigned only to the kedai could not read salon services.
- Owner-only integration configuration remained forbidden to that cashier.
- The frontend did not elevate permissions or confuse a configuration permission failure with global provider availability.

Each UI scenario recorded zero uncaught JavaScript errors or unexpected console errors. Deliberately injected HTTP/network failures were expected test inputs, not suppressed application exceptions.

## Production smoke test

The non-root standalone Docker image served the login page with locally bundled Lato/Lora assets. Browser inspection confirmed Lato was the operational body font, rather than a fallback serif.

The documented development owner account opened Kasir through the production image. The browser accepted the production HTTP-only, Secure cookie on localhost; `/api/session` returned 200; logout returned to login. No uncaught browser errors were recorded. External deployment still requires HTTPS.

## Design delivery gate

- **Hard gate PASS:** Approved text wordmark and navigation only; no invented customers, business metrics, testimonials, or provider claims. Documented text/control color pairs were calculated; keyboard focus, dialog Escape, responsive reflow, data/error states, and runtime behavior were exercised. QR images have intrinsic dimensions. No theme toggle or decorative assets were fabricated.
- **Purpose gate PASS:** Palette, typography, spacing, catalog/order split, semantic status borders, and modal elevation follow the written reasons in `design.md`. Semantic colors and status borders communicate real returned states; they are not decorative stripes. No gradients, glass layers, glows, or unrelated illustrations were introduced.
- **Liveliness PASS:** ENERGY 2 / RHYTHM 1 / MOTION 1 matches the rendered app. Lora titles, ivory canvas, espresso content, white order/receipt surfaces, and a restrained burgundy next action provide the chosen boutique identity without changing the checkout workflow.
- **Craftsmanship and quality locks PASS:** Approved screens use actual API records, support recoverable failures, and have recorded click-through evidence. Navigation has real destinations, retries preserve uncertainty, and business/user contexts are separated. Screenshots were inspected for typography and long-name/mobile layout. No unmeasured performance score or production-readiness claim is made.

The gate applies to this core scope, not to unbuilt management screens, unsupported payment providers, or all possible devices.

## Local screenshot artifacts

Generated by the browser suite under gitignored `frontend/test-results/`:

- `boutique-lia-kasir-desktop.png`
- `boutique-lia-kasir-mobile.png`
- `boutique-lia-receipt-desktop.png`
- `boutique-lia-production-login.png` (blank login screen from the Docker smoke test)

The checkout/receipt images contain explicitly labeled test fixtures, not customer data. Subsequent test runs regenerate them. Screenshot files are local evidence, not committed UI assets.

## Touchscreen tablet update

Landscape tablet layout, 56px standard targets, 64px checkout, independent pane scrolling, a cash keypad, clear-order confirmation, and explicitly labeled card-image placeholders are now included. Touch-emulation and production smoke evidence, screenshots, and limits are recorded in [TABLET-VERIFICATION.md](TABLET-VERIFICATION.md). The core flow and imported database catalog remain unchanged.

## Editable kedai categories

Makanan, Minuman, and Snack are persisted categories. Katalog supports owner/admin category management and product assignment; Kasir uses server-side category filters. The local database was upgraded with prices/stock verified unchanged and 22/21/0 assignments. Full migration, API, PostgreSQL, browser, and production evidence is in [CATEGORY-VERIFICATION.md](CATEGORY-VERIFICATION.md).

## Supplied catalog import

On the user's approval, `frontend/scripts/import-menu.mjs` imported the names and prices from the supplied `../manu.md`: 22 foods and 21 drinks, all scoped to Kedai Lia 287. Six importer tests passed, followed by a preflight dry run, an authorized API import, and a second dry run confirming that all 43 existing entries would be skipped. No prior products were overwritten and no sales or inventory movements were created.

The production frontend proxy returned all 43 active products. Browser inspection confirmed Ayam lalapan at IDR 19,000 and Es teh at IDR 4,000; selecting both produced a temporary IDR 23,000 cart, which was cleared without submitting checkout. No uncaught browser errors were recorded. `frontend/test-results/kedai-imported-menu.png` is local evidence of the supplied catalog, not generated sample business data. These catalog records are in the existing local POS database, unlike the disposable E2E fixtures above.

## Remaining operational checks

- Owner/cashier UAT with actual catalog records and operating conditions.
- Physical tablet/phone testing, especially virtual-keyboard positioning.
- Physical receipt printer testing and confirmation of receipt/tax policy.
- Selected real payment-provider integration and sandbox UAT. The tested QR is not payable QRIS.
- HTTPS/reverse-proxy staging deployment; an explicit `POS_APP_ORIGIN` is needed when the public origin differs from the authority Next receives.
- A complete independently verified dark palette if a light/dark toggle becomes part of scope; the current selected light theme has no unfinished toggle.
- Broader security assessment and field performance measurements. Lighthouse and Web Vitals were not measured.

Browser draft/attempt storage is tab-scoped. Closing a tab, clearing site data, switching devices, or losing that storage can remove the local idempotency recovery key. Persisted transaction records must be inspected before repeating a possibly committed sale after losing the local context. Offline checkout is not supported.
