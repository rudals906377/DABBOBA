#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

usage() {
  printf 'Usage: %s {api|api-bootstrap|worker|migration}\n' "${0##*/}" >&2
  exit 64
}

kind="${1:-}"
[[ $# -eq 1 ]] || usage
case "$kind" in
  api|api-bootstrap|worker|migration) ;;
  *) usage ;;
esac

assert_mutation_approval
assert_no_raw_secret_envs
if [[ "$kind" != "migration" ]]; then
  assert_database_release_attestation
fi
assert_gcloud_context
assert_cloud_release_boundaries

project="$(expected_project_id)"
image_kind="$kind"
[[ "$image_kind" == "api-bootstrap" ]] && image_kind="api"
image="$(image_uri_for "$image_kind")"

deploy_api() {
  local mode="$1"
  if [[ "$mode" == "bootstrap" ]]; then
    # There is no service or revision to inspect before the first deployment.
    # The newly created service is still checked immediately after deploy.
    check_api_prerequisites private-bootstrap
  else
    check_api_prerequisites
  fi
  local service="${DABBOBA_API_SERVICE:-dabboba-api}"
  local candidate_tag
  local candidate_url
  local invoker_flag
  local expected_percent
  local env_vars
  local secret_vars
  local traffic_arg
  local traffic_args_text
  local -a traffic_args=()
  assert_resource_name "$service" DABBOBA_API_SERVICE
  candidate_tag="$(api_candidate_tag)"
  assert_api_deploy_mode_preconditions "$mode" "$service" "$candidate_tag"
  case "$mode" in
    candidate)
      invoker_flag="--no-invoker-iam-check"
      expected_percent="0"
      ;;
    bootstrap)
      invoker_flag="--invoker-iam-check"
      expected_percent="100"
      ;;
    *) die "Unknown API deployment mode: $mode" ;;
  esac
  traffic_args_text="$(api_deploy_traffic_args "$mode" "$candidate_tag")"
  while IFS= read -r traffic_arg; do
    [[ -n "$traffic_arg" ]] && traffic_args+=("$traffic_arg")
  done <<< "$traffic_args_text"
  env_vars="$(api_plain_env | plain_env_flag)"
  secret_vars="$(api_secret_env | secret_env_flag)"

  if [[ "$mode" == "bootstrap" ]]; then
    note "Creating first API revision $candidate_tag privately with the Invoker IAM check enabled"
  else
    note "Deploying approved public customer API candidate $candidate_tag with zero production traffic"
  fi
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
    "$invoker_flag" \
    "${traffic_args[@]}" \
    --set-env-vars="$env_vars" \
    --set-secrets="$secret_vars" \
    --startup-probe="httpGet.path=/readyz,httpGet.port=8080,initialDelaySeconds=0,failureThreshold=12,timeoutSeconds=2,periodSeconds=5" \
    --liveness-probe="httpGet.path=/healthz,httpGet.port=8080,initialDelaySeconds=0,failureThreshold=3,timeoutSeconds=2,periodSeconds=10" \
    --readiness-probe="httpGet.path=/readyz,httpGet.port=8080,successThreshold=2,failureThreshold=3,timeoutSeconds=2,periodSeconds=10"

  assert_service_revisions_scale_to_zero "$service"
  if [[ "$mode" == "bootstrap" ]]; then
    # Check the newly created service policy before printing any smoke URL.
    # The hierarchy was already checked immediately before service creation.
    assert_api_service_has_no_public_principals "$service"
  fi
  candidate_url="$(assert_api_candidate_release "$service" "$candidate_tag" "$expected_percent")"

  if [[ "$mode" == "bootstrap" ]]; then
    assert_api_invoker_iam_disabled "$service" false
    note "Private first revision is ready at $candidate_url; unauthenticated access remains blocked"
    note "Run bash ops/cloud-run/smoke-api-candidate.sh --private-bootstrap before public promotion"
  else
    assert_api_invoker_iam_disabled "$service" true
    note "Candidate is ready at $candidate_url and still serves 0 percent production traffic"
    note "Run bash ops/cloud-run/smoke-api-candidate.sh before any traffic promotion"
  fi
}

deploy_worker() {
  check_worker_prerequisites
  local job="${DABBOBA_WORKER_JOB:-dabboba-worker}"
  local queue="${DABBOBA_WORKER_QUEUE_NAME:-dabboba_worker}"
  local env_vars
  local secret_vars
  assert_resource_name "$job" DABBOBA_WORKER_JOB
  [[ "$queue" == "dabboba_worker" ]] \
    || die "DABBOBA_WORKER_QUEUE_NAME must be dabboba_worker to match the migrated queue ACL"
  env_vars="$(worker_plain_env | plain_env_flag)"
  secret_vars="$(worker_secret_env | secret_env_flag)"

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
    --set-env-vars="$env_vars" \
    --set-secrets="$secret_vars"

  assert_worker_job_matches_scheduler_contract "$job"
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
  api) deploy_api candidate ;;
  api-bootstrap) deploy_api bootstrap ;;
  worker) deploy_worker ;;
  migration) deploy_migration ;;
esac
