# DABBOBA Worker

The worker is the asynchronous execution boundary for the TypeScript modular monolith. PostgreSQL remains authoritative; Redis and BullMQ only deliver jobs and coordinate retries.

## What it does

- Polls `outbox_events` with `FOR UPDATE SKIP LOCKED`, publishes stable BullMQ job IDs, and records queue acceptance in `published_at`.
- Retries failed outbox publication with bounded exponential backoff. A crash after queue acceptance but before the database update is safe because the same BullMQ job ID is reused.
- Expires unpaid stock reservations transactionally, returning stock, coupon usage, and reserved points before emitting one cancellation event.
- Refuses to release reservations for authorized or paid transactions. Those cases are routed to reconciliation instead of guessing a money state.
- Persists idempotent in-app notifications. Optional HTTP delivery uses the notification UUID as the provider idempotency key.
- Removes stale pending/rejected media from GCS and then soft-marks its database row `DELETED`. READY media is never selected.
- Exposes `/live`, `/ready`, `/health`, and process-local `/metrics`; readiness checks both PostgreSQL and Redis.

`outbox_events.published_at` means that Redis accepted the job, not that every side effect completed. BullMQ keeps completed jobs for seven days and failed jobs for thirty days to preserve the deduplication and incident-review window. Redis persistence and monitoring are deployment requirements.

## Payment reconciliation boundary

The current provider adapter intentionally returns `UNKNOWN`. The worker identifies stale `PENDING`, `AUTHORIZED`, and `REFUND_REVIEW` payments and logs them without changing order, payment, inventory, point, or draw ledgers. A real PG adapter must observe provider state and feed a verified, deduplicated provider event through the API webhook transaction. Do not add direct worker-side ledger updates.

## Run locally

From the repository root, copy values from `.env.example` and `apps/worker/.env.example`, start local PostgreSQL/Redis, migrate the database, and run:

```sh
pnpm --filter @dabboba/worker dev
```

The default health endpoint is `http://127.0.0.1:8791/ready`.

## Production requirements

- `DATABASE_URL`, `REDIS_URL`, and `GCS_BUCKET` are mandatory (`GCS_PROJECT_ID` is optional when Application Default Credentials resolve it).
- Configure Redis persistence/high availability; Redis is still not a business ledger.
- Set `NOTIFICATION_DELIVERY_URL` to an HTTPS provider endpoint that honors the `Idempotency-Key` header. Without it, in-app notifications are stored and external push delivery is explicitly disabled.
- Run one or more identical worker replicas. PostgreSQL row locks, advisory locks, stable job IDs, and idempotent mutations make concurrent replicas safe.
- Alert on failed jobs, growing unpublished outbox depth, old active reservations, reconciliation backlog, and `/ready` failures.
- Keep the health listener private; it has no authentication and intentionally exposes only operational counters, never payloads or secrets.

## Verification

```sh
pnpm --filter @dabboba/worker build
pnpm --filter @dabboba/worker test
pnpm --filter @dabboba/worker typecheck
```
