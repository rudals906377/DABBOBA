#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

usage() {
  printf 'Usage: %s {api|worker|migration|all}\n' "${0##*/}" >&2
  exit 64
}

kind="${1:-all}"
[[ $# -le 1 ]] || usage
case "$kind" in
  api|worker|migration|all) ;;
  *) usage ;;
esac

assert_mutation_approval
assert_no_raw_secret_envs
assert_gcloud_context
assert_cloud_identity_boundaries
check_build_prerequisites

declare -a kinds
if [[ "$kind" == "all" ]]; then
  kinds=(api worker migration)
else
  kinds=("$kind")
fi

for item in "${kinds[@]}"; do
  assert_image_tag_absent "$item"
done

build_one() {
  local item="$1"
  local target="${item}-runtime"
  local image
  local project
  local bucket
  image="$(image_uri_for "$item")"
  project="$(expected_project_id)"
  bucket="$(normalize_bucket_name "$DABBOBA_CLOUD_BUILD_BUCKET")"
  note "Submitting approved Cloud Build target $target as $image"
  gcloud builds submit "$DABBOBA_REPO_ROOT" \
    --quiet \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --config="$SCRIPT_DIR/cloudbuild.yaml" \
    --ignore-file="$DABBOBA_REPO_ROOT/.gcloudignore" \
    --service-account="projects/$project/serviceAccounts/$DABBOBA_CLOUD_BUILD_SERVICE_ACCOUNT" \
    --gcs-source-staging-dir="gs://$bucket/dabboba/cloud-build-source" \
    --substitutions="_TARGET=$target,_IMAGE=$image"
  assert_image_exists "$image"
}

build_all() {
  local project
  local bucket
  local api_image
  local worker_image
  local migration_image
  project="$(expected_project_id)"
  bucket="$(normalize_bucket_name "$DABBOBA_CLOUD_BUILD_BUCKET")"
  api_image="$(image_uri_for api)"
  worker_image="$(image_uri_for worker)"
  migration_image="$(image_uri_for migration)"
  note "Submitting one approved Cloud Build for API, worker, and migration images"
  gcloud builds submit "$DABBOBA_REPO_ROOT" \
    --quiet \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --config="$SCRIPT_DIR/cloudbuild-all.yaml" \
    --ignore-file="$DABBOBA_REPO_ROOT/.gcloudignore" \
    --service-account="projects/$project/serviceAccounts/$DABBOBA_CLOUD_BUILD_SERVICE_ACCOUNT" \
    --gcs-source-staging-dir="gs://$bucket/dabboba/cloud-build-source" \
    --substitutions="_API_IMAGE=$api_image,_WORKER_IMAGE=$worker_image,_MIGRATION_IMAGE=$migration_image"
  assert_image_exists "$api_image"
  assert_image_exists "$worker_image"
  assert_image_exists "$migration_image"
}

if [[ "$kind" == "all" ]]; then
  build_all
else
  build_one "$kind"
fi

note "Cloud Build completed for: ${kinds[*]}"
