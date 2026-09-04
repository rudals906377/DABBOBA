#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

usage() {
  printf 'Usage: %s {api|worker|migration}\n' "${0##*/}" >&2
  exit 64
}

kind="${1:-}"
[[ $# -eq 1 ]] || usage
case "$kind" in
  api|worker|migration) ;;
  *) usage ;;
esac

assert_mutation_approval
assert_no_raw_secret_envs
if [[ "$kind" != "migration" ]]; then
  assert_database_release_attestation
fi
assert_gcloud_context
assert_cloud_identity_boundaries

project="$(expected_project_id)"
image="$(image_uri_for "$kind")"

deploy_api() {
  check_api_prerequisites
  local service="${DABBOBA_API_SERVICE:-dabboba-api}"
  local env_vars
  assert_resource_name "$service" DABBOBA_API_SERVICE
  env_vars="^~^NODE_ENV=production~API_SURFACE=customer~LOG_LEVEL=info~SUPABASE_URL=$DABBOBA_SUPABASE_URL~SUPABASE_JWT_AUDIENCE=authenticated~WEB_ORIGINS=$DABBOBA_WEB_ORIGINS~PAYMENT_PROVIDER=UNCONFIGURED"
  if [[ -n "${DABBOBA_GCS_BUCKET:-}" ]]; then
    env_vars+="~GCS_BUCKET=$(normalize_bucket_name "$DABBOBA_GCS_BUCKET")~GCS_PROJECT_ID=$project"
  fi

  note "Deploying approved public customer API service $service"
  gcloud run deploy "$service" \
    --quiet \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --image="$image" \
    --service-account="$DABBOBA_API_SERVICE_ACCOUNT" \
    --cpu=1 \
    --memory=512Mi \
    --cpu-throttling \
    --no-cpu-boost \
    --scaling=auto \
    --min=0 \
    --min-instances=0 \
    --max=2 \
    --port=8080 \
    --ingress=all \
    --no-invoker-iam-check \
    --set-env-vars="$env_vars" \
    --set-secrets="DATABASE_URL=$DABBOBA_DATABASE_SECRET:$DABBOBA_DATABASE_SECRET_VERSION,SESSION_TOKEN_PEPPER=$DABBOBA_SESSION_PEPPER_SECRET:$DABBOBA_SESSION_PEPPER_SECRET_VERSION" \
    --startup-probe="httpGet.path=/readyz,httpGet.port=8080,initialDelaySeconds=0,failureThreshold=12,timeoutSeconds=2,periodSeconds=5" \
    --liveness-probe="httpGet.path=/healthz,httpGet.port=8080,initialDelaySeconds=0,failureThreshold=3,timeoutSeconds=2,periodSeconds=10" \
    --readiness-probe="httpGet.path=/readyz,httpGet.port=8080,successThreshold=2,failureThreshold=3,timeoutSeconds=2,periodSeconds=10"

  assert_service_revisions_scale_to_zero "$service"

  gcloud run services describe "$service" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format='value(status.latestReadyRevisionName,status.url)'
}

deploy_worker() {
  check_worker_prerequisites
  local job="${DABBOBA_WORKER_JOB:-dabboba-worker}"
  local queue="${DABBOBA_WORKER_QUEUE_NAME:-dabboba_worker}"
  assert_resource_name "$job" DABBOBA_WORKER_JOB
  [[ "$queue" == "dabboba_worker" ]] \
    || die "DABBOBA_WORKER_QUEUE_NAME must be dabboba_worker to match the migrated queue ACL"

  note "Deploying approved finite worker job $job without executing it"
  gcloud run jobs deploy "$job" \
    --quiet \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --image="$image" \
    --service-account="$DABBOBA_WORKER_SERVICE_ACCOUNT" \
    --cpu=1 \
    --memory=512Mi \
    --tasks=1 \
    --parallelism=1 \
    --max-retries=3 \
    --task-timeout=10m \
    --set-env-vars="^~^NODE_ENV=production~LOG_LEVEL=info~WORKER_QUEUE_NAME=$queue~WORKER_QUEUE_VISIBILITY_SECONDS=900~WORKER_MAX_RUN_SECONDS=240~WORKER_MAX_MESSAGES_PER_RUN=100~WORKER_DATABASE_OPERATION_TIMEOUT_MS=30000~DATABASE_POOL_MAX=3~GCS_BUCKET=$(normalize_bucket_name "$DABBOBA_GCS_BUCKET")~GCS_PROJECT_ID=$project" \
    --set-secrets="WORKER_DATABASE_URL=$DABBOBA_WORKER_DATABASE_SECRET:$DABBOBA_WORKER_DATABASE_SECRET_VERSION"

  gcloud run jobs describe "$job" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format='value(metadata.name,metadata.generation)'
}

deploy_migration() {
  check_migration_prerequisites
  local job="${DABBOBA_MIGRATION_JOB:-dabboba-migration}"
  assert_resource_name "$job" DABBOBA_MIGRATION_JOB

  note "Deploying approved migration job $job without executing it"
  gcloud run jobs deploy "$job" \
    --quiet \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --image="$image" \
    --service-account="$DABBOBA_MIGRATION_SERVICE_ACCOUNT" \
    --cpu=1 \
    --memory=512Mi \
    --tasks=1 \
    --parallelism=1 \
    --max-retries=0 \
    --task-timeout=10m \
    --set-env-vars="NODE_ENV=production" \
    --set-secrets="DATABASE_MIGRATION_URL=$DABBOBA_MIGRATION_DATABASE_SECRET:$DABBOBA_MIGRATION_DATABASE_SECRET_VERSION"

  gcloud run jobs describe "$job" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format='value(metadata.name,metadata.generation)'
}

case "$kind" in
  api) deploy_api ;;
  worker) deploy_worker ;;
  migration) deploy_migration ;;
esac
