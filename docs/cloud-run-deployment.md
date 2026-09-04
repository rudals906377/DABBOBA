# DABBOBA Cloud Run deployment

This runbook covers the public customer API and two finite Cloud Run Jobs in
`asia-northeast3`. It does not provision projects, billing, APIs, repositories,
buckets, service accounts, secrets, IAM, domains, or budgets. The optional
scheduler step creates only its pre-approved trigger.

## Safety contract

- Run `ops/cloud-run/preflight.sh` first. It performs read-only `describe`,
  `list`, and IAM-policy checks and never requires mutation approval.
- `build.sh`, `deploy.sh`, and `schedule-worker.sh` stop unless
  `DABBOBA_APPROVE_GCP_MUTATIONS=YES`, the configured gcloud project equals
  `DABBOBA_GCP_PROJECT_ID`, and that project is linked to exactly
  `DABBOBA_GCP_BILLING_ACCOUNT_ID`.
- Raw database URLs and secret values are rejected. Only enabled, numeric Secret
  Manager versions are accepted; `latest` is forbidden.
- API and worker deployment require an exact release attestation tied to the
  reviewed `0033` checksum and successful runtime/worker role verification.
  Scheduling additionally requires a successful manual execution attestation
  tied to the same immutable worker image tag. These values are operator gates,
  not substitutes for the underlying database and Job evidence.
- Every configured DABBOBA service account, including the Cloud Build account,
  must be distinct. Runtime accounts are rejected if they have project-level
  `roles/secretmanager.secretAccessor` or appear on another DABBOBA secret's
  accessor policy.
- The public API receives only the restricted `dabboba_runtime` `DATABASE_URL`.
  The worker receives a distinct `dabboba_worker` `WORKER_DATABASE_URL`; only
  the migration Job receives the schema-owner `DATABASE_MIGRATION_URL`. The
  three Secret Manager secret IDs must be different.
- Builds require an existing Seoul Docker repository with immutable tags,
  existing Seoul staging bucket, and existing dedicated Cloud Build service
  account. Both staging and media buckets must be owned by the configured
  DABBOBA project's numeric project identity; passing `--project` while
  describing a globally named bucket is not treated as ownership proof.
  `.dockerignore` and `.gcloudignore` use separate deny-by-default allow-lists
  because Docker and gcloud re-include directories differently. CI compares
  gcloud's effective upload list to the reviewed Docker build inputs. The build
  uses Cloud Logging instead of creating a default logs bucket.
- The Dockerfile frontend, Node 24 Bookworm image, and Cloud Build Docker
  builder are digest-pinned. Refresh those digests only as a reviewed upgrade.
- Images use immutable non-`latest` tags. `build.sh` refuses an existing tag.
  `build.sh all` checks all three tags before making one Cloud Build submission,
  then builds and publishes API, worker, and migration images under that single
  build. The three individual modes remain available for an explicitly scoped
  rebuild.

## Required operator inputs

Set names and version numbers, never values:

```bash
export DABBOBA_GCP_PROJECT_ID='your-project-id'
export DABBOBA_GCP_BILLING_ACCOUNT_ID='000000-000000-000000'
export DABBOBA_ARTIFACT_REPOSITORY='dabboba'
export DABBOBA_IMAGE_TAG='git-commit-or-release-id'

export DABBOBA_CLOUD_BUILD_BUCKET='existing-seoul-staging-bucket'
export DABBOBA_CLOUD_BUILD_SERVICE_ACCOUNT='dabboba-build@your-project-id.iam.gserviceaccount.com'

export DABBOBA_API_SERVICE_ACCOUNT='dabboba-api@your-project-id.iam.gserviceaccount.com'
export DABBOBA_WORKER_SERVICE_ACCOUNT='dabboba-worker@your-project-id.iam.gserviceaccount.com'
export DABBOBA_MIGRATION_SERVICE_ACCOUNT='dabboba-migration@your-project-id.iam.gserviceaccount.com'
export DABBOBA_SCHEDULER_SERVICE_ACCOUNT='dabboba-scheduler@your-project-id.iam.gserviceaccount.com'

export DABBOBA_DATABASE_SECRET='dabboba-database-runtime'
export DABBOBA_DATABASE_SECRET_VERSION='1'
export DABBOBA_WORKER_DATABASE_SECRET='dabboba-database-worker'
export DABBOBA_WORKER_DATABASE_SECRET_VERSION='1'
export DABBOBA_MIGRATION_DATABASE_SECRET='dabboba-database-migration'
export DABBOBA_MIGRATION_DATABASE_SECRET_VERSION='1'
export DABBOBA_SESSION_PEPPER_SECRET='dabboba-session-pepper'
export DABBOBA_SESSION_PEPPER_SECRET_VERSION='1'

export DABBOBA_SUPABASE_URL='https://project-ref.supabase.co'
export DABBOBA_WEB_ORIGINS='https://customer.example.com'
export DABBOBA_GCS_BUCKET='existing-seoul-media-bucket'

# Set only after completing the public API abuse-control review below.
export DABBOBA_PUBLIC_API_ABUSE_CONTROLS_VERIFIED='YES'
```

