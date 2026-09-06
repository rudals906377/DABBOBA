#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=ops/cloud-run/_common.sh
source "$SCRIPT_DIR/_common.sh"

tests_run=0
failures=0

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

check_candidate_tag() (
  export DABBOBA_API_CANDIDATE_TAG="${1:-}"
  api_candidate_tag >/dev/null
)

check_smoke_attestation() (
  export DABBOBA_IMAGE_TAG="release-2026"
  export DABBOBA_API_CANDIDATE_TAG="candidate-release-2026"
  export DABBOBA_API_CANDIDATE_REVISION="${2:-dabboba-api-00002-abc}"
  export DABBOBA_API_CANDIDATE_SMOKE_ATTESTATION="${1:-}"
  assert_api_candidate_smoke_attestation
)

check_smoke_attestation_without_revision() (
  export DABBOBA_IMAGE_TAG="release-2026"
  export DABBOBA_API_CANDIDATE_TAG="candidate-release-2026"
  unset DABBOBA_API_CANDIDATE_REVISION
  export DABBOBA_API_CANDIDATE_SMOKE_ATTESTATION="api-candidate:release-2026:candidate-release-2026:dabboba-api-00002-abc:PASSED"
  assert_api_candidate_smoke_attestation
)

check_file_contains() {
  local file="$1"
  local pattern="$2"
  grep -F -- "$pattern" "$file" >/dev/null
}

