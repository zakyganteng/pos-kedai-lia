# Touchscreen tablet update

## Approved direction

Landscape tablets are the primary operating context. Boutique Lia remains ENERGY 2 / RHYTHM 1 / MOTION 1. The owner also requested an image on each catalog card and explicitly approved dummy images initially.

## Implemented

- Side-by-side catalog/order from approximately 960px in landscape, or 1280px on wider layouts.
- Separate catalog-result and order-content scrolling when there is enough viewport height. Catalog paging, order totals, and checkout sit outside those scroll areas.
- Portrait/narrow order-review pane and short-viewport document-scrolling fallback.
- At least 56px standard touch targets and a 64px checkout target; quantity and remove actions are separated.
- Persistent selected-card border plus a real order-quantity label, with native tap/keyboard actions.
- Confirmation before clearing a draft. Unknown payment requests lock draft editing until resolved.
- Cash-entry keypad with digits, backspace, clear, and exact-amount control. The labeled field remains editable; the app does not require the device keyboard for cash entry.
- Dialog headers/action rows outside the scrolling body, including the payment dialog.
- Dimensioned local SVG image placeholders on every product and salon-service card, visibly labeled `Foto belum tersedia`. These are not real photos or animated loading skeletons. SKU remains searchable but is hidden on the card to prioritize image, name, and price.

No backend schema, catalog prices, stock, or existing sales were changed by the tablet update. The 43 imported menu products remain DB-backed. An actual product-photo/upload field is not part of the current API.

## Verification

- TypeScript, ESLint, production build, and the existing 127 unit tests passed.
- The browser suite passed all 12 scenarios, including the existing cash/QRIS/retry/authorization flows and 3 new touchscreen scenarios in `frontend/e2e/tablet.spec.ts`.
- Touch emulation checked 1024x768, 960x640, 1280x800, portrait 768x1024, and a reduced-height 1024x400 viewport. Page reflow at 200% text size was also checked.
- Image tap added exactly one item; repeated taps and quantity buttons updated the expected count. Standard control bounds were measured at 56px or larger and checkout at 64px or larger.
- Synthetic touch swipe gestures scrolled the catalog and order independently. Checkout remained within the viewport and did not move with catalog scrolling.
- Clear confirmation supported both cancellation and explicit clearing.
- Keypad digits, backspace, clear, and Uang pas worked; a real API cash sale completed in the disposable test database.
- Portrait review, short-height payment actions, Escape, and existing keyboard interactions remained usable.
- Placeholder label contrast was calculated as 5.27:1 (`#6C5D59` on `#F1EAE4`). Intrinsic image dimensions reserve the photo area.
- The updated standalone Docker image was built and deployed locally. Production touch smoke testing loaded all 43 active products, verified card-image taps, reachable checkout, cash amount entry, clear confirmation, and logout without submitting a sale in the existing database.

One initial dev-server run after production build did not pass its first scenario while Next.js repeatedly hot-refreshed. The final full-suite run passed; no retry setting was added to hide failures. Development-server timing is not a physical-tablet performance measurement.

## Delivery gate

- **Hard gate PASS:** owner-approved placeholders and existing navigation only; real API menu/prices retained; sized images; keyboard/dialog behavior, touch targets, failure states, and responsive layouts exercised.
- **Purpose gate PASS:** larger targets support touch accuracy; fixed action placement supports checkout; independent scrolling prevents long orders hiding payment; image placeholders honestly reserve future photo space. No decorative animation, new brand palette, or fabricated food photography.
- **Liveliness PASS:** Boutique Lia typography/colors remain visible, with the declared 2/1/1 dials and one dominant next-action area.
- **Craftsmanship PASS:** all 12 browser scenarios and 127 unit tests passed, build/lint/typecheck passed, screenshots inspected, Docker updated. No hardware UAT or unmeasured performance claim is made.

## Evidence and limits

Local, gitignored screenshots: `frontend/test-results/boutique-lia-tablet-landscape.png`, `boutique-lia-tablet-payment.png`, `boutique-lia-tablet-portrait.png`, and `kedai-tablet-touch.png`.

These checks use Chromium touch emulation and synthetic swipe gestures, not a physical tablet. Actual device keyboard behavior, real printer output, real-provider payment UAT, and staff testing remain operational checks. The light theme has no unfinished dark toggle.