Every runtime service account needs a secret-level
`roles/secretmanager.secretAccessor` binding only on its listed secret. Apply
all migrations through `0033_exchange_bundle_items.sql`. For
a fresh database, or only when deliberately rotating a credential, provision
both restricted login roles from a controlled operator host by streaming their
separately generated passwords to:

```bash
corepack pnpm --filter @dabboba/db provision:runtime-role -- --password-stdin
corepack pnpm --filter @dabboba/db provision:worker-role -- --password-stdin
```

Do not rotate an existing credential on every release. Passwords are not
accepted as command arguments, printed, or stored in migration SQL; store the
resulting Session-pooler URLs directly in their separate API and worker
secrets. These provisioning CLIs remain host/operator-only and are not present
in any runtime image. The migration account must be distinct from API and
worker accounts. The scheduler
account must also be distinct and needs `roles/run.invoker` on only the worker
Job. The Cloud Scheduler service agent must retain
`roles/cloudscheduler.serviceAgent`; do not grant that role to the scheduler
account. The operator creating the schedule also needs
`iam.serviceAccounts.actAs` on that account. The Cloud Build account needs
Artifact Registry write, source-staging object, and Logging write permissions.
Grant API/worker bucket permissions only when the existing media bucket and
retention policy have been reviewed; do not use downloadable service-account
keys. Do not grant any DABBOBA runtime account project-level
`roles/secretmanager.secretAccessor`; grant only the exact secret-level bindings
listed above. Preflight detects direct service-account members on project and
secret policies. It cannot expand Google Group membership or inherited
organization/folder policies, so review those separately before release.

`DABBOBA_PUBLIC_API_ABUSE_CONTROLS_VERIFIED=YES` is a deliberate, fail-closed
operator attestation, not an automatically created control. Set it only after
reviewing the direct `run.app` exposure, verifying that client-IP attribution
used by rate limits cannot be spoofed, exercising unauthenticated and
authenticated abuse limits, and confirming the chosen edge/WAF or documented
beta substitute. If a load balancer/WAF is required, keep the API blocked until
its separate cost and configuration are approved; never set the attestation
merely to make preflight pass.

## Preflight, build, and deploy

The operator host needs authenticated `gcloud` and `jq`; Docker is optional for
read-only preflight but required for local image checks. The scripts do not
install tools or enable APIs.

CI runs `bash ops/cloud-run/check-artifacts.sh --build` without Google Cloud
credentials. It parses both Cloud Build YAML files, checks shell syntax and
Dockerfile targets, compares `gcloud meta list-files-for-upload` with an
independently constructed build-input allow-list, builds every runtime target,
and copies the effective Docker context into a disposable check stage. Together
these checks prove that tests, local assets, operator-only database entrypoints,
environment files, and unrelated workspace trees remain excluded. Run the same
command locally before changing build or ignore rules; omit `--build` for the
fast static subset.

