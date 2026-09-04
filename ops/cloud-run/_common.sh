#!/usr/bin/env bash

set -Eeuo pipefail

readonly DABBOBA_CLOUD_RUN_REGION="asia-northeast3"
readonly CLOUD_RUN_OPS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DABBOBA_REPO_ROOT="$(cd -- "$CLOUD_RUN_OPS_DIR/../.." && pwd -P)"
readonly DABBOBA_DATABASE_RELEASE_MIGRATION="packages/db/migrations/0033_exchange_bundle_items.sql"
readonly DABBOBA_DATABASE_RELEASE_SHA256="1a4f88b4bc6707d9b985c0a29fb0fac1dda228af4fd87850d4eb6b1f7bd60c62"
readonly DABBOBA_REQUIRED_DATABASE_RELEASE_ATTESTATION="0033:${DABBOBA_DATABASE_RELEASE_SHA256}:runtime+worker"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1
export CLOUDSDK_GCLOUDIGNORE_ENABLED=true

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

sha256_file() {
  local path="$1"
  local digest
  [[ -f "$path" ]] || die "Required checksum input is unavailable: $path"

  if command -v sha256sum >/dev/null 2>&1; then
    digest="$(sha256sum "$path" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    digest="$(shasum -a 256 "$path" | awk '{print $1}')"
  elif command -v openssl >/dev/null 2>&1; then
    digest="$(openssl dgst -sha256 "$path" | awk '{print $NF}')"
  else
    die "A SHA-256 implementation is required (sha256sum, shasum, or openssl)"
  fi

  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die "Unable to calculate a valid SHA-256 digest for $path"
  printf '%s\n' "$digest"
}

assert_database_release_migration_checksum() {
  local migration="$DABBOBA_REPO_ROOT/$DABBOBA_DATABASE_RELEASE_MIGRATION"
  local actual
  actual="$(sha256_file "$migration")"
  [[ "$actual" == "$DABBOBA_DATABASE_RELEASE_SHA256" ]] \
    || die "Migration 0033 checksum changed; review the migration and intentionally rotate the database release attestation"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Set $name before continuing"
}

assert_resource_name() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]] \
    || die "$label must be a lowercase Google Cloud resource name"
}

