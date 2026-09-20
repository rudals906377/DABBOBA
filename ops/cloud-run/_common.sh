#!/usr/bin/env bash

set -Eeuo pipefail

readonly DABBOBA_CLOUD_RUN_REGION="asia-northeast3"
readonly CLOUD_RUN_OPS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DABBOBA_REPO_ROOT="$(cd -- "$CLOUD_RUN_OPS_DIR/../.." && pwd -P)"
readonly DABBOBA_DATABASE_RELEASE_MIGRATION="packages/db/migrations/0039_retire_prototype_catalog.sql"
readonly DABBOBA_DATABASE_RELEASE_SHA256="9bee32390788e2c57c549bfad41d882b2bb626da9b3a175182bfa240e1449502"
readonly DABBOBA_REQUIRED_DATABASE_RELEASE_ATTESTATION="0039:${DABBOBA_DATABASE_RELEASE_SHA256}:runtime+worker"
readonly DABBOBA_WORKER_SCHEDULER_CRON="* * * * *"
readonly DABBOBA_WORKER_SCHEDULER_TIME_ZONE="Asia/Seoul"
readonly DABBOBA_WORKER_SCHEDULER_ATTEMPT_DEADLINE="30s"
readonly DABBOBA_WORKER_SCHEDULER_MAX_RETRY_ATTEMPTS="0"
readonly DABBOBA_WORKER_SCHEDULER_DESCRIPTION="DABBOBA finite pgmq worker every minute (Asia/Seoul)"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1
export CLOUDSDK_GCLOUDIGNORE_ENABLED=true

# shellcheck source=ops/cloud-run/_media-storage.sh
source "$CLOUD_RUN_OPS_DIR/_media-storage.sh"

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
    || die "Migration 0039 checksum changed; review the migration and intentionally rotate the database release attestation"
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
    NOTIFICATION_DELIVERY_TOKEN \
    SUPABASE_STORAGE_SERVICE_KEY \
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID \
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY; do
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

required_release_service_account_env_names() {
  printf '%s\n' \
    DABBOBA_API_SERVICE_ACCOUNT \
    DABBOBA_WORKER_SERVICE_ACCOUNT \
    DABBOBA_MIGRATION_SERVICE_ACCOUNT \
    DABBOBA_SCHEDULER_SERVICE_ACCOUNT
}

assert_release_service_accounts_are_declared() {
  local name
  local purpose
  while IFS= read -r name; do
    require_env "$name"
    case "$name" in
      DABBOBA_API_SERVICE_ACCOUNT) purpose="API runtime" ;;
      DABBOBA_WORKER_SERVICE_ACCOUNT) purpose="Worker job" ;;
      DABBOBA_MIGRATION_SERVICE_ACCOUNT) purpose="Migration job" ;;
      DABBOBA_SCHEDULER_SERVICE_ACCOUNT) purpose="Worker scheduler" ;;
      *) die "Unknown required release service account variable: $name" ;;
    esac
    assert_service_account "${!name}" "$purpose"
  done < <(required_release_service_account_env_names)
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

assert_no_project_level_secret_accessor_bindings() {
  local project
  local members
  local member
  project="$(expected_project_id)"
  members="$(gcloud projects get-iam-policy "$project" \
    --flatten='bindings[].members' \
    --filter='bindings.role=roles/secretmanager.secretAccessor' \
    --format='value(bindings.members)' 2>/dev/null)" \
    || die "Unable to inspect project-level Secret Manager IAM"
  while IFS= read -r member; do
    [[ -z "$member" ]] && continue
    die "$member must not have project-level roles/secretmanager.secretAccessor; grant Secret Manager payload access only through exact per-secret policies"
  done <<< "$members"
  return 0
}

assert_cloud_identity_boundaries() {
  # Every release command declares the complete identity boundary. Otherwise a
  # worker or migration command could omit the API peer and reuse its identity.
  assert_release_service_accounts_are_declared
  assert_configured_service_accounts_are_distinct
  assert_no_project_level_secret_accessor_bindings
}

