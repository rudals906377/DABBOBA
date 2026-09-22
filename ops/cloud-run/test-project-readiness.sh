#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/dabboba-readiness-test.XXXXXX")"
trap 'rm -rf -- "$TEST_TMP"' EXIT
export TEST_GCLOUD_LOG="$TEST_TMP/gcloud-calls"

tests_run=0
failures=0

# An exported function is the command shim: no real gcloud subprocess runs.
# All arguments are checked, including the explicit project and output fields.
gcloud() {
  printf '%s\n' "$*" >> "$TEST_GCLOUD_LOG"
  [[ "${CLOUDSDK_CORE_DISABLE_PROMPTS:-}" == 1 ]] || return 95
  case "$*" in
    'projects describe dabboba-app-20260906 --project=dabboba-app-20260906 --format=json(projectId,lifecycleState) --verbosity=error')
      case "$TEST_SCENARIO" in
        project_permission)
          printf 'PERMISSION_DENIED: fixture-operator@example.invalid token=fixture-secret\n' >&2
          return 1 ;;
        project_missing) printf 'NOT_FOUND: fixture-secret\n' >&2; return 1 ;;
        project_auth) printf 'UNAUTHENTICATED: fixture-operator@example.invalid\n' >&2; return 1 ;;
        project_network) printf 'connection failed fixture-secret\n' >&2; return 1 ;;
        project_malformed) printf 'not JSON fixture-secret\n'; return 0 ;;
        project_multiple) printf '%s\n' '{"projectId":"findy-staging","lifecycleState":"ACTIVE"}' '{"projectId":"dabboba-app-20260906","lifecycleState":"ACTIVE"}'; return 0 ;;
        project_wrong) printf '%s\n' '{"projectId":"findy-staging","lifecycleState":"ACTIVE"}'; return 0 ;;
        project_inactive) printf '%s\n' '{"projectId":"dabboba-app-20260906","lifecycleState":"DELETE_REQUESTED"}'; return 0 ;;
      esac
      printf '%s\n' '{"projectId":"dabboba-app-20260906","lifecycleState":"ACTIVE","ignored":"fixture-secret"}'
      ;;
    'billing projects describe dabboba-app-20260906 --project=dabboba-app-20260906 --format=json(projectId,billingEnabled,billingAccountName) --verbosity=error')
      case "$TEST_SCENARIO" in
        billing_permission)
          printf 'PERMISSION_DENIED: fixture-operator@example.invalid token=fixture-secret\n' >&2
          return 1 ;;
        billing_malformed) printf '%s\n' '{"projectId":"dabboba-app-20260906","billingEnabled":"false"}'; return 0 ;;
        billing_account_false) printf '%s\n' '{"projectId":"dabboba-app-20260906","billingEnabled":false,"billingAccountName":false}'; return 0 ;;
        billing_multiple) printf '%s\n' '{"projectId":"findy-staging","billingEnabled":false}' '{"projectId":"dabboba-app-20260906","billingEnabled":false}'; return 0 ;;
        billing_wrong) printf '%s\n' '{"projectId":"findy-staging","billingEnabled":false}'; return 0 ;;
        billing_inconsistent) printf '%s\n' '{"projectId":"dabboba-app-20260906","billingEnabled":true,"billingAccountName":""}'; return 0 ;;
        billing_on) printf '%s\n' '{"projectId":"dabboba-app-20260906","billingEnabled":true,"billingAccountName":"billingAccounts/AAAAAA-BBBBBB-CCCCCC"}'; return 0 ;;
        billing_linked_disabled) printf '%s\n' '{"projectId":"dabboba-app-20260906","billingEnabled":false,"billingAccountName":"billingAccounts/AAAAAA-BBBBBB-CCCCCC"}'; return 0 ;;
      esac
      printf '%s\n' '{"projectId":"dabboba-app-20260906","billingEnabled":false,"billingAccountName":""}'
      ;;
    *)
      printf 'FORBIDDEN_GCLOUD_COMMAND\n' >&2
      return 97
      ;;
  esac
}
export -f gcloud

check_case() {
  local label="$1" scenario="$2" expected_exit="$3" expected_calls="$4" predicate="$5"
  shift 5
  local output="" result=0 calls=0
  tests_run=$((tests_run + 1))
  : > "$TEST_GCLOUD_LOG"
  if output="$(TEST_SCENARIO="$scenario" bash "$SCRIPT_DIR/project-readiness.sh" "$@" 2>&1)"; then
    result=0
  else
    result=$?
  fi
  calls="$(wc -l < "$TEST_GCLOUD_LOG" | tr -d ' ')"
  if [[ "$result" -eq "$expected_exit" && "$calls" -eq "$expected_calls" ]] \
    && ! [[ "$output" =~ fixture-secret|fixture-operator|AAAAAA-BBBBBB-CCCCCC ]] \
    && { [[ "$predicate" == usage ]] || jq -e "$predicate" >/dev/null 2>&1 <<< "$output"; }; then
    printf 'ok %d - %s\n' "$tests_run" "$label"
  else
    failures=$((failures + 1))
    printf 'not ok %d - %s (exit %d, calls %s)\n' "$tests_run" "$label" "$result" "$calls" >&2
    # Do not reprint failed output: this suite also checks output redaction.
  fi
}