expected_project_id() {
  require_env DABBOBA_GCP_PROJECT_ID
  [[ "$DABBOBA_GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] \
    || die "DABBOBA_GCP_PROJECT_ID is not a valid project ID"
  [[ "$DABBOBA_GCP_PROJECT_ID" != "findy-staging" ]] \
    || die "findy-staging belongs to a different product and is forbidden for DABBOBA deployment"
  printf '%s\n' "$DABBOBA_GCP_PROJECT_ID"
}

expected_billing_account_id() {
  require_env DABBOBA_GCP_BILLING_ACCOUNT_ID
  local value="${DABBOBA_GCP_BILLING_ACCOUNT_ID#billingAccounts/}"
  value="$(printf '%s' "$value" | tr '[:lower:]' '[:upper:]')"
  [[ "$value" =~ ^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$ ]] \
    || die "DABBOBA_GCP_BILLING_ACCOUNT_ID is not a valid billing account ID"
  printf '%s\n' "$value"
}

expected_project_number() {
  local project
  local project_number
  project="$(expected_project_id)"
  project_number="$(gcloud projects describe "$project" \
    --format='value(projectNumber)' 2>/dev/null)" \
    || die "Unable to resolve the project number for $project"
  project_number="${project_number##*/}"
  [[ "$project_number" =~ ^[0-9]+$ ]] \
    || die "Google Cloud returned an invalid project number for $project"
  printf '%s\n' "$project_number"
}

assert_no_raw_secret_envs() {
  local name
  for name in \
    DATABASE_URL \
    WORKER_DATABASE_URL \
    DATABASE_MIGRATION_URL \
    SESSION_TOKEN_PEPPER \
    ADMIN_PROXY_IDENTITY_SECRET \
    PAYMENT_WEBHOOK_SECRET \
    NOTIFICATION_DELIVERY_TOKEN; do
    [[ -z "${!name:-}" ]] \
      || die "Unset raw secret environment variable $name; Cloud Run operations accept Secret Manager references only"
  done
}

assert_mutation_approval() {
  [[ "${DABBOBA_APPROVE_GCP_MUTATIONS:-}" == "YES" ]] \
    || die "Refusing Google Cloud mutation. Set DABBOBA_APPROVE_GCP_MUTATIONS=YES for this command only"
}

assert_gcloud_context() {
  require_command gcloud
  local expected_project
  local expected_billing
  local configured_project
  local active_account
  local billing_name
  local billing_enabled
  expected_project="$(expected_project_id)"
  expected_billing="$(expected_billing_account_id)"

  [[ -z "${DABBOBA_GCP_REGION:-}" || "$DABBOBA_GCP_REGION" == "$DABBOBA_CLOUD_RUN_REGION" ]] \
    || die "DABBOBA_GCP_REGION must be $DABBOBA_CLOUD_RUN_REGION"

  configured_project="$(gcloud config get-value project 2>/dev/null)" \
    || die "Unable to read the active gcloud project"
  [[ "$configured_project" == "$expected_project" ]] \
    || die "Active gcloud project '$configured_project' does not match expected project '$expected_project'"

  active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" \
    || die "Unable to inspect the active gcloud account"
  [[ -n "$active_account" ]] || die "No active gcloud account is configured"

  billing_name="$(gcloud billing projects describe "$expected_project" --format='value(billingAccountName)' 2>/dev/null)" \
    || die "Unable to verify the project's linked billing account"
  billing_enabled="$(gcloud billing projects describe "$expected_project" --format='value(billingEnabled)' 2>/dev/null)" \
    || die "Unable to verify whether project billing is enabled"
  [[ "${billing_name#billingAccounts/}" == "$expected_billing" ]] \
    || die "Project billing account does not match DABBOBA_GCP_BILLING_ACCOUNT_ID"
  [[ "$(printf '%s' "$billing_enabled" | tr '[:lower:]' '[:upper:]')" == "TRUE" ]] \
    || die "Billing is not enabled for project $expected_project"

  note "gcloud context verified: account=$active_account project=$expected_project billing=$expected_billing"
}

assert_api_enabled() {
  local api="$1"
  local project
  local enabled
  project="$(expected_project_id)"
  enabled="$(gcloud services list \
    --enabled \
    --project="$project" \
    --filter="config.name=$api" \
    --format='value(config.name)' 2>/dev/null)" \
    || die "Unable to inspect API state for $api"
  [[ "$enabled" == "$api" ]] \
    || die "$api is not enabled; this script will not enable APIs implicitly"
}

artifact_repository() {
  require_env DABBOBA_ARTIFACT_REPOSITORY
  assert_resource_name "$DABBOBA_ARTIFACT_REPOSITORY" DABBOBA_ARTIFACT_REPOSITORY
  printf '%s\n' "$DABBOBA_ARTIFACT_REPOSITORY"
}

assert_artifact_repository() {
  local project
  local repository
  local format
  local immutable_tags
  project="$(expected_project_id)"
  repository="$(artifact_repository)"
  format="$(gcloud artifacts repositories describe "$repository" \
    --project="$project" \
    --location="$DABBOBA_CLOUD_RUN_REGION" \
    --format='value(format)' 2>/dev/null)" \
    || die "Artifact Registry repository '$repository' must already exist in $DABBOBA_CLOUD_RUN_REGION"
  [[ "$format" == "DOCKER" ]] || die "Artifact Registry repository '$repository' is not a Docker repository"
  immutable_tags="$(gcloud artifacts repositories describe "$repository" \
    --project="$project" \
    --location="$DABBOBA_CLOUD_RUN_REGION" \
    --format='value(dockerConfig.immutableTags)' 2>/dev/null)" \
    || die "Unable to inspect tag immutability for Artifact Registry repository '$repository'"
  [[ "$(printf '%s' "$immutable_tags" | tr '[:lower:]' '[:upper:]')" == "TRUE" ]] \
    || die "Artifact Registry repository '$repository' must have immutable Docker tags enabled"
}

normalize_bucket_name() {
  local value="${1#gs://}"
  value="${value%/}"
  [[ "$value" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] \
    || die "Invalid Cloud Storage bucket name"
  printf '%s\n' "$value"
}

assert_existing_seoul_bucket() {
  local raw_name="$1"
  local purpose="$2"
  local project
  local bucket
  local bucket_project_number
  local location
  local project_number
  project="$(expected_project_id)"
  project_number="$(expected_project_number)"
  bucket="$(normalize_bucket_name "$raw_name")"
  location="$(gcloud storage buckets describe "gs://$bucket" \
    --project="$project" \
    --format='value(location)' 2>/dev/null)" \
    || die "$purpose bucket gs://$bucket must already exist; this script will not create it"
  [[ "$(printf '%s' "$location" | tr '[:lower:]' '[:upper:]')" == "ASIA-NORTHEAST3" ]] \
    || die "$purpose bucket gs://$bucket must be located in asia-northeast3, not $location"
  bucket_project_number="$(gcloud storage buckets describe "gs://$bucket" \
    --project="$project" \
    --format='value(projectNumber)' 2>/dev/null)" \
    || die "Unable to verify project ownership for $purpose bucket gs://$bucket"
  bucket_project_number="${bucket_project_number##*/}"
  [[ "$bucket_project_number" =~ ^[0-9]+$ ]] \
    || die "$purpose bucket gs://$bucket returned an invalid owning project number"
  [[ "$bucket_project_number" == "$project_number" ]] \
    || die "$purpose bucket gs://$bucket belongs to project number $bucket_project_number, not DABBOBA project number $project_number"
}

configured_service_account_env_names() {
  printf '%s\n' \
    DABBOBA_CLOUD_BUILD_SERVICE_ACCOUNT \
    DABBOBA_API_SERVICE_ACCOUNT \
    DABBOBA_WORKER_SERVICE_ACCOUNT \
    DABBOBA_MIGRATION_SERVICE_ACCOUNT \
    DABBOBA_SCHEDULER_SERVICE_ACCOUNT
}

assert_configured_service_accounts_are_distinct() {
  local name
  local value
  local index
  local -a seen_names=()
  local -a seen_values=()
  while IFS= read -r name; do
    value="${!name:-}"
    [[ -n "$value" ]] || continue
    for index in "${!seen_values[@]}"; do
      [[ "$value" != "${seen_values[$index]}" ]] \
        || die "${seen_names[$index]} and $name must use separate service accounts"
    done
    seen_names+=("$name")
    seen_values+=("$value")
  done < <(configured_service_account_env_names)
}

is_configured_dabboba_service_account() {
  local candidate="$1"
  local name
  local configured
  while IFS= read -r name; do
    configured="${!name:-}"
    if [[ -n "$configured" && "$candidate" == "$configured" ]]; then
      return 0
    fi
  done < <(configured_service_account_env_names)
  return 1
}

assert_no_project_level_secret_accessor_for_configured_service_accounts() {
  local project
  local members
  local member
  local account
  local has_configured_account=""
  local name
  while IFS= read -r name; do
    [[ -z "${!name:-}" ]] || has_configured_account="yes"
  done < <(configured_service_account_env_names)
  [[ "$has_configured_account" == "yes" ]] || return 0

  project="$(expected_project_id)"
  members="$(gcloud projects get-iam-policy "$project" \
    --flatten='bindings[].members' \
    --filter='bindings.role=roles/secretmanager.secretAccessor' \
    --format='value(bindings.members)' 2>/dev/null)" \
    || die "Unable to inspect project-level Secret Manager IAM"
  while IFS= read -r member; do
    [[ "$member" == serviceAccount:* ]] || continue
    account="${member#serviceAccount:}"
    if is_configured_dabboba_service_account "$account"; then
      die "$account must not have project-level roles/secretmanager.secretAccessor; grant only per-secret access"
    fi
  done <<< "$members"
  return 0
}

assert_cloud_identity_boundaries() {
  assert_configured_service_accounts_are_distinct
  assert_no_project_level_secret_accessor_for_configured_service_accounts
}

assert_service_account() {
  local email="$1"
  local purpose="$2"
  local project
  project="$(expected_project_id)"
  [[ "$email" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]@${project//./\.}\.iam\.gserviceaccount\.com$ ]] \
    || die "$purpose must use a dedicated service account in project $project"
  gcloud iam service-accounts describe "$email" --project="$project" --format='value(email)' >/dev/null 2>&1 \
    || die "$purpose service account $email must already exist"
}

assert_secret_version() {
  local secret="$1"
  local version="$2"
  local service_account="$3"
  local purpose="$4"
  local project
  local state
  local members
  local matching_members=0
  local member
  project="$(expected_project_id)"

  [[ "$secret" =~ ^[A-Za-z0-9_-]{1,255}$ ]] || die "$purpose secret ID is invalid"
  [[ "$version" =~ ^[1-9][0-9]*$ ]] \
    || die "$purpose must pin a numeric Secret Manager version; aliases such as latest are forbidden"

  state="$(gcloud secrets versions describe "$version" \
    --secret="$secret" \
    --project="$project" \
    --format='value(state)' 2>/dev/null)" \
    || die "$purpose secret version $secret:$version is unavailable"
  [[ "$state" == "ENABLED" ]] || die "$purpose secret version $secret:$version is not enabled"

  members="$(gcloud secrets get-iam-policy "$secret" \
    --project="$project" \
    --flatten='bindings[].members' \
    --filter="bindings.role=roles/secretmanager.secretAccessor" \
    --format='value(bindings.members)' 2>/dev/null)" \
    || die "Unable to inspect IAM for $purpose secret $secret"
  while IFS= read -r member; do
    [[ -n "$member" ]] || continue
    if [[ "$member" == "serviceAccount:$service_account" ]]; then
      matching_members=$((matching_members + 1))
      continue
    fi
    die "$member must not access $purpose secret $secret; only serviceAccount:$service_account may have roles/secretmanager.secretAccessor on this DABBOBA secret"
  done <<< "$members"
  [[ "$matching_members" -eq 1 ]] \
    || die "$service_account needs exactly one secret-level roles/secretmanager.secretAccessor binding on $secret"
}

image_tag() {
  require_env DABBOBA_IMAGE_TAG
  [[ "$DABBOBA_IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] \
    || die "DABBOBA_IMAGE_TAG is not a valid container tag"
  [[ "$(printf '%s' "$DABBOBA_IMAGE_TAG" | tr '[:upper:]' '[:lower:]')" != "latest" ]] \
    || die "The mutable latest image tag is forbidden"
  printf '%s\n' "$DABBOBA_IMAGE_TAG"
}

image_name_for() {
  case "$1" in
    api) printf '%s\n' "dabboba-api" ;;
    worker) printf '%s\n' "dabboba-worker" ;;
    migration) printf '%s\n' "dabboba-migration" ;;
    *) die "Unknown image kind: $1" ;;
  esac
}

image_uri_for() {
  local kind="$1"
  local project
  local repository
  local tag
  project="$(expected_project_id)"
  repository="$(artifact_repository)"
  tag="$(image_tag)"
  printf '%s-docker.pkg.dev/%s/%s/%s:%s\n' \
    "$DABBOBA_CLOUD_RUN_REGION" "$project" "$repository" "$(image_name_for "$kind")" "$tag"
}

assert_image_exists() {
  local image="$1"
  image_digest_for "$image" >/dev/null
}

image_digest_for() {
  local image="$1"
  local project
  local digest
  project="$(expected_project_id)"
  digest="$(gcloud artifacts docker images describe "$image" \
    --project="$project" \
    --format='value(image_summary.digest)' 2>/dev/null)" \
    || die "Container image does not exist or cannot be inspected: $image"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || die "Artifact Registry returned an invalid digest for $image"
  printf '%s\n' "$digest"
}

assert_image_tag_absent() {
  local kind="$1"
  local project
  local repository
  local image_name
  local image_path
  local tag
  local existing_tags
  local existing_tag
  project="$(expected_project_id)"
  repository="$(artifact_repository)"
  image_name="$(image_name_for "$kind")"
  tag="$(image_tag)"
  image_path="$DABBOBA_CLOUD_RUN_REGION-docker.pkg.dev/$project/$repository/$image_name"
  if ! existing_tags="$(gcloud artifacts docker tags list \
    "$image_path" \
    --project="$project" \
    --format='value(tag)' 2>&1)"; then
    if [[ "$existing_tags" =~ (^|[[:space:]])NOT_FOUND: ]]; then
      return 0
    fi
    die "Unable to verify whether image tag $image_name:$tag already exists: $existing_tags"
  fi
  while IFS= read -r existing_tag; do
    case "$existing_tag" in
      "$tag"|"$image_path:$tag"|*/tags/"$tag")
        die "Immutable image tag already exists: $image_name:$tag"
        ;;
    esac
  done <<< "$existing_tags"
}