assert_release_secret_id_boundaries() {
  require_env DABBOBA_DATABASE_SECRET
  require_env DABBOBA_WORKER_DATABASE_SECRET
  require_env DABBOBA_MIGRATION_DATABASE_SECRET
  require_env DABBOBA_SESSION_PEPPER_SECRET
  [[ "$DABBOBA_DATABASE_SECRET" != "$DABBOBA_WORKER_DATABASE_SECRET" ]] \
    || die "API and worker database secrets must be different"
  [[ "$DABBOBA_DATABASE_SECRET" != "$DABBOBA_MIGRATION_DATABASE_SECRET" ]] \
    || die "Runtime and migration database secrets must be different"
  [[ "$DABBOBA_WORKER_DATABASE_SECRET" != "$DABBOBA_MIGRATION_DATABASE_SECRET" ]] \
    || die "Worker and migration database secrets must be different"
  [[ "$DABBOBA_SESSION_PEPPER_SECRET" != "$DABBOBA_DATABASE_SECRET" ]] \
    || die "Session pepper and API database secrets must be different"
  [[ "$DABBOBA_SESSION_PEPPER_SECRET" != "$DABBOBA_WORKER_DATABASE_SECRET" ]] \
    || die "Session pepper and worker database secrets must be different"
  [[ "$DABBOBA_SESSION_PEPPER_SECRET" != "$DABBOBA_MIGRATION_DATABASE_SECRET" ]] \
    || die "Session pepper and migration database secrets must be different"
}