readonly PROJECT='dabboba-app-20260906'
readonly BILLING_OFF='.read_status == "complete" and .project_present == true and .lifecycle_state == "ACTIVE" and .billing_enabled == false and .billing_linked == false and .deployment_status == "blocked" and .deployment_reason == "BILLING_DISABLED" and .full_preflight_required == true'

check_case 'unpaid ACTIVE project is diagnosed, deployment remains blocked' billing_off 0 2 "$BILLING_OFF" --project "$PROJECT"
check_case 'enabled billing never certifies deployment readiness' billing_on 0 2 '.billing_enabled == true and .billing_linked == true and .deployment_status == "unverified" and .full_preflight_required == true' --project "$PROJECT"
check_case 'linked but disabled billing is distinguished' billing_linked_disabled 0 2 '.billing_linked == true and .billing_enabled == false and .deployment_reason == "BILLING_DISABLED"' --project "$PROJECT"
check_case 'inactive project stops before billing' project_inactive 0 1 '.project_present == true and .billing_enabled == null and .deployment_reason == "PROJECT_NOT_ACTIVE"' --project "$PROJECT"
check_case 'project permission denial is inconclusive, not absent' project_permission 1 1 '.read_status == "failed" and .project_present == null and .error == "PERMISSION_DENIED"' --project "$PROJECT"
check_case 'missing or inaccessible project does not imply absence' project_missing 1 1 '.project_present == null and .error == "NOT_FOUND_OR_INACCESSIBLE"' --project "$PROJECT"
check_case 'authentication error exposes no account email' project_auth 1 1 '.error == "AUTHENTICATION_REQUIRED" and .deployment_status == "unverified"' --project "$PROJECT"
check_case 'network failure remains an unknown read' project_network 1 1 '.error == "READ_FAILED" and .project_present == null' --project "$PROJECT"
check_case 'malformed project response fails closed' project_malformed 1 1 '.error == "INVALID_PROJECT_RESPONSE"' --project "$PROJECT"
check_case 'multiple project response documents fail closed' project_multiple 1 1 '.error == "INVALID_PROJECT_RESPONSE"' --project "$PROJECT"
check_case 'wrong returned project stops before billing' project_wrong 1 1 '.error == "INVALID_PROJECT_RESPONSE"' --project "$PROJECT"
check_case 'billing permission denial preserves observed project' billing_permission 1 2 '.project_present == true and .billing_enabled == null and .error == "PERMISSION_DENIED" and .error_stage == "billing"' --project "$PROJECT"
check_case 'billing boolean must be a JSON boolean' billing_malformed 1 2 '.error == "INVALID_BILLING_RESPONSE"' --project "$PROJECT"
check_case 'billing account must not be a boolean' billing_account_false 1 2 '.error == "INVALID_BILLING_RESPONSE"' --project "$PROJECT"
check_case 'multiple billing response documents fail closed' billing_multiple 1 2 '.error == "INVALID_BILLING_RESPONSE"' --project "$PROJECT"
check_case 'wrong billing project fails closed' billing_wrong 1 2 '.error == "INVALID_BILLING_RESPONSE"' --project "$PROJECT"
check_case 'enabled billing without an account fails closed' billing_inconsistent 1 2 '.error == "INVALID_BILLING_RESPONSE"' --project "$PROJECT"
check_case 'explicit project is required' billing_off 64 0 usage
check_case 'FINDE project is rejected before any command' billing_off 64 0 usage --project findy-staging
check_case 'other project is rejected before any command' billing_off 64 0 usage --project dabboba-prod
check_case 'mutation argument is rejected before any command' billing_off 64 0 usage --project "$PROJECT" --enable-billing
check_case 'gcloud command injection is rejected before any command' billing_off 64 0 usage --project "$PROJECT" services enable run.googleapis.com

# An ambient project and a mutation approval cannot redirect this read-only CLI.
export CLOUDSDK_CORE_PROJECT=findy-staging
export DABBOBA_GCP_PROJECT_ID=findy-staging
export DABBOBA_APPROVE_GCP_MUTATIONS=YES
check_case 'ambient defaults cannot change the explicit read target or enable writes' billing_off 0 2 "$BILLING_OFF" --project "$PROJECT"

# Prove the shim itself rejects mutations; the suite must never reach real gcloud.
tests_run=$((tests_run + 1))
if CLOUDSDK_CORE_DISABLE_PROMPTS=1 gcloud services enable run.googleapis.com >/dev/null 2>&1; then
  failures=$((failures + 1))
  printf 'not ok %d - shim rejects forbidden mutations\n' "$tests_run" >&2
else
  printf 'ok %d - shim rejects forbidden mutations\n' "$tests_run"
fi

printf '%d tests, %d failures\n' "$tests_run" "$failures"
[[ "$failures" -eq 0 ]]
