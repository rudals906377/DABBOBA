# DABBOBA Cloud Run deployment

This runbook covers the public customer API and two finite Cloud Run Jobs in
`asia-northeast3`. It does not provision projects, billing, APIs, repositories,
buckets, service accounts, secrets, IAM, domains, or budgets. The optional
scheduler step creates only its pre-approved trigger.

## Safety contract

- The current Supabase project was designated production-intended on 2026-09-08.
  This is not deployment or worker-execution approval. Default local launchers
  use a separate loopback database and do not source the preserved production
  connection files. Online staging must use its own database and provider
  credentials; it has not been provisioned by the environment split.
- Real process entrypoints require `DABBOBA_ENVIRONMENT_TIER` to match
  `NODE_ENV`: `LOCAL`/development, `TEST`/test, or
  `STAGING`/`PRODUCTION` with production. Production worker execution also
  requires `DABBOBA_ENABLE_PRODUCTION_WORKER=true`. The reviewed production
  deployment template provides these values only within the existing guarded
  deployment workflow; setting the flag alone is not operational approval.
- Run `ops/cloud-run/preflight.sh` first. It performs read-only `describe`,
  `list`, and IAM-policy checks and never requires mutation approval.
- `build.sh`, `deploy.sh`, `promote-api-candidate.sh`, and
  `schedule-worker.sh` stop unless
  `DABBOBA_APPROVE_GCP_MUTATIONS=YES`, the configured gcloud project equals
  `DABBOBA_GCP_PROJECT_ID`, and that project is linked to exactly
  `DABBOBA_GCP_BILLING_ACCOUNT_ID`.
- Raw database URLs and secret values are rejected. Only enabled, numeric Secret
  Manager versions are accepted; `latest` is forbidden.
- API and worker deployment require an exact release attestation tied to the
  reviewed `0039` checksum and successful runtime/worker role verification.
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
- API releases use a unique lowercase `candidate-*` traffic tag. Deployment
  creates a zero-traffic revision, the read-only smoke script probes its tagged
  URL, and a separately approved promotion moves traffic to the exact attested
  revision with `gcloud run services update-traffic --to-revisions`. A smoke
  result for another image, tag, or revision cannot authorize promotion.

## Required operator inputs

Set names and version numbers, never values:

```bash
export DABBOBA_GCP_PROJECT_ID='your-project-id'
export DABBOBA_GCP_BILLING_ACCOUNT_ID='000000-000000-000000'
export DABBOBA_ARTIFACT_REPOSITORY='dabboba'
export DABBOBA_IMAGE_TAG='git-commit-or-release-id'
export DABBOBA_API_CANDIDATE_TAG='candidate-git-commit-or-release-id'

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

export DABBOBA_SUPABASE_URL='https://abcdefghijklmnopqrst.supabase.co' # replace the 20-character example project ref
export DABBOBA_WEB_ORIGINS='https://customer.example.com'
export DABBOBA_MEDIA_STORAGE_PROVIDER='supabase'
export DABBOBA_SUPABASE_STORAGE_BUCKET='existing-private-media'
export DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT='https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3'
export DABBOBA_SUPABASE_STORAGE_S3_REGION='ap-northeast-2' # verify the actual Supabase project region

# These are Secret Manager resource IDs and exact numeric versions, never keys.
export DABBOBA_API_SUPABASE_STORAGE_SERVICE_KEY_SECRET='dabboba-api-storage-service-key'
export DABBOBA_API_SUPABASE_STORAGE_SERVICE_KEY_SECRET_VERSION='1'
export DABBOBA_API_SUPABASE_STORAGE_S3_ACCESS_KEY_ID_SECRET='dabboba-api-storage-s3-access-key'
export DABBOBA_API_SUPABASE_STORAGE_S3_ACCESS_KEY_ID_SECRET_VERSION='1'
export DABBOBA_API_SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY_SECRET='dabboba-api-storage-s3-secret-key'
export DABBOBA_API_SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY_SECRET_VERSION='1'
export DABBOBA_WORKER_SUPABASE_STORAGE_SERVICE_KEY_SECRET='dabboba-worker-storage-service-key'
export DABBOBA_WORKER_SUPABASE_STORAGE_SERVICE_KEY_SECRET_VERSION='1'
export DABBOBA_WORKER_SUPABASE_STORAGE_S3_ACCESS_KEY_ID_SECRET='dabboba-worker-storage-s3-access-key'
export DABBOBA_WORKER_SUPABASE_STORAGE_S3_ACCESS_KEY_ID_SECRET_VERSION='1'
export DABBOBA_WORKER_SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY_SECRET='dabboba-worker-storage-s3-secret-key'
export DABBOBA_WORKER_SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY_SECRET_VERSION='1'

# Retain this only while existing GCS objects or POST-only clients need it.
# export DABBOBA_GCS_BUCKET='existing-seoul-media-bucket'

# Set only after completing the public API abuse-control review below.
export DABBOBA_PUBLIC_API_ABUSE_CONTROLS_VERIFIED='YES'
```

