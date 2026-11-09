# Deployment and operations

## What this stack runs

`compose.yaml` runs three services: `db` (PostgreSQL 17), `backend` (the Go API), and `frontend` (the Next.js core POS). The API also runs its payment-expiry and notification workers. Every time the backend container starts it runs `pos migrate` and then `pos serve`; migration is idempotent and, while the users table is empty, creates the default owner. If migration fails, the API does not start. There is no payment gateway or WhatsApp vendor service in this stack.

The database volume survives `make down`, container replacement and host reboot. It does not survive disk loss or `docker compose down --volumes`. Never use the latter on a real deployment.

The frontend publishes `FRONTEND_PORT` (default 3000), the API publishes `BACKEND_PORT` (default 8080), and the database publishes `DB_PORT` (default 5432), all to host loopback only. All services share the default Compose network. The API container runs as the non-root `nobody` user; the frontend runs as `node`. Docker and host administrators can still read container environment variables. Restrict access to both.

For simple local use, one PostgreSQL superuser, `postgres`, initializes the database, runs migrations, serves the API and runs backups/restores. Its password is `POSTGRES_PASSWORD` (default `postgres`), set only when the volume is first created; changing `.env` later does not rotate it. A shared or production deployment should use separate least-privileged migration and runtime roles instead. Volumes created by the earlier script-based stack may still contain its `pos` and `pos_migrator` roles; this stack no longer uses them.

## Local startup

Requirements: Docker Engine with Compose v2 (`--wait` support) and Make; `curl` for the examples. Native development/checks additionally need Go and Node.js 24. Browser checks need Chromium. The backend Dockerfile and `compose.yaml` use version tags (`golang:1.26-alpine`, `alpine:3.23`, `postgres:17-alpine`), not digests, so rebuilds and pulls pick up patch updates.

From `project/`:

```sh
make dev
```

`make dev` runs `docker compose up -d --build --wait`: it builds the backend and frontend images, starts PostgreSQL, waits until the backend has migrated and both application services report healthy, then prints the POS/API URLs and default login. It needs no `.env` file and never prompts. The POS is at `http://localhost:3000`, the API is at `http://127.0.0.1:8080/api/v1`, and PostgreSQL is at `127.0.0.1:5432`, database `pos`, user `postgres`, password `postgres` unless `.env` sets `POSTGRES_PASSWORD`. To change ports, the database password or provider settings, copy `.env.example` to `.env` and edit it.

If migration or startup fails, for example because `POSTGRES_PASSWORD` was changed after the volume was created, `make dev` exits with "backend is unhealthy" and Compose keeps restarting the backend; `make logs` shows the `startup failed` reason.

The first migration creates the two business lines and one owner, `owner@owner.com` / `owner-password-123`, but only while the users table is empty. Once any user exists, re-running migrations (`make dev` or any backend restart) never recreates that owner or resets its password. There is no seed command and no sample catalog or transaction data. The owner adds cashiers and admins with `POST /api/v1/users` (`name`, `email`, 12-72 byte `password`, `role`, one or two `businessLineIds`); only an active owner can create, change or disable users.

The default owner password is published in this repository. Change it with `PATCH /api/v1/users/{id}` before any non-local use. The fixed business line IDs are `11111111-1111-4111-8111-111111111111` (kedai) and `22222222-2222-4222-8222-222222222222` (salon).

Useful commands:

```sh
make ps
make logs
make psql              # psql on database pos as postgres
make down              # Keeps the database volume
make dev               # Reuses the volume; never resets data
make test              # Native backend vet and race tests
docker compose down -v # Deletes the database volume; local data only
```

Do not paste plain `docker compose config` or `docker inspect` output into tickets: they contain interpolated credentials. `.env*`, build outputs, browser auth state and backups are ignored by Git and excluded from Docker build contexts. `.env.example` contains only the published local default password. Store exports outside the source tree anyway.

Clients log in with `POST /api/v1/auth/login` and send the returned `accessToken` as `Authorization: Bearer <token>`. The API sends no CORS headers. The Next.js frontend provides the same-origin cookie/session boundary and an allowlisted API proxy; browser JavaScript never receives the bearer token. See [frontend documentation](../frontend/README.md) for native development, retry behavior, and browser checks.

## Environment and provider boundaries

Compose passes only the variables each service needs. The backend receives `DATABASE_URL`, `APP_ENV`, `SESSION_TTL`, `BUSINESS_TIMEZONE` and the `PAYMENT_*`/`NOTIFICATION_*` settings below, and listens on the default `HTTP_ADDR` `:8080`. Defaults are a 30-minute session and `Asia/Jakarta` reporting timezone; stored timestamps are UTC. The backend refuses to start if `BUSINESS_TIMEZONE` is not an IANA zone name. `POSTGRES_PASSWORD` is embedded in `DATABASE_URL`, so keep it URL-safe (letters, digits, `-`, `_`, `.`, `~`).

