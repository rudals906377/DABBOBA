#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

readonly TEST_STUB_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dabboba-release-attestations.XXXXXX")"
readonly TEST_STUB_BIN="$TEST_STUB_ROOT/bin"
readonly TEST_ISOLATED_PATH="$TEST_STUB_BIN:/usr/bin:/bin"
mkdir -p "$TEST_STUB_BIN"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "ERROR: release-attestation test gcloud stub must never reach Google Cloud" >&2' \
  'exit 97' \
  > "$TEST_STUB_BIN/gcloud"
chmod +x "$TEST_STUB_BIN/gcloud"
trap 'rm -rf -- "$TEST_STUB_ROOT"' EXIT

tests_run=0
failures=0

gcloud() {
  if [[ "${1:-}" == "secrets" && "${2:-}" == "versions" && "${3:-}" == "describe" ]]; then
    printf '%s\n' "ENABLED"
    return 0
  fi
  if [[ "${1:-}" == "secrets" && "${2:-}" == "get-iam-policy" ]]; then
    case "${GCLOUD_STUB_SCENARIO:-}" in
      target-only)
        printf '%s\n' "serviceAccount:api-runtime@dabboba-prod.iam.gserviceaccount.com"
        ;;
      public-plus-target)
        printf '%s\n' \
          "serviceAccount:api-runtime@dabboba-prod.iam.gserviceaccount.com" \
          "allUsers"
        ;;
      external-plus-target)
        printf '%s\n' \
          "serviceAccount:api-runtime@dabboba-prod.iam.gserviceaccount.com" \
          "serviceAccount:external@another-project.iam.gserviceaccount.com"
        ;;
      duplicate-target)
        printf '%s\n' \
          "serviceAccount:api-runtime@dabboba-prod.iam.gserviceaccount.com" \
          "serviceAccount:api-runtime@dabboba-prod.iam.gserviceaccount.com"
        ;;
      missing-target)
        ;;
      *)
        printf 'unexpected IAM stub scenario: %s\n' "${GCLOUD_STUB_SCENARIO:-<unset>}" >&2
        return 64
        ;;
    esac
    return 0
  fi
  printf 'unexpected gcloud invocation:' >&2
  printf ' %q' "$@" >&2
  printf '\n' >&2
  return 64
}

record_result() {
  local expectation="$1"
  local label="$2"
  shift 2
  local output=""
  local exit_code=0

  tests_run=$((tests_run + 1))
  if output="$("$@" 2>&1)"; then
    exit_code=0
  else
    exit_code=$?
  fi

  if [[ "$expectation" == "success" && "$exit_code" -eq 0 ]]; then
    printf 'ok %d - %s\n' "$tests_run" "$label"
    return
  fi
  if [[ "$expectation" == "failure" && "$exit_code" -ne 0 ]]; then
    printf 'ok %d - %s fails closed\n' "$tests_run" "$label"
    return
  fi

  failures=$((failures + 1))
  printf 'not ok %d - %s (exit %d)\n' "$tests_run" "$label" "$exit_code" >&2
  [[ -z "$output" ]] || printf '%s\n' "$output" | sed 's/^/  /' >&2
}

record_failure_matching() {
  local label="$1"
  local pattern="$2"
  shift 2
  local output=""
  local exit_code=0

  tests_run=$((tests_run + 1))
  if output="$("$@" 2>&1)"; then
    exit_code=0
  else
    exit_code=$?
  fi

  if [[ "$exit_code" -ne 0 && "$output" == *"$pattern"* ]]; then
    printf 'ok %d - %s fails at the expected gate\n' "$tests_run" "$label"
    return
  fi

  failures=$((failures + 1))
  printf 'not ok %d - %s did not fail at %s\n' "$tests_run" "$label" "$pattern" >&2
  [[ -z "$output" ]] || printf '%s\n' "$output" | sed 's/^/  /' >&2
}

