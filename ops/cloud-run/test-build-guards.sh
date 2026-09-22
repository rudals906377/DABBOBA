#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

readonly TEST_PROJECT="dabboba-prod"
readonly TEST_REPOSITORY="prod-images"
readonly TEST_IMAGE_NAME="dabboba-api"
readonly TEST_IMAGE_TAG="release-2026"
readonly TEST_IMAGE_PATH="$DABBOBA_CLOUD_RUN_REGION-docker.pkg.dev/$TEST_PROJECT/$TEST_REPOSITORY/$TEST_IMAGE_NAME"
readonly TEST_API_TAG_NAME="projects/$TEST_PROJECT/locations/$DABBOBA_CLOUD_RUN_REGION/repositories/$TEST_REPOSITORY/packages/$TEST_IMAGE_NAME/tags/$TEST_IMAGE_TAG"

export DABBOBA_GCP_PROJECT_ID="$TEST_PROJECT"
export DABBOBA_ARTIFACT_REPOSITORY="$TEST_REPOSITORY"
export DABBOBA_IMAGE_TAG="$TEST_IMAGE_TAG"

gcloud() {
  if [[ "${1:-}" != "artifacts" \
    || "${2:-}" != "docker" \
    || "${3:-}" != "tags" \
    || "${4:-}" != "list" ]]; then
    printf 'unexpected gcloud invocation:' >&2
    printf ' %q' "$@" >&2
    printf '\n' >&2
    return 64
  fi

  case "${GCLOUD_STUB_SCENARIO:-}" in
    package-not-found)
      printf '%s\n' \
        "ERROR: (gcloud.artifacts.docker.tags.list) NOT_FOUND: Package $TEST_IMAGE_NAME was not found." >&2
      return 1
      ;;
    permission-denied)
      printf '%s\n' \
        'ERROR: (gcloud.artifacts.docker.tags.list) PERMISSION_DENIED: Permission denied.' >&2
      return 1
      ;;
    unavailable)
      printf '%s\n' \
        'ERROR: (gcloud.artifacts.docker.tags.list) UNAVAILABLE: Artifact Registry is unavailable.' >&2
      return 1
      ;;
    existing-short)
      printf '%s\n' "$TEST_IMAGE_TAG"
      ;;
    existing-docker-uri)
      printf '%s\n' "$TEST_IMAGE_PATH:$TEST_IMAGE_TAG"
      ;;
    existing-api-resource)
      printf '%s\n' "$TEST_API_TAG_NAME"
      ;;
    unrelated-tags)
      printf '%s\n' \
        'previous-release' \
        "$TEST_IMAGE_PATH:other-release" \
        "projects/$TEST_PROJECT/locations/$DABBOBA_CLOUD_RUN_REGION/repositories/$TEST_REPOSITORY/packages/$TEST_IMAGE_NAME/tags/canary"
      ;;
    empty)
      ;;
    *)
      printf 'unknown gcloud stub scenario: %s\n' "${GCLOUD_STUB_SCENARIO:-<unset>}" >&2
      return 64
      ;;
  esac
}

tests_run=0
failures=0

run_guard() (
  GCLOUD_STUB_SCENARIO="$1"
  assert_image_tag_absent api
)

record_result() {
  local expectation="$1"
  local scenario="$2"
  local output=""
  local exit_code=0

  tests_run=$((tests_run + 1))
  if output="$(run_guard "$scenario" 2>&1)"; then
    exit_code=0
  else
    exit_code=$?
  fi

  if [[ "$expectation" == "success" && "$exit_code" -eq 0 ]]; then
    printf 'ok %d - %s is accepted\n' "$tests_run" "$scenario"
    return
  fi
  if [[ "$expectation" == "failure" && "$exit_code" -ne 0 ]]; then
    printf 'ok %d - %s fails closed\n' "$tests_run" "$scenario"
    return
  fi

  failures=$((failures + 1))
  if [[ "$expectation" == "success" ]]; then
    printf 'not ok %d - %s should be accepted (exit %d)\n' \
      "$tests_run" "$scenario" "$exit_code" >&2
  else
    printf 'not ok %d - %s should fail closed\n' "$tests_run" "$scenario" >&2
  fi
  if [[ -n "$output" ]]; then
    printf '%s\n' "$output" | sed 's/^/  /' >&2
  fi
}

record_result success package-not-found
record_result failure permission-denied
record_result failure unavailable
record_result failure existing-short
record_result failure existing-docker-uri
record_result failure existing-api-resource
record_result success unrelated-tags
record_result success empty

if ((failures > 0)); then
  printf '%d of %d build guard tests failed\n' "$failures" "$tests_run" >&2
  exit 1
fi

printf 'All %d build guard tests passed\n' "$tests_run"