```bash
# Local artifact verification; this file intentionally need not be executable.
bash ops/cloud-run/check-artifacts.sh --build

# Read-only checks. Use build before images exist, then target checks afterward.
ops/cloud-run/preflight.sh build

# Each command below can incur charges and needs one-command approval.
DABBOBA_APPROVE_GCP_MUTATIONS=YES ops/cloud-run/build.sh all
ops/cloud-run/preflight.sh all
DABBOBA_APPROVE_GCP_MUTATIONS=YES ops/cloud-run/deploy.sh migration

# Stop here. Separately approve and execute the migration Job, then verify its
# checksums and both restricted database roles before continuing.
# gcloud run jobs execute dabboba-migration --wait \
#   --project="$DABBOBA_GCP_PROJECT_ID" --region=asia-northeast3

# Set this exact, non-secret value only after migration 0033's checksum and the
# dabboba_runtime/dabboba_worker role suites pass against the target database.
export DABBOBA_DATABASE_RELEASE_ATTESTATION='0033:1a4f88b4bc6707d9b985c0a29fb0fac1dda228af4fd87850d4eb6b1f7bd60c62:runtime+worker'

DABBOBA_APPROVE_GCP_MUTATIONS=YES ops/cloud-run/deploy.sh worker
DABBOBA_APPROVE_GCP_MUTATIONS=YES ops/cloud-run/deploy.sh api

# Separately approve and manually execute this exact worker image once. Inspect
# successful exit, queue/DLQ, outbox, and reconciliation state before attesting.
# gcloud run jobs execute dabboba-worker --wait \
#   --project="$DABBOBA_GCP_PROJECT_ID" --region=asia-northeast3
export DABBOBA_WORKER_EXECUTION_ATTESTATION="worker-job:${DABBOBA_IMAGE_TAG}:SUCCEEDED"

# Only after that execution and the job-level invoker IAM binding are verified.
ops/cloud-run/preflight.sh scheduler
DABBOBA_APPROVE_GCP_MUTATIONS=YES ops/cloud-run/schedule-worker.sh
```

Deploying a Job does not execute it. Review the image digest, service account,
secret version, migration checksums, and target database before a separately
approved execution. Do not deploy the worker or API until the migration
execution has succeeded and the runtime/worker role suites pass. The deploy
script enforces the exact database release attestation above; the scheduling
script enforces it again plus the image-bound successful execution attestation.
Migration and worker execution are intentionally not wrapped by repository
automation. `schedule-worker.sh`
creates, but does not immediately
run, a fixed `*/15 * * * *` Asia/Seoul trigger. Its 15-minute latency keeps
executions within the free-tier-first plan more effectively than a five-minute
schedule. The target is the Cloud Run v2 `jobs:run` Google API, so Scheduler
must use OAuth, not OIDC. It uses a dedicated invoker account, one bounded
control-plane retry, and a 30-second attempt deadline. Before creating the
schedule, preflight requires a Ready, fully observed Worker Job whose immutable
image tag/digest, service account, one task, parallelism one, three retries,
600-second timeout, 1 vCPU/512MiB limits, command/arguments, complete plain
environment, lack of extra mounts/resources, and numeric `WORKER_DATABASE_URL`
secret version exactly match the approved deployment contract. This prevents a
correct Scheduler target from invoking a drifted or more expensive Job. The
worker's advisory lock and durable queue protect against overlap, but handlers
must remain idempotent because delivery is not exactly once.

The API deploy is fixed to 1 CPU, 512MiB, request-based CPU throttling, no
startup CPU boost, automatic scaling, service-level min 0, revision-level min
0, max 2, and port 8080. API preflight rejects manual scaling and any existing
service or retained revision with a nonzero minimum, and deployment repeats
that check after the new revision is ready; this includes tagged revisions that
could otherwise continue billing at zero traffic. Both startup and readiness
use the PostgreSQL-aware `/readyz`,
because Cloud Run can route before the first readiness check. Liveness uses
process-only `/healthz`. The service sets `API_SURFACE=customer`, so
`/v1/admin/*` routes are not registered. It is publicly reachable for the
mobile app only after the explicit abuse-control attestation above;
Supabase/DABBOBA session authorization remains application-level. Deploy the
admin surface as a separate authenticated/internal service after a dedicated
review.

The worker Job has a 10-minute task timeout, a four-minute bounded application
run, 30-second per-query client/server timeouts, and a 15-minute queue
visibility timeout. Visibility therefore exceeds the platform timeout by five
minutes, preventing a still-running task from making its message eligible for
early redelivery. Its Supabase URL must use the Session pooler on port 5432,
not Transaction mode on 6543, because the worker holds a session-level
PostgreSQL advisory lock for the run.

## Budget and expected cost

Cloud Billing budgets are alerts, not hard caps, and reporting can be delayed.
Create one USD 5 monthly project budget with actual-spend alerts at 20% and
100%, which yields USD 1 and USD 5 notices:

```bash
gcloud billing budgets create \
  --billing-account="$DABBOBA_GCP_BILLING_ACCOUNT_ID" \
  --display-name='DABBOBA monthly 5 USD' \
  --budget-amount=5USD \
  --filter-projects="projects/$DABBOBA_GCP_PROJECT_ID" \
  --threshold-rule=percent=0.20 \
  --threshold-rule=percent=1.00
```