| Setting | Meaning |
| --- | --- |
| `PAYMENT_PROVIDER=disabled` | Cash works; QRIS is unavailable. No locally invented QR or payment success. |
| `PAYMENT_PROVIDER=mock` | Non-production only; calls a separately deployed external mock. |
| `PAYMENT_BASE_URL`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | External provider endpoint and credentials. Keep them server-side. |
| `NOTIFICATION_PROVIDER=disabled` | Notifications remain visibly undelivered/failed; payments remain valid. |
| `NOTIFICATION_PROVIDER=http` | Non-production vendor-neutral HTTP contract; not evidence of compatibility with a selected WhatsApp vendor. |
| `NOTIFICATION_BASE_URL`, `NOTIFICATION_API_KEY`, `NOTIFICATION_DESTINATION` | Approved notification endpoint, credential and recipient. |
| `NOTIFICATION_TEMPLATE` | Operational alert wording. Empty uses the backend default `Payment confirmed. Sale {{saleId}}, IDR {{total}}.` Only `{{saleId}}`, `{{total}}` and `{{businessLineId}}` are interpolated, maximum 500 characters, no control characters; the backend refuses to start on an unsupported or malformed placeholder. Nothing browser-supplied is substituted. This is POS-side wording only and is not a vendor-approved WhatsApp template. |

For the separate mock, the normalized webhook route is `/api/v1/webhooks/payments/mock`. Its signature covers exact request bytes using HMAC SHA256; `X-Webhook-Signature` carries hex (optional `sha256=` prefix), and `X-Idempotency-Key` equals the body `eventId`. Confirm the external adapter's request path and payload against its own contract before testing. Docker `localhost` means that container, not a host-run mock. Supply a reachable private endpoint. Do not disable certificate verification to work around connectivity.

The backend rejects both `mock` payments and `http` notifications in production; both providers must remain `disabled` until production adapters exist. Production is blocked on a selected QRIS vendor, its implemented/approved adapter and signature scheme, approved WhatsApp contract/templates/recipient consent, successful UAT, backup retention approval, and a restore rehearsal in the hosting environment. `productionReady=false` is not cleared by merely adding credentials. A separately approved cash-only pilot still needs HTTPS, replaced default owner credentials, backups and explicit approval for unavailable integrations.

## Release and first owner

`compose.yaml` is a local development stack: one superuser, a published default password and a locally built `:local` image. A real deployment needs its own reviewed configuration, kept outside the checkout with mode 600: `APP_ENV=production`, a strong `POSTGRES_PASSWORD` or separate least-privileged roles, immutable application image references and TLS. Never copy development owner data into production.

To update a running stack from this checkout, back up first, then rebuild and restart:

```sh
make backup FILE=/secure-backups/pos-before-release.dump
make dev
```

Compose stops the old backend container, then the new one runs `pos migrate` and serves only if migration succeeds, so the API is briefly unavailable; this is not a zero-downtime release. Run one deployment job at a time and schedule maintenance for a breaking migration. Record source revision, application image digest, schema version and the backup file. CI validates and builds but does not push images or deploy: `.github/workflows/project-ci.yaml` runs backend vet/race/black-box jobs, OpenAPI lint and a `containers` job (Compose config, `make dev`, default-owner login).

On first deployment there is no database to back up; create the empty database and run migrations, which create the default owner `owner@owner.com` / `owner-password-123`. Before exposing the API, log in as that owner and change its email and password with `PATCH /api/v1/users/{id}`, or create your own owner and then disable the default one with `DELETE /api/v1/users/{id}`. Do not put real owner passwords in shell command arguments, `.env.example`, screenshots or CI logs.

For an application rollback, redeploy a known compatible image against the current schema. Do not assume an old image supports a new schema. There is no automatic down migration. A schema rollback requires maintenance, a reviewed restore plan and a decision about writes made since the backup.

## HTTPS and reverse proxy

A TLS reverse proxy is an external deployment dependency. The Compose stack does not bundle one or acquire certificates. Keep inbound access to ports 80/443 at the proxy and restrict SSH/administrative access. Redirect HTTP to HTTPS, automate certificate renewal, monitor expiry, and overwrite forwarded headers rather than trusting client-supplied ones.

The API is published to `127.0.0.1:${BACKEND_PORT}` (default 8080) for a host-managed Nginx proxy. Expose only the routes external clients need; the example below exposes just the payment webhook prefix. Example Nginx server fragment (replace the hostname and certificate paths):

