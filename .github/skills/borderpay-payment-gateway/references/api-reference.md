# Borderpay API reference notes

Verified against the [guides](https://borderpay.id/docs), [API reference](https://borderpay.id/api-reference), and [OpenAPI JSON](https://borderpay.id/openapi.json) on 2026-11-10. This is a summarized snapshot; check live sources before implementing or relying on changeable details.

## Guide index

| Topic | Official guide |
| --- | --- |
| Overview and integration choices | https://borderpay.id/docs |
| Project preparation | https://borderpay.id/docs?s=persiapan |
| Hosted pay-link | https://borderpay.id/docs?s=paylink |
| Embedded checkout | https://borderpay.id/docs?s=embed |
| WooCommerce | https://borderpay.id/docs?s=woocommerce |
| Authentication | https://borderpay.id/docs?s=auth |
| Create a payment/session | https://borderpay.id/docs?s=create |
| Payment methods and banks | https://borderpay.id/docs?s=methods |
| Status and cancellation | https://borderpay.id/docs?s=status |
| Test simulation | https://borderpay.id/docs?s=simulate |
| Payment listing and balance | https://borderpay.id/docs?s=list |
| Create a payout | https://borderpay.id/docs?s=payout |
| Payout status and listing | https://borderpay.id/docs?s=payout-status |
| Webhook notifications | https://borderpay.id/docs?s=webhook |

## Connection and authentication

- Base URL: `https://borderpay.id/api/v1`.
- Authentication: `Authorization: Bearer <PROJECT_API_KEY>`.
- Prefix `bp_test_` selects sandbox; `bp_live_` selects real-money transactions. There is no separate sandbox base URL in the spec.
- JSON request bodies use `Content-Type: application/json`.
- Amounts are integer IDR (whole rupiah), not decimal currency strings or cents.
- The reference documents a limit of 120 requests per 60 seconds per API key. Recheck before designing polling or retry behavior.

## REST operations

Paths below are relative to the base URL. `{reference}` is the merchant payment `reference_id`, not an assumed internal payment ID.

| Method | Path | Purpose and constraints |
| --- | --- | --- |
| POST | `/payments` | Create checkout session or direct charge. `201` means created; `200` may mean an idempotently reused payment. |
| GET | `/payments` | Most recent 50 payments for the API key's mode, returned in `data`. |
| GET | `/payments/{reference}` | Retrieve payment status and totals. |
| POST | `/payments/{reference}/cancel` | Cancel a `pending` payment; the resulting status is `expired`. |
| POST | `/payments/{reference}/simulate` | Mark a pending test payment `paid`; not allowed with a live key. |
| GET | `/payment-methods` | Discover enabled QRIS, VA banks, e-wallets, and fees for this merchant. |
| GET | `/balance` | Retrieve `available`, `pending`, and `currency`. |
| POST | `/disbursements` | Create a bank payout; live payouts require approved KYC. |
| GET | `/disbursements` | Most recent 50 payouts for the API key's mode, returned in `data`. |
| GET | `/disbursements/{id}` | Retrieve a payout by Borderpay payout ID or merchant `reference_id`. |

The published operations do not document pagination parameters or a refund operation. Do not infer either from status names or general payment gateway conventions.

## Creating payments

Source: [creation guide](https://borderpay.id/docs?s=create), OpenAPI `CreatePaymentRequest` and `Payment`.

| Field | Contract |
| --- | --- |
| `amount` | Required integer, minimum 1, original order amount in rupiah. |
| `reference_id` | Optional in the schema, at most 64 characters. Supply a stable, unique order/payment-operation reference for idempotency. |
| `method` | Omit for a checkout session; otherwise `qris`, `va`, or `ewallet` for a direct charge. |
| `bank_code` | Required by the field description for `va` and `ewallet`, at most 16 characters. Discover supported codes from `/payment-methods`. |
| `return_url` | Optional URI, at most 2048 characters. HTTPS required, with `http://localhost` also accepted for test keys. |
| `fee_borne_by` | Deprecated request field. Fee allocation belongs in project dashboard settings. |

Payment responses can include `type` (`session` or `charge`), `id`, `reference_id`, `status`, `mode`, `amount`, `customer_pays`, `merchant_receives`, `fee`, `fee_borne_by`, `pay_url`, `checkout_url`, `return_url`, `qr_string`, `va_number`, `va_bank`, `expires_at`, and `reused`.

`checkout_url`, `return_url`, `qr_string`, `va_number`, `va_bank`, and `expires_at` can be null in the schema. Do not assume every method returns the same payment instructions.

The API uses `reference_id` for create idempotency. Repeating a reference can reuse a resource; the create-payment operation also documents `409` conflicts such as `already_paid` and `reference_mode_mismatch`. Do not treat every repeated request as successful creation.

### Amounts and statuses

Source: OpenAPI `Payment`, `PaymentStatus`, and `WebhookEvent`.

| Context | Meaning |
| --- | --- |
| POST payment request/response `amount` | Original order amount. |
| GET payment status `order_amount` | Original order amount, suitable for matching the order. |
| GET payment status `amount` | Compatibility field equal to `customer_pays`, not necessarily the original order amount. |
| Webhook `data.amount` | Gross total paid by the customer. |
| `customer_pays` | Customer-payable total, including fees when allocated to the customer. |
| `merchant_receives` | Net amount received by the merchant. |

Payment/status schemas list `pending`, `paid`, `expired`, `failed`, and `refunded`. The introductory guide lists only the first four; account for `refunded` in API responses without inventing a refund endpoint or notification.

Cancellation is only for `pending` payments. Documented errors include `409` when payment wins the cancellation race, `422` for a non-pending state, and `502` if gateway deactivation fails.

The methods response has `qris` and `va` sections with enablement and fee information. `ewallet` may be absent entirely if that feature is not enabled. Do not hardcode a bank/wallet list or fee schedule.

## Embedded checkout and hosted links

Sources: [embed guide](https://borderpay.id/docs?s=embed), [pay-link guide](https://borderpay.id/docs?s=paylink).

For embedded checkout, the server first creates a session through `POST /payments` without `method`. The browser loads `https://borderpay.id/embed.js` and calls `BorderPay.checkout({ reference: "<reference_id>", onSuccess, onClose })`. Only the public payment reference goes to the browser; the API key stays on the server.

`onSuccess` and `onClose` support the UI flow. Neither is proof that an order should be fulfilled. Use verified server-side payment confirmation. The request schema notes that hosted non-embed checkout can auto-redirect to `return_url`, while embed mode communicates through `postMessage`; consult the embed guide before implementing custom message handling.

For a hosted pay-link or WooCommerce setup, consult the linked guide for the current URL format, parameters, and configuration rather than extrapolating them from REST endpoints.

## Webhooks

Source: [webhook guide](https://borderpay.id/docs?s=webhook), OpenAPI `webhooks.payment` and `WebhookEvent`.

- Configure the receiving URL and verification token in the project dashboard.
- Borderpay sends a JSON `POST` to that URL.
- Verify `x-borderpay-token` against the configured token with a timing-safe comparison. The documented mechanism is token comparison, not an HMAC signature.
- Additional headers are `x-borderpay-event` and `x-borderpay-mode` (`test` or `live`).
- Event names are `payment.paid`, `payment.expired`, and `payment.failed`.
- The body contains `event`, `mode`, and `data`. Data fields include `slug`, `mode`, `reference_id`, `order_id`, `status`, `amount`, `fee`, `merchant_receives`, and `method`.
- `WebhookEvent.data` describes `mode`, but the guide's example omits it. Validate top-level mode and any mode values that are present; do not require a nested field solely because it appears in the property list.
- A payment can become `paid` after an `expired` notification; the guide says to treat `paid` as final in that sequence.
- Persist the payment/order change before replying `2xx`. Already-processed duplicate notifications should not repeat fulfillment.
- The inspected contract does not specify a delivery retry schedule. Do not promise particular timing or counts.

## Payouts

Sources: [payout guide](https://borderpay.id/docs?s=payout), OpenAPI `CreateDisbursementRequest` and `Disbursement`.

`POST /disbursements` requires `amount`, `bank_code`, `account_number`, and `account_name`. `reference_id` is optional in the schema; supply one for idempotency.

The requested `amount` is the net amount the recipient receives. The response distinguishes it from `fee` and `total_deducted`, the gross deduction from the merchant balance.

Payout statuses are `pending`, `processing`, `delivered`, and `failed`, not payment statuses. Test mode does not move real funds; live mode requires approved KYC. Check the live docs for eligibility, bank support, minimums, and fees.

## Error handling and sandbox checks

Errors use `{"error":{"code":"<machine_code>","message":"<message>"}}`; messages in the reference are Indonesian. Branch on HTTP status and `error.code`, not translated message text.

Common documented statuses include `400` invalid input/JSON, `401` invalid or missing API key, `403` project/mode/eligibility restrictions, `404` not found, `409` reference or state conflicts, `422` provider/validation rejection, and `429` rate limiting. Available errors vary by operation.

To check a sandbox payment: create with a `bp_test_` key and a stable reference, call `POST /payments/{reference}/simulate`, then retrieve `GET /payments/{reference}` and verify the resulting status. Exercise webhook receipt as well when the configured callback is reachable. These are integration steps, not checks already executed while authoring this skill.