check_database_attestation() (
  export DABBOBA_DATABASE_RELEASE_ATTESTATION="${1:-}"
  assert_database_release_attestation
)

check_worker_execution_attestation() (
  export DABBOBA_IMAGE_TAG="release-2026"
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  export DABBOBA_ARTIFACT_REPOSITORY="prod-images"
  export DABBOBA_WORKER_SERVICE_ACCOUNT="worker-runtime@dabboba-prod.iam.gserviceaccount.com"
  export DABBOBA_WORKER_DATABASE_SECRET="worker-database"
  export DABBOBA_WORKER_DATABASE_SECRET_VERSION="7"
  export DABBOBA_GCS_BUCKET="dabboba-media"
  export DABBOBA_WORKER_EXECUTION_ATTESTATION="${1:-}"
  if [[ "$DABBOBA_WORKER_EXECUTION_ATTESTATION" == current ]]; then
    DABBOBA_WORKER_EXECUTION_ATTESTATION="$(expected_worker_execution_attestation)"
  fi
  assert_worker_execution_attestation
)

check_secret_policy() (
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  export DABBOBA_API_SERVICE_ACCOUNT="api-runtime@dabboba-prod.iam.gserviceaccount.com"
  GCLOUD_STUB_SCENARIO="$1"
  assert_secret_version \
    "api-database-url" \
    "1" \
    "$DABBOBA_API_SERVICE_ACCOUNT" \
    "API runtime database"
)

check_release_identity_boundary() (
  local scenario="$1"
  local checked=0
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  export DABBOBA_API_SERVICE_ACCOUNT="api-runtime@dabboba-prod.iam.gserviceaccount.com"
  export DABBOBA_WORKER_SERVICE_ACCOUNT="worker-runtime@dabboba-prod.iam.gserviceaccount.com"
  export DABBOBA_MIGRATION_SERVICE_ACCOUNT="migration-runtime@dabboba-prod.iam.gserviceaccount.com"
  export DABBOBA_SCHEDULER_SERVICE_ACCOUNT="scheduler-runtime@dabboba-prod.iam.gserviceaccount.com"
  case "$scenario" in
    missing-api) unset DABBOBA_API_SERVICE_ACCOUNT ;;
    duplicate-worker) DABBOBA_WORKER_SERVICE_ACCOUNT="$DABBOBA_API_SERVICE_ACCOUNT" ;;
    complete) ;;
    *) return 64 ;;
  esac
  assert_service_account() {
    checked=$((checked + 1))
  }
  assert_release_service_accounts_are_declared
  assert_configured_service_accounts_are_distinct
  [[ "$checked" -eq 4 ]]
)

check_worker_job_trigger_policy() (
  local scenario="$1"
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  gcloud() {
    [[ "$1 $2 $3" == "run jobs get-iam-policy" ]] || return 64
    case "$scenario" in
      exact)
        printf '%s\n' '{"bindings":[{"role":"roles/run.invoker","members":["serviceAccount:scheduler-runtime@dabboba-prod.iam.gserviceaccount.com"]}]}'
        ;;
      public-extra-member)
        printf '%s\n' '{"bindings":[{"role":"roles/run.invoker","members":["serviceAccount:scheduler-runtime@dabboba-prod.iam.gserviceaccount.com","allUsers"]}]}'
        ;;
      jobs-executor)
        printf '%s\n' '{"bindings":[{"role":"roles/run.jobsExecutor","members":["serviceAccount:scheduler-runtime@dabboba-prod.iam.gserviceaccount.com"]}]}'
        ;;
      custom-extra-binding)
        printf '%s\n' '{"bindings":[{"role":"roles/run.invoker","members":["serviceAccount:scheduler-runtime@dabboba-prod.iam.gserviceaccount.com"]},{"role":"projects/dabboba-prod/roles/customJobRunner","members":["serviceAccount:other@dabboba-prod.iam.gserviceaccount.com"]}]}'
        ;;
      conditional)
        printf '%s\n' '{"bindings":[{"role":"roles/run.invoker","members":["serviceAccount:scheduler-runtime@dabboba-prod.iam.gserviceaccount.com"],"condition":{"title":"temporary","expression":"request.time < timestamp(\"2030-01-01T00:00:00Z\")"}}]}'
        ;;
      *) return 64 ;;
    esac
  }
  assert_worker_job_trigger_iam_policy \
    dabboba-worker \
    scheduler-runtime@dabboba-prod.iam.gserviceaccount.com
)

