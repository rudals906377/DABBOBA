#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

usage() {
  printf 'Usage: %s {base|build|api|worker|migration|scheduler|all}\n' "${0##*/}" >&2
  exit 64
}

mode="${1:-all}"
[[ $# -le 1 ]] || usage

assert_no_raw_secret_envs
assert_gcloud_context
assert_cloud_release_boundaries

case "$mode" in
  base)
    ;;
  build)
    check_build_prerequisites
    ;;
  api)
    check_api_prerequisites
    ;;
  worker)
    check_worker_prerequisites
    ;;
  migration)
    check_migration_prerequisites
    ;;
  scheduler)
    check_scheduler_prerequisites
    ;;
  all)
    check_build_prerequisites
    check_api_prerequisites
    check_worker_prerequisites
    check_migration_prerequisites
    ;;
  *)
    usage
    ;;
esac

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  note "Docker daemon: available"
else
  note "Docker daemon: unavailable (local image build not verified)"
fi

note "Read-only preflight passed for '$mode'; no Google Cloud resource was changed"
