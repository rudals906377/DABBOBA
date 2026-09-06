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

assert_mutation_approval
assert_no_raw_secret_envs
assert_database_release_attestation
assert_gcloud_context
assert_cloud_release_boundaries
check_api_prerequisites
assert_api_candidate_smoke_attestation

project="$(expected_project_id)"
service="${DABBOBA_API_SERVICE:-dabboba-api}"
assert_resource_name "$service" DABBOBA_API_SERVICE
candidate_tag="$(api_candidate_tag)"
candidate_revision="$DABBOBA_API_CANDIDATE_REVISION"

# Promotion is intentionally a separate mutation. Re-verify the exact candidate
# revision and its mode-specific traffic/IAM state immediately before routing
# production traffic to that revision name.
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

note "Promoting attested API revision $candidate_revision to 100 percent production traffic"
gcloud run services update-traffic "$service" \
  --quiet \
  --project="$project" \
  --region="$DABBOBA_CLOUD_RUN_REGION" \
  --to-revisions="$candidate_revision=100"

if [[ "$private_bootstrap" == "true" ]]; then
  note "Private bootstrap smoke is verified; enabling unauthenticated API access"
  gcloud run services update "$service" \
    --quiet \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --no-invoker-iam-check
fi

assert_api_candidate_release "$service" "$candidate_tag" 100 "$candidate_revision" >/dev/null
assert_api_invoker_iam_disabled "$service" true
assert_service_revisions_scale_to_zero "$service"

gcloud run services describe "$service" \
  --project="$project" \
  --region="$DABBOBA_CLOUD_RUN_REGION" \
  --format='value(status.latestReadyRevisionName,status.url)'
