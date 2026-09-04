#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

assert_mutation_approval
assert_no_raw_secret_envs
assert_database_release_attestation
assert_worker_execution_attestation
assert_gcloud_context
assert_cloud_identity_boundaries
check_scheduler_prerequisites

project="$(expected_project_id)"
worker_job="${DABBOBA_WORKER_JOB:-dabboba-worker}"
scheduler_job="${DABBOBA_WORKER_SCHEDULER_JOB:-dabboba-worker-every-15m}"
assert_resource_name "$scheduler_job" DABBOBA_WORKER_SCHEDULER_JOB
assert_scheduler_job_absent "$scheduler_job"

target_uri="https://run.googleapis.com/v2/projects/$project/locations/$DABBOBA_CLOUD_RUN_REGION/jobs/$worker_job:run"

note "Creating approved 15-minute worker schedule $scheduler_job without running it immediately"
gcloud scheduler jobs create http "$scheduler_job" \
  --quiet \
  --project="$project" \
  --location="$DABBOBA_CLOUD_RUN_REGION" \
  --schedule='*/15 * * * *' \
  --time-zone='Asia/Seoul' \
  --uri="$target_uri" \
  --http-method=POST \
  --oauth-service-account-email="$DABBOBA_SCHEDULER_SERVICE_ACCOUNT" \
  --oauth-token-scope='https://www.googleapis.com/auth/cloud-platform' \
  --attempt-deadline=30s \
  --max-retry-attempts=1 \
  --max-retry-duration=120s \
  --min-backoff=30s \
  --max-backoff=60s \
  --max-doublings=1 \
  --description='DABBOBA finite pgmq worker every 15 minutes (Asia/Seoul)'

gcloud scheduler jobs describe "$scheduler_job" \
  --project="$project" \
  --location="$DABBOBA_CLOUD_RUN_REGION" \
  --format='value(name,schedule,timeZone,state,httpTarget.uri,httpTarget.oauthToken.serviceAccountEmail)'