assert_cloud_release_boundaries() {
  assert_cloud_identity_boundaries
  # Require the complete peer set even for a single-component command so an
  # omitted variable cannot conceal reuse of a more privileged DB secret.
  assert_release_secret_id_boundaries
  assert_media_storage_config
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
  local name
  project="$(expected_project_id)" || return 1
  repository="$(artifact_repository)" || return 1
  tag="$(image_tag)" || return 1
  name="$(image_name_for "$kind")" || return 1
  printf '%s-docker.pkg.dev/%s/%s/%s:%s\n' \
    "$DABBOBA_CLOUD_RUN_REGION" "$project" "$repository" "$name" "$tag"
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
  [[ "$value" != *[[:cntrl:]~]* && "$value" != ,* && "$value" != *, && "$value" != *,,* ]] \
    || die "$label must not contain control characters, deployment delimiters, or empty origins"
  IFS=',' read -r -a origins <<< "$value"
  ((${#origins[@]} > 0)) || die "$label must include at least one HTTPS origin"
  for origin in "${origins[@]}"; do
    assert_https_origin "$origin" "$label entry"
  done
}

assert_runtime_migration_separation() {
  assert_release_secret_id_boundaries
}

assert_public_api_abuse_controls_attestation() {
  [[ "${DABBOBA_PUBLIC_API_ABUSE_CONTROLS_VERIFIED:-}" == "YES" ]] \
    || die "Public API deployment is blocked. Set DABBOBA_PUBLIC_API_ABUSE_CONTROLS_VERIFIED=YES only after the documented abuse-control review is complete"
}

assert_database_release_attestation() {
  assert_database_release_migration_checksum
  [[ "${DABBOBA_DATABASE_RELEASE_ATTESTATION:-}" == "$DABBOBA_REQUIRED_DATABASE_RELEASE_ATTESTATION" ]] \
    || die "API and worker deployment is blocked. Set DABBOBA_DATABASE_RELEASE_ATTESTATION to the documented release value only after migration 0039 and both restricted database roles are verified against the target database"
}

api_candidate_tag() {
  require_env DABBOBA_API_CANDIDATE_TAG
  [[ "$DABBOBA_API_CANDIDATE_TAG" =~ ^candidate-[a-z0-9]([a-z0-9-]{0,51}[a-z0-9])?$ ]] \
    || die "DABBOBA_API_CANDIDATE_TAG must be a unique lowercase candidate-* tag of at most 63 characters"
  printf '%s\n' "$DABBOBA_API_CANDIDATE_TAG"
}

expected_api_candidate_smoke_attestation() {
  local service="${DABBOBA_API_SERVICE:-dabboba-api}"
  local revision
  assert_resource_name "$service" DABBOBA_API_SERVICE
  require_env DABBOBA_API_CANDIDATE_REVISION
  revision="$DABBOBA_API_CANDIDATE_REVISION"
  [[ "$revision" =~ ^${service}-[a-z0-9-]+$ ]] \
    || die "DABBOBA_API_CANDIDATE_REVISION is not a valid revision for Cloud Run API service $service"
  printf 'api-candidate:%s:%s:%s:PASSED\n' \
    "$(image_tag)" \
    "$(api_candidate_tag)" \
    "$revision"
}

assert_api_candidate_smoke_attestation() {
  local expected
  expected="$(expected_api_candidate_smoke_attestation)"
  [[ "${DABBOBA_API_CANDIDATE_SMOKE_ATTESTATION:-}" == "$expected" ]] \
    || die "API promotion is blocked. Set DABBOBA_API_CANDIDATE_SMOKE_ATTESTATION=$expected only after the candidate smoke script passes for this immutable image, tag, and exact Cloud Run revision"
}

api_service_json() {
  local service="$1"
  local project
  project="$(expected_project_id)"
  gcloud run services describe "$service" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null \
    || die "Cloud Run API service $service must already exist with a serving baseline revision"
}

api_service_exists() {
  local service="$1"
  local project
  local services
  local listed_service
  project="$(expected_project_id)"
  services="$(gcloud run services list \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format='value(metadata.name)' 2>/dev/null)" \
    || die "Unable to inspect existing Cloud Run services"
  while IFS= read -r listed_service; do
    [[ "${listed_service##*/}" == "$service" ]] && return 0
  done <<< "$services"
  return 1
}

assert_api_service_absent() {
  local service="$1"
  if api_service_exists "$service"; then
    die "Cloud Run API service $service already exists; private bootstrap is only for the first revision"
  fi
}

public_principal_bindings_from_policy() {
  local policy_json="$1"
  require_command jq
  printf '%s\n' "$policy_json" | jq -er '
    [
      .bindings[]? as $binding
      | $binding.members[]?
      | select(. == "allUsers" or . == "allAuthenticatedUsers")
      | "\($binding.role)=\(.)"
    ]
    | unique
    | join(",")
  '
}

assert_iam_policy_has_no_public_principals() {
  local policy_json="$1"
  local resource_label="$2"
  local public_bindings
  public_bindings="$(public_principal_bindings_from_policy "$policy_json")" \
    || die "Unable to inspect public principal bindings on $resource_label"
  [[ -z "$public_bindings" ]] \
    || die "$resource_label grants a role to a public principal ($public_bindings); private API bootstrap is blocked"
}

assert_no_public_principals_in_project_hierarchy() {
  local project
  local ancestors_json
  local hierarchy_entries
  local project_entry_count
  local resource_type
  local resource_id
  local policy_json
  project="$(expected_project_id)"
  require_command jq

  ancestors_json="$(gcloud projects get-ancestors "$project" --format=json 2>/dev/null)" \
    || die "Unable to inspect the project, folder, and organization ancestry for $project; private API bootstrap fails closed"
  project_entry_count="$(printf '%s\n' "$ancestors_json" | jq -er --arg project "$project" '
    [.[]? | select(.type == "project" and .id == $project)] | length
  ')" || die "Unable to validate the resource ancestry for $project"
  [[ "$project_entry_count" == "1" ]] \
    || die "Google Cloud returned an incomplete or unexpected ancestry for $project; private API bootstrap fails closed"
  hierarchy_entries="$(printf '%s\n' "$ancestors_json" | jq -er '
    if type == "array" and length > 0
    then .[] | [(.type // ""), ((.id // "") | tostring)] | @tsv
    else error("empty ancestry")
    end
  ')" || die "Unable to parse the resource ancestry for $project"

  while IFS=$'\t' read -r resource_type resource_id; do
    case "$resource_type" in
      project)
        [[ "$resource_id" == "$project" ]] \
          || die "Google Cloud returned an unexpected project ancestor: $resource_id"
        policy_json="$(gcloud projects get-iam-policy "$resource_id" --format=json 2>/dev/null)" \
          || die "Unable to inspect project IAM for $resource_id; private API bootstrap fails closed"
        ;;
      folder)
        [[ "$resource_id" =~ ^[0-9]+$ ]] \
          || die "Google Cloud returned an invalid folder ancestor ID"
        policy_json="$(gcloud resource-manager folders get-iam-policy "$resource_id" --format=json 2>/dev/null)" \
          || die "Unable to inspect folder IAM for $resource_id; private API bootstrap fails closed"
        ;;
      organization)
        [[ "$resource_id" =~ ^[0-9]+$ ]] \
          || die "Google Cloud returned an invalid organization ancestor ID"
        policy_json="$(gcloud organizations get-iam-policy "$resource_id" --format=json 2>/dev/null)" \
          || die "Unable to inspect organization IAM for $resource_id; private API bootstrap fails closed"
        ;;
      *)
        die "Google Cloud returned an unsupported ancestor type: $resource_type"
        ;;
    esac
    assert_iam_policy_has_no_public_principals "$policy_json" "$resource_type $resource_id"
  done <<< "$hierarchy_entries"
}

assert_api_service_has_no_public_principals() {
  local service="$1"
  local project
  local policy_json
  project="$(expected_project_id)"
  policy_json="$(gcloud run services get-iam-policy "$service" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null)" \
    || die "Unable to inspect service IAM for Cloud Run API service $service; private API bootstrap fails closed"
  assert_iam_policy_has_no_public_principals "$policy_json" "Cloud Run API service $service"
}

assert_api_deploy_mode_preconditions() {
  local mode="$1"
  local service="$2"
  local candidate_tag="$3"
  case "$mode" in
    candidate)
      assert_api_service_has_baseline_traffic "$service"
      # A private first revision must pass the dedicated authenticated smoke
      # and bootstrap promotion. A later candidate deploy must not make that
      # service public as a side effect and bypass the bootstrap attestation.
      assert_api_invoker_iam_disabled "$service" true
      assert_api_candidate_tag_available "$service" "$candidate_tag"
      ;;
    bootstrap)
      [[ "${DABBOBA_APPROVE_PRIVATE_API_BOOTSTRAP:-}" == "YES" ]] \
        || die "First-service bootstrap is blocked. Set DABBOBA_APPROVE_PRIVATE_API_BOOTSTRAP=YES for this private bootstrap command only"
      assert_api_service_absent "$service"
      # Invoker grants inherited from the project, folder, or organization
      # remain effective on a new service. Role definitions and custom roles
      # can also include run.routes.invoke, so reject every public principal
      # binding in each readable ancestor policy before create.
      assert_no_public_principals_in_project_hierarchy
      ;;
    *)
      die "Unknown API deployment mode: $mode"
      ;;
  esac
}

