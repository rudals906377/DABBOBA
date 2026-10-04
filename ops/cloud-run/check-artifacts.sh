#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"

usage() {
  printf 'Usage: %s [--build]\n' "${0##*/}" >&2
  exit 64
}

mode="${1:-}"
[[ $# -le 1 ]] || usage
case "$mode" in
  ""|--build) ;;
  *) usage ;;
esac

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'ERROR: Required command is unavailable: %s\n' "$1" >&2
    exit 1
  }
}

require_command bash
require_command node
require_command jq
require_command diff
require_command find
require_command grep
require_command awk
require_command gcloud
require_command mktemp
require_command ruby
require_command sort

bash -n \
  "$SCRIPT_DIR/_common.sh" \
  "$SCRIPT_DIR/_media-storage.sh" \
  "$SCRIPT_DIR/build.sh" \
  "$SCRIPT_DIR/check-artifacts.sh" \
  "$SCRIPT_DIR/deploy.sh" \
  "$SCRIPT_DIR/preflight.sh" \
  "$SCRIPT_DIR/promote-api-candidate.sh" \
  "$SCRIPT_DIR/smoke-api-candidate.sh" \
  "$SCRIPT_DIR/test-api-candidate-release.sh" \
  "$SCRIPT_DIR/test-build-guards.sh" \
  "$SCRIPT_DIR/test-release-attestations.sh" \
  "$SCRIPT_DIR/schedule-worker.sh"

bash "$SCRIPT_DIR/test-build-guards.sh"
bash "$SCRIPT_DIR/test-api-candidate-release.sh"
bash "$SCRIPT_DIR/test-release-attestations.sh"
node --test "$SCRIPT_DIR/test-media-storage.test.mjs"
node --test "$SCRIPT_DIR/test-api-revision.test.mjs"

ruby - "$SCRIPT_DIR/cloudbuild.yaml" "$SCRIPT_DIR/cloudbuild-all.yaml" <<'RUBY'
require "yaml"

single_path, all_path = ARGV

def load_config(path)
  document = YAML.safe_load_file(path, aliases: false)
  abort "#{path}: expected a YAML mapping" unless document.is_a?(Hash)
  abort "#{path}: timeout must remain 1200s" unless document["timeout"] == "1200s"
  abort "#{path}: Cloud Logging-only mode is required" unless document.dig("options", "logging") == "CLOUD_LOGGING_ONLY"
  steps = document["steps"]
  abort "#{path}: steps must be a non-empty array" unless steps.is_a?(Array) && !steps.empty?
  steps.each do |step|
    image = step["name"].to_s
    abort "#{path}: every builder image must be digest-pinned" unless image.match?(/@sha256:[0-9a-f]{64}\z/)
    abort "#{path}: every build step must enable BuildKit" unless Array(step["env"]).include?("DOCKER_BUILDKIT=1")
  end
  document
end

def target_image_pairs(document, path)
  document.fetch("steps").map do |step|
    args = Array(step["args"])
    target_index = args.index("--target")
    tag_index = args.index("--tag")
    abort "#{path}: each step must set one target and tag" unless target_index && tag_index
    abort "#{path}: Docker build context must be repository root" unless args.last == "."
    [args.fetch(target_index + 1), args.fetch(tag_index + 1)]
  end
end

single = load_config(single_path)
single_expected = [["${_TARGET}", "${_IMAGE}"]]
abort "#{single_path}: individual-build target contract drifted" unless target_image_pairs(single, single_path) == single_expected
abort "#{single_path}: individual image output drifted" unless single["images"] == ["${_IMAGE}"]

all = load_config(all_path)
all_expected = [
  ["api-runtime", "${_API_IMAGE}"],
  ["worker-runtime", "${_WORKER_IMAGE}"],
  ["migration-runtime", "${_MIGRATION_IMAGE}"],
]
abort "#{all_path}: all-build target contract drifted" unless target_image_pairs(all, all_path) == all_expected
abort "#{all_path}: all-build image outputs drifted" unless all["images"] == all_expected.map(&:last)
RUBY

for target in api-runtime worker-runtime migration-runtime; do
  grep -Eq "^FROM .* AS ${target}$" "$REPO_ROOT/Dockerfile" \
    || {
      printf 'ERROR: Dockerfile target is missing: %s\n' "$target" >&2
      exit 1
    }
done

grep -Fxq '**' "$REPO_ROOT/.dockerignore" \
  || {
    printf '%s\n' 'ERROR: .dockerignore must remain deny-by-default' >&2
    exit 1
  }
for denied_path in \
  packages/db/src/provision-runtime-role.ts \
  packages/db/src/provision-worker-role.ts \
  packages/db/src/role-credentials.ts \
  packages/db/src/role-provisioning.ts \
  packages/db/src/seed.ts; do
  grep -Fxq "$denied_path" "$REPO_ROOT/.dockerignore" \
    || {
      printf 'ERROR: .dockerignore must explicitly deny %s\n' "$denied_path" >&2
      exit 1
    }
