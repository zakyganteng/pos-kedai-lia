# Lia POS black-box verification and bounded UAT

## Scope and evidence policy

The independent API suite is in `project/tests/`. It builds and starts the **actual Go API**, migrates a **new PostgreSQL database** (the migration creates the default owner), and exercises only public HTTP routes. It never imports application services/repositories, edits migrations, inserts fixture sales with SQL, or substitutes in-memory persistence. Role fixtures, catalog, stock, customers, staff, sales, and queues are created through the API.

The suite runs in **two phases against two separate disposable databases and two separate API processes**, because notification provider configuration is process-wide and a second outbox worker on a shared database would claim the other phase's jobs:

- **Phase 1 — `tests/api.test.mjs`**, `NOTIFICATION_PROVIDER=disabled`. Verifies the observable undelivered state rather than a false success.
- **Phase 2 — `tests/notifications.test.mjs`**, `NOTIFICATION_PROVIDER=http` pointed at the loopback notification boundary. Verifies the real adapter transport, the rendered outbound payload, and scheduled retry behaviour.

The only double is `tests/support/gateway.mjs`, a deterministic loopback HTTP fixture with two independent boundaries:

- **Payment intent boundary** (`/mock-gateway/v1/payments`): validates adapter credentials, stable provider idempotency headers, amount/currency, and returns a pending test intent. Its opaque QR payload is deliberately **not payable**.
- **Notification boundary** (`/notify/v1/messages`): validates the bearer credential and the paired `Idempotency-Key`/`X-Idempotency-Key` headers, records the **exact request bytes of every attempt** (including deterministically rejected ones) and can be told to reject the next N messages.

The fixture is started only by the test runner. It is not an application service, a deployment component, a bundled mock gateway, or a real-provider compatibility claim; passing the notification cases proves the POS-side transport and outbox behaviour only, **not** WhatsApp vendor delivery. Signed callback bodies are delivered over HTTP using Node's `crypto` HMAC-SHA256.

A test passing is not owner/staff UAT, real payment certification, delivery confirmation, production approval, or a performance benchmark. No production credentials or customer data are required.

## Executable commands

Prerequisites: Node.js 22+, Go version required by `backend/go.mod`, PostgreSQL 16+ running, and `psql` on PATH. The PostgreSQL administrative user needs CREATE/DROP DATABASE on a local or dedicated **test** cluster. The default uses the current OS PostgreSQL user over the local socket (`postgres:///postgres`). No npm install is required.

From the repository root:

```sh
# Static syntax verification; no database needed.
node --check project/tests/run.mjs
node --check project/tests/api.test.mjs
node --check project/tests/notifications.test.mjs
node --check project/tests/support/api.mjs
node --check project/tests/support/gateway.mjs
node --test project/tests/support.test.mjs

# Full real API + disposable PostgreSQL verification (two phases; expect roughly 60-70s
# because NOTIF-03 deliberately waits out the backend's 30 second delivery backoff).
node project/tests/run.mjs

# Explicit dedicated test cluster (never production):
QA_PG_ADMIN_URL='postgresql://test_user:test_password@127.0.0.1:5432/postgres' \
  node project/tests/run.mjs

# Preserve TAP output and a sanitized server log (optional):
set -o pipefail
QA_LOG_PATH=/tmp/lia-pos-qa-api.log node project/tests/run.mjs \
  2>&1 | tee /tmp/lia-pos-qa.tap
```

The runner:

1. Runs `go build -o <temporary-directory>/pos ./cmd/pos` inside `project/backend` and starts the loopback fixture on **19091** (`QA_GATEWAY_PORT`).
2. Creates `lia_pos_qa_<runner-pid>` for phase 1 and `lia_pos_qa_<runner-pid>2` for phase 2; the suites refuse to run without that isolation marker. It never truncates or resets an existing application database.
3. Runs `pos migrate` per phase with the test-only database URL, then logs in as the default owner `owner@owner.com` / `owner-password-123` that the migration creates.
4. Starts the actual `pos serve` process on **18081** for phase 1 and **18082** for phase 2 (`QA_API_PORT` sets the base port).
5. Uses `APP_ENV=development`, `SESSION_TTL=30m`, `BUSINESS_TIMEZONE=Asia/Jakarta`, `PAYMENT_PROVIDER=mock`, `PAYMENT_BASE_URL=http://127.0.0.1:19091/mock-gateway/v1` and random provider/HMAC secrets in both phases. Phase 1 sets `NOTIFICATION_PROVIDER=disabled`; phase 2 sets `NOTIFICATION_PROVIDER=http`, `NOTIFICATION_BASE_URL=http://127.0.0.1:19091/notify/v1`, a random notification key, a synthetic destination, and an explicit non-default `NOTIFICATION_TEMPLATE` exercising every supported placeholder. Production credentials inherited from the shell are overwritten for these adapters.
6. Waits for actual HTTP readiness for at most approximately 10 seconds per phase, then runs Node's built-in test runner sequentially. Individual HTTP requests time out after 5 seconds (20 seconds for the intentional provider-response timeout, 10 seconds for recovery); disabled-WhatsApp failure observation is bounded to 6 seconds and the scheduled-retry case to 75 seconds because the backend's first delivery backoff is 30 seconds. Concurrent scenario requests are deliberately launched with `Promise.all`.
7. Stops both APIs and the test-only fixture, drops **only its newly-created databases**, and removes the temporary binary on success/failure/interruption. `SIGKILL` cannot be trapped; inspect and remove an orphaned `lia_pos_qa_<pid>` manually only after confirming it belongs to an abandoned QA run.

Use a dedicated test cluster because the admin connection has database-creation rights. Do not point the suite at an existing application server or live business data. Run near—but not across—Jakarta midnight; an explicit guard fails a crossing rather than silently comparing the wrong reporting day.

## Fixture and assertion design

- The migration supplies only the default owner and fixed lines: kedai `11111111-1111-4111-8111-111111111111`; salon `22222222-2222-4222-8222-222222222222`.
- Owner creates an admin assigned both lines and two cashiers assigned one line each via `/users`. Only one deliberate bad-password login is sent, avoiding accidental shared login-limit exhaustion.
- Every logical mutation gets a fresh UUID-based idempotency key unless the scenario explicitly repeats it.
- Report expected values come from known fixture prices/quantities and accepted terminal outcomes, not from report totals. A multi-item sale and two services for one stylist distinguish quantity/join-row counts from **distinct sale counts**.
- The suite uses paginated API reads to inspect ledgers, receipts, delivery history, and reconciliation events. No SQL assertion shortcuts.
- Money assertions use integer IDR. Signatures cover exact UTF-8 serialized bytes; changing whitespace while retaining a prior signature must fail.
- Error assertions check HTTP status, structured `error.code/message/requestId`, and absence of common internal-error/secret leakage. Foreign detail IDs may return 403 or concealment 404; foreign-line list requests must return 403.
- Server-side filter assertions are **partition-based**: a filtered result must both contain only matching rows and, unioned across the enum, reproduce the unfiltered set exactly. That distinguishes a real SQL predicate from an ignored query parameter or from client-side filtering.
- Phase 2 asserts the provider transport contract and the server-side rendering contract: one authenticated call per logical outbox record, the paired idempotency headers, byte-identical resend on retry, and a message equal to the configured `NOTIFICATION_TEMPLATE` with only the documented server-side placeholders substituted. No vendor rendering or delivery is claimed.

## Automated scenario matrix

