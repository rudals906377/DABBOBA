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
  export DABBOBA_WORKER_EXECUTION_ATTESTATION="${1:-}"
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

record_result success "migration 0033 checksum matches the release gate" \
  assert_database_release_migration_checksum
record_result failure "missing database release attestation" \
  check_database_attestation ""
record_result failure "stale database release attestation" \
  check_database_attestation "0032:a5b8f8a92c53d9042c2deeaac4d0668d4a886c88ec1d1ddfc33a1052d7de0109:runtime+worker"
record_result success "exact database release attestation" \
  check_database_attestation "$DABBOBA_REQUIRED_DATABASE_RELEASE_ATTESTATION"
record_result failure "missing worker execution attestation" \
  check_worker_execution_attestation ""
record_result failure "different worker image execution attestation" \
  check_worker_execution_attestation "worker-job:previous-release:SUCCEEDED"
record_result success "current worker image execution attestation" \
  check_worker_execution_attestation "worker-job:release-2026:SUCCEEDED"
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