# Identity/traffic tests use the declared release maps. Independent map and
# malicious-observation fixtures live in test-api-revision.test.mjs.
candidate_revision_fixture() {
  local revision="$1" style="${2:-tag}" plain secrets
  plain="$(api_plain_env)" || return 1
  secrets="$(api_secret_env)" || return 1
  jq -cn --arg revision "$revision" --arg style "$style" \
    --arg account "$DABBOBA_API_SERVICE_ACCOUNT" --argjson plain "$plain" --argjson secrets "$secrets" '
    ($plain | to_entries | map({name:.key,value:.value})) as $plain_entries
    | if $style == "tag" then
        {metadata:{name:$revision,namespace:"123456789012"},spec:{serviceAccountName:$account,containers:[{
          image:"asia-northeast3-docker.pkg.dev/dabboba-prod/prod-images/dabboba-api:release-2026",
          env:($plain_entries + ($secrets | to_entries | map({name:.key,valueFrom:{secretKeyRef:{name:.value.secret,key:.value.version}}}))) }]}}
      else
        {name:("projects/dabboba-prod/locations/asia-northeast3/services/dabboba-api/revisions/" + $revision),serviceAccount:$account,containers:[{
          image:"asia-northeast3-docker.pkg.dev/dabboba-prod/prod-images/dabboba-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          env:($plain_entries + ($secrets | to_entries | map({name:.key,valueSource:{secretKeyRef:{secret:.value.secret,version:.value.version}}}))) }]}
      end'
}

check_candidate_fixture() (
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  export DABBOBA_ARTIFACT_REPOSITORY="prod-images"
  export DABBOBA_IMAGE_TAG="release-2026"
  export DABBOBA_API_CANDIDATE_TAG="candidate-release-2026"
  export DABBOBA_API_SERVICE_ACCOUNT="dabboba-api@dabboba-prod.iam.gserviceaccount.com"
  export DABBOBA_SUPABASE_URL="https://project-ref.supabase.co"
  export DABBOBA_WEB_ORIGINS="https://customer.example.com"
  export DABBOBA_DATABASE_SECRET="dabboba-database-runtime" DABBOBA_DATABASE_SECRET_VERSION=1
  export DABBOBA_SESSION_PEPPER_SECRET="dabboba-session-pepper" DABBOBA_SESSION_PEPPER_SECRET_VERSION=1
  local candidate_url

  api_service_json() {
    case "${FIXTURE_STYLE:-}" in
      v1)
        printf '%s\n' '{"status":{"latestReadyRevisionName":"dabboba-api-00002-abc","traffic":[{"revisionName":"dabboba-api-00002-abc","percent":0,"tag":"candidate-release-2026","url":"https://candidate-release-2026---dabboba-api-abc-an.a.run.app"}]}}'
        ;;
      v2)
        printf '%s\n' '{"latestReadyRevision":"projects/dabboba-prod/locations/asia-northeast3/services/dabboba-api/revisions/dabboba-api-00002-abc","trafficStatuses":[{"revision":"dabboba-api-00002-abc","percent":0,"tag":"candidate-release-2026","uri":"https://candidate-release-2026---dabboba-api-123456789012.asia-northeast3.run.app"}]}'
        ;;
      *) return 64 ;;
    esac
  }

  gcloud() {
    if [[ "$1 $2 $3" == "run revisions describe" ]]; then
      case "${IMAGE_STYLE:-}" in
        tag|digest) candidate_revision_fixture dabboba-api-00002-abc "$IMAGE_STYLE" ;;
        *) return 64 ;;
      esac
      return 0
    fi
    if [[ "$1 $2 $3" == "projects describe dabboba-prod" ]]; then
      printf '%s\n' 123456789012
      return 0
    fi
    if [[ "$1 $2 $3 $4" == "artifacts docker images describe" ]]; then
      printf '%s\n' 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      return 0
    fi
    return 64
  }

  candidate_url="$(assert_api_candidate_release \
    dabboba-api \
    candidate-release-2026 \
    0 \
    "${EXPECTED_REVISION:-}")"
  [[ "$candidate_url" == https://candidate-release-2026---*.run.app ]]
)

check_v1_tag_fixture() (
  export FIXTURE_STYLE=v1
  export IMAGE_STYLE=tag
  check_candidate_fixture
)

check_v2_digest_fixture() (
  export FIXTURE_STYLE=v2
  export IMAGE_STYLE=digest
  check_candidate_fixture
)

check_wrong_revision_fixture() (
  export FIXTURE_STYLE=v1
  export IMAGE_STYLE=tag
  export EXPECTED_REVISION=dabboba-api-00003-def
  check_candidate_fixture
)

check_smoke_target_resolution() (
  local scenario="$1"
  local target
  local revision
  local candidate_url
  api_candidate_revision() {
    printf '%s\n' 'dabboba-api-00002-abc'
  }
  assert_api_candidate_release() {
    [[ "$4" == "dabboba-api-00002-abc" ]] || return 64
    [[ "$scenario" != "moved" ]] || die "candidate tag moved before URL resolution"
    printf '%s\n' 'https://candidate-release-2026---dabboba-api-abc-an.a.run.app'
  }
  target="$(api_candidate_smoke_target dabboba-api candidate-release-2026 0)"
  IFS=$'\t' read -r revision candidate_url <<< "$target"
  [[ "$revision" == "dabboba-api-00002-abc" ]]
  [[ "$candidate_url" == "https://candidate-release-2026---dabboba-api-abc-an.a.run.app" ]]
)

check_hierarchy_invoker_policy() (
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  local scenario="$1"

  gcloud() {
    if [[ "$1 $2" == "projects get-ancestors" ]]; then
      printf '%s\n' '[{"id":"dabboba-prod","type":"project"},{"id":"1234","type":"folder"},{"id":"5678","type":"organization"}]'
      return 0
    fi
    if [[ "$1 $2" == "projects get-iam-policy" ]]; then
      if [[ "$scenario" == "project-public" ]]; then
        printf '%s\n' '{"bindings":[{"role":"roles/run.servicesInvoker","members":["allUsers"]}]}'
      else
        printf '%s\n' '{"bindings":[{"role":"roles/viewer","members":["user:operator@example.com"]}]}'
      fi
      return 0
    fi
    if [[ "$1 $2 $3" == "resource-manager folders get-iam-policy" ]]; then
      [[ "$scenario" != "folder-unreadable" ]] || return 1
      if [[ "$scenario" == "folder-public" ]]; then
        printf '%s\n' '{"bindings":[{"role":"roles/run.admin","members":["allAuthenticatedUsers"]}]}'
      else
        printf '%s\n' '{"bindings":[]}'
      fi
      return 0
    fi
    if [[ "$1 $2" == "organizations get-iam-policy" ]]; then
      if [[ "$scenario" == "organization-public" ]]; then
        printf '%s\n' '{"bindings":[{"role":"organizations/5678/roles/customRunCaller","members":["allUsers"]}]}'
      else
        printf '%s\n' '{"bindings":[]}'
      fi
      return 0
    fi
    return 64
  }

  assert_no_public_principals_in_project_hierarchy
)

check_service_invoker_policy() (
  export DABBOBA_GCP_PROJECT_ID="dabboba-prod"
  local scenario="$1"
  gcloud() {
    if [[ "$1 $2 $3" == "run services get-iam-policy" ]]; then
      if [[ "$scenario" == "public" ]]; then
        printf '%s\n' '{"bindings":[{"role":"roles/run.developer","members":["allUsers"]}]}'
      else
        printf '%s\n' '{"bindings":[]}'
      fi
      return 0
    fi
    return 64
  }
  assert_api_service_has_no_public_principals dabboba-api
)

check_deploy_precondition_scenario() (
  local scenario="$1"
  local mode="$2"
  local trace=""
  if [[ "$scenario" == "bootstrap-approved" || "$scenario" == "bootstrap-existing" || "$scenario" == "bootstrap-public-hierarchy" ]]; then
    export DABBOBA_APPROVE_PRIVATE_API_BOOTSTRAP=YES
  else
    unset DABBOBA_APPROVE_PRIVATE_API_BOOTSTRAP
  fi

  assert_api_service_has_baseline_traffic() {
    trace+="baseline "
  }
  assert_api_invoker_iam_disabled() {
    trace+="invoker:$2 "
    [[ "$scenario" != "candidate-private" ]] || die "private baseline"
  }
  assert_api_candidate_tag_available() {
    trace+="tag "
  }
  assert_api_service_absent() {
    trace+="absent "
    [[ "$scenario" != "bootstrap-existing" ]] || die "existing service"
  }
  assert_no_public_principals_in_project_hierarchy() {
    trace+="hierarchy "
    [[ "$scenario" != "bootstrap-public-hierarchy" ]] || die "public ancestor"
  }

  assert_api_deploy_mode_preconditions "$mode" dabboba-api candidate-release-2026
  case "$mode" in
    candidate) [[ "$trace" == "baseline invoker:true tag " ]] ;;
    bootstrap) [[ "$trace" == "absent hierarchy " ]] ;;
    *) return 64 ;;
  esac
)

