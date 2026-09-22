#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

mode="${1:-}"
[[ $# -le 1 ]] || mode="invalid"
case "$mode" in
  "") expected_percent="0"; private_bootstrap="false" ;;
  --private-bootstrap) expected_percent="100"; private_bootstrap="true" ;;
  *)
    printf 'Usage: %s [--private-bootstrap]\n' "${0##*/}" >&2
    exit 64
    ;;
esac

assert_no_raw_secret_envs
assert_database_release_attestation
assert_gcloud_context
assert_cloud_release_boundaries
check_api_prerequisites
require_command curl

service="${DABBOBA_API_SERVICE:-dabboba-api}"
assert_resource_name "$service" DABBOBA_API_SERVICE
candidate_tag="$(api_candidate_tag)"
if [[ "$private_bootstrap" == "true" ]]; then
  # Re-read both inherited and service-local IAM after service creation and
  # before issuing even the first network probe.
  assert_no_public_principals_in_project_hierarchy
  assert_api_service_has_no_public_principals "$service"
fi
candidate_target="$(api_candidate_smoke_target "$service" "$candidate_tag" "$expected_percent")"
IFS=$'\t' read -r candidate_revision candidate_url <<< "$candidate_target"
[[ -n "$candidate_revision" && -n "$candidate_url" ]] \
  || die "Unable to resolve an exact Cloud Run API candidate smoke target"
if [[ "$private_bootstrap" == "true" ]]; then
  assert_api_invoker_iam_disabled "$service" false
  identity_token="$(gcloud auth print-identity-token 2>/dev/null)" \
    || die "Unable to obtain an identity token for private bootstrap smoke"
  [[ "$identity_token" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] \
    || die "gcloud returned an invalid identity token for private bootstrap smoke"
else
  assert_api_invoker_iam_disabled "$service" true
  identity_token=""
fi

probe_status() {
  local url="$1"
  local expected="$2"
  local actual
  local -a curl_args=(
    --silent
    --show-error
    --output /dev/null
    --write-out '%{http_code}'
    --connect-timeout 10
    --max-time 45
    --retry 2
    --retry-delay 1
    --header 'Accept: application/json'
  )
  if [[ -n "$identity_token" ]]; then
    actual="$(printf 'header = "Authorization: Bearer %s"\n' "$identity_token" \
      | curl --config - "${curl_args[@]}" "$url")" \
      || die "Private candidate request failed before returning an HTTP status"
  else
    actual="$(curl "${curl_args[@]}" "$url")" \
      || die "Candidate request failed before returning an HTTP status"
  fi
  [[ "$actual" == "$expected" ]] \
    || die "Candidate path returned HTTP $actual; expected $expected"
}

probe_unauthenticated_denied() {
  local url="$1"
  local actual
  actual="$(curl \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 45 \
    --retry 2 \
    --retry-delay 1 \
    --header 'Accept: application/json' \
    "$url")" || die "Private candidate unauthenticated probe failed before returning an HTTP status"
  [[ "$actual" == "401" || "$actual" == "403" ]] \
    || die "Private candidate unexpectedly allowed an unauthenticated request (HTTP $actual)"
}

if [[ "$private_bootstrap" == "true" ]]; then
  note "Smoking private first API revision $candidate_tag with authenticated requests"
  probe_unauthenticated_denied "$candidate_url/healthz"
else
  note "Smoking zero-traffic API candidate $candidate_tag"
fi
probe_status "$candidate_url/healthz" 200
probe_status "$candidate_url/readyz" 200
probe_status "$candidate_url/v1/admin/products" 404
probe_status "$candidate_url/v1/catalog/home-sections" 200
probe_status "$candidate_url/v1/auth/providers" 200

# Re-read the service after the network probes so a concurrent traffic or tag
# change cannot produce an attestation for a different release state.
assert_api_candidate_release \
  "$service" \
  "$candidate_tag" \
  "$expected_percent" \
  "$candidate_revision" >/dev/null
if [[ "$private_bootstrap" == "true" ]]; then
  assert_no_public_principals_in_project_hierarchy
  assert_api_service_has_no_public_principals "$service"
  assert_api_invoker_iam_disabled "$service" false
else
  assert_api_invoker_iam_disabled "$service" true
fi
assert_service_revisions_scale_to_zero "$service"

if [[ "$private_bootstrap" == "true" ]]; then
  note "Private first-revision smoke passed while unauthenticated access remained blocked"
else
  note "API candidate smoke passed with 0 percent production traffic"
fi
export DABBOBA_API_CANDIDATE_REVISION="$candidate_revision"
note "export DABBOBA_API_CANDIDATE_REVISION='$candidate_revision'"
note "export DABBOBA_API_CANDIDATE_SMOKE_ATTESTATION='$(expected_api_candidate_smoke_attestation)'"
