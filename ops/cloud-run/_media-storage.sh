#!/usr/bin/env bash

# Sourced by _common.sh. Only non-secret configuration and Secret Manager
# references are handled here; these helpers never read credential payloads.
media_storage_provider() {
  local provider="${DABBOBA_MEDIA_STORAGE_PROVIDER:-gcs}"
  [[ "$provider" == gcs || "$provider" == supabase ]] \
    || die "DABBOBA_MEDIA_STORAGE_PROVIDER must be gcs or supabase"
  printf '%s\n' "$provider"
}

media_storage_secret_setting_names() {
  local role key
  for role in API WORKER; do
    for key in SERVICE_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
      printf 'DABBOBA_%s_SUPABASE_STORAGE_%s_SECRET\n' "$role" "$key"
    done
  done
}

media_storage_supabase_enabled() {
  local name version_name
  [[ "${DABBOBA_MEDIA_STORAGE_PROVIDER:-gcs}" != supabase ]] || return 0
  for name in DABBOBA_SUPABASE_STORAGE_BUCKET DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT DABBOBA_SUPABASE_STORAGE_S3_REGION; do
    [[ -z "${!name:-}" ]] || return 0
  done
  while IFS= read -r name; do
    version_name="${name}_VERSION"
    [[ -z "${!name:-}" && -z "${!version_name:-}" ]] || return 0
  done < <(media_storage_secret_setting_names)
  return 1
}

assert_media_storage_config() {
  local name version_name secret_id previous origin host alternate_endpoint=""
  local -a secret_ids=()
  media_storage_provider >/dev/null
  for name in SUPABASE_STORAGE_ALLOW_LOCAL_HTTP DABBOBA_SUPABASE_STORAGE_ALLOW_LOCAL_HTTP; do
    [[ -z "${!name:-}" || "${!name}" == false ]] \
      || die "$name must remain false for Cloud Run releases"
  done
  if [[ -n "${DABBOBA_GCS_BUCKET:-}" ]]; then normalize_bucket_name "$DABBOBA_GCS_BUCKET" >/dev/null; fi
  media_storage_supabase_enabled || return 0

  for name in DABBOBA_SUPABASE_URL DABBOBA_SUPABASE_STORAGE_BUCKET DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT DABBOBA_SUPABASE_STORAGE_S3_REGION; do
    require_env "$name"
  done
  assert_https_origin "$DABBOBA_SUPABASE_URL" DABBOBA_SUPABASE_URL
  origin="$DABBOBA_SUPABASE_URL"
  host="${origin#https://}"
  # Match the production adapter, including its managed project-ref boundary.
  [[ "$host" =~ ^[a-z0-9]{20}\.supabase\.co$ ]] \
    || die "Supabase Storage requires the hosted 20-character project-ref HTTPS origin without a port"
  alternate_endpoint="https://${host%.supabase.co}.storage.supabase.co/storage/v1/s3"
  [[ "$DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT" == "$origin/storage/v1/s3" \
    || ( -n "$alternate_endpoint" && "$DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT" == "$alternate_endpoint" ) ]] \
    || die "Supabase S3 endpoint must identify the configured Supabase origin/project and exact /storage/v1/s3 path"
  [[ "$DABBOBA_SUPABASE_STORAGE_BUCKET" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] \
    || die "DABBOBA_SUPABASE_STORAGE_BUCKET is invalid"
  [[ "$DABBOBA_SUPABASE_STORAGE_S3_REGION" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] \
    || die "DABBOBA_SUPABASE_STORAGE_S3_REGION is invalid"

  # A single-component deploy still declares every peer, preventing accidental
  # API/Worker reuse or reuse of any privileged database/pepper secret.
  for name in DABBOBA_DATABASE_SECRET DABBOBA_WORKER_DATABASE_SECRET DABBOBA_MIGRATION_DATABASE_SECRET DABBOBA_SESSION_PEPPER_SECRET; do
    require_env "$name"
    secret_ids+=("${!name}")
  done
  while IFS= read -r name; do
    version_name="${name}_VERSION"
    require_env "$name"
    require_env "$version_name"
    secret_id="${!name}"
    [[ "$secret_id" =~ ^[A-Za-z0-9_-]{1,255}$ ]] || die "$name is not a Secret Manager ID"
    [[ "${!version_name}" =~ ^[1-9][0-9]*$ ]] || die "$version_name must pin a numeric Secret Manager version"
    for previous in "${secret_ids[@]}"; do
      [[ "$secret_id" != "$previous" ]] || die "$name must use a distinct per-runtime storage secret ID"
    done
    secret_ids+=("$secret_id")
  done < <(media_storage_secret_setting_names)
}

media_storage_plain_env() {
  local provider json project bucket
  require_command jq
  assert_media_storage_config
  provider="$(media_storage_provider)" || return 1
  json="$(jq -cn --arg provider "$provider" '{MEDIA_STORAGE_PROVIDER:$provider}')" || return 1
  if [[ -n "${DABBOBA_GCS_BUCKET:-}" ]]; then
    project="$(expected_project_id)" || return 1
    bucket="$(normalize_bucket_name "$DABBOBA_GCS_BUCKET")" || return 1
    json="$(printf '%s\n' "$json" | jq -c --arg bucket "$bucket" --arg project "$project" '. + {GCS_BUCKET:$bucket,GCS_PROJECT_ID:$project}')" || return 1
  fi
  if media_storage_supabase_enabled; then
    json="$(printf '%s\n' "$json" | jq -c \
      --arg url "$DABBOBA_SUPABASE_URL" --arg bucket "$DABBOBA_SUPABASE_STORAGE_BUCKET" \
      --arg endpoint "$DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT" --arg region "$DABBOBA_SUPABASE_STORAGE_S3_REGION" \
      '. + {SUPABASE_URL:$url,SUPABASE_STORAGE_BUCKET:$bucket,SUPABASE_STORAGE_S3_ENDPOINT:$endpoint,SUPABASE_STORAGE_S3_REGION:$region}')" || return 1
  fi
  printf '%s\n' "$json"
}

media_storage_secret_env() {
  local role="$1" upper key name version_name json='{}'
  case "$role" in api) upper=API ;; worker) upper=WORKER ;; *) die "Unknown storage runtime role" ;; esac
  require_command jq
  assert_media_storage_config
  if media_storage_supabase_enabled; then
    for key in SERVICE_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
      name="DABBOBA_${upper}_SUPABASE_STORAGE_${key}_SECRET"
      version_name="${name}_VERSION"
      json="$(printf '%s\n' "$json" | jq -c --arg key "SUPABASE_STORAGE_$key" --arg secret "${!name}" --arg version "${!version_name}" '. + {($key):{secret:$secret,version:$version}}')" || return 1
    done
  fi
  printf '%s\n' "$json"
}

