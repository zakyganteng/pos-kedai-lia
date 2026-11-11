# Lia POS Design Direction

## 1. Selected theme: Boutique Lia

**Decision:** Theme 3, selected by the product owner.

**Visual identity:** Ivory, espresso, and deep burgundy. A welcoming boutique character shared by Kedai Lia 287 and Lia Salon, without turning operational screens into a decorative salon website.

**Audience:** Cashiers recording sales, salon staff managing walk-ins, and the owner reviewing business records.

**Design read:** A shared-counter POS for kedai and salon staff, in a warm boutique visual language, with ENERGY 2 / RHYTHM 1 / MOTION 1.

- **ENERGY 2:** Warm colors and a restrained serif title treatment provide personality; transaction content stays visually quiet.
- **RHYTHM 1:** Repeated spacing, control placement, and list structure make daily work predictable. Different workflows can use different compositions without moving familiar actions arbitrarily.
- **MOTION 1:** Immediate interaction feedback only. No entrance choreography, bouncing elements, or continuous decorative animation.

This document defines the selected visual direction and frontend requirements. Core POS implementation uses Next.js, TypeScript, and the App Router in `frontend/`. The product owner approved the Kasir and Struk screen arrangement described below; other workflow layouts remain proposals.

## 2. Palette

### Brand and surface tokens

| Token | Value | Role and reason |
| --- | --- | --- |
| `background` | `#FAF6F1` | Ivory page canvas provides warmth without competing with transaction data. |
| `surface` | `#FFFFFF` | White forms, catalog areas, and order panels keep operational content distinct from the canvas. |
| `text-primary` | `#352A28` | Espresso text provides strong readability with a warmer character than pure black. |
| `text-secondary` | `#6C5D59` | Supporting labels and metadata remain readable rather than fading into pale grey. |
| `accent` | `#843A4B` | Deep burgundy identifies the primary next action and gives both businesses one shared identity. |
| `accent-hover` | `#713040` | Darker burgundy provides feedback on enabled primary actions. |
| `accent-active` | `#602837` | A deeper pressed state confirms interaction without moving the button. |
| `on-accent` | `#FFFFFF` | White labels on burgundy primary buttons. |
| `selected-surface` | `#F2E5E7` | A pale burgundy tint supports selected rows or tabs, accompanied by a label, checkmark, or distinct outline. |
| `divider` | `#E5DCD6` | Quiet separators between passive content groups; not a control boundary or status signal. |
| `control-border` | `#9A8781` | Visible input and secondary-button boundaries on white and ivory surfaces; never a text color. |

Burgundy is the only brand accent. Most icons, totals, and navigation labels use espresso rather than repeating the accent everywhere. A screen has one dominant next-action area; supporting actions use outlined or text treatments.

### Semantic colors

| Token | Value | Restricted meaning |
| --- | --- | --- |
| `success` | `#275C43` | A genuinely confirmed payment or completed operation. |
| `warning` | `#805600` | A pending payment or an actionable caution. |
| `error` | `#A12E2E` | A failed operation, invalid field, or destructive-action warning. |

Semantic colors communicate state, not additional branding. Every state includes visible wording; color alone never distinguishes pending, confirmed, failed, or expired payments. Neutral information uses espresso and secondary text.

### Contrast evidence

WCAG contrast calculations were performed on the specified tokens. Ratios are rounded for display; pass decisions use unrounded values.

| Pairing | Contrast | Intended use |
| --- | --- | --- |
| Espresso on ivory | 12.90:1 | Primary text |
| Secondary text on ivory | 5.83:1 | Supporting text |
| White on burgundy | 7.81:1 | Primary button labels |
| White on hover burgundy | 9.55:1 | Hover button labels |
| White on active burgundy | 11.31:1 | Pressed button labels |
| Burgundy on selected surface | 6.38:1 | Selected text |
| Secondary text on selected surface | 5.12:1 | Selected-row metadata |
| Control border against ivory | 3.17:1 | Non-text control boundary only |
| Control border against white | 3.41:1 | Non-text control boundary only |