| ID / feature | Real-life scenario and bounded inputs | Oracle / required outcome |
|---|---|---|
| API-01 F01 | Unauthenticated browser, forged bearer, one bad password, logout followed by token reuse | 401; no protected data; revoked token rejected |
| API-02 F01 | Kedai-only cashier opens salon list/detail/payment/queue or submits salon references in kedai sale | 403 / concealed detail 404; no cross-line data or mutation |
| API-03 F01/F04 | Cashier attempts catalog/inventory/staff mutation, user administration, detailed report/export, notifications/reconciliation; admin attempts owner settings | 403 at API, not only hidden UI |
| API-04 F01/F02/F05 | Malformed/absent UUIDs; pages 0/-1; limits 0/101/non-integer; broken/trailing JSON; null; unknown fields | Structured 400/404; no panic/database detail leakage |
| API-05 F02 | Create/search/update/archive product; duplicate SKU; change price/name after paid checkout | Unique SKU conflict; historical receipt unchanged; archived item cannot be sold |
| API-06 F02/F04 | Service/customer/staff CRUD and archive after attributed salon sale | Updated directory records; historical customer/staff references and service snapshot survive |
| API-07 F02/F05 | Negative/fractional/excessive price, invalid phone/duration/name, zero/negative/fractional/>1000 quantity, empty cart, underpaid cash, client totals | Validation rejects; no incorrect sale or integer rounding |
| API-08 F05 | Repeat the same cash checkout three times, then change quantity under the same key; reuse key for another user/line/queue operation | Same original sale response; changed fingerprint 409; unrelated scopes remain independent |
| API-09 F03/F05 | 8 simultaneous same-key cash submissions, quantity 2, stock 8 | One sale, one stock debit, final stock 6 |
| API-10 F03/F05 | Audited receive/adjust with zero/negative-stock attempts; 6 simultaneous distinct cash sales for one unit | Actor/time/reason retained; invalid adjustments rejected; exactly one 201 and five 409; one debit; zero stock |
| API-11 F05/F06 | 8 simultaneous same-key QR checkouts against external HTTP fixture | One sale and one logical/provider intent; stable idempotency; still pending; browser PATCH cannot confirm |
| API-12 F06 | Wrong HMAC; valid event with whitespace changed after signing; wrong event header key; exact pretty JSON with `sha256=` prefix | Rejected events cannot confirm; exact signed body accepted |
| API-13 F06 | Six simultaneous identical webhook retries; same event ID with changed signed amount | Single stored event/effect; changed payload 409 |
| API-14 F06 | Separately signed amount, currency, merchant reference, and provider payment reference mismatches | 409; pending remains pending; no notification |
| API-15 F03/F06 | 6 concurrent distinct QR intents for one stock unit; failure/replay then two competing cash sales | One QR reservation; release exactly once; only one subsequent cash sale succeeds |
| API-16 F06 | Failed/expired followed by success; confirmed followed by failed/expired | Terminal state never reopens/regresses; conflicts retained for reconciliation; no false revenue or stock release |
| API-17 F07 | Confirm cash/QR with WhatsApp unavailable, then admin retries failed outbox | Checkout/webhook return <2s in local functional envelope; visible failed delivery, never sent; one logical notification; cashier/anonymous retry denied; disabled provider returns explicit 503 `NOTIFICATION_DISABLED`; configured transient provider can enqueue retry; payment stays confirmed |
| API-18 F09 | Six same-key queue submissions, changed note replay, 12 distinct simultaneous walk-ins | One replayed entry, changed payload 409; 12 unique contiguous daily numbers |
| API-19 F09 | Waiting→completed, reverse in-service, valid completion with salon sale, wrong-line sale link, terminal cancellation | Invalid transitions rejected; valid timestamps/sale association; terminal states protected |
| API-20 F08 | Invalid/impossible/reversed dates; 367 inclusive days; 366-day boundary; empty historic date; invalid grouping | 400 for invalid/excessive; allowed boundary; empty report is zero |
| API-21 F08 | Both lines, mixed cash/QR/pending/failed/expired, archived snapshots; day/method/item/staff grouping | Confirmed-only independent totals; distinct transaction counts; stable ID group keys; no cross-line mixing |
| API-22 F08 | CSV for each line and today's Jakarta business date | Exact columns `saleId,businessLineId,createdAt,paymentMethod,total`; exactly confirmed sale IDs; integer per-sale amounts and aggregate equal expected report |
| API-23 F05/F06 | External provider persists intent but withholds response; valid callback arrives before response/attachment, followed by retry | Bounded timeout; early event retained/recoverable; same sale/reference/key reused; one stock debit; same signed event can confirm after recovery |
| API-24 F06 | Authenticated terminal event occurred 30 days ago and arrives after confirmation | Retained timestamp and approved `stale` outcome for reconciliation; no payment regression or invisible loss |
| API-25 F07 | Catalog changes between failed notification and retry | API-visible outbox ID, sale ID, createdAt and masked destination remain stable; message body is not exposed and is not claimed asserted |
| API-26 F08 | Interleave 24 report reads with eight payment confirmations | Every report uses internally consistent totals/group amounts/counts within before/after bounds; final aggregate includes all eight exactly once |
| API-27 F03/F08 | Inventory report: received/zero/untracked products, a pending QR reservation then its confirmation, `lowStock=true`, missing/invalid `businessLineId`/`lowStock`, salon line and foreign line | Tracked items only, integer on-hand/reserved/available; reservation shows as reserved not available and debits on-hand only on confirmation; low-stock view is exactly the at-or-below-threshold subset; 400 for wrong line type or bad input, 403 for unassigned line |
| API-28 F01 | Owner creates, lists, reads, re-assigns lines for, and archives a dedicated user; duplicate email, 5-byte password, unknown role/line, blank name, bad email; admin/cashier/anonymous attempt every user route; owner demotes/archives the last active owner | No password or hash in any payload; line change and archive revoke the live session immediately (401) and archive blocks re-login; all non-owner access 403; last active owner returns 409 and keeps working |
| API-29 F01/F05/F09 | Omit `limit`; partition the sale ledger by `status` and by business date; `status=refunded`; `from=not-a-date`; partition the queue day by `status`; `status=no_show`; `date=2000-01-01` | Default page size is 20; status/date filters are applied server-side and partition the same ledger/day exactly with no duplicates or losses; invalid enum/date values are 400 |
| API-30 F06 | Reconciliation `search` by event, sale, provider payment reference and a raw substring; `outcome` enum and an invalid outcome; `limit=1` paging of a filtered view; a salon event searched from the kedai line; cashier access | Filtered `pagination.total` describes the filtered set, not the table; every returned row matches; paging at limit 1 returns each event exactly once; foreign-line events are unreachable; invalid outcome 400; cashier 403; no signature/QR/secret material in the payload |
| API-31 F01/F10 | 2 MiB product body; `text/plain`, form and absent content types; empty body; unknown route; wrong method on a known route; unknown webhook provider segment | Oversized body refused at the documented 1 MiB cap; non-JSON and empty bodies are 400; unknown route/method/provider stay below 500 with a structured error |
| NOTIF-01 F07 | Phase 2: confirmed cash sale with a reachable provider boundary and an explicit non-default `NOTIFICATION_TEMPLATE`; retry the sent notification; read integration status | Exactly one provider call keyed by the outbox ID; the rendered body equals the configured template with `{{saleId}}`/`{{total}}`/`{{businessLineId}}` substituted from server-side sale values and no unresolved placeholder; outbox exposes masked destination only and never the full destination or credentials; retrying a sent notification is 409 and does not reach the provider; integrations report `configured` but not production-ready |
| NOTIF-02 F07 | Phase 2: QR sale pending, then one signed success event, then two identical replays | Pending QR never notifies; webhook returns in <2s; exactly one logical notification and exactly one provider call survive the replays |
| NOTIF-03 F07 | Phase 2: boundary deterministically rejects the first message; catalog name/price changed between attempts; wait out the backend's 30s first backoff | Checkout stays confirmed; the scheduled retry resends **byte-identical** rendered content under the same outbox idempotency key and still matches the template rendered from the original sale; one logical outbox record converges to `sent` with a visible attempt count ≥ 2, stable `id`/`createdAt`/masked destination, and cleared error |
| NOTIF-04 F07/F10 | Phase 2: start the real binary with an unsupported placeholder, a malformed placeholder, whitespace-only, a control character, and an over-length `NOTIFICATION_TEMPLATE` | Startup fails non-zero for every supplied bad value, names `NOTIFICATION_TEMPLATE`, and emits no panic, SQLSTATE or credential. An absent/empty variable is documented "use the default" and is out of scope for this case |