check_api_deploy_traffic_args() (
  local mode="$1"
  local expected="$2"
  local actual
  actual="$(api_deploy_traffic_args "$mode" candidate-release-2026)"
  [[ "$actual" == "$expected" ]]
)

check_full_bootstrap_deploy_flow() (
  local storage_mode="${1:-gcs}"
  local role key name
  local fixture_dir
  local deploy_line
  local deploy_call
  fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/dabboba-bootstrap-release.XXXXXX")"
  trap 'rm -rf -- "$fixture_dir"' EXIT
  export DABBOBA_BOOTSTRAP_TEST_TRACE="$fixture_dir/gcloud.trace"
  export DABBOBA_BOOTSTRAP_TEST_SERVICE_STATE="$fixture_dir/service-created"

  export DABBOBA_APPROVE_GCP_MUTATIONS=YES
  export DABBOBA_APPROVE_PRIVATE_API_BOOTSTRAP=YES
  export DABBOBA_DATABASE_RELEASE_ATTESTATION="$DABBOBA_REQUIRED_DATABASE_RELEASE_ATTESTATION"
  export DABBOBA_GCP_PROJECT_ID=dabboba-prod
  export DABBOBA_GCP_BILLING_ACCOUNT_ID=000000-000000-000000
  export DABBOBA_ARTIFACT_REPOSITORY=prod-images
  export DABBOBA_IMAGE_TAG=release-2026
  export DABBOBA_API_CANDIDATE_TAG=candidate-release-2026
  export DABBOBA_API_SERVICE_ACCOUNT=dabboba-api@dabboba-prod.iam.gserviceaccount.com
  export DABBOBA_WORKER_SERVICE_ACCOUNT=dabboba-worker@dabboba-prod.iam.gserviceaccount.com
  export DABBOBA_MIGRATION_SERVICE_ACCOUNT=dabboba-migration@dabboba-prod.iam.gserviceaccount.com
  export DABBOBA_SCHEDULER_SERVICE_ACCOUNT=dabboba-scheduler@dabboba-prod.iam.gserviceaccount.com
  export DABBOBA_DATABASE_SECRET=dabboba-database-runtime
  export DABBOBA_DATABASE_SECRET_VERSION=1
  export DABBOBA_WORKER_DATABASE_SECRET=dabboba-database-worker
  export DABBOBA_MIGRATION_DATABASE_SECRET=dabboba-database-migration
  export DABBOBA_SESSION_PEPPER_SECRET=dabboba-session-pepper
  export DABBOBA_SESSION_PEPPER_SECRET_VERSION=1
  export DABBOBA_SUPABASE_URL=https://project-ref.supabase.co
  export DABBOBA_WEB_ORIGINS=https://customer.example.com
  export DABBOBA_PUBLIC_API_ABUSE_CONTROLS_VERIFIED=YES
  unset DATABASE_URL WORKER_DATABASE_URL DATABASE_MIGRATION_URL SESSION_TOKEN_PEPPER
  unset ADMIN_PROXY_IDENTITY_SECRET PAYMENT_WEBHOOK_SECRET NOTIFICATION_DELIVERY_TOKEN
  unset DABBOBA_GCS_BUCKET
  export DABBOBA_MEDIA_STORAGE_PROVIDER=gcs
  if [[ "$storage_mode" != gcs ]]; then
    export DABBOBA_MEDIA_STORAGE_PROVIDER=supabase
    export DABBOBA_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
    export DABBOBA_SUPABASE_STORAGE_BUCKET=private-media
    export DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT=https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3
    export DABBOBA_SUPABASE_STORAGE_S3_REGION=ap-northeast-2
    for role in API WORKER; do
      for key in SERVICE_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
        name="DABBOBA_${role}_SUPABASE_STORAGE_${key}_SECRET"
        export "$name=${role}-${key}" "${name}_VERSION=3"
      done
    done
    if [[ "$storage_mode" == mixed || "$storage_mode" == rollback ]]; then
      export DABBOBA_GCS_BUCKET=dabboba-media
    fi
    [[ "$storage_mode" != rollback ]] || export DABBOBA_MEDIA_STORAGE_PROVIDER=gcs
  fi

  gcloud() {
    printf '%s\n' "$*" >> "$DABBOBA_BOOTSTRAP_TEST_TRACE"
    case "$1 $2 $3" in
      "config get-value project")
        printf '%s\n' dabboba-prod
        ;;
      "auth list --filter=status:ACTIVE")
        printf '%s\n' operator@example.com
        ;;
      "billing projects describe")
        if [[ "$*" == *"value(billingAccountName)"* ]]; then
          printf '%s\n' billingAccounts/000000-000000-000000
        else
          printf '%s\n' true
        fi
        ;;
      "iam service-accounts describe")
        return 0
        ;;
      "projects describe dabboba-prod")
        printf '%s\n' 123456789012
        ;;
      "storage buckets describe")
        if [[ "$*" == *"value(location)"* ]]; then printf '%s\n' ASIA-NORTHEAST3
        else printf '%s\n' 123456789012; fi
        ;;
      "projects get-iam-policy "*)
        if [[ "$*" == *"--format=json"* ]]; then
          printf '%s\n' '{"bindings":[]}'
        fi
        ;;
      "services list "*)
        if [[ "$*" == *"--enabled"* ]]; then
          local argument
          for argument in "$@"; do
            if [[ "$argument" == --filter=config.name=* ]]; then
              printf '%s\n' "${argument#--filter=config.name=}"
              return 0
            fi
          done
          return 64
        fi
        [[ ! -f "$DABBOBA_BOOTSTRAP_TEST_SERVICE_STATE" ]] || printf '%s\n' dabboba-api
        ;;
      "artifacts repositories describe")
        if [[ "$*" == *"value(dockerConfig.immutableTags)"* ]]; then
          printf '%s\n' true
        else
          printf '%s\n' DOCKER
        fi
        ;;
      "secrets versions describe")
        printf '%s\n' ENABLED
        ;;
      "secrets get-iam-policy "*)
        printf '%s\n' serviceAccount:dabboba-api@dabboba-prod.iam.gserviceaccount.com
        ;;
      "projects get-ancestors "*)
        printf '%s\n' '[{"id":"dabboba-prod","type":"project"}]'
        ;;
      "run services list")
        [[ ! -f "$DABBOBA_BOOTSTRAP_TEST_SERVICE_STATE" ]] || printf '%s\n' dabboba-api
        ;;
      "run services describe")
        [[ -f "$DABBOBA_BOOTSTRAP_TEST_SERVICE_STATE" ]] || return 64
        printf '%s\n' '{"invokerIamDisabled":false,"spec":{"scaling":{"minInstanceCount":0}},"scaling":{"scalingMode":"AUTOMATIC","manualInstanceCount":0},"status":{"latestReadyRevisionName":"dabboba-api-00001-abc","traffic":[{"revisionName":"dabboba-api-00001-abc","percent":100,"tag":"candidate-release-2026","url":"https://candidate-release-2026---dabboba-api-abc-an.a.run.app"}]}}'
        ;;
      "run services get-iam-policy")
        printf '%s\n' '{"bindings":[]}'
        ;;
      "run revisions list")
        printf '%s\n' '[{"metadata":{"name":"dabboba-api-00001-abc"},"spec":{"scaling":{"minInstanceCount":0}}}]'
        ;;
      "run revisions describe")
        candidate_revision_fixture dabboba-api-00001-abc tag
        ;;
      "run deploy "*)
        : > "$DABBOBA_BOOTSTRAP_TEST_SERVICE_STATE"
        ;;
      *)
        if [[ "$1 $2 $3 $4" == "artifacts docker images describe" ]]; then
          printf '%s\n' sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          return 0
        fi
        return 64
        ;;
    esac
  }
  export -f gcloud candidate_revision_fixture

  bash "$SCRIPT_DIR/deploy.sh" api-bootstrap >/dev/null
  deploy_line="$(grep -n '^run deploy ' "$DABBOBA_BOOTSTRAP_TEST_TRACE" | cut -d: -f1)"
  [[ "$deploy_line" =~ ^[0-9]+$ ]]
  deploy_call="$(sed -n "${deploy_line}p" "$DABBOBA_BOOTSTRAP_TEST_TRACE")"
  [[ "$deploy_call" == *"--tag=candidate-release-2026"* ]]
  [[ "$deploy_call" != *"--no-traffic"* ]]
  [[ "$deploy_call" == *"MEDIA_STORAGE_PROVIDER=$DABBOBA_MEDIA_STORAGE_PROVIDER"* ]]
  if [[ "$storage_mode" != gcs ]]; then
    [[ "$deploy_call" == *"SUPABASE_STORAGE_BUCKET=private-media"* ]]
    [[ "$deploy_call" == *"SUPABASE_STORAGE_S3_ENDPOINT=https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3"* ]]
    [[ "$deploy_call" == *"SUPABASE_STORAGE_SERVICE_KEY=API-SERVICE_KEY:3"* ]]
    [[ "$deploy_call" == *"SUPABASE_STORAGE_S3_ACCESS_KEY_ID=API-S3_ACCESS_KEY_ID:3"* ]]
    [[ "$deploy_call" == *"SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=API-S3_SECRET_ACCESS_KEY:3"* ]]
    [[ "$deploy_call" != *"=WORKER-"* ]]
    if [[ "$storage_mode" == supabase ]]; then [[ "$deploy_call" != *"GCS_BUCKET="* ]]
    else [[ "$deploy_call" == *"GCS_BUCKET=dabboba-media"* ]]; fi
  fi
  [[ "$(awk -v stop="$deploy_line" 'NR < stop && /^run services list / { count += 1 } END { print count + 0 }' "$DABBOBA_BOOTSTRAP_TEST_TRACE")" == "1" ]]
  ! awk -v stop="$deploy_line" 'NR < stop && /^run revisions (list|describe) / { found = 1 } END { exit found ? 0 : 1 }' "$DABBOBA_BOOTSTRAP_TEST_TRACE"
  awk -v start="$deploy_line" 'NR > start && /^run revisions list / { found = 1 } END { exit found ? 0 : 1 }' "$DABBOBA_BOOTSTRAP_TEST_TRACE"
)