check_project_secret_accessor_boundary() (
  local scenario="$1"
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  gcloud() {
    [[ "$1 $2" == "projects get-iam-policy" ]] || return 64
    case "$scenario" in
      none) ;;
      user) printf '%s\n' 'user:operator@example.com' ;;
      external-service-account) printf '%s\n' 'serviceAccount:external@another-project.iam.gserviceaccount.com' ;;
      *) return 64 ;;
    esac
  }
  assert_no_project_level_secret_accessor_bindings
)

check_release_secret_id_boundary() (
  local scenario="$1"
  export DABBOBA_DATABASE_SECRET="api-database"
  export DABBOBA_WORKER_DATABASE_SECRET="worker-database"
  export DABBOBA_MIGRATION_DATABASE_SECRET="migration-database"
  export DABBOBA_SESSION_PEPPER_SECRET="session-pepper"
  case "$scenario" in
    complete) ;;
    missing-worker) unset DABBOBA_WORKER_DATABASE_SECRET ;;
    api-reuses-migration) DABBOBA_DATABASE_SECRET="$DABBOBA_MIGRATION_DATABASE_SECRET" ;;
    worker-reuses-migration) DABBOBA_WORKER_DATABASE_SECRET="$DABBOBA_MIGRATION_DATABASE_SECRET" ;;
    pepper-reuses-migration) DABBOBA_SESSION_PEPPER_SECRET="$DABBOBA_MIGRATION_DATABASE_SECRET" ;;
    *) return 64 ;;
  esac
  assert_release_secret_id_boundaries
)

check_complete_release_boundary_wiring() (
  local trace=""
  assert_cloud_identity_boundaries() {
    trace+="identities "
  }
  assert_release_secret_id_boundaries() {
    trace+="secrets "
  }
  assert_cloud_release_boundaries
  [[ "$trace" == "identities secrets " ]]
)

check_deploy_wiring() (
  env -i \
    PATH="$TEST_ISOLATED_PATH" \
    DABBOBA_APPROVE_GCP_MUTATIONS="YES" \
    bash "$SCRIPT_DIR/deploy.sh" "$1"
)

check_migration_deploy_exemption() (
  env -i \
    PATH="$TEST_ISOLATED_PATH" \
    DABBOBA_APPROVE_GCP_MUTATIONS="YES" \
    bash "$SCRIPT_DIR/deploy.sh" migration
)

check_scheduler_wiring() (
  env -i \
    PATH="$TEST_ISOLATED_PATH" \
    DABBOBA_APPROVE_GCP_MUTATIONS="YES" \
    DABBOBA_DATABASE_RELEASE_ATTESTATION="$DABBOBA_REQUIRED_DATABASE_RELEASE_ATTESTATION" \
    DABBOBA_IMAGE_TAG="release-2026" \
    bash "$SCRIPT_DIR/schedule-worker.sh"
)