assert_https_origin() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]] \
    || die "$label must be an exact HTTPS origin without credentials, path, query, wildcard, or trailing slash"
}

assert_https_origin_list() {
  local value="$1"
  local label="$2"
  local origins=()
  local origin
  IFS=',' read -r -a origins <<< "$value"
  ((${#origins[@]} > 0)) || die "$label must include at least one HTTPS origin"
  for origin in "${origins[@]}"; do
    assert_https_origin "$origin" "$label entry"
  done
}

assert_runtime_migration_separation() {
  if [[ -n "${DABBOBA_WORKER_DATABASE_SECRET:-}" ]]; then
    [[ "$DABBOBA_DATABASE_SECRET" != "$DABBOBA_WORKER_DATABASE_SECRET" ]] \
      || die "API and worker database secrets must be different"
  fi
  if [[ -n "${DABBOBA_MIGRATION_DATABASE_SECRET:-}" ]]; then
    [[ "$DABBOBA_DATABASE_SECRET" != "$DABBOBA_MIGRATION_DATABASE_SECRET" ]] \
      || die "Runtime and migration database secrets must be different"
    if [[ -n "${DABBOBA_WORKER_DATABASE_SECRET:-}" ]]; then
      [[ "$DABBOBA_WORKER_DATABASE_SECRET" != "$DABBOBA_MIGRATION_DATABASE_SECRET" ]] \
        || die "Worker and migration database secrets must be different"
    fi
  fi
}

assert_public_api_abuse_controls_attestation() {
  [[ "${DABBOBA_PUBLIC_API_ABUSE_CONTROLS_VERIFIED:-}" == "YES" ]] \
    || die "Public API deployment is blocked. Set DABBOBA_PUBLIC_API_ABUSE_CONTROLS_VERIFIED=YES only after the documented abuse-control review is complete"
}

assert_database_release_attestation() {
  assert_database_release_migration_checksum
  [[ "${DABBOBA_DATABASE_RELEASE_ATTESTATION:-}" == "$DABBOBA_REQUIRED_DATABASE_RELEASE_ATTESTATION" ]] \
    || die "API and worker deployment is blocked. Set DABBOBA_DATABASE_RELEASE_ATTESTATION to the documented release value only after migration 0033 and both restricted database roles are verified against the target database"
}

expected_worker_execution_attestation() {
  printf 'worker-job:%s:SUCCEEDED\n' "$(image_tag)"
}

assert_worker_execution_attestation() {
  local expected
  expected="$(expected_worker_execution_attestation)"
  [[ "${DABBOBA_WORKER_EXECUTION_ATTESTATION:-}" == "$expected" ]] \
    || die "Worker scheduling is blocked. Set DABBOBA_WORKER_EXECUTION_ATTESTATION=$expected only after this immutable worker image completes one approved manual Job execution"
}

assert_service_revisions_scale_to_zero() {
  local service="$1"
  local project
  local services
  local existing_service=""
  local listed_service
  local service_json
  local service_min
  local service_scaling_mode
  local manual_instance_count
  local revisions_json
  local revision_violations
  require_command jq
  project="$(expected_project_id)"

  services="$(gcloud run services list \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format='value(metadata.name)' 2>/dev/null)" \
    || die "Unable to inspect existing Cloud Run services"
  while IFS= read -r listed_service; do
    if [[ "${listed_service##*/}" == "$service" ]]; then
      existing_service="yes"
    fi
  done <<< "$services"
  [[ "$existing_service" == "yes" ]] || return 0

  service_json="$(gcloud run services describe "$service" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null)" \
    || die "Unable to inspect Cloud Run service $service"
  service_min="$(printf '%s\n' "$service_json" | jq -er '
    (.spec.scaling.minInstanceCount
      // .scaling.minInstanceCount
      // .metadata.annotations["run.googleapis.com/minScale"]
      // 0)
    | tonumber
  ')" || die "Unable to inspect service-level minimum instances for $service"
  [[ "$service_min" == "0" ]] \
    || die "Cloud Run service $service has a nonzero service-level minimum of $service_min"
  service_scaling_mode="$(printf '%s\n' "$service_json" | jq -er '
    (.scaling.scalingMode
      // .metadata.annotations["run.googleapis.com/scalingMode"]
      // "automatic")
    | tostring
    | ascii_downcase
  ')" || die "Unable to inspect the scaling mode for $service"
  [[ "$service_scaling_mode" == "auto" || "$service_scaling_mode" == "automatic" ]] \
    || die "Cloud Run service $service uses non-autoscaling mode $service_scaling_mode"
  manual_instance_count="$(printf '%s\n' "$service_json" | jq -er '
    (.scaling.manualInstanceCount
      // .metadata.annotations["run.googleapis.com/manualInstanceCount"]
      // 0)
    | tonumber
  ')" || die "Unable to inspect manual instance count for $service"
  [[ "$manual_instance_count" == "0" ]] \
    || die "Cloud Run service $service has a nonzero manual instance count of $manual_instance_count"

  revisions_json="$(gcloud run revisions list \
    --service="$service" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null)" \
    || die "Unable to inspect revisions for Cloud Run service $service"
  revision_violations="$(printf '%s\n' "$revisions_json" | jq -cer '[
    .[]
    | ((.spec.scaling.minInstanceCount
        // .scaling.minInstanceCount
        // .spec.template.scaling.minInstanceCount
        // .metadata.annotations["autoscaling.knative.dev/minScale"]
        // .metadata.annotations["run.googleapis.com/minScale"]
        // 0) | tonumber) as $minimum
    | select($minimum != 0)
    | {revision: (.metadata.name // .name // "unknown"), minimum: $minimum}
  ]')" || die "Unable to inspect revision-level minimum instances for $service"
  [[ "$revision_violations" == "[]" ]] \
    || die "Cloud Run service $service has revisions with nonzero minimum instances: $revision_violations"
}

assert_worker_job_matches_scheduler_contract() {
  local worker_job="$1"
  local project
  local expected_image
  local expected_digest
  local expected_digest_image
  local expected_bucket
  local expected_queue
  local job_json
  require_command jq
  [[ -f "$CLOUD_RUN_OPS_DIR/verify-worker-job.jq" ]] \
    || die "Missing ops/cloud-run/verify-worker-job.jq"
  project="$(expected_project_id)"
  expected_image="$(image_uri_for worker)"
  expected_digest="$(image_digest_for "$expected_image")"
  expected_digest_image="${expected_image%:*}@$expected_digest"
  expected_bucket="$(normalize_bucket_name "$DABBOBA_GCS_BUCKET")"
  expected_queue="${DABBOBA_WORKER_QUEUE_NAME:-dabboba_worker}"
  [[ "$expected_queue" == "dabboba_worker" ]] \
    || die "DABBOBA_WORKER_QUEUE_NAME must be dabboba_worker to match the migrated queue ACL"

  job_json="$(gcloud run jobs describe "$worker_job" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null)" \
    || die "Worker job $worker_job must already exist before scheduling"
  printf '%s\n' "$job_json" | jq -e \
    --arg expected_image "$expected_image" \
    --arg expected_digest_image "$expected_digest_image" \
    --arg expected_service_account "$DABBOBA_WORKER_SERVICE_ACCOUNT" \
    --arg expected_queue "$expected_queue" \
    --arg expected_bucket "$expected_bucket" \
    --arg expected_project "$project" \
    --arg expected_secret "$DABBOBA_WORKER_DATABASE_SECRET" \
    --arg expected_secret_version "$DABBOBA_WORKER_DATABASE_SECRET_VERSION" \
    -f "$CLOUD_RUN_OPS_DIR/verify-worker-job.jq" >/dev/null \
    || die "Worker job $worker_job does not match the approved scheduling contract"
}

check_build_prerequisites() {
  assert_api_enabled artifactregistry.googleapis.com
  assert_api_enabled cloudbuild.googleapis.com
  assert_artifact_repository
  require_env DABBOBA_CLOUD_BUILD_BUCKET
  require_env DABBOBA_CLOUD_BUILD_SERVICE_ACCOUNT
  assert_existing_seoul_bucket "$DABBOBA_CLOUD_BUILD_BUCKET" "Cloud Build staging"
  assert_service_account "$DABBOBA_CLOUD_BUILD_SERVICE_ACCOUNT" "Cloud Build"
  image_tag >/dev/null
  [[ -f "$DABBOBA_REPO_ROOT/Dockerfile" && -f "$DABBOBA_REPO_ROOT/.dockerignore" ]] \
    || die "Dockerfile and .dockerignore must exist at the repository root"
  [[ -f "$DABBOBA_REPO_ROOT/.gcloudignore" ]] \
    || die ".gcloudignore must exist at the repository root"
  grep -Fxq '**' "$DABBOBA_REPO_ROOT/.gcloudignore" \
    || die ".gcloudignore must remain deny-by-default"
  [[ -f "$CLOUD_RUN_OPS_DIR/cloudbuild.yaml" ]] || die "Missing ops/cloud-run/cloudbuild.yaml"
  [[ -f "$CLOUD_RUN_OPS_DIR/cloudbuild-all.yaml" ]] || die "Missing ops/cloud-run/cloudbuild-all.yaml"
}

check_api_prerequisites() {
  local service_account
  local service
  assert_api_enabled run.googleapis.com
  assert_api_enabled secretmanager.googleapis.com
  assert_api_enabled artifactregistry.googleapis.com
  assert_artifact_repository
  require_env DABBOBA_API_SERVICE_ACCOUNT
  require_env DABBOBA_DATABASE_SECRET
  require_env DABBOBA_DATABASE_SECRET_VERSION
  require_env DABBOBA_SESSION_PEPPER_SECRET
  require_env DABBOBA_SESSION_PEPPER_SECRET_VERSION
  require_env DABBOBA_SUPABASE_URL
  require_env DABBOBA_WEB_ORIGINS
  assert_public_api_abuse_controls_attestation
  service_account="$DABBOBA_API_SERVICE_ACCOUNT"
  assert_service_account "$service_account" "API runtime"
  assert_runtime_migration_separation
  [[ "$DABBOBA_DATABASE_SECRET" != "$DABBOBA_SESSION_PEPPER_SECRET" ]] \
    || die "DATABASE_URL and SESSION_TOKEN_PEPPER must use different secrets"
  assert_secret_version "$DABBOBA_DATABASE_SECRET" "$DABBOBA_DATABASE_SECRET_VERSION" "$service_account" "API runtime database"
  assert_secret_version "$DABBOBA_SESSION_PEPPER_SECRET" "$DABBOBA_SESSION_PEPPER_SECRET_VERSION" "$service_account" "API session pepper"
  assert_https_origin "$DABBOBA_SUPABASE_URL" DABBOBA_SUPABASE_URL
  assert_https_origin_list "$DABBOBA_WEB_ORIGINS" DABBOBA_WEB_ORIGINS
  if [[ -n "${DABBOBA_GCS_BUCKET:-}" ]]; then
    assert_existing_seoul_bucket "$DABBOBA_GCS_BUCKET" "Customer media"
  fi
  assert_image_exists "$(image_uri_for api)"
  service="${DABBOBA_API_SERVICE:-dabboba-api}"
  assert_resource_name "$service" DABBOBA_API_SERVICE
  assert_service_revisions_scale_to_zero "$service"
}

check_worker_prerequisites() {
  local service_account
  assert_api_enabled run.googleapis.com
  assert_api_enabled secretmanager.googleapis.com
  assert_api_enabled artifactregistry.googleapis.com
  assert_artifact_repository
  require_env DABBOBA_WORKER_SERVICE_ACCOUNT
  require_env DABBOBA_DATABASE_SECRET
  require_env DABBOBA_WORKER_DATABASE_SECRET
  require_env DABBOBA_WORKER_DATABASE_SECRET_VERSION
  require_env DABBOBA_GCS_BUCKET
  service_account="$DABBOBA_WORKER_SERVICE_ACCOUNT"
  assert_service_account "$service_account" "Worker job"
  assert_runtime_migration_separation
  if [[ -n "${DABBOBA_API_SERVICE_ACCOUNT:-}" ]]; then
    [[ "$service_account" != "$DABBOBA_API_SERVICE_ACCOUNT" ]] \
      || die "API and worker must use separate service accounts"
  fi
  assert_secret_version "$DABBOBA_WORKER_DATABASE_SECRET" "$DABBOBA_WORKER_DATABASE_SECRET_VERSION" "$service_account" "Worker database"
  assert_existing_seoul_bucket "$DABBOBA_GCS_BUCKET" "Worker media"
  assert_image_exists "$(image_uri_for worker)"
}

check_migration_prerequisites() {
  local service_account
  assert_api_enabled run.googleapis.com
  assert_api_enabled secretmanager.googleapis.com
  assert_api_enabled artifactregistry.googleapis.com
  assert_artifact_repository
  require_env DABBOBA_MIGRATION_SERVICE_ACCOUNT
  require_env DABBOBA_DATABASE_SECRET
  require_env DABBOBA_MIGRATION_DATABASE_SECRET
  require_env DABBOBA_MIGRATION_DATABASE_SECRET_VERSION
  service_account="$DABBOBA_MIGRATION_SERVICE_ACCOUNT"
  assert_service_account "$service_account" "Migration job"
  assert_runtime_migration_separation
  if [[ -n "${DABBOBA_API_SERVICE_ACCOUNT:-}" ]]; then
    [[ "$service_account" != "$DABBOBA_API_SERVICE_ACCOUNT" ]] \
      || die "Migration and API must use separate service accounts"
  fi
  if [[ -n "${DABBOBA_WORKER_SERVICE_ACCOUNT:-}" ]]; then
    [[ "$service_account" != "$DABBOBA_WORKER_SERVICE_ACCOUNT" ]] \
      || die "Migration and worker must use separate service accounts"
  fi
  assert_secret_version "$DABBOBA_MIGRATION_DATABASE_SECRET" "$DABBOBA_MIGRATION_DATABASE_SECRET_VERSION" "$service_account" "Migration database"
  assert_image_exists "$(image_uri_for migration)"
}

check_scheduler_prerequisites() {
  local project
  local project_number
  local worker_job
  local scheduler_service_account
  local scheduler_service_agent
  local members
  local found_invoker=""
  local found_service_agent=""
  local member
  project="$(expected_project_id)"
  assert_api_enabled cloudscheduler.googleapis.com
  check_worker_prerequisites
  require_env DABBOBA_SCHEDULER_SERVICE_ACCOUNT
  worker_job="${DABBOBA_WORKER_JOB:-dabboba-worker}"
  scheduler_service_account="$DABBOBA_SCHEDULER_SERVICE_ACCOUNT"
  assert_resource_name "$worker_job" DABBOBA_WORKER_JOB
  assert_service_account "$scheduler_service_account" "Worker scheduler"
  [[ "$scheduler_service_account" != "$DABBOBA_WORKER_SERVICE_ACCOUNT" ]] \
    || die "Scheduler and worker runtime must use separate service accounts"
  if [[ -n "${DABBOBA_API_SERVICE_ACCOUNT:-}" ]]; then
    [[ "$scheduler_service_account" != "$DABBOBA_API_SERVICE_ACCOUNT" ]] \
      || die "Scheduler and API must use separate service accounts"
  fi
  if [[ -n "${DABBOBA_MIGRATION_SERVICE_ACCOUNT:-}" ]]; then
    [[ "$scheduler_service_account" != "$DABBOBA_MIGRATION_SERVICE_ACCOUNT" ]] \
      || die "Scheduler and migration must use separate service accounts"
  fi

  assert_worker_job_matches_scheduler_contract "$worker_job"

  members="$(gcloud run jobs get-iam-policy "$worker_job" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --flatten='bindings[].members' \
    --filter='bindings.role=roles/run.invoker' \
    --format='value(bindings.members)' 2>/dev/null)" \
    || die "Unable to inspect invoker IAM for worker job $worker_job"
  while IFS= read -r member; do
    if [[ "$member" == "serviceAccount:$scheduler_service_account" ]]; then
      found_invoker="yes"
    fi
  done <<< "$members"
  [[ "$found_invoker" == "yes" ]] \
    || die "$scheduler_service_account needs a job-level roles/run.invoker binding on $worker_job"

  project_number="$(expected_project_number)"
  scheduler_service_agent="service-$project_number@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
  members="$(gcloud projects get-iam-policy "$project" \
    --flatten='bindings[].members' \
    --filter='bindings.role=roles/cloudscheduler.serviceAgent' \
    --format='value(bindings.members)' 2>/dev/null)" \
    || die "Unable to inspect the Cloud Scheduler service-agent IAM binding"
  while IFS= read -r member; do
    if [[ "$member" == "serviceAccount:$scheduler_service_agent" ]]; then
      found_service_agent="yes"
    fi
  done <<< "$members"
  [[ "$found_service_agent" == "yes" ]] \
    || die "Cloud Scheduler service agent must retain roles/cloudscheduler.serviceAgent"
}

assert_scheduler_job_absent() {
  local scheduler_job="$1"
  local project
  local existing_jobs
  local existing_job
  project="$(expected_project_id)"
  existing_jobs="$(gcloud scheduler jobs list \
    --project="$project" \
    --location="$DABBOBA_CLOUD_RUN_REGION" \
    --format='value(name)' 2>/dev/null)" \
    || die "Unable to inspect existing Cloud Scheduler jobs"
  while IFS= read -r existing_job; do
    [[ "${existing_job##*/}" != "$scheduler_job" ]] \
      || die "Cloud Scheduler job already exists and will not be overwritten: $scheduler_job"
  done <<< "$existing_jobs"
}