Primary, secondary, accent, and semantic text were checked against ivory, white, and the selected surface; all exceed 4.5:1. Actual component pairings, overlays, disabled states, and focus treatments still need verification when implemented. The divider color does not provide an accessible interactive boundary.

## 3. Typography

| Use | Typeface | Treatment |
| --- | --- | --- |
| Operational content | Lato | Body text, forms, navigation, product/service names, tables, queue numbers, and prices. |
| Occasional page title | Lora | A restrained boutique signature for page titles; not used for inputs, receipts, prices, or dense data. |
| Fallbacks | System fonts | Lato falls back to `system-ui, sans-serif`; Lora to `Georgia, serif`. |

Lato keeps everyday workflows readable. Lora adds personality at the page level without forcing staff to scan serif transaction data.

- Body and form text: `1rem`, line height around `1.5`.
- Supporting text: `0.875rem`, with sufficient contrast and no tiny labels for essential information.
- Section headings: `1.125rem` to `1.25rem`, usually Lato bold.
- Page titles: fluid `1.5rem` to `2rem`, Lora medium or semibold.
- Checkout total: `1.75rem` to `2rem`, Lato bold; more prominent than the page title during payment review.
- Money and numeric table columns: tabular numerals, right aligned where comparison matters.
- Sentence-case labels; no widely tracked uppercase headings or monospace styling for decoration.

Fonts use local WOFF2 assets where licensing permits, `font-display: swap`, and suitable fallbacks. Font files are not included by this design document.

## 4. Spacing, shape, and identity

**Spacing scale:** 4, 8, 12, 16, 24, and 32 CSS pixels, expressed through relative units in implementation. Small gaps connect related fields; larger gaps separate decisions. Generous spacing means clear grouping, not oversized empty panels.

**Radii:** 6px for compact inputs and quantity controls, 8px for buttons, 12px for panels and dialogs. Pills are not the default treatment.

**Elevation:** Flat surfaces and borders for ordinary content. A modest shadow is reserved for a popover or dialog that sits above the workspace.

**Identity motif:** A Lora page title paired with an espresso operational workspace, and a white receipt-style order panel ending in a burgundy next action. This repeats the boutique identity without decorative illustrations.

No background patterns, gold ornamentation, glass panels, gradients, or glowing borders are part of this theme. The owner requested an image on every catalog card and explicitly approved dummy images initially. Each card therefore reserves a 16:9 image area using a local neutral SVG with the visible label `Foto belum tersedia`. It is an honest placeholder, not a real product photo or a permanently animated loading skeleton. Real photos remain future catalog data; the current API does not expose an image field. The app name can be a text wordmark until a logo is approved.

## 5. Proposed workflow layouts

**Approved core layout:** Login opens Kasir. Wide screens show catalog selection on the left and order review on the right; phones use a separate order-review view. Struk reopens recent receipts and pending payments. The header contains Kasir, Struk, the assigned business-line selector, and logout. The owner approved an additional Katalog destination for owners/admins, specifically for kedai category management and product assignments; cashiers do not see it. Core UI wording is Indonesian.

Salon queue, reports, and management beyond kedai categories remain later-stage proposals, not current navigation destinations. Only API-supported capabilities can appear as working actions; broader PRD intentions do not imply backend availability.

### Checkout

**Job:** Select products or services and review the order before collecting payment.

- On wide screens, a searchable catalog occupies the main area and a white order-summary panel sits on the right.
- The selected business name is explicit: Kedai Lia 287 or Lia Salon. Only assigned business lines are available.
- The kedai catalog emphasizes product name, price, quantity, and available tracked stock. Category filters are backed by the API and combine with search: Semua, each active category, and Tanpa kategori. They do not apply to salon services.
- Katalog separates category administration from checkout. Owners/admins can create, rename, archive, restore, and assign categories; used categories must be emptied before archival. Product counts include inactive products and are explicitly labeled.
- The salon catalog emphasizes service name and price, without staff attribution, matching kedai checkout. Duration appears only when available.
- Customer association remains optional and does not dominate the initial checkout view.
- The order summary lists names, quantities, amounts, and an authoritative total. Burgundy identifies the next step, such as `Lanjut ke pembayaran`.
- Changing business line confirms that the current draft stays with its original user/business context; it is neither moved nor merged into the other business.
- Landscape touchscreen tablets are the primary operating context. Catalog and order remain visible side by side; their content scrolls independently while order totals and payment actions stay outside the order scroll area.
- Quantity controls and secondary actions use at least 56px touch targets; the checkout action is at least 64px tall. Hapus is separated from the quantity buttons, and clearing the entire order requires confirmation.
- A touch cash keypad supports amount entry without depending on the device's on-screen keyboard. The labeled cash field remains editable for keyboard users.