record_result failure "missing candidate tag" check_candidate_tag ""
record_result failure "generic reusable candidate tag" check_candidate_tag "candidate"
record_result failure "uppercase candidate tag" check_candidate_tag "candidate-Release"
record_result success "release-specific candidate tag" check_candidate_tag "candidate-release-2026"

record_result failure "missing candidate smoke attestation" check_smoke_attestation ""
record_result failure "missing attested candidate revision" \
  check_smoke_attestation_without_revision
record_result failure "invalid attested candidate revision" \
  check_smoke_attestation "ignored" "other-service-00002-abc"
record_result failure "wrong candidate smoke attestation" \
  check_smoke_attestation "api-candidate:release-2026:candidate-other:dabboba-api-00002-abc:PASSED"
record_result success "exact candidate smoke attestation" \
  check_smoke_attestation "api-candidate:release-2026:candidate-release-2026:dabboba-api-00002-abc:PASSED"
record_result success "v1 traffic URL and tagged image fixture" \
  check_v1_tag_fixture
record_result success "v2 traffic URI and digest image fixture" \
  check_v2_digest_fixture
record_result failure "candidate tag moved to a different revision" \
  check_wrong_revision_fixture
record_result success "smoke target binds URL to the captured revision before probes" \
  check_smoke_target_resolution stable