Do this separately after confirming recipients; the deployment scripts never
create it. If the billing account is not denominated in USD, use the equivalent
amount in its billing currency. The Preview Cloud Run spend cap can pause or block new eligible
Cloud Run use, but does not promise a particular client status code and still
does not cap Artifact Registry, Logging, Secret Manager, Storage, or network
costs, so it is not enabled here.

At steady-state scale-to-zero, service CPU/RAM is USD 0. A deployment or probe
on a live instance still consumes billable CPU and memory. Seoul is Tier 2;
current request-based list prices are USD 0.0000336/vCPU-second and USD
0.0000035/GiB-second, plus USD 0.40 per million requests after the free tier.
Two fully busy 1 CPU/512Mi instances for 30 days are roughly USD 183.25 before
free-tier credits, requests, probes, build, storage, logs, secrets, and network.
The service-level maximum can be temporarily exceeded during traffic spikes or
deployments, so it is not a hard cost ceiling. The headline service free tier
is the Tier 1-priced spending equivalent of 180,000 vCPU-seconds, 360,000
GiB-seconds, and two million requests per billing account per month; Seoul Tier
2 usage consumes that discount faster. Jobs use instance-based billing with a
one-minute minimum per execution.

Internet responses from Seoul to Korean destinations currently start at USD
0.19/GiB; the Cloud Run North America 1GiB allowance does not apply. Artifact
Registry includes 0.5GiB-month, Cloud Logging includes 50GiB/project/month, and
Secret Manager includes six active versions plus 10,000 access operations per
billing account/month. Cloud Scheduler includes three jobs per billing account
each month, then costs USD 0.10/job/month; paused jobs still count. Keep logs
free of request bodies, tokens, and URLs.

Official references: [Cloud Run pricing](https://cloud.google.com/run/pricing),
[health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks),
[minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances),
[scheduled Jobs](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule),
[Scheduler target authentication](https://docs.cloud.google.com/scheduler/docs/http-target-auth),
[network pricing](https://cloud.google.com/vpc/pricing),
[Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing),
[Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing),
[budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets),
[Secret Manager pricing](https://cloud.google.com/secret-manager/pricing), and
[Logging pricing](https://cloud.google.com/products/observability/pricing).

## Release, rollback, and current blockers

Before release, record the image digest; confirm `API_SURFACE=customer`; probe
`/healthz` and `/readyz`; verify `/v1/admin/*` is 404; exercise authenticated
customer reads and denied writes; inspect Error Reporting and billing alerts;
and leave migrations, worker execution, and API traffic as distinct approvals.
The current restricted-role route integration covers catalog and notification
preferences, while the broad API integration suite still uses the schema owner
for fixture-heavy coverage. Expanding restricted-role route coverage is a
production-release evidence gate even though the database ACL suites and the
focused runtime-route test pass.

For an API rollback, list revisions and move traffic to the last known-good
revision. Do not delete the failed revision until evidence is retained:

```bash
gcloud run revisions list --service=dabboba-api \
  --project="$DABBOBA_GCP_PROJECT_ID" --region=asia-northeast3
gcloud run services update-traffic dabboba-api \
  --project="$DABBOBA_GCP_PROJECT_ID" --region=asia-northeast3 \
  --to-revisions='KNOWN_GOOD_REVISION=100'
```

Jobs roll back by redeploying a previously verified immutable image. Database
migrations are forward-only; application rollback does not reverse schema or
data changes.

The current gcloud audit found no DABBOBA project. The only configured project,
`findy-staging`, has billing disabled, belongs to another product, and is
explicitly refused by the scripts. Current blockers until independently
confirmed by preflight are a dedicated DABBOBA project and exact billing link,
enabled APIs, existing immutable-tag Artifact Registry repository,
existing Cloud Build and media buckets, least-privilege service accounts and
IAM, enabled numeric secret versions, budget recipients, and produced image
digests. A documented, evidenced abuse-control review is also required before
setting the public API attestation. Payment remains `UNCONFIGURED`; media
remains unavailable without an approved bucket; no worker schedule or external
notification provider is created. Production also rejects
`NOTIFICATION_DELIVERY_URL` until its receiver
durably enforces same-key/same-payload idempotency and exposes auditable
delivery receipts. Local builds and import smoke checks passed for all three container
targets, including a no-cache rebuild of the shared production stages; no
image was pushed and no Google Cloud mutation was run.

Direct Cloud Run domain mapping is not supported in `asia-northeast3`. Use the
default `run.app` URL for the beta, or separately approve and budget a global
external Application Load Balancer for a custom domain.