assert_media_storage_secret_access() {
  local role="$1" upper service_account name version_name key
  case "$role" in api) upper=API ;; worker) upper=WORKER ;; *) die "Unknown storage runtime role" ;; esac
  assert_media_storage_config
  media_storage_supabase_enabled || return 0
  name="DABBOBA_${upper}_SERVICE_ACCOUNT"
  require_env "$name"
  service_account="${!name}"
  for key in SERVICE_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    name="DABBOBA_${upper}_SUPABASE_STORAGE_${key}_SECRET"
    version_name="${name}_VERSION"
    assert_secret_version "${!name}" "${!version_name}" "$service_account" "$role Supabase Storage $key"
  done
}

# JSON maps are the single source for deploy flags, actual Job comparison and
# the approval fingerprint. jq rejects delimiter/control injection on the full
# value before conversion to gcloud's replacement flags.
plain_env_flag() {
  jq -er 'if type != "object" or any(to_entries[]; (.key | test("^[A-Z][A-Z0-9_]*$") | not)
    or (.value | type != "string") or (.value | test("[~\\x00-\\x1f\\x7f]")))
    then error("Unsafe Cloud Run environment map")
    else "^~^" + (to_entries | sort_by(.key) | map(.key + "=" + .value) | join("~")) end'
}

secret_env_flag() {
  jq -er 'if type != "object" or any(to_entries[]; (.key | test("^[A-Z][A-Z0-9_]*\\z") | not)
    or (.value.secret | type != "string") or (.value.secret | test("^[A-Za-z0-9_-]{1,255}\\z") | not)
    or (.value.version | type != "string") or (.value.version | test("^[1-9][0-9]*\\z") | not))
    then error("Unsafe Cloud Run secret reference map")
    else to_entries | sort_by(.key) | map(.key + "=" + .value.secret + ":" + .value.version) | join(",") end'
}

api_plain_env() {
  local storage
  require_env DABBOBA_SUPABASE_URL
  require_env DABBOBA_WEB_ORIGINS
  assert_https_origin "$DABBOBA_SUPABASE_URL" DABBOBA_SUPABASE_URL
  assert_https_origin_list "$DABBOBA_WEB_ORIGINS" DABBOBA_WEB_ORIGINS
  storage="$(media_storage_plain_env)" || return 1
  printf '%s\n' "$storage" | jq -c --arg url "$DABBOBA_SUPABASE_URL" --arg origins "$DABBOBA_WEB_ORIGINS" '
    . + {NODE_ENV:"production", API_SURFACE:"customer", LOG_LEVEL:"info", SUPABASE_URL:$url,
      SUPABASE_JWT_AUDIENCE:"authenticated", WEB_ORIGINS:$origins, PAYMENT_PROVIDER:"UNCONFIGURED"}'
}