### Salon walk-in queue

**Job:** Identify the next waiting customer and update service progress.

- Queue number, requested service, and current state precede secondary metadata.
- Waiting, in-service, completed, and cancelled entries use clear text labels and the transitions supported by the API.
- The next waiting entry is easy to locate without making every row a large decorative card.
- This is a walk-in queue, not an appointment calendar or booking feature.

### Records and reports

**Job:** Find a transaction, inspect stock movement, or review confirmed sales for a selected period.

- Business line and relevant filters remain visible above the results.
- Tables use decision-relevant columns, not a generic row of metric cards followed by a filler chart.
- A chart is appropriate only when it answers a stated question using real returned data.
- Revenue is labeled as sales/revenue, not profit. Comparisons appear only when the underlying periods and values exist.
- Customer, catalog, stock, user, and integration controls reflect actual API permissions. Hidden controls are not a substitute for server authorization.

## 6. Responsive behavior

The layout is designed mobile-first and reflows when content stops fitting. Widths below are starting points for testing, not a final device-based breakpoint contract.

| Available width | Proposed checkout behavior |
| --- | --- |
| Narrow, approximately below 640px | Single-column catalog with an accessible order-review view. A compact order summary can link to review; no desktop sidebar squeezed into the viewport. |
| Portrait/tablet, approximately 640px and above | Responsive image-card grid; order review is a separate pane until the layout is wide enough. |
| Landscape, approximately 960px and above | Catalog and order side by side. The order panel is bounded to 20-22rem; catalog columns follow the available space rather than a fixed device model. |
| Wide, approximately 1280px and above | Side-by-side workspace even in a tall orientation, with the same predictable control placement. |

- Standard interactive controls have at least 56px touch targets; primary checkout is at least 64px tall. Quantity buttons have a minimum 56px width and clear remove-action spacing.
- Mobile page padding starts at 16px; wide workspace padding can increase to 24px or 32px.
- Long names wrap. Essential prices, controls, and error text are never clipped to hide layout problems.
- Tables either reflow into labeled records or use a contained, keyboard-accessible scroll region; the page itself has no horizontal overflow.
- Landscape panes are height-bounded only when there is adequate viewport height. Catalog results and order items scroll inside them; headings, pagination, totals, and payment actions remain outside those scroll areas. Short viewports fall back to document scrolling instead of clipping controls.
- Phone review bars reserve their height and respect safe-area insets. They cannot cover the last item or a focused field.
- Dialog headers and action rows remain outside the scrolling dialog body, keeping confirmation controls reachable when the cash keypad or device keyboard takes space.
- The on-screen keyboard cannot obscure active form fields or their validation messages.
- Verification includes 360px width, the intermediate tablet range, wide screens, and 200% zoom.

## 7. Interaction and accessibility

- Actions are native buttons; navigation uses links to actual destinations. Every icon-only control has an accessible name.
- Enabled actions show a pointer cursor; disabled actions use native disabled behavior where suitable and explain why they are unavailable.
- Secondary buttons use espresso text and visible control borders. Hover adds a surface change and stronger boundary; pressed feedback does not shift the layout.
- Focus uses a visible 2px burgundy outline with a 2px white offset gap, so burgundy controls also have a distinguishable ring. Final adjacency checks happen in the rendered UI.
- Selected tabs and rows use more than color: a checkmark, underline, or distinct outline plus the correct accessible state.
- Every field has a visible label. Validation text names the problem and remains associated with the field.
- Keyboard order follows visual order. Dialogs support Escape, appropriate focus containment, and focus restoration.
- Essential actions never depend on hover. Screen-reader announcements cover payment updates and actionable errors without continuously repeating status.
- Non-essential motion stops under `prefers-reduced-motion: reduce`. No decorative loops or animated celebrations interrupt checkout.
- Page titles, headings, landmarks, language metadata, and zoom support form part of frontend acceptance checks.

