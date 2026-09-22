#!/usr/bin/env bash

# Unpaid-project diagnosis only. Keep this independent of deployment _common.sh:
# it deliberately needs no billing-account ID, service account, or secret inputs.
set -Eeuo pipefail

readonly DABBOBA_READINESS_PROJECT='dabboba-app-20260906'

usage() {
  printf 'Usage: %s --project dabboba-app-20260906\n' "${0##*/}" >&2
  printf 'Read-only diagnosis; other projects and additional arguments are rejected.\n' >&2
  exit 64
}

[[ $# -eq 2 ]] || usage
[[ "$1" == --project && "$2" == "$DABBOBA_READINESS_PROJECT" ]] || usage

# Command-local environment only: never switch the user's gcloud configuration.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
export CLOUDSDK_CORE_DISABLE_USAGE_REPORTING=1

project_present=null
lifecycle_state=''
billing_enabled=null
billing_linked=null
read_status=complete
deployment_status=unverified
deployment_reason=FULL_PREFLIGHT_REQUIRED
error=''
error_stage=''

report() {
  jq -n \
    --arg project "$DABBOBA_READINESS_PROJECT" \
    --argjson project_present "$project_present" \
    --arg lifecycle_state "$lifecycle_state" \
    --argjson billing_enabled "$billing_enabled" \
    --argjson billing_linked "$billing_linked" \
    --arg read_status "$read_status" \
    --arg deployment_status "$deployment_status" \
    --arg deployment_reason "$deployment_reason" \
    --arg error "$error" \
    --arg error_stage "$error_stage" \
    '{schema_version: 1, project_id: $project, read_status: $read_status,
      project_present: $project_present,
      lifecycle_state: (if $lifecycle_state == "" then null else $lifecycle_state end),
      billing_enabled: $billing_enabled, billing_linked: $billing_linked,
      deployment_status: $deployment_status, deployment_reason: $deployment_reason,
      full_preflight_required: true,
      error: (if $error == "" then null else $error end),
      error_stage: (if $error_stage == "" then null else $error_stage end)}'
}

fail_read() {
  error="$1"
  read_status=failed
  deployment_reason=READ_INCOMPLETE
  report
  exit 1
}

classify_read_error() {
  # Inspect only to choose a fixed code. Raw CLI output may contain an account
  # email or diagnostic tokens, and must never reach stdout/stderr or a file.
  case "$1" in
    *PERMISSION_DENIED*|*'Permission denied'*|*'permission denied'*|*403*)
      printf 'PERMISSION_DENIED' ;;
    *UNAUTHENTICATED*|*credentials*|*reauth*|*'auth login'*|*401*)
      printf 'AUTHENTICATION_REQUIRED' ;;
    *NOT_FOUND*|*'not found'*|*404*)
      printf 'NOT_FOUND_OR_INACCESSIBLE' ;;
    *) printf 'READ_FAILED' ;;
  esac
}

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"schema_version":1,"project_id":"dabboba-app-20260906","read_status":"failed","project_present":null,"lifecycle_state":null,"billing_enabled":null,"billing_linked":null,"deployment_status":"unverified","deployment_reason":"READ_INCOMPLETE","full_preflight_required":true,"error":"JQ_UNAVAILABLE","error_stage":"local"}'
  exit 1
fi
error_stage=local
command -v gcloud >/dev/null 2>&1 || fail_read GCLOUD_UNAVAILABLE

error_stage=project
if project_response="$(gcloud projects describe "$DABBOBA_READINESS_PROJECT" \
  --project="$DABBOBA_READINESS_PROJECT" \
  --format='json(projectId,lifecycleState)' --verbosity=error 2>&1)"; then
  if ! jq -se --arg project "$DABBOBA_READINESS_PROJECT" \
    'length == 1 and (.[0] | type == "object" and .projectId == $project and
      (.lifecycleState | IN("ACTIVE", "DELETE_REQUESTED", "DELETE_IN_PROGRESS")))' \
    >/dev/null 2>&1 <<< "$project_response"; then
    fail_read INVALID_PROJECT_RESPONSE
  fi
else
  fail_read "$(classify_read_error "$project_response")"
fi
project_present=true
lifecycle_state="$(jq -r '.lifecycleState' <<< "$project_response")"
unset project_response

if [[ "$lifecycle_state" != ACTIVE ]]; then
  deployment_status=blocked
  deployment_reason=PROJECT_NOT_ACTIVE
  error_stage=''
  report
  exit 0
fi

error_stage=billing
if billing_response="$(gcloud billing projects describe "$DABBOBA_READINESS_PROJECT" \
  --project="$DABBOBA_READINESS_PROJECT" \
  --format='json(projectId,billingEnabled,billingAccountName)' --verbosity=error 2>&1)"; then
  if ! jq -se --arg project "$DABBOBA_READINESS_PROJECT" \
    'length == 1 and (.[0] | type == "object" and .projectId == $project and
      (.billingEnabled | type == "boolean") and
      (.billingAccountName == null or (.billingAccountName | type == "string")) and
      ((.billingAccountName // "") == "" or
        (.billingAccountName | test("^billingAccounts/[A-Fa-f0-9]{6}-[A-Fa-f0-9]{6}-[A-Fa-f0-9]{6}$"))) and
      (.billingEnabled == false or (.billingAccountName // "") != ""))' \
    >/dev/null 2>&1 <<< "$billing_response"; then
    fail_read INVALID_BILLING_RESPONSE
  fi
else
  fail_read "$(classify_read_error "$billing_response")"
fi
billing_enabled="$(jq -r '.billingEnabled' <<< "$billing_response")"
billing_linked="$(jq -r '(.billingAccountName // "") != ""' <<< "$billing_response")"
unset billing_response

if [[ "$billing_enabled" == false ]]; then
  deployment_status=blocked
  deployment_reason=BILLING_DISABLED
fi
error_stage=''
report
