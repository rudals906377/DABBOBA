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
assert_cloud_release_boundaries
check_scheduler_prerequisites

project="$(expected_project_id)"
worker_job="${DABBOBA_WORKER_JOB:-dabboba-worker}"
scheduler_job="${DABBOBA_WORKER_SCHEDULER_JOB:-dabboba-worker-every-minute}"
assert_resource_name "$scheduler_job" DABBOBA_WORKER_SCHEDULER_JOB

target_uri="https://run.googleapis.com/v2/projects/$project/locations/$DABBOBA_CLOUD_RUN_REGION/jobs/$worker_job:run"
assert_scheduler_job_absent "$scheduler_job" "$target_uri"

note "Creating approved one-minute worker schedule $scheduler_job without running it immediately"
create_worker_scheduler_job \
  "$project" \
  "$scheduler_job" \
  "$target_uri" \
  "$DABBOBA_SCHEDULER_SERVICE_ACCOUNT"

assert_worker_scheduler_matches_contract \
  "$scheduler_job" \
  "$target_uri" \
  "$DABBOBA_SCHEDULER_SERVICE_ACCOUNT"

gcloud scheduler jobs describe "$scheduler_job" \
  --project="$project" \
  --location="$DABBOBA_CLOUD_RUN_REGION" \
  --format='value(name,schedule,timeZone,state,httpTarget.uri,httpTarget.oauthToken.serviceAccountEmail)'