## 8. Data and payment states

Copy examples below are proposed Indonesian UI wording, not a decision about the final localization strategy.

| Situation | Proposed wording and behavior |
| --- | --- |
| Empty order | `Belum ada item. Pilih produk atau layanan untuk memulai.` |
| Empty search | `Tidak ada hasil untuk pencarian ini.` Keep the query editable and offer clearing it. |
| Catalog loading | `Memuat produk…` or `Memuat layanan…`; preserve the surrounding layout. |
| Catalog error | `Daftar item belum dapat dimuat.` Offer `Coba lagi` when retry is possible. |
| QRIS pending | `Menunggu konfirmasi pembayaran.` Do not show a paid receipt or manual mark-paid action. |
| Payment confirmed | `Pembayaran berhasil.` Only after the API reports confirmed payment. |
| Payment status unavailable | `Status pembayaran belum dapat diperiksa.` Preserve the known pending state; do not imply failure or request another charge. |
| Payment failed or expired | Show the actual returned state and only recovery actions supported by the payment flow. |
| Notification delivery failed | `Pembayaran berhasil. Notifikasi belum terkirim.` Keep payment success separate from notification delivery. |

Empty, loading, error, permission-denied, and session-expired states are distinct. Failed writes preserve recoverable form data. Checkout retries retain the appropriate request identity and must not cause duplicate orders or charges.

QRIS appears only when an adapter is available. A development QR is visibly identified as test-only; no invented provider branding or compatibility claim is shown. All monetary values come from the API and use integer IDR formatting. Dates use the configured business timezone, defaulting to Asia/Jakarta.

## 9. Theme and receipt boundaries

The selected palette defines a light default, intended for readable counter operation in daylight or well-lit interiors. Lighting suitability still needs staff UAT; this is not a measured ergonomics claim. If a light/dark toggle is included in frontend scope, both variants need complete tokens, component-state contrast checks, and runtime verification before shipping. An unstyled dark variant is not part of this direction.

Printed receipts use black on white, readable amounts, and persisted transaction details rather than screen decoration. Printer size, required receipt fields, taxes, and footer wording need owner confirmation; no printer format or accounting policy is assumed here.

## 10. Verification status

**Document review, not application certification:**

- **Hard gate PASS (document scope):** No fabricated metrics, customers, testimonials, provider claims, or final assets. Contrast checked for specified pairings. Layout proposals and unimplemented frontend requirements are explicitly identified.
- **Purpose gate PASS:** Palette, typefaces, spacing, elevation, panel placement, and status colors each have a written operational or identity reason. Decorative techniques are not added by default.
- **Liveliness PASS:** ENERGY 2 / RHYTHM 1 / MOTION 1 are explicit. The boutique title treatment, ivory/espresso workspace, receipt-style panel, and restrained burgundy action define the proposed identity and focal hierarchy.
- **Craftsmanship and quality locks PASS (document scope):** Proposed screens follow documented kedai/salon jobs, include responsive and failure-state requirements, and distinguish real API capability from design intent.

**Core implementation verification:** The Next.js frontend passed TypeScript, ESLint, 133 unit tests, a production build, and 22 real-API browser/integration scenarios, including touchscreen tablet checks. Navigation, font rendering, payment recovery, keyboard dialogs, mobile reflow, 200% text resizing, and print-media behavior were exercised. Docker startup and production login/logout also passed. Recorded scope and evidence are in [docs/FRONTEND-VERIFICATION.md](docs/FRONTEND-VERIFICATION.md) and [docs/TABLET-VERIFICATION.md](docs/TABLET-VERIFICATION.md). Category implementation and migration evidence is in [docs/CATEGORY-VERIFICATION.md](docs/CATEGORY-VERIFICATION.md).

**Still outside verification:** Physical-device keyboards, physical printer output, staff UAT, real payment-provider certification, external HTTPS deployment, dark-mode implementation, and field performance measurements. No light/dark toggle is shipped; the selected light theme is the current frontend direction.