Every release command requires all four API, worker, migration, and scheduler
service-account variables above, verifies that each account exists in the
selected project, and requires them to be pairwise distinct. This complete peer
set is required even when the command operates on only one component, so an
omitted peer cannot hide identity reuse. The API, worker, and migration database
secret IDs plus the session-pepper secret ID are likewise all required and
pairwise distinct on every release command; only each component's secret
version remains component-specific.

Supabase media configuration additionally declares all six distinct API/Worker
Storage secret resource IDs and their numeric versions. Each deploy grants no
permissions: it reads and verifies only that runtime's existing secret-level
access. Do not reuse database, migration, pepper, or peer-runtime secret IDs.
Never export raw `SUPABASE_STORAGE_SERVICE_KEY`, `SUPABASE_STORAGE_S3_ACCESS_KEY_ID`
or `SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY` in the deployment shell. Those values
are delivered to the deployed container only by Secret Manager references.
Numeric environment-secret version pinning follows the
[Cloud Run secret guidance](https://cloud.google.com/run/docs/configuring/services/secrets).

The media flag defaults to `gcs` for old installations, but new target deployments
explicitly select `supabase`. Keeping `DABBOBA_GCS_BUCKET` supports old objects;
switching the default back to `gcs` must retain the full secondary Supabase config
for already-uploaded Supabase objects. Partial config and local HTTP are rejected.
Supabase selection removes the media GCS requirement, **not** the existing
Cloud Build staging-bucket prerequisite. No script creates a Storage bucket,
secret payload, IAM grant, or paid resource implicitly.

Every runtime service account needs a secret-level
`roles/secretmanager.secretAccessor` binding only on its listed secret. Apply
all migrations through `0039_retire_prototype_catalog.sql`. For
a fresh database, or only when deliberately rotating a credential, provision
both restricted login roles from a controlled operator host by streaming their
separately generated passwords to:

```bash
corepack pnpm --filter @dabboba/db provision:runtime-role -- --password-stdin
corepack pnpm --filter @dabboba/db provision:worker-role -- --password-stdin \
  --expected-target-hash '<independently-approved-target-sha256>'
```

The remote worker CLI requires an explicit STAGING/PRODUCTION environment tier,
certificate-verified Supabase Session pooler 5432, and the independently approved
target hash. It refuses an existing LOGIN unless a separately approved rotation
explicitly supplies `--authorize-existing-login-rotation`. These switches do not
authorize production changes. See the [operator runbook](dabboba-operations-runbook.md#worker-최초-login-준비와-비밀번호-회전-구분)
for the target fingerprint and first-time setup boundary. Runtime provisioning
behavior is unchanged. Do not rotate an existing credential on every release. Passwords are not
accepted as command arguments, printed, or stored in migration SQL; store the
resulting Session-pooler URLs directly in their separate API and worker
secrets. These provisioning CLIs remain host/operator-only and are not present
in any runtime image. The migration account must be distinct from API and
worker accounts. The scheduler account must also be distinct. The worker Job's
entire direct IAM policy must contain exactly one unconditioned binding:
`roles/run.invoker` for that scheduler account alone. Extra members, public
principals, `roles/run.jobsExecutor`, custom roles, conditions, and any other
Job-local binding block scheduling. Preflight also rejects any public principal
binding returned from the project/folder/organization hierarchy. The Cloud
Scheduler service agent must retain
`roles/cloudscheduler.serviceAgent`; do not grant that role to the scheduler
account. The operator creating the schedule also needs
`iam.serviceAccounts.actAs` on that account. The Cloud Build account needs
Artifact Registry write, source-staging object, and Logging write permissions.
Grant API/worker bucket permissions only when the existing media bucket and
retention policy have been reviewed; do not use downloadable service-account
keys. Do not grant any principal project-level
`roles/secretmanager.secretAccessor`; preflight rejects every member of that
role. Grant only the exact secret-level bindings listed above, where each secret
policy is also checked as a one-account allow-list. This automated check does
not resolve custom roles containing `secretmanager.versions.access` and does
not expand group membership or inherited folder/organization secret access;
audit those effective permissions separately before release.

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

# Set this exact, non-secret value only after migration 0039's checksum and the
# dabboba_runtime/dabboba_worker role suites pass against the target database.
export DABBOBA_DATABASE_RELEASE_ATTESTATION='0039:9bee32390788e2c57c549bfad41d882b2bb626da9b3a175182bfa240e1449502:runtime+worker'

DABBOBA_APPROVE_GCP_MUTATIONS=YES ops/cloud-run/deploy.sh worker
# Normal releases require an existing public service with a 100% serving
# baseline and create a new revision at 0% production traffic. A private first
# revision cannot enter this path before its dedicated bootstrap promotion.
# Use a new candidate tag every release.
DABBOBA_APPROVE_GCP_MUTATIONS=YES ops/cloud-run/deploy.sh api

# Read-only Google Cloud inspection plus HTTPS GET smoke probes. The script
# prints the exact revision and non-secret attestation only after all checks
# pass and the candidate is re-confirmed at 0% traffic.
bash ops/cloud-run/smoke-api-candidate.sh
export DABBOBA_API_CANDIDATE_REVISION='dabboba-api-00002-abc'
export DABBOBA_API_CANDIDATE_SMOKE_ATTESTATION='api-candidate:git-commit-or-release-id:candidate-git-commit-or-release-id:dabboba-api-00002-abc:PASSED'

# Separate, explicitly approved traffic mutation. This rechecks the same image,
# tag, exact attested latest-ready revision, 0% state, and smoke attestation
# before routing traffic to that revision name.
DABBOBA_APPROVE_GCP_MUTATIONS=YES bash ops/cloud-run/promote-api-candidate.sh

# First service only: create the first revision with Invoker IAM still enabled,
# without --no-traffic (Cloud Run rejects that flag for a new service). It is
# not publicly callable while it necessarily owns 100% service traffic.
# This has a second, explicit bootstrap approval and cannot target an existing
# service. Before create it reads project, folder, and organization IAM and
# fails closed if any ancestor policy is unreadable or grants any role to
# allUsers/allAuthenticatedUsers. After create it checks service IAM before the
# bootstrap smoke first proves an unauthenticated request is denied, then
# repeats the route probes with the operator token.
DABBOBA_APPROVE_GCP_MUTATIONS=YES \
DABBOBA_APPROVE_PRIVATE_API_BOOTSTRAP=YES \
  ops/cloud-run/deploy.sh api-bootstrap
bash ops/cloud-run/smoke-api-candidate.sh --private-bootstrap
export DABBOBA_API_CANDIDATE_REVISION='dabboba-api-00001-abc'
export DABBOBA_API_CANDIDATE_SMOKE_ATTESTATION='api-candidate:git-commit-or-release-id:candidate-git-commit-or-release-id:dabboba-api-00001-abc:PASSED'
DABBOBA_APPROVE_GCP_MUTATIONS=YES \
  bash ops/cloud-run/promote-api-candidate.sh --private-bootstrap

# Separately approve and manually execute this exact worker image once. Inspect
# successful exit, queue/DLQ, outbox, and reconciliation state before attesting.
# gcloud run jobs execute dabboba-worker --wait \
#   --project="$DABBOBA_GCP_PROJECT_ID" --region=asia-northeast3
# Print/record this only AFTER inspecting that exact deployed Job's successful
# execution and its unchanged provider/bucket/secret-version configuration.
export DABBOBA_WORKER_EXECUTION_ATTESTATION="$(
  bash -c 'source ops/cloud-run/_common.sh; expected_worker_execution_attestation'
)"

# Only after that execution and the job-level invoker IAM binding are verified.
ops/cloud-run/preflight.sh scheduler
DABBOBA_APPROVE_GCP_MUTATIONS=YES ops/cloud-run/schedule-worker.sh
```

Deploying a Job does not execute it. Review the image digest, service account,
secret version, migration checksums, and target database before a separately
approved execution. Do not deploy the worker or API until the migration
execution has succeeded and the runtime/worker role suites pass. The deploy
script enforces the exact database release attestation above; the scheduling
script enforces it again plus the image-and-configuration-bound execution attestation
`worker-job:<image-tag>:storage-v1:<SHA-256>:SUCCEEDED`. The fingerprint includes
the full immutable image URI (including its repository), project/region/Job/service account, complete worker plain settings, legacy GCS
settings, and exact worker DB/Storage Secret Manager IDs and versions. The actual
Job environment and references are compared after deploy and before scheduling.
Changing storage settings with the same image invalidates the old attestation.
Computing the fingerprint alone is not proof that a Job was executed.
Migration and worker execution are intentionally not wrapped by repository
automation. `schedule-worker.sh`
creates, but does not immediately
run, a fixed `* * * * *` Asia/Seoul trigger so a new sweep attempt is requested
within the next minute after a three-minute Kuji checkout lease expires. The
target is the Cloud Run v2 `jobs:run` Google API, so Scheduler must use OAuth,
not OIDC.

The API candidate gate now compares the complete actual v1/v2 Revision environment
against the same plain-value and pinned Secret Manager reference maps used by deploy.
It verifies the immutable image, runtime identity, customer surface and exact storage
configuration; same-project ID/number references and used v1 aliases normalize before
comparison. Duplicate/extra variables, foreign/unknown aliases, raw secrets and
execution overrides fail closed. The combined local artifact check includes eight
new Revision tests; cloud calls are stubbed, not production evidence.
[Official secret reference guidance](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
recommends pinned versions for environment secrets; the gate requires numeric versions.

The API health/catalog/auth smoke still does not upload or read media. A separately
authorized authenticated hosted-media smoke remains a release gate; do not use a
green health probe to claim Storage production readiness. Serialize deployment,
smoke and promotion under one operator/release owner: pre/post revision checks do
not provide a control-plane lock against concurrent tag A-to-B-to-A changes.

Scheduler uses a dedicated invoker account, no control-plane retry, and a
30-second attempt deadline; the next minute is the retry opportunity. Before
creating the schedule, preflight requires a Ready, fully observed Worker Job
whose immutable image tag/digest, service account, one task, parallelism one,
three retries, 600-second timeout, 45-second application work window,
1 vCPU/512MiB limits, command/arguments, complete plain environment, lack of
extra mounts/resources, and numeric `WORKER_DATABASE_URL` secret version
exactly match the approved deployment contract. This prevents a
correct Scheduler target from invoking a drifted or more expensive Job. The
create script rejects an existing job name and any existing Scheduler job that
already targets the same Worker, including the legacy fifteen-minute default.
After creation it reads the resource back and requires the exact enabled
one-minute, OAuth, no-retry contract. The worker holds a session-level
`pg_try_advisory_lock` for its finite run; an overlapping execution that cannot
take it exits successfully before queue or periodic work. The durable queue and
idempotent handlers remain required because delivery is not exactly once.

The API deploy is fixed to 1 CPU, 512MiB, request-based CPU throttling, no
startup CPU boost, automatic scaling, service-level min 0, revision-level min
0, max 2, and port 8080. API preflight rejects manual scaling and any existing
service or retained revision with a nonzero minimum, and deployment repeats
that check after the new revision is ready; this includes tagged revisions that
could otherwise continue billing at zero traffic. A normal API deploy refuses a
first-ever service or a reused candidate tag: Cloud Run's documented
zero-traffic tagged rollout applies to a new revision of an existing service.
For the first service only, `deploy.sh api-bootstrap` instead creates the tagged
revision with the Invoker IAM check enabled. Although that sole revision owns
100 percent of the service traffic, unauthenticated requests remain blocked;
before creation the deploy script reads the direct IAM policies on the project
and every returned parent folder/organization. Because predefined and custom
roles other than `roles/run.invoker` may contain `run.routes.invoke`, bootstrap
rejects every role binding whose member is `allUsers` or
`allAuthenticatedUsers`; it fails closed when the operator cannot read any
ancestor policy. After creation, both the deploy and smoke scripts apply the
same strict check to the service IAM policy before any HTTP smoke. This guard
does not freeze IAM: an administrator can still change an ancestor or service
policy concurrently after the check, and it does not expand group/domain
membership. Keep IAM changes out of the release window and review Cloud Audit
Logs.
The smoke script obtains a short-lived gcloud identity token without printing
it or putting it in a process argument. Only the separately approved bootstrap
promotion routes the exact attested revision and then disables the Invoker IAM
check.
After deployment, `smoke-api-candidate.sh` verifies `/healthz`, `/readyz`, the
public Home catalog and auth-provider discovery routes, and the absence of the
admin surface through the tag URL while production traffic stays at zero.
It then emits a smoke attestation containing the immutable image tag, candidate
tag, and exact Cloud Run revision. `promote-api-candidate.sh` rejects a moved
tag or different revision and routes production traffic with
`--to-revisions=<attested-revision>=100`; it is the only scripted path that
assigns the candidate 100 percent traffic. Both startup
and readiness use the PostgreSQL-aware `/readyz`,
because Cloud Run can route before the first readiness check. Liveness uses
process-only `/healthz`. The service sets `API_SURFACE=customer`, so
`/v1/admin/*` routes are not registered. It is publicly reachable for the
mobile app only after the explicit abuse-control attestation above;
Supabase/DABBOBA session authorization remains application-level. Deploy the
admin surface as a separate authenticated/internal service after a dedicated
review.

The worker Job has a 10-minute fail-safe task timeout, a 45-second bounded
application work window, 30-second per-query client/server timeouts, and a
15-minute queue visibility timeout. Periodic work starts with reservation
expiry before queue consumption, so queue backlog cannot starve the Kuji lease
sweep. Visibility exceeds the platform timeout by five minutes, preventing a
still-running task from making its message eligible for early redelivery. Its
Supabase URL must use the Session pooler on port 5432, not Transaction mode on
6543, because the worker holds a session-level PostgreSQL advisory lock for the
run.

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
one-minute minimum per execution. A one-minute Worker schedule means up to
43,200 scheduled Job executions in a 30-day month before platform retries or
manual runs. Even a lock-miss execution can incur that one-minute minimum, so
this low-latency schedule is not the earlier free-tier-first fifteen-minute
baseline and can exceed the headline CPU/RAM allowance. Confirm the USD 1/USD 5
budget notifications and inspect billable instance time during beta; frequency
changes require a separate latency and cost review.

Internet responses from Seoul to Korean destinations currently start at USD
0.19/GiB; the Cloud Run North America 1GiB allowance does not apply. Artifact
Registry includes 0.5GiB-month, Cloud Logging includes 50GiB/project/month, and
Secret Manager includes six active versions plus 10,000 access operations per
billing account/month. Cloud Scheduler includes three jobs per billing account
each month, then costs USD 0.10/job/month; paused jobs still count. Keep logs
free of request bodies, tokens, and URLs.

Official references: [tagged zero-traffic rollouts and revision traffic migration](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration),
[public access and the Invoker IAM check](https://cloud.google.com/run/docs/authenticating/public),
[Cloud Run pricing](https://cloud.google.com/run/pricing),
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

Before release, record the image digest; confirm `API_SURFACE=customer`; run the
candidate smoke script at zero production traffic; exercise authenticated
customer reads and denied writes; inspect Error Reporting and billing alerts;
and leave migrations, worker execution, and API traffic as distinct approvals.
The restricted-role route integration now covers public catalog reads,
notification preference writes, point-funded order idempotency, gacha and kuji
entitlement consumption/recovery, inventory ownership, default-address writes,
and immutable shipping-request creation/readback using `dabboba_runtime`.
Fixture-heavy breadth still runs with the schema owner, so the zero-traffic
candidate must repeat authenticated allow/deny and write-path smoke checks with
the deployed runtime role before production traffic is assigned.

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

The 2026-09-09 read-only inventory supersedes the earlier "no DABBOBA project"
observation: dedicated project `dabboba-app-20260906` (`DABBOBA`) exists and is
ACTIVE, but its billing is disabled and the Secret Manager API is disabled.
The CLI default remains the unrelated `findy-staging`, explicitly refused by
the scripts; do not use it or change the global default. Always pass the exact
DABBOBA project. No API enablement, billing link, secret or IAM mutation was
performed during this inventory. Current blockers until independently
confirmed by preflight are the exact billing link,
enabled APIs, existing immutable-tag Artifact Registry repository,
existing Cloud Build and media buckets, least-privilege service accounts and
IAM, enabled numeric secret versions, budget recipients, and produced image
digests. A normal candidate release additionally needs an existing known-good
API baseline revision; a first release uses the private bootstrap path above.
A documented, evidenced abuse-control review is also required before
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