api_secret_env() {
  local storage name
  for name in DABBOBA_DATABASE_SECRET DABBOBA_DATABASE_SECRET_VERSION DABBOBA_SESSION_PEPPER_SECRET DABBOBA_SESSION_PEPPER_SECRET_VERSION; do
    require_env "$name"
  done
  [[ "$DABBOBA_DATABASE_SECRET" != "$DABBOBA_SESSION_PEPPER_SECRET" ]] \
    || die "API database and session pepper must use distinct secrets"
  storage="$(media_storage_secret_env api)" || return 1
  printf '%s\n' "$storage" | jq -c \
    --arg database "$DABBOBA_DATABASE_SECRET" --arg database_version "$DABBOBA_DATABASE_SECRET_VERSION" \
    --arg pepper "$DABBOBA_SESSION_PEPPER_SECRET" --arg pepper_version "$DABBOBA_SESSION_PEPPER_SECRET_VERSION" '
    . + {DATABASE_URL:{secret:$database,version:$database_version},SESSION_TOKEN_PEPPER:{secret:$pepper,version:$pepper_version}}'
}

worker_plain_env() {
  local storage queue="${DABBOBA_WORKER_QUEUE_NAME:-dabboba_worker}"
  [[ "$queue" == dabboba_worker ]] || die "DABBOBA_WORKER_QUEUE_NAME must be dabboba_worker"
  storage="$(media_storage_plain_env)" || return 1
  printf '%s\n' "$storage" | jq -c --arg queue "$queue" '. + {
    NODE_ENV:"production", LOG_LEVEL:"info", WORKER_QUEUE_NAME:$queue,
    WORKER_QUEUE_VISIBILITY_SECONDS:"900", WORKER_MAX_RUN_SECONDS:"45",
    WORKER_MAX_MESSAGES_PER_RUN:"100", WORKER_DATABASE_OPERATION_TIMEOUT_MS:"30000", DATABASE_POOL_MAX:"3"}'
}

worker_secret_env() {
  local storage
  require_env DABBOBA_WORKER_DATABASE_SECRET
  require_env DABBOBA_WORKER_DATABASE_SECRET_VERSION
  storage="$(media_storage_secret_env worker)" || return 1
  printf '%s\n' "$storage" | jq -c --arg secret "$DABBOBA_WORKER_DATABASE_SECRET" --arg version "$DABBOBA_WORKER_DATABASE_SECRET_VERSION" '. + {WORKER_DATABASE_URL:{secret:$secret,version:$version}}'
}

worker_storage_release_fingerprint() {
  local plain secrets canonical digest project image job="${DABBOBA_WORKER_JOB:-dabboba-worker}"
  assert_resource_name "$job" DABBOBA_WORKER_JOB
  require_env DABBOBA_WORKER_SERVICE_ACCOUNT
  project="$(expected_project_id)" || return 1
  image="$(image_uri_for worker)" || return 1
  plain="$(worker_plain_env)" || return 1
  secrets="$(worker_secret_env)" || return 1
  # Validate the same flags that deploy will use; no unvalidated strings enter
  # an attestation, including the worker DB version and legacy GCS settings.
  printf '%s\n' "$plain" | plain_env_flag >/dev/null || return 1
  printf '%s\n' "$secrets" | secret_env_flag >/dev/null || return 1
  canonical="$(jq -cnS --arg project "$project" --arg region "$DABBOBA_CLOUD_RUN_REGION" \
    --arg job "$job" --arg image "$image" --arg account "$DABBOBA_WORKER_SERVICE_ACCOUNT" \
    --argjson plain "$plain" --argjson secrets "$secrets" \
    '{project:$project,region:$region,job:$job,image:$image,serviceAccount:$account,plain:$plain,secrets:$secrets}')" || return 1
  if command -v sha256sum >/dev/null 2>&1; then digest="$(printf '%s' "$canonical" | sha256sum | awk '{print $1}')" || return 1
  elif command -v shasum >/dev/null 2>&1; then digest="$(printf '%s' "$canonical" | shasum -a 256 | awk '{print $1}')" || return 1
  else die "A SHA-256 implementation is required for the worker storage release proof"; fi
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die "Invalid worker storage release fingerprint"
  printf '%s\n' "$digest"
}
