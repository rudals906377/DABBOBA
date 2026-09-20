# DABBOBA finite worker

The worker is a bounded Supabase Queues (`pgmq`) consumer.
PostgreSQL remains authoritative; no Redis or always-on process is required.

The user's 2026-09-09 target is Supabase Edge Functions plus Supabase Cron,
not a separately hosted Cloud Run/Railway/Render worker. Follow the
[transition plan](../../docs/supabase-only-transition.md). Existing Cloud Run
instructions below describe the previous implementation and are not an active
deployment instruction. Local implementation does not activate a hosted function
or schedule; both require separate operational approval and runtime evidence.

## Supabase Edge local artifact

Run `corepack pnpm --filter @dabboba/worker build:edge` from the repository root.
This generates the ignored `supabase/functions/dabboba-worker/worker.generated.js`
with pinned esbuild 0.28.2. The bundle retains the existing finite transaction/queue
core but includes only the Supabase media provider; the Node wrapper preserves
mixed-provider compatibility. Rebuild before deploying; never deploy a stale artifact.

The function uses dedicated internal authentication (`verify_jwt=false` is not public
job access). Missing auth configuration returns 503, invalid credentials return 401,
and non-POST methods return 405 before worker configuration or database work.
Use the `DABBOBA_*` Edge secret names listed in the transition plan, not the
reserved custom `SUPABASE_STORAGE_*` names used by the Node configuration.
No scheduler or hosted deployment is enabled by this build.

Local verification: worker typecheck/build and 86 tests passed, including disposable
PostgreSQL integration; the artifact test and Deno 2.9.6 smoke passed. Hosted
CPU/wall time, authenticated HTTP-to-Session-pooler execution, Storage access and
Cron behavior remain separate release gates. See the transition plan for the full
evidence and outstanding API/media migration scope.

Each invocation:

1. takes one PostgreSQL advisory lock so scheduled executions cannot overlap;
2. runs the reservation sweep first, followed by payment reconciliation
   observation and media cleanup, so queue backlog cannot starve lease expiry;
3. publishes claimed `outbox_events` to the logged `dabboba_worker` queue in the
   same database transaction that records `published_at`;
4. uses `pgmq.read` with a 900-second default visibility timeout, processes the
   existing idempotent handler, then deletes the message;
5. defers failures with bounded exponential backoff and moves exhausted jobs to
   `worker_dead_letters` atomically.

The deployed Cloud Run task timeout is fixed at 600 seconds. Configuration
requires queue visibility to be at least 900 seconds (the task timeout plus a
300-second safety margin), and caps the entire worker run—including database
connection and ACL checks—at 45 seconds. Cooperative deadline checks stop
between bounded units and roll back an in-flight transaction when needed. The
session lock safely rejects the next tick if one bounded operation runs past the
45-second start-work window. Queue reads
claim one message at a time, and retry visibility is never shorter than the
remaining run window, so unprocessed tail messages do not consume `read_ct` and
one execution cannot consume the same failed message twice.

`pgmq.pop` is intentionally never used. Successful messages are deleted because
the canonical event remains in `outbox_events`; this bounds Supabase Free storage.
The production baseline invokes one Cloud Run Job every minute so an expired
three-minute Kuji checkout lease gets a new sweep attempt on the next minute.
The session-level `pg_try_advisory_lock` is non-blocking: an overlapping
invocation exits successfully before publishing, consuming, or periodic work.
This protects consistency but does not remove Cloud Run Jobs' one-minute minimum
billing per execution. The one-minute latency target therefore replaces, and is
more expensive than, the earlier fifteen-minute free-tier-first baseline.

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

## KG INICIS transaction inquiry

`PAYMENT_RECONCILIATION_PROVIDER` defaults to `MANUAL_REVIEW`. Explicit
`KG_INICIS` configuration selects the read-only INIAPI V1 inquiry adapter; it
does not approve, cancel or refund payments. An observed difference goes to
the existing manual-review path, never directly to the commerce ledger.
Only explicit STAGING/TEST-provider or PRODUCTION/LIVE-provider combinations
are allowed. Local tests must not inherit KG credentials.

See [KG INICIS setup and boundaries](../../docs/kg-inicis-integration.md).
No Google Cloud resources or remote worker execution are part of this step.

## Failure semantics

- Queue payloads are authenticated against the canonical outbox row.
- Existing reservation, notification, payment, and media idempotency guards are
  retained. The optional development/test HTTP adapter sends the notification
  UUID as its idempotency key. Production rejects that adapter until the
  receiver durably enforces same-key/same-payload replay and exposes an
  auditable delivery receipt.
- `EXPO_PUSH_ACCESS_TOKEN` enables the production Expo gateway adapter. When it
  is unset, account notifications remain available in-app and remote push is
  intentionally disabled. The adapter sends at most 100 messages per request,
  checks Expo receipts, invalidates unregistered device tokens, and retries only
  bounded transient failures without logging device tokens or credentials.
- A nonzero process exit marks infrastructure or periodic-work failure for Cloud
  Run. Individual message failures stay in pgmq for retry and do not spin a
  second whole-job retry loop.
- Operators inspect `worker_dead_letters` through the migration/admin database
  path; the runtime role cannot delete dead-letter evidence.