check_scheduler_create_command() (
  local -a captured=()
  local -a expected=(
    scheduler jobs create http dabboba-worker-every-minute
    --quiet
    --project=dabboba-prod
    --location=asia-northeast3
    "--schedule=* * * * *"
    --time-zone=Asia/Seoul
    --uri=https://run.googleapis.com/v2/projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker:run
    --http-method=POST
    --oauth-service-account-email=scheduler-runtime@dabboba-prod.iam.gserviceaccount.com
    --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform
    --attempt-deadline=30s
    --max-retry-attempts=0
    "--description=DABBOBA finite pgmq worker every minute (Asia/Seoul)"
  )
  local index
  gcloud() {
    captured=("$@")
  }

  create_worker_scheduler_job \
    dabboba-prod \
    dabboba-worker-every-minute \
    https://run.googleapis.com/v2/projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker:run \
    scheduler-runtime@dabboba-prod.iam.gserviceaccount.com

  [[ "${#captured[@]}" -eq "${#expected[@]}" ]] || return 1
  for index in "${!expected[@]}"; do
    [[ "${captured[$index]}" == "${expected[$index]}" ]] || return 1
  done
)

check_scheduler_contract() (
  local scenario="$1"
  local schedule="* * * * *"
  local retry_count="0"
  local state="ENABLED"
  local service_account="scheduler-runtime@dabboba-prod.iam.gserviceaccount.com"
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  case "$scenario" in
    exact) ;;
    stale-fifteen-minute) schedule="*/15 * * * *" ;;
    retry-enabled) retry_count="1" ;;
    paused) state="PAUSED" ;;
    wrong-service-account) service_account="other@dabboba-prod.iam.gserviceaccount.com" ;;
    *) return 64 ;;
  esac
  gcloud() {
    [[ "$1 $2 $3" == "scheduler jobs describe" ]] || return 64
    printf '%s\n' "{\"name\":\"projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker-every-minute\",\"description\":\"DABBOBA finite pgmq worker every minute (Asia/Seoul)\",\"schedule\":\"$schedule\",\"timeZone\":\"Asia/Seoul\",\"state\":\"$state\",\"attemptDeadline\":\"30s\",\"retryConfig\":{\"retryCount\":$retry_count},\"httpTarget\":{\"uri\":\"https://run.googleapis.com/v2/projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker:run\",\"httpMethod\":\"POST\",\"oauthToken\":{\"serviceAccountEmail\":\"$service_account\",\"scope\":\"https://www.googleapis.com/auth/cloud-platform\"}}}"
  }
  assert_worker_scheduler_matches_contract \
    dabboba-worker-every-minute \
    https://run.googleapis.com/v2/projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker:run \
    scheduler-runtime@dabboba-prod.iam.gserviceaccount.com
)

check_scheduler_target_absence() (
  local scenario="$1"
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  gcloud() {
    [[ "$1 $2 $3" == "scheduler jobs list" ]] || return 64
    case "$scenario" in
      empty) printf '%s\n' '[]' ;;
      legacy-target)
        printf '%s\n' '[{"name":"projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker-every-15m","httpTarget":{"uri":"https://run.googleapis.com/v2/projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker:run"}}]'
        ;;
      same-name)
        printf '%s\n' '[{"name":"projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker-every-minute","httpTarget":{"uri":"https://example.invalid/other"}}]'
        ;;
      *) return 64 ;;
    esac
  }
  assert_scheduler_job_absent \
    dabboba-worker-every-minute \
    https://run.googleapis.com/v2/projects/dabboba-prod/locations/asia-northeast3/jobs/dabboba-worker:run
)

