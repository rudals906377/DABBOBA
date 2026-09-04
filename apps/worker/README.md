# DABBOBA finite worker

The worker is a bounded Supabase Queues (`pgmq`) consumer for Cloud Run Jobs.
PostgreSQL remains authoritative; no Redis or always-on process is required.

Each invocation:

1. takes one PostgreSQL advisory lock so scheduled executions cannot overlap;
2. publishes claimed `outbox_events` to the logged `dabboba_worker` queue in the
   same database transaction that records `published_at`;
3. uses `pgmq.read` with a 900-second default visibility timeout, processes the
   existing idempotent handler, then deletes the message;
4. defers failures with bounded exponential backoff and moves exhausted jobs to
   `worker_dead_letters` atomically;
5. runs the reservation sweep, payment reconciliation observation, and media
   cleanup once before exiting.

The deployed Cloud Run task timeout is fixed at 600 seconds. Configuration
requires queue visibility to be at least 900 seconds (the task timeout plus a
300-second safety margin), and caps the entire worker run—including database
connection and ACL checks—at 240 seconds. Cooperative deadline checks stop
between bounded units and roll back an in-flight transaction when needed,
leaving six minutes for one already-started operation and shutdown. Queue reads
claim one message at a time, and retry visibility is never shorter than the
remaining run window, so unprocessed tail messages do not consume `read_ct` and
one execution cannot consume the same failed message twice.

`pgmq.pop` is intentionally never used. Successful messages are deleted because
the canonical event remains in `outbox_events`; this bounds Supabase Free storage.
The free-tier-first baseline invokes one Cloud Run Job every fifteen minutes;
operators can shorten that interval only after accepting the higher minimum-task
billing and measuring the required reservation latency.

## Database boundary

Run migrations `0027_supabase_worker_queue.sql`,
`0028_harden_pgmq_public.sql`, `0029_worker_database_role.sql`, and
`0030_harden_pgmq_function_defaults.sql` plus
`0031_enforce_worker_least_privilege.sql` and
`0032_worker_payment_reconciliation_schedule.sql` with
`DATABASE_MIGRATION_URL` before the worker. Provision the `dabboba_worker` login
by streaming its generated password to `provision:worker-role -- --password-stdin`;
the command never accepts it as an argument or prints it. The worker receives
only `WORKER_DATABASE_URL`, distinct from the API's `DATABASE_URL` and the
migration credential. A Supabase pooler worker URL must use Session mode on port
5432 because the finite run holds a session-level advisory lock.
`pgmq_public`, PostgREST, `anon`, `authenticated`, and `service_role` are not part
of the queue path. Migration 0029 removes the temporary 0027 queue grants from
`dabboba_runtime`, so the API role is denied pgmq and dead-letter access.

## Local run

After migrating a compatible PostgreSQL/Supabase database, run one finite batch:

```sh
cp apps/worker/.env.example apps/worker/.env.local
# Set WORKER_DATABASE_URL in .env.local to the provisioned dabboba_worker login.
set -a
. apps/worker/.env.local
set +a
corepack pnpm --filter @dabboba/worker build
corepack pnpm --filter @dabboba/worker start
```

Use the variables in `apps/worker/.env.example`. The production media cleanup
path still requires `GCS_BUCKET`; this preserves the current private GCS adapter
until a separately reviewed Supabase Storage migration exists.

## Failure semantics

- Queue payloads are authenticated against the canonical outbox row.
- Existing reservation, notification, payment, and media idempotency guards are
  retained. The optional development/test HTTP adapter sends the notification
  UUID as its idempotency key. Production rejects that adapter until the
  receiver durably enforces same-key/same-payload replay and exposes an
  auditable delivery receipt.
- A nonzero process exit marks infrastructure or periodic-work failure for Cloud
  Run. Individual message failures stay in pgmq for retry and do not spin a
  second whole-job retry loop.
- Operators inspect `worker_dead_letters` through the migration/admin database
  path; the runtime role cannot delete dead-letter evidence.