**Deliberately bounded follow-up scenarios, not claimed automated here:** real QR expiry clock advancement, process crash/restart during provider intent and notification delivery, gateway explicit 5xx recovery (ambiguous timeout is covered above), permanent notification failure after the full five-attempt backoff chain (~7.5 minutes of wall clock), real WhatsApp vendor delivery and vendor-rendered template approval, session expiry wall-clock test, brute-force login limiter load, queue rollover across Jakarta midnight, and the >10,000-sale export `413` no-silent-truncation boundary. These need controlled clocks, fault injection, vendor sandbox, or operations ownership; add evidence before their corresponding release claim. Container-restart persistence and backup/restore are out of this suite's scope but **are** covered by the coordinator's Docker scripts — see release blocker 4.

## Owner/staff UAT (manual, not replaced by passing API tests)

Use anonymized sandbox fixtures. Record date, build SHA/version, device/browser, operator, elapsed time, result and defect evidence. Owner and one operator from **each business** sign off. Run each case once on desktop/tablet and repeat marked mobile cases at 360px; keyboard-only checks on desktop.

| UAT | Operator / bounded scenario | Acceptance / evidence |
|---|---|---|
| UAT-01 | Owner logs in, switches kedai/salon; restricted cashier repeats; wrong password and expired session | Only assigned lines visible; correct empty/loading/error/401/403 states; no stale foreign-line data |
| UAT-02 (mobile) | Cashier buys 2 products, adjusts quantity, selects optional customer, pays exact cash and then overpays | Saved totals/change correct; responsive receipt printable; repeat click/retry creates one sale |
| UAT-03 (mobile) | Cashier initiates one QR sale; observe pending, then valid sandbox confirmation; repeat with invalid/mismatched callback | QR stays pending until trusted event; no browser self-confirm; failed/expired receipt not shown as paid |
| UAT-04 | Admin changes price and archives previously sold item; cashier views old receipt and starts new cart | Historical name/price remain; archived item not selectable/sellable; validation errors understandable |
| UAT-05 | Two cashiers simultaneously buy the last item | One succeeds; loser sees useful stock conflict; refresh shows zero; ledger attributable |
| UAT-06 (mobile) | Salon operator creates 3 walk-ins, assigns staff/customer, calls and completes one, cancels one | Queue sorted/numbered; valid actions/timestamps; no invalid backward transition; sale link available |
| UAT-07 | Admin edits customer/staff, archives referenced person; cashier performs permitted customer lookup/create | Correct role boundaries and retained historical references; no secret exposure |
| UAT-08 | Admin opens failed WhatsApp history after confirmed payment, retries; cashier attempts same URL | Failure visible without misleading sent label; payment remains confirmed; unauthorized retry denied |
| UAT-09 | Owner reconciles a prepared day (≤30 sales across both lines) using day/method/item/staff report and CSV | Values match receipts; pending/failed excluded; clear sales/revenue wording, **not profit**; end-of-day workflow <10 minutes |
| UAT-10 | Tablet/mobile with delayed network, empty search, one server error; keyboard through core forms | No clipped controls at 360px, clear labels/focus/error recovery, duplicate actions controlled, no lost cart silently |