check_worker_job_run_window_contract() (
  local max_run_seconds="$1"
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  export DABBOBA_ARTIFACT_REPOSITORY="prod-images"
  export DABBOBA_IMAGE_TAG="release-2026"
  export DABBOBA_WORKER_SERVICE_ACCOUNT="worker-runtime@dabboba-prod.iam.gserviceaccount.com"
  export DABBOBA_WORKER_DATABASE_SECRET="worker-database"
  export DABBOBA_WORKER_DATABASE_SECRET_VERSION="7"
  export DABBOBA_GCS_BUCKET="dabboba-media"
  image_digest_for() {
    printf '%s\n' 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  }
  gcloud() {
    [[ "$1 $2 $3" == "run jobs describe" ]] || return 64
    jq -cn --arg max_run_seconds "$max_run_seconds" '
      {
        metadata: {generation: "3"},
        status: {
          observedGeneration: "3",
          conditions: [{type: "Ready", status: "True"}]
        },
        spec: {
          template: {
            spec: {
              taskCount: 1,
              parallelism: 1,
              template: {
                spec: {
                  serviceAccountName: "worker-runtime@dabboba-prod.iam.gserviceaccount.com",
                  maxRetries: 3,
                  timeoutSeconds: 600,
                  containers: [{
                    image: "asia-northeast3-docker.pkg.dev/dabboba-prod/prod-images/dabboba-worker:release-2026",
                    resources: {limits: {cpu: "1", memory: "512Mi"}},
                    env: [
                      {name: "NODE_ENV", value: "production"},
                      {name: "DABBOBA_ENVIRONMENT_TIER", value: "PRODUCTION"},
                      {name: "DABBOBA_ENABLE_PRODUCTION_WORKER", value: "true"},
                      {name: "LOG_LEVEL", value: "info"},
                      {name: "WORKER_QUEUE_NAME", value: "dabboba_worker"},
                      {name: "WORKER_QUEUE_VISIBILITY_SECONDS", value: "900"},
                      {name: "WORKER_MAX_RUN_SECONDS", value: $max_run_seconds},
                      {name: "WORKER_MAX_MESSAGES_PER_RUN", value: "100"},
                      {name: "WORKER_DATABASE_OPERATION_TIMEOUT_MS", value: "30000"},
                      {name: "DATABASE_POOL_MAX", value: "3"},
                      {name: "MEDIA_STORAGE_PROVIDER", value: "gcs"},
                      {name: "GCS_BUCKET", value: "dabboba-media"},
                      {name: "GCS_PROJECT_ID", value: "dabboba-prod"},
                      {
                        name: "WORKER_DATABASE_URL",
                        valueFrom: {secretKeyRef: {name: "worker-database", key: "7"}}
                      }
                    ]
                  }]
                }
              }
            }
          }
        }
      }
    '
  }
  assert_worker_job_matches_scheduler_contract dabboba-worker
)

record_result success "migration 0039 checksum matches the release gate" \
  assert_database_release_migration_checksum
record_result failure "missing database release attestation" \
  check_database_attestation ""
record_result failure "stale database release attestation" \
  check_database_attestation "0033:1a4f88b4bc6707d9b985c0a29fb0fac1dda228af4fd87850d4eb6b1f7bd60c62:runtime+worker"
record_result success "exact database release attestation" \
  check_database_attestation "$DABBOBA_REQUIRED_DATABASE_RELEASE_ATTESTATION"
record_result failure "missing worker execution attestation" \
  check_worker_execution_attestation ""
record_result failure "different worker image execution attestation" \
  check_worker_execution_attestation "worker-job:previous-release:SUCCEEDED"
record_result failure "legacy image-only worker proof cannot attest storage configuration" \
  check_worker_execution_attestation "worker-job:release-2026:SUCCEEDED"
record_result success "current worker image and storage configuration execution attestation" \
  check_worker_execution_attestation current
record_result success "target-only secret accessor policy" \
  check_secret_policy target-only
record_result failure "public secret accessor policy" \
  check_secret_policy public-plus-target
record_result failure "external service account secret accessor policy" \
  check_secret_policy external-plus-target
record_result failure "duplicate target secret accessor policy" \
  check_secret_policy duplicate-target
record_result failure "missing target secret accessor policy" \
  check_secret_policy missing-target
record_result success "all four release identities are declared and distinct" \
  check_release_identity_boundary complete
record_result failure "missing API peer identity on a release command" \
  check_release_identity_boundary missing-api
record_result failure "worker reuses the API identity" \
  check_release_identity_boundary duplicate-worker