api_deploy_traffic_args() {
  local mode="$1"
  local candidate_tag="$2"
  case "$mode" in
    candidate)
      printf '%s\n' '--no-traffic' "--tag=$candidate_tag"
      ;;
    bootstrap)
      # Cloud Run rejects --no-traffic when the service does not exist. The
      # sole first revision therefore owns 100% traffic while IAM stays private.
      printf '%s\n' "--tag=$candidate_tag"
      ;;
    *)
      die "Unknown API deployment mode: $mode"
      ;;
  esac
}

assert_api_service_has_baseline_traffic() {
  local service="$1"
  local service_json
  local traffic_total
  require_command jq
  service_json="$(api_service_json "$service")"
  traffic_total="$(printf '%s\n' "$service_json" | jq -er '
    [(.status.traffic // .trafficStatuses // [])[]? | (.percent // 0)] | add // 0
  ')" || die "Unable to inspect baseline traffic for Cloud Run API service $service"
  [[ "$traffic_total" == "100" ]] \
    || die "Cloud Run API service $service needs an existing 100 percent serving baseline before a no-traffic candidate deployment"
}

assert_api_candidate_tag_available() {
  local service="$1"
  local candidate_tag="$2"
  local service_json
  local matching_tags
  require_command jq
  service_json="$(api_service_json "$service")"
  matching_tags="$(printf '%s\n' "$service_json" | jq -er --arg tag "$candidate_tag" '
    [(.status.traffic // .trafficStatuses // [])[]? | select(.tag == $tag)] | length
  ')" || die "Unable to inspect existing traffic tags for Cloud Run API service $service"
  [[ "$matching_tags" == "0" ]] \
    || die "Candidate tag $candidate_tag already exists; use a unique release-specific DABBOBA_API_CANDIDATE_TAG"
}

assert_api_candidate_release() {
  local service="$1"
  local candidate_tag="$2"
  local expected_percent="$3"
  local expected_revision="${4:-}"
  local service_json
  local revision
  local candidate_url
  local actual_percent
  local latest_ready_revision
  local revision_json
  local expected_image
  local expected_digest
  local expected_digest_image
  local details
  local expected_plain_env expected_secret_env project project_number
  require_command jq
  [[ "$expected_percent" == "0" || "$expected_percent" == "100" ]] \
    || die "Candidate traffic assertion accepts only 0 or 100 percent"
  if [[ -n "$expected_revision" ]]; then
    [[ "$expected_revision" =~ ^${service}-[a-z0-9-]+$ ]] \
      || die "Expected candidate revision is not valid for Cloud Run API service $service"
  fi

  service_json="$(api_service_json "$service")"
  details="$(printf '%s\n' "$service_json" | jq -er --arg tag "$candidate_tag" '
    [(.status.traffic // .trafficStatuses // [])[]? | select(.tag == $tag)]
    | if length == 1 then .[0] else error("candidate tag must identify exactly one revision") end
    | [(.revisionName // .revision // ""), (.url // .uri // ""), ((.percent // 0) | tostring)]
    | @tsv
  ')" || die "Candidate tag $candidate_tag does not identify exactly one Cloud Run revision"
  IFS=$'\t' read -r revision candidate_url actual_percent <<< "$details"
  revision="${revision##*/}"
  [[ "$revision" =~ ^${service}-[a-z0-9-]+$ ]] \
    || die "Candidate tag $candidate_tag returned an invalid revision name"
  [[ -z "$expected_revision" || "$revision" == "$expected_revision" ]] \
    || die "Candidate tag $candidate_tag points to revision $revision; smoke attested revision $expected_revision"
  [[ "$candidate_url" =~ ^https://${candidate_tag}---[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app$ ]] \
    || die "Candidate tag $candidate_tag returned an unexpected Cloud Run URL"
  [[ "$actual_percent" == "$expected_percent" ]] \
    || die "Candidate tag $candidate_tag serves $actual_percent percent traffic; expected $expected_percent percent"

  latest_ready_revision="$(printf '%s\n' "$service_json" | jq -er '.status.latestReadyRevisionName // .latestReadyRevision // empty')" \
    || die "Unable to inspect the latest ready revision for Cloud Run API service $service"
  latest_ready_revision="${latest_ready_revision##*/}"
  [[ "$revision" == "$latest_ready_revision" ]] \
    || die "Candidate tag $candidate_tag does not point to the latest ready revision"

  revision_json="$(gcloud run revisions describe "$revision" \
    --project="$(expected_project_id)" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null)" \
    || die "Unable to inspect candidate revision $revision"
  expected_image="$(image_uri_for api)" || return 1
  expected_digest="$(image_digest_for "$expected_image")" || return 1
  expected_digest_image="${expected_image%:*}@$expected_digest"
  require_env DABBOBA_API_SERVICE_ACCOUNT
  project="$(expected_project_id)" || return 1
  project_number="$(expected_project_number)" || return 1
  expected_plain_env="$(api_plain_env)" || return 1
  expected_secret_env="$(api_secret_env)" || return 1
  printf '%s\n' "$expected_plain_env" | plain_env_flag >/dev/null || return 1
  printf '%s\n' "$expected_secret_env" | secret_env_flag >/dev/null || return 1
  printf '%s\n' "$revision_json" | jq -e \
    --arg expected_project "$project" --arg expected_project_number "$project_number" \
    --arg expected_region "$DABBOBA_CLOUD_RUN_REGION" --arg expected_service "$service" \
    --arg expected_revision "$revision" --arg expected_image "$expected_image" \
    --arg expected_digest_image "$expected_digest_image" \
    --arg expected_service_account "$DABBOBA_API_SERVICE_ACCOUNT" \
    --argjson expected_plain_env "$expected_plain_env" --argjson expected_secret_env "$expected_secret_env" \
    -f "$CLOUD_RUN_OPS_DIR/verify-api-revision.jq" >/dev/null 2>/dev/null \
    || die "Candidate revision $revision does not match the approved API image, identity, environment or pinned secret references"

  printf '%s\n' "$candidate_url"
}

api_candidate_revision() {
  local service="$1"
  local candidate_tag="$2"
  local service_json
  local revision
  require_command jq
  service_json="$(api_service_json "$service")"
  revision="$(printf '%s\n' "$service_json" | jq -er --arg tag "$candidate_tag" '
    [(.status.traffic // .trafficStatuses // [])[]? | select(.tag == $tag)]
    | if length == 1 then .[0] else error("candidate tag must identify exactly one revision") end
    | (.revisionName // .revision // "")
  ')" || die "Candidate tag $candidate_tag does not identify exactly one Cloud Run revision"
  revision="${revision##*/}"
  [[ "$revision" =~ ^${service}-[a-z0-9-]+$ ]] \
    || die "Candidate tag $candidate_tag returned an invalid revision name"
  printf '%s\n' "$revision"
}

api_candidate_smoke_target() {
  local service="$1"
  local candidate_tag="$2"
  local expected_percent="$3"
  local revision
  local candidate_url
  # Capture the tag's revision first, then require the same revision while
  # resolving its URL. This closes the pre-probe tag-move window.
  revision="$(api_candidate_revision "$service" "$candidate_tag")" || return 1
  candidate_url="$(assert_api_candidate_release \
    "$service" \
    "$candidate_tag" \
    "$expected_percent" \
    "$revision")" || return 1
  printf '%s\t%s\n' "$revision" "$candidate_url"
}

assert_api_invoker_iam_disabled() {
  local service="$1"
  local expected="$2"
  local service_json
  local actual
  require_command jq
  [[ "$expected" == "true" || "$expected" == "false" ]] \
    || die "Invoker IAM assertion accepts only true or false"
  service_json="$(api_service_json "$service")"
  actual="$(printf '%s\n' "$service_json" | jq -er '
    (.invokerIamDisabled
      // .metadata.annotations["run.googleapis.com/invoker-iam-disabled"]
      // false)
    | tostring
    | ascii_downcase
  ')" || die "Unable to inspect the Invoker IAM check for Cloud Run API service $service"
  [[ "$actual" == "$expected" ]] \
    || die "Cloud Run API service $service Invoker IAM disabled state is $actual; expected $expected"
}

expected_worker_execution_attestation() {
  local tag fingerprint
  tag="$(image_tag)" || return 1
  fingerprint="$(worker_storage_release_fingerprint)" || return 1
  printf 'worker-job:%s:storage-v1:%s:SUCCEEDED\n' "$tag" "$fingerprint"
}

assert_worker_execution_attestation() {
  local expected
  require_env DABBOBA_WORKER_EXECUTION_ATTESTATION
  expected="$(expected_worker_execution_attestation)" || return 1
  [[ "${DABBOBA_WORKER_EXECUTION_ATTESTATION:-}" == "$expected" ]] \
    || die "Worker scheduling is blocked. Set DABBOBA_WORKER_EXECUTION_ATTESTATION=$expected only after the immutable image with these exact deployed storage settings and secret versions completes one approved manual Job execution"
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
  local expected_plain_env
  local expected_secret_env
  local expected_queue
  local job_json
  require_command jq
  [[ -f "$CLOUD_RUN_OPS_DIR/verify-worker-job.jq" ]] \
    || die "Missing ops/cloud-run/verify-worker-job.jq"
  project="$(expected_project_id)"
  expected_image="$(image_uri_for worker)"
  expected_digest="$(image_digest_for "$expected_image")"
  expected_digest_image="${expected_image%:*}@$expected_digest"
  expected_plain_env="$(worker_plain_env)" || return 1
  expected_secret_env="$(worker_secret_env)" || return 1
  printf '%s\n' "$expected_plain_env" | plain_env_flag >/dev/null || return 1
  printf '%s\n' "$expected_secret_env" | secret_env_flag >/dev/null || return 1
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
    --argjson expected_plain_env "$expected_plain_env" \
    --argjson expected_secret_env "$expected_secret_env" \
    --arg expected_project "$project" \
    -f "$CLOUD_RUN_OPS_DIR/verify-worker-job.jq" >/dev/null \
    || die "Worker job $worker_job does not match the approved scheduling contract"
}

assert_worker_job_trigger_iam_policy() {
  local worker_job="$1"
  local scheduler_service_account="$2"
  local project
  local policy_json
  project="$(expected_project_id)"
  require_command jq
  policy_json="$(gcloud run jobs get-iam-policy "$worker_job" \
    --project="$project" \
    --region="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null)" \
    || die "Unable to inspect trigger IAM for worker job $worker_job"
  printf '%s\n' "$policy_json" | jq -e \
    --arg expected_member "serviceAccount:$scheduler_service_account" '
      (.bindings // []) as $bindings
      | ($bindings | length) == 1
        and $bindings[0].role == "roles/run.invoker"
        and (($bindings[0].condition // null) == null)
        and (($bindings[0].members // []) | length) == 1
        and $bindings[0].members[0] == $expected_member
    ' >/dev/null \
    || die "Worker job $worker_job IAM must contain only one unconditioned roles/run.invoker binding for serviceAccount:$scheduler_service_account"
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
  local predeploy_mode="${1:-existing-service}"
  local service_account
  local service
  case "$predeploy_mode" in
    existing-service|private-bootstrap) ;;
    *) die "Unknown API prerequisite mode: $predeploy_mode" ;;
  esac
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
  assert_secret_version "$DABBOBA_DATABASE_SECRET" "$DABBOBA_DATABASE_SECRET_VERSION" "$service_account" "API runtime database"
  assert_secret_version "$DABBOBA_SESSION_PEPPER_SECRET" "$DABBOBA_SESSION_PEPPER_SECRET_VERSION" "$service_account" "API session pepper"
  assert_media_storage_secret_access api
  assert_https_origin "$DABBOBA_SUPABASE_URL" DABBOBA_SUPABASE_URL
  assert_https_origin_list "$DABBOBA_WEB_ORIGINS" DABBOBA_WEB_ORIGINS
  if [[ -n "${DABBOBA_GCS_BUCKET:-}" ]]; then
    assert_existing_seoul_bucket "$DABBOBA_GCS_BUCKET" "Customer media"
  fi
  assert_image_exists "$(image_uri_for api)"
  service="${DABBOBA_API_SERVICE:-dabboba-api}"
  assert_resource_name "$service" DABBOBA_API_SERVICE
  if [[ "$predeploy_mode" == "existing-service" ]]; then
    assert_service_revisions_scale_to_zero "$service"
  fi
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
  assert_media_storage_config
  if [[ -z "${DABBOBA_GCS_BUCKET:-}" ]] && ! media_storage_supabase_enabled; then
    die "Worker media requires an existing GCS bucket or a complete Supabase Storage configuration"
  fi
  service_account="$DABBOBA_WORKER_SERVICE_ACCOUNT"
  assert_service_account "$service_account" "Worker job"
  assert_runtime_migration_separation
  if [[ -n "${DABBOBA_API_SERVICE_ACCOUNT:-}" ]]; then
    [[ "$service_account" != "$DABBOBA_API_SERVICE_ACCOUNT" ]] \
      || die "API and worker must use separate service accounts"
  fi
  assert_secret_version "$DABBOBA_WORKER_DATABASE_SECRET" "$DABBOBA_WORKER_DATABASE_SECRET_VERSION" "$service_account" "Worker database"
  assert_media_storage_secret_access worker
  if [[ -n "${DABBOBA_GCS_BUCKET:-}" ]]; then
    assert_existing_seoul_bucket "$DABBOBA_GCS_BUCKET" "Worker media"
  fi
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
  # Reject public principals anywhere above the Job, then require an exact
  # Job-local allow-list. This blocks alternate predefined/custom execution
  # roles and extra members from silently widening the Scheduler boundary.
  assert_no_public_principals_in_project_hierarchy
  assert_worker_job_trigger_iam_policy "$worker_job" "$scheduler_service_account"

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
  local target_uri="${2:-}"
  local project
  local existing_jobs_json
  local conflicts
  project="$(expected_project_id)"
  require_command jq
  existing_jobs_json="$(gcloud scheduler jobs list \
    --project="$project" \
    --location="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null)" \
    || die "Unable to inspect existing Cloud Scheduler jobs"
  conflicts="$(printf '%s\n' "$existing_jobs_json" | jq -cer \
    --arg expected_name "$scheduler_job" \
    --arg expected_uri "$target_uri" '
      [ .[]
        | select(
            ((.name // "") | split("/") | last) == $expected_name
            or ($expected_uri != "" and (.httpTarget.uri // "") == $expected_uri)
          )
        | {name: (.name // "unknown"), uri: (.httpTarget.uri // "")}
      ]
    ')" || die "Unable to validate existing Cloud Scheduler jobs"
  [[ "$conflicts" == "[]" ]] \
    || die "A Cloud Scheduler job already uses this name or worker target and will not be overwritten: $conflicts"
}

create_worker_scheduler_job() {
  local project="$1"
  local scheduler_job="$2"
  local target_uri="$3"
  local scheduler_service_account="$4"

  gcloud scheduler jobs create http "$scheduler_job" \
    --quiet \
    --project="$project" \
    --location="$DABBOBA_CLOUD_RUN_REGION" \
    --schedule="$DABBOBA_WORKER_SCHEDULER_CRON" \
    --time-zone="$DABBOBA_WORKER_SCHEDULER_TIME_ZONE" \
    --uri="$target_uri" \
    --http-method=POST \
    --oauth-service-account-email="$scheduler_service_account" \
    --oauth-token-scope='https://www.googleapis.com/auth/cloud-platform' \
    --attempt-deadline="$DABBOBA_WORKER_SCHEDULER_ATTEMPT_DEADLINE" \
    --max-retry-attempts="$DABBOBA_WORKER_SCHEDULER_MAX_RETRY_ATTEMPTS" \
    --description="$DABBOBA_WORKER_SCHEDULER_DESCRIPTION"
}

assert_worker_scheduler_matches_contract() {
  local scheduler_job="$1"
  local target_uri="$2"
  local scheduler_service_account="$3"
  local project
  local scheduler_json
  project="$(expected_project_id)"
  require_command jq
  scheduler_json="$(gcloud scheduler jobs describe "$scheduler_job" \
    --project="$project" \
    --location="$DABBOBA_CLOUD_RUN_REGION" \
    --format=json 2>/dev/null)" \
    || die "Unable to inspect the created Cloud Scheduler job $scheduler_job"
  printf '%s\n' "$scheduler_json" | jq -e \
    --arg expected_name "projects/$project/locations/$DABBOBA_CLOUD_RUN_REGION/jobs/$scheduler_job" \
    --arg expected_schedule "$DABBOBA_WORKER_SCHEDULER_CRON" \
    --arg expected_time_zone "$DABBOBA_WORKER_SCHEDULER_TIME_ZONE" \
    --arg expected_uri "$target_uri" \
    --arg expected_service_account "$scheduler_service_account" \
    --arg expected_attempt_deadline "$DABBOBA_WORKER_SCHEDULER_ATTEMPT_DEADLINE" \
    --arg expected_description "$DABBOBA_WORKER_SCHEDULER_DESCRIPTION" '
      . as $job
      | (($job.retryConfig.retryCount // 0) | tonumber) as $retry_count
      | ($job.name == $expected_name)
        and ($job.schedule == $expected_schedule)
        and ($job.timeZone == $expected_time_zone)
        and ($job.state == "ENABLED")
        and ($job.description == $expected_description)
        and ($job.httpTarget.uri == $expected_uri)
        and ($job.httpTarget.httpMethod == "POST")
        and ($job.httpTarget.oauthToken.serviceAccountEmail == $expected_service_account)
        and ($job.httpTarget.oauthToken.scope == "https://www.googleapis.com/auth/cloud-platform")
        and (($job.httpTarget.oidcToken // null) == null)
        and ($job.attemptDeadline == $expected_attempt_deadline)
        and ($retry_count == 0)
    ' >/dev/null \
    || die "Cloud Scheduler job $scheduler_job does not match the approved one-minute, no-retry contract"
}