record_result failure "smoke target rejects a tag move before URL resolution" \
  check_smoke_target_resolution moved

record_result success "project, folder, and organization policies have no public principals" \
  check_hierarchy_invoker_policy safe
record_result failure "project-level public alternate Run role binding" \
  check_hierarchy_invoker_policy project-public
record_result failure "folder-level inherited public admin binding" \
  check_hierarchy_invoker_policy folder-public
record_result failure "organization-level inherited public custom role binding" \
  check_hierarchy_invoker_policy organization-public
record_result failure "unreadable ancestor IAM policy" \
  check_hierarchy_invoker_policy folder-unreadable
record_result success "service IAM policy has no public principals" \
  check_service_invoker_policy safe
record_result failure "service-level public alternate Run role binding" \
  check_service_invoker_policy public

record_result success "candidate deploy preconditions execute in order" \
  check_deploy_precondition_scenario candidate-approved candidate
record_result failure "candidate deploy rejects a private baseline" \
  check_deploy_precondition_scenario candidate-private candidate
record_result failure "bootstrap deploy requires explicit approval" \
  check_deploy_precondition_scenario bootstrap-unapproved bootstrap
record_result success "bootstrap deploy checks absence then inherited IAM" \
  check_deploy_precondition_scenario bootstrap-approved bootstrap