```nginx
server {
    listen 443 ssl;
    server_name pos.example.invalid;
    ssl_certificate /etc/letsencrypt/live/pos.example.invalid/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pos.example.invalid/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 1m;

    location ^~ /api/v1/webhooks/payments/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
}
```

Do not rewrite the webhook body. Route browser traffic through the frontend rather than exposing the whole API; the API accepts bearer tokens only and sends no CORS headers. Set frontend server-only `POS_APP_ORIGIN` to the real HTTPS public origin when it differs from the authority/scheme Next.js receives. Production cookies stay Secure even when TLS terminates at the proxy. The Nginx fragment is a deployment example, not an executed staging verification. Add proxy rate/connection limits appropriate to measured checkout and provider retry traffic; preserve 429 handling. Log status, latency and request ID, not bodies, cookies, Authorization headers or query strings containing personal data. Verify login, logout and webhook signature behavior through the actual proxy.

A proxy in another container should join the Compose network (`lia-pos_default`) instead of using host loopback. A proxy or database on another host needs authenticated TLS on that hop. The local internal PostgreSQL connection uses `sslmode=disable` only inside this single-host Docker network; it is not suitable across hosts. For managed PostgreSQL use a reviewed overlay with distinct runtime/migrator DSNs and `sslmode=verify-full` plus the required CA. `make backup` and `make restore` target the bundled `db` service, not a managed service.

## Backups, retention and restore

Run:

```sh
make backup FILE=/secure-backups/pos-YYYYMMDDTHHMMSSZ.dump
make restore FILE=/secure-backups/pos-YYYYMMDDTHHMMSSZ.dump TARGET=pos_restore_rehearsal
```

Backup runs `pg_dump` in the `db` container and writes a PostgreSQL custom-format archive with mode 600 through a temporary file. It refuses to overwrite an existing backup. A dump is a consistent database snapshot; it is not a filesystem copy of a live database. No checksum is written; encrypt and authenticate backup storage separately.

Restore creates a new database named `TARGET` (default `pos_restore_check`) and fails if it already exists, including the live `pos`. It restores in one transaction without ownership or grants, so restored objects belong to `postgres`. It never drops, truncates or cleans the live database. On failure, drop only that failed target after diagnosis (`docker compose exec db dropdb -U postgres <target>`).

For a recovery, restore beside the original database first. Keep provider workers disabled while checking recovered data to avoid delivering old outbox items or expiring historical payments. Compare schema versions, confirmed sale counts/totals by business line, payment states, stock ledger balances, queue records and notification state. Verify logins and representative receipts. Reconcile uncertain payments with the external provider before resuming QRIS.

After owner approval, stop the API and any other database clients, take a final recovery snapshot if possible, then have the database operator perform a reviewed connection switch or database rename. Keep the original database for investigation. The Makefile deliberately does not automate destructive cutover. Revoke restored sessions before reopening access if compromise or stale sessions are a concern. Document the actual data-loss window and completion time.

Agree on backup frequency, recovery point/time objectives, retention and a named operator before production. A proposed starting policy is nightly encrypted off-host dumps, a backup before every migration, 30 daily copies, and a monthly restore rehearsal. These are proposed operating values, not owner-approved guarantees. Shorter recovery windows need WAL archiving/PITR and managed operational support, neither of which is configured here.

Schedule `make backup` through a monitored timer/backup service and alert on nonzero exit, missing or stale backups, low disk space and failed upload. The repository does not install a scheduler, encryption keys, off-host storage or automatic deletion. Keep backups, database credentials and encryption keys in separately controlled storage. Retention deletion requires owner approval; there is no automatic deletion of sales, stock, payment-event, queue or customer records.

## Runbook

| Symptom | Check and action |
| --- | --- |
| API unavailable | `make ps`; `/api/v1/health/live` distinguishes a running process from `/api/v1/health/ready`. Check database health, migrations and free disk space. `pg_isready` alone does not prove schema readiness. |
| Migration fails | `make dev` reports the backend unhealthy and Compose keeps restarting it. Read `make logs`, compare the deployed schema and image version, and check that `POSTGRES_PASSWORD` still matches the one the volume was created with. Migration runs in one transaction, so a failed attempt leaves the schema unchanged. |
| Login fails after deploy | Verify the proxy forwards `/api/v1/auth/*` and the `Authorization: Bearer` header, the clock is correct, and the session has not expired or been revoked. Do not move tokens into URLs or logs. |
| Pending QRIS | Check the external provider and webhook route/signature, then reconciliation history. Never mark it paid using SQL or browser action. Expired/failed intents release reservations once; late terminal conflicts require operator review. |
| Stock appears lower than expected | Compare on-hand, reserved and available quantities. Pending QRIS reserves stock; reports include confirmed sales only. Do not manually reverse a paid sale. Refund/void policy remains a release dependency. |
| WhatsApp delivery fails | Review sanitized notification history, provider credentials, approved destination and external service health. Retry only after correcting the cause; payment confirmation remains valid. |
| Database disk full | Stop avoidable writes, inspect disk/volume usage and backup jobs, expand storage. Never delete PostgreSQL files or business ledgers by hand. |
| Suspected credential leak | Restrict access, revoke affected sessions/keys, rotate credentials, preserve sanitized evidence, and review payment events. Removing a leaked value from Git is insufficient. |