Stop UAT on false payment confirmation, data leakage, duplicate charge/order, overselling, or report discrepancy. Record reproducible steps; retest the failed scenario plus its affected automated group before signoff.

## Execution record

All entries below are actual observed runs. A line is only added after the command was executed and its output read.

### Historical runs (earlier build states, kept for traceability)

- First real-run attempt: setup correctly created/dropped `lia_pos_qa_42991` on actual PostgreSQL 17.5, but the backend build was blocked: `stat project/backend/cmd/pos: directory not found`. **No API cases executed**; temporary database cleanup succeeded.
- Buildable-backend run (`lia_pos_qa_68523`): Go build succeeded, but `pos migrate` exited 1 with PostgreSQL `ERROR: syntax error at or near "->>" (SQLSTATE 42601)`. **No API cases executed**; disposable database dropped. Reported to the coordinator for backend-owned migration correction.
- First HTTP acceptance run (`lia_pos_qa_79985`): 57/65 TAP assertions passed; failures included QA fixture control fields accidentally submitted in sale JSON (corrected in QA code) and an overly short 5-second callback deadline during the intentional provider stall (raised to the documented 20-second fault-test bound).
- Corrected HTTP acceptance run (`lia_pos_qa_84845`): **63 passed, 5 failed of 68**. Underlying issues: malformed raw JSON `{` returned 500 rather than 400; the retained stale event returned outcome `stale` instead of the then-documented `terminal_conflict`; disabled-provider admin retry returned 503 `NOTIFICATION_DISABLED` rather than 202.
- Coordinator approved/documented contract decisions: the retained stale-event outcome is `stale`, and disabled notification retries intentionally return 503 `NOTIFICATION_DISABLED`. QA assertions were updated accordingly.

### Current evidence (2026-09-30, Go 1.26.4, PostgreSQL 17.5, Node 22.20.0)