record_result failure "bootstrap deploy rejects an existing service" \
  check_deploy_precondition_scenario bootstrap-existing bootstrap
record_result failure "bootstrap deploy rejects inherited public IAM" \
  check_deploy_precondition_scenario bootstrap-public-hierarchy bootstrap

record_result success "candidate command includes no-traffic and tag" \
  check_api_deploy_traffic_args candidate $'--no-traffic\n--tag=candidate-release-2026'
record_result success "first-service bootstrap omits no-traffic" \
  check_api_deploy_traffic_args bootstrap '--tag=candidate-release-2026'
record_result success "full private bootstrap skips predeploy revision checks and verifies the created service" \
  check_full_bootstrap_deploy_flow
record_result success "Supabase-only API deploy renders three API-only pinned storage references without GCS" \
  check_full_bootstrap_deploy_flow supabase
record_result success "mixed-provider API deploy preserves legacy GCS and exact Supabase references" \
  check_full_bootstrap_deploy_flow mixed
record_result success "GCS rollback API deploy retains secondary Supabase credentials" \
  check_full_bootstrap_deploy_flow rollback

record_result success "API deploy consumes mode-specific traffic arguments" \
  check_file_contains "$SCRIPT_DIR/deploy.sh" 'api_deploy_traffic_args "$mode" "$candidate_tag"'
record_result success "candidate smoke checks health" \
  check_file_contains "$SCRIPT_DIR/smoke-api-candidate.sh" 'probe_status "$candidate_url/healthz" 200'
record_result success "candidate smoke checks readiness" \
  check_file_contains "$SCRIPT_DIR/smoke-api-candidate.sh" 'probe_status "$candidate_url/readyz" 200'
record_result success "candidate smoke rejects admin surface" \
  check_file_contains "$SCRIPT_DIR/smoke-api-candidate.sh" 'probe_status "$candidate_url/v1/admin/products" 404'
record_result success "candidate smoke checks public home catalog" \
  check_file_contains "$SCRIPT_DIR/smoke-api-candidate.sh" 'probe_status "$candidate_url/v1/catalog/home-sections" 200'
record_result success "candidate smoke checks auth provider discovery" \
  check_file_contains "$SCRIPT_DIR/smoke-api-candidate.sh" 'probe_status "$candidate_url/v1/auth/providers" 200'
record_result success "promotion routes by exact attested revision" \
  check_file_contains "$SCRIPT_DIR/promote-api-candidate.sh" '--to-revisions="$candidate_revision=100"'
record_result success "private first-service bootstrap is explicit" \
  check_file_contains "$SCRIPT_DIR/deploy.sh" 'api-bootstrap'
record_result success "private bootstrap keeps invoker IAM enabled" \
  check_file_contains "$SCRIPT_DIR/deploy.sh" '--invoker-iam-check'
record_result success "private bootstrap smoke proves unauthenticated access is denied" \
  check_file_contains "$SCRIPT_DIR/smoke-api-candidate.sh" 'probe_unauthenticated_denied "$candidate_url/healthz"'
record_result success "bootstrap promotion explicitly enables public access" \
  check_file_contains "$SCRIPT_DIR/promote-api-candidate.sh" '--no-invoker-iam-check'

if ((failures > 0)); then
  printf '%d of %d API candidate release tests failed\n' "$failures" "$tests_run" >&2
  exit 1
fi

printf 'All %d API candidate release tests passed\n' "$tests_run"