record_result success "worker Job trigger IAM exact scheduler allow-list" \
  check_worker_job_trigger_policy exact
record_result failure "worker Job trigger IAM public extra member" \
  check_worker_job_trigger_policy public-extra-member
record_result failure "worker Job trigger IAM alternate jobs executor role" \
  check_worker_job_trigger_policy jobs-executor
record_result failure "worker Job trigger IAM custom extra role" \
  check_worker_job_trigger_policy custom-extra-binding
record_result failure "worker Job trigger IAM conditional binding" \
  check_worker_job_trigger_policy conditional
record_result success "no project-level Secret Manager payload accessor" \
  check_project_secret_accessor_boundary none
record_result failure "human project-level Secret Manager payload accessor" \
  check_project_secret_accessor_boundary user
record_result failure "external project-level Secret Manager payload accessor" \
  check_project_secret_accessor_boundary external-service-account
record_result success "database and session pepper secret IDs are declared and distinct" \
  check_release_secret_id_boundary complete
record_result failure "missing worker database secret peer" \
  check_release_secret_id_boundary missing-worker
record_result failure "API reuses migration database secret" \
  check_release_secret_id_boundary api-reuses-migration
record_result failure "worker reuses migration database secret" \
  check_release_secret_id_boundary worker-reuses-migration
record_result failure "session pepper reuses migration database secret" \
  check_release_secret_id_boundary pepper-reuses-migration
record_result success "release boundary executes identity and secret peer checks" \
  check_complete_release_boundary_wiring
record_result success "one-minute Scheduler create command has no control-plane retry" \
  check_scheduler_create_command
record_result success "one-minute Scheduler post-create contract" \
  check_scheduler_contract exact
record_result failure "stale fifteen-minute Scheduler contract" \
  check_scheduler_contract stale-fifteen-minute
record_result failure "Scheduler control-plane retry drift" \
  check_scheduler_contract retry-enabled
record_result failure "paused Scheduler contract" \
  check_scheduler_contract paused
record_result failure "wrong Scheduler OAuth service account" \
  check_scheduler_contract wrong-service-account
record_result success "empty Scheduler target slot" \
  check_scheduler_target_absence empty
record_result failure "legacy schedule still targets the worker" \
  check_scheduler_target_absence legacy-target
record_result failure "Scheduler job name already exists" \
  check_scheduler_target_absence same-name
record_result success "Worker Job contract uses the 45-second work window" \
  check_worker_job_run_window_contract 45
record_result failure "Worker Job contract rejects the old 240-second work window" \
  check_worker_job_run_window_contract 240

# Deliberately model a credential-bearing operator shell. The wiring checks must
# execute with an allowlisted environment and a local gcloud stub, so inherited
# secrets cannot move their expected failure point or reach Google Cloud.
export DATABASE_URL="postgresql://inherited.invalid/dabboba"
export WORKER_DATABASE_URL="postgresql://inherited.invalid/dabboba"
export DATABASE_MIGRATION_URL="postgresql://inherited.invalid/dabboba"
record_failure_matching "API deploy wiring" "DABBOBA_DATABASE_RELEASE_ATTESTATION" \
  check_deploy_wiring api
record_failure_matching "worker deploy wiring" "DABBOBA_DATABASE_RELEASE_ATTESTATION" \
  check_deploy_wiring worker
record_failure_matching "migration deploy bypasses the post-migration gate" "DABBOBA_GCP_PROJECT_ID" \
  check_migration_deploy_exemption
record_failure_matching "Scheduler manual execution wiring" "DABBOBA_WORKER_EXECUTION_ATTESTATION" \
  check_scheduler_wiring

if ((failures > 0)); then
  printf '%d of %d release attestation tests failed\n' "$failures" "$tests_run" >&2
  exit 1
fi

printf 'All %d release attestation tests passed\n' "$tests_run"