Database credential rotation requires `ALTER ROLE` through an authenticated operator session, then matching secret updates and application recreation. Do not put cleartext passwords in shell history. Provider key rotation must also follow the selected vendor's overlapping-key/webhook procedure.

Compose does not configure log rotation, monitoring, alert routing or a log sink. Before production, assign an operator and monitor API readiness/error rate/latency, certificate expiry, database connections/storage, stale pending payments, failed notifications, backup age and restore drills. Never label gross sales as profit; expense/cost-basis policy remains unresolved.

## Verification evidence

Current core frontend verification (2026-11-09), including Next.js checks, 9 browser/integration scenarios, production image startup, and localhost login/logout, is recorded in [FRONTEND-VERIFICATION.md](FRONTEND-VERIFICATION.md). The dated backend-only results below remain historical.

Simplified Compose stack (`compose.yaml` and `Makefile`, after `scripts/` was removed): direct runs on 2026-11-05 on a macOS developer machine (Docker Engine 29.5.2 via Colima, Compose 5.6.1). Nothing here is inferred.

- `docker compose config -q` passed.
- In a disposable project with no `.env` (loopback ports 55433/18083), `docker compose up -d --build --wait` built the backend without buildx, pulled `postgres:17-alpine` (PostgreSQL 17.11), and both services became healthy.
- The default owner logged in (200) and created a cashier (201). On `/api/v1/users` the cashier got 403 and an anonymous request 401; a wrong owner password got 401.
- A backend restart re-ran migrations without adding an owner. `make down` then `make dev` kept the data.
- `make ps`, `make psql`, `make logs` and `make build` worked. `make backup` wrote a mode-600 archive and refused to overwrite it. `make restore` restored users and business lines into `pos_restore_check` and refused existing targets, including `pos`.
- With `POSTGRES_PASSWORD` changed after the volume was created, `make dev` exited 1 within 7 seconds ("backend is unhealthy") and the backend logged `startup failed`.
- `make test` (vet and race tests) passed.
- A volume created by the earlier script-based stack (objects owned by `pos_migrator`) migrated and served under this file; its data and owner login were unchanged.
- The disposable projects removed their own containers, networks and volumes. The updated CI `containers` job was not executed on a GitHub-hosted runner.

The results below come from the earlier script-based stack; its scripts and Make targets no longer exist.

Results below are from direct runs on 2026-11-05, after the frontend was removed, on a macOS developer machine (Docker Engine 29.5.2 via Colima, Compose 5.6.1, Python 3.15). Nothing here is inferred. Earlier frontend and browser evidence is historical; see [COMPLETION.md](COMPLETION.md).

- Script and config audit passed:
  - `bash -n scripts/*.sh` passed.
  - `python3 -m unittest scripts/test-config.py scripts/test-dev-start.py` passed 8/8 tests.
  - `make config` passed.
- `scripts/test-stack.sh` passed in disposable Compose project `lia-stack-test-1793818971-34300`, building the backend image from current sources:
  - Migrations applied twice (idempotent migrator path).
  - API readiness on a loopback-only published port and non-root runtime verified.
  - Runtime DDL denial confirmed (`permission denied for schema public`).
  - Owner provisioning, wrong-password rejection, bearer login, `/auth/me` with and without a token, and logout revocation verified.
  - Repeat provisioning and production seed were refused.
  - A non-default `BUSINESS_TIMEZONE` was observed in the backend container.
  - Invalid notification templates were rejected; valid custom template accepted.
  - Full application backup/restore rehearsal into a new database succeeded.
- `make test-backup` passed in disposable Compose project `lia-restore-test-1793819002-34523`:
  - Backup archive and checksum generation succeeded.
  - Restore into a new database succeeded with runtime-role data access.
  - Overwrite and tampered-archive refusal behaved correctly.
  - Restored data persisted after database restart.
- Both disposable rehearsals removed their own temporary containers, networks and volumes.
- CI workflow is defined in `.github/workflows/project-ci.yaml` but was not executed on a GitHub-hosted runner. No production TLS/vendor/UAT/off-host-backup/hosting restore certification is claimed.