- Syntax checks: `node --check` passed for the runner, both suites, the API helpers, and the gateway fixture.
- Harness self-tests: `node --test project/tests/support.test.mjs` — **4 passed, 0 failed** (CSV quoting parser, payment boundary contract/idempotency, persisted-intent response-timeout recovery, notification boundary authentication/attempt recording/deterministic rejection). These are fixture contract tests, not application acceptance tests.
- Totals for the current tree: **102 black-box assertions across both phases plus 4 harness self-tests, 0 failures, reproduced twice.**
- Regression baseline before this round's additions (`lia_pos_qa_82166`): **68 passed, 0 failed of 68**. The previously reported malformed-JSON 500 defect is fixed; raw `{`, `{} {}` and `null` bodies now return structured 400.
- Full two-phase run after adding API-27–API-31 and NOTIF-01–NOTIF-03 (`lia_pos_qa_14269` / `lia_pos_qa_142692`): phase 1 **93 passed, 0 failed of 93**; phase 2 **7 passed, 0 failed of 7**. Runner exit 0.
- Repeat run for flake detection at that build (`lia_pos_qa_20421` / `lia_pos_qa_204212`): phase 1 **93/93**, phase 2 **7/7**, runner exit 0. Both disposable databases dropped; `pg_database` contained no residual `lia_pos_qa%` entries afterwards. The sanitized server log contained no bcrypt hashes and no provider credentials.
- `NOTIFICATION_TEMPLATE` landed in the backend during this round. NOTIF-01/03 were tightened from "body identifies the sale" to exact equality against the configured template, and NOTIF-04 was added for startup configuration validation. One intermediate failure was found and resolved in QA code, not by weakening an assertion: an empty `NOTIFICATION_TEMPLATE` correctly falls back to the documented default (standard env-var semantics) rather than failing startup, so it was removed from the invalid-value list and documented.
- **Authoritative run against the current tree** (`lia_pos_qa_42210` / `lia_pos_qa_422102`): phase 1 **93 passed, 0 failed of 93**; phase 2 **9 passed, 0 failed of 9**. Runner exit 0.
- **Independent repeat of the same tree** (`lia_pos_qa_60594` / `lia_pos_qa_605942`): phase 1 **93/93**, phase 2 **9/9**, runner exit 0. No backend or contract file changed between these two runs. All four disposable databases were dropped and no orphans remained.
- **Independent coordinator reproduction on non-default ports** (`QA_API_PORT=18101 QA_GATEWAY_PORT=19101`, databases `lia_pos_qa_63729` / `lia_pos_qa_637292`): **93 API assertions + 9 notification assertions, zero failed, zero skipped**, databases cleaned. Confirms the suite is port-portable and not dependent on this workstation's state.
- The final backend handoff migrates to **schema version 3** (`schema_migrations.version=3`, `sale_items` and `outbox_jobs` present). The runner always creates an empty database and runs `pos migrate` first, so every run above executed the current migration chain end to end; readiness would have failed otherwise.
- Timing evidence that NOTIF-03 exercised a real scheduled retry rather than an immediate resend: that case takes roughly **34 s**, consistent with the backend's 30-second first-failure backoff plus the 2-second worker tick.
- Reconciliation `search`/`outcome` server-side filtering (coordinator request) is implemented and verified by API-30, including filtered `pagination.total`, `limit=1` paging, invalid-outcome 400 and cross-line isolation.
- Coordination note on `NOTIFICATION_TEMPLATE`: the runner now sets an explicit non-default template exercising `{{saleId}}`, `{{total}}` and `{{businessLineId}}`, and NOTIF-01 asserts the rendered provider payload equals that template exactly. A default or configured template that drops a placeholder, leaves `{{...}}` unresolved, or re-renders differently on retry will fail NOTIF-01 or NOTIF-03.
- Backend-owned checks reported by the coordinator and **not** re-run here: `go vet` and `TEST_DATABASE_URL=postgres:///postgres go test -race -count=1 ./...` — 32 tests pass. That is backend evidence, separate from this black-box suite.
- **No open QA-reported backend or frontend defects at this commit state.** Every failure previously reported by QA is either fixed or resolved by a documented contract decision.
- Owner/staff UAT: **not performed**.
- The frontend was removed on 2026-11-05; this document records API evidence only.
- Real payment/WhatsApp sandbox certification and production vendor selection: **external release gates**.

### Remaining release blockers

1. No QRIS/payment provider selected; all payment evidence is against a loopback test double.
2. No WhatsApp vendor, approved template, destination rule or consent policy; NOTIF-01–03 prove POS transport and outbox behaviour only.
3. Owner/staff UAT (UAT-01 – UAT-10) not executed, including the <10 minute end-of-day reconciliation goal.
4. Backup/restore and container-restart persistence are **verified locally on Docker by the coordinator**, not by this suite: `scripts/test-stack.sh` (schema 3 runtime security/template/timezone checks plus a full-schema backup and restore) and `scripts/test-backup-restore.sh` (checksum verification, refusal path, persistence across restart) passed against real Docker builds. **Restore on the actual staging/production host remains an external operations gate** and must be evidenced there before release.
5. Expense/net-profit semantics still undefined; reports must continue to say sales/revenue, not profit.
6. The bounded follow-up scenarios listed above remain unautomated.