done

if grep -Eq \
  'ALTER ROLE|provision(Runtime|Worker)DatabaseRole|DatabasePassword|DatabaseUrl' \
  "$REPO_ROOT/packages/db/src/runtime-role.ts"; then
  printf '%s\n' 'ERROR: runtime-role.ts must contain only runtime-safe role identifiers' >&2
  exit 1
fi
grep -Eq 'ALTER ROLE|provision(Runtime|Worker)DatabaseRole' \
  "$REPO_ROOT/packages/db/src/role-provisioning.ts" \
  || {
    printf '%s\n' 'ERROR: operator-only role provisioning logic must remain isolated' >&2
    exit 1
  }

grep -Fxq '**' "$REPO_ROOT/.gcloudignore" \
  || {
    printf '%s\n' 'ERROR: .gcloudignore must remain deny-by-default' >&2
    exit 1
  }

context_check_dir="$(mktemp -d "${TMPDIR:-/tmp}/dabboba-context-check.XXXXXX")"
trap 'rm -rf -- "$context_check_dir"' EXIT
expected_context="$context_check_dir/expected.txt"
actual_context="$context_check_dir/actual.txt"
(
  cd "$REPO_ROOT"
  {
    printf '%s\n' \
      .dockerignore \
      Dockerfile \
      package.json \
      pnpm-lock.yaml \
      pnpm-workspace.yaml \
      tsconfig.base.json \
      patches/node-forge@1.4.0.patch \
      patches/@expo__metro-file-map@57.0.3.patch \
      patches/metro-file-map@0.84.5.patch \
      patches/metro-file-map@0.84.6.patch \
      apps/api/package.json \
      apps/api/tsconfig.json \
      apps/worker/package.json \
      apps/worker/tsconfig.json \
      packages/config/package.json \
      packages/config/tsconfig.json \
      packages/contracts/package.json \
      packages/contracts/tsconfig.json \
      packages/db/package.json \
      packages/db/tsconfig.json \
      packages/db/src/index.ts \
      packages/db/src/kuji-room.ts \
      packages/db/src/migrate.ts \
      packages/db/src/runtime-role.ts \
      packages/db/src/supabase-root-ca.ts \
      packages/domain/package.json \
      packages/domain/tsconfig.json \
      packages/media-storage/package.json \
      packages/media-storage/tsconfig.json
    find \
      apps/api/src \
      apps/api/src/lib \
      apps/api/src/modules \
      apps/api/src/plugins \
      apps/worker/src \
      packages/config/src \
      packages/contracts/src \
      packages/domain/src \
      packages/media-storage/src \
      -maxdepth 1 -type f -name '*.ts' \
      ! -name '*.test.ts' \
      ! -name '*.integration.test.ts' \
      ! -name '*.conformance.ts' \
      ! -name '*.test-d.ts' \
      -print
    find packages/contracts/openapi -maxdepth 1 -type f -name '*.yaml' -print
    find packages/db/migrations -maxdepth 1 -type f -name '*.sql' -print
  } | sort -u > "$expected_context"
)

if ! CLOUDSDK_GCLOUDIGNORE_ENABLED=true \
  gcloud meta list-files-for-upload "$REPO_ROOT" | sort -u > "$actual_context"; then
  printf '%s\n' 'ERROR: gcloud could not enumerate the local Cloud Build upload context' >&2
  exit 1
fi
if ! diff -u "$expected_context" "$actual_context"; then
  printf '%s\n' 'ERROR: the gcloud upload context does not match the reviewed Docker build allow-list' >&2
  exit 1
fi

if [[ "$mode" == "--build" ]]; then
  require_command docker
  docker info >/dev/null 2>&1 \
    || {
      printf '%s\n' 'ERROR: Docker daemon is unavailable' >&2
      exit 1
    }
  for target in api-runtime worker-runtime migration-runtime; do
    docker buildx build --check --target "$target" "$REPO_ROOT"
    docker buildx build \
      --progress=plain \
      --target "$target" \
      --output=type=cacheonly \
      "$REPO_ROOT"
  done
  docker buildx build \
    --check \
    --file "$SCRIPT_DIR/context-check.Dockerfile" \
    "$REPO_ROOT"
  docker buildx build \
    --progress=plain \
    --file "$SCRIPT_DIR/context-check.Dockerfile" \
    --output=type=cacheonly \
    "$REPO_ROOT"
fi

if [[ "$mode" == "--build" ]]; then
  printf '%s\n' 'Cloud Run artifact checks passed with Docker builds'
else
  printf '%s\n' 'Cloud Run artifact static checks passed'
fi
