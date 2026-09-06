import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = fileURLToPath(new URL(".", import.meta.url));
const base = {
  PATH: "/usr/bin:/bin:/opt/homebrew/bin", DABBOBA_GCP_PROJECT_ID: "dabboba-prod",
  DABBOBA_ARTIFACT_REPOSITORY: "prod-images", DABBOBA_IMAGE_TAG: "release-2026",
  DABBOBA_DATABASE_SECRET: "api-database", DABBOBA_WORKER_DATABASE_SECRET: "worker-database",
  DABBOBA_WORKER_DATABASE_SECRET_VERSION: "7", DABBOBA_MIGRATION_DATABASE_SECRET: "migration-database",
  DABBOBA_SESSION_PEPPER_SECRET: "session-pepper", DABBOBA_GCS_BUCKET: "legacy-media",
  DABBOBA_API_SERVICE_ACCOUNT: "api-runtime@dabboba-prod.iam.gserviceaccount.com",
  DABBOBA_WORKER_SERVICE_ACCOUNT: "worker-runtime@dabboba-prod.iam.gserviceaccount.com",
};
const supabase = {
  DABBOBA_MEDIA_STORAGE_PROVIDER: "supabase", DABBOBA_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  DABBOBA_SUPABASE_STORAGE_BUCKET: "private-media",
  DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT: "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3",
  DABBOBA_SUPABASE_STORAGE_S3_REGION: "ap-northeast-2",
};
for (const role of ["API", "WORKER"]) {
  for (const key of ["SERVICE_KEY", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
    supabase[`DABBOBA_${role}_SUPABASE_STORAGE_${key}_SECRET`] = `${role.toLowerCase()}-${key.toLowerCase().replaceAll("_", "-")}`;
    supabase[`DABBOBA_${role}_SUPABASE_STORAGE_${key}_SECRET_VERSION`] = "3";
  }
}
function run(script, extra = {}, prefix = "") {
  const env = { ...base, ...extra };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return spawnSync("/bin/bash", ["-c", `source "$1/_common.sh"\ngcloud() { printf '%s\\n' 'unexpected cloud call' >&2; return 97; }\n${prefix}\n${script}`, "storage-test", directory], {
    env, encoding: "utf8", timeout: 10_000,
  });
}
function success(result) { assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); return result.stdout.trim(); }
function failure(result) { assert.notEqual(result.status, 0, result.stdout); assert.doesNotMatch(result.stderr, /unexpected cloud call/); }

test("legacy GCS, Supabase-only, mixed and rollback produce explicit bounded storage env maps", () => {
  assert.deepEqual(JSON.parse(success(run("media_storage_plain_env"))), {
    MEDIA_STORAGE_PROVIDER: "gcs", GCS_BUCKET: "legacy-media", GCS_PROJECT_ID: "dabboba-prod",
  });
  const expected = {
    MEDIA_STORAGE_PROVIDER: "supabase", SUPABASE_URL: supabase.DABBOBA_SUPABASE_URL,
    SUPABASE_STORAGE_BUCKET: "private-media", SUPABASE_STORAGE_S3_ENDPOINT: supabase.DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT,
    SUPABASE_STORAGE_S3_REGION: "ap-northeast-2",
  };
  assert.deepEqual(JSON.parse(success(run("media_storage_plain_env", { ...supabase, DABBOBA_GCS_BUCKET: undefined }))), expected);
  const mixed = JSON.parse(success(run("media_storage_plain_env", supabase)));
  assert.deepEqual(mixed, { ...expected, GCS_BUCKET: "legacy-media", GCS_PROJECT_ID: "dabboba-prod" });
  assert.deepEqual(JSON.parse(success(run("media_storage_plain_env", { ...supabase, DABBOBA_MEDIA_STORAGE_PROVIDER: "gcs" }))), { ...mixed, MEDIA_STORAGE_PROVIDER: "gcs" });
});

test("partial config, unsafe URL and environment delimiter injection fail locally", () => {
  for (const key of Object.keys(supabase).filter((key) => key !== "DABBOBA_MEDIA_STORAGE_PROVIDER")) {
    failure(run("assert_media_storage_config", { ...supabase, [key]: undefined }));
  }
  for (const extra of [
    { DABBOBA_MEDIA_STORAGE_PROVIDER: "unknown" },
    { DABBOBA_SUPABASE_URL: "https://custom.example", DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT: "https://custom.example/storage/v1/s3" },
    { DABBOBA_SUPABASE_URL: "https://short-ref.supabase.co", DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT: "https://short-ref.storage.supabase.co/storage/v1/s3" },
    { DABBOBA_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co:443" },
    { DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT: "http://localhost:54321/storage/v1/s3" },
    { DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT: "https://foreign.example/storage/v1/s3" },
    { DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT: `${supabase.DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT}?leak=1` },
    { DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT: `${supabase.DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT}\n~API_SURFACE=admin` },
    { DABBOBA_SUPABASE_STORAGE_BUCKET: "private~API_SURFACE=admin" },
    { DABBOBA_SUPABASE_STORAGE_BUCKET: "Private" }, { DABBOBA_SUPABASE_STORAGE_BUCKET: "private.bucket" },
    { DABBOBA_SUPABASE_STORAGE_BUCKET: "a".repeat(64) },
    { DABBOBA_SUPABASE_STORAGE_S3_REGION: "AP-northeast-2" }, { DABBOBA_SUPABASE_STORAGE_S3_REGION: "-region" },
    { DABBOBA_SUPABASE_STORAGE_S3_REGION: "a".repeat(64) },
    { DABBOBA_SUPABASE_STORAGE_S3_REGION: "ap-northeast-2\n" },
    { DABBOBA_SUPABASE_STORAGE_ALLOW_LOCAL_HTTP: "true" },
    { SUPABASE_STORAGE_ALLOW_LOCAL_HTTP: "true" },
  ]) failure(run("assert_media_storage_config", { ...supabase, ...extra }));
});

test("storage secret IDs are distinct across API, worker, database and pepper, with pinned numeric versions", () => {
  success(run("assert_media_storage_config", supabase));
  for (const key of Object.keys(supabase).filter((key) => key.endsWith("_SECRET_VERSION"))) {
    for (const invalid of ["latest", "0", "03", "3~NODE_ENV=test"]) failure(run("assert_media_storage_config", { ...supabase, [key]: invalid }));
  }
  for (const shared of ["api-database", "worker-database", "migration-database", "session-pepper", supabase.DABBOBA_WORKER_SUPABASE_STORAGE_SERVICE_KEY_SECRET]) {
    failure(run("assert_media_storage_config", { ...supabase, DABBOBA_API_SUPABASE_STORAGE_SERVICE_KEY_SECRET: shared }));
  }
});

test("raw storage credentials are rejected without printing values or contacting Cloud", () => {
  for (const name of ["SUPABASE_STORAGE_SERVICE_KEY", "SUPABASE_STORAGE_S3_ACCESS_KEY_ID", "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY"]) {
    const result = run("assert_no_raw_secret_envs", { [name]: "raw-credential-must-not-appear" });
    failure(result);
    assert.doesNotMatch(result.stderr + result.stdout, /raw-credential-must-not-appear/);
  }
});

test("role-specific storage secret rendering contains references only", () => {
  for (const role of ["api", "worker"]) {
    const actual = JSON.parse(success(run(`media_storage_secret_env ${role}`, supabase)));
    assert.deepEqual(actual, {
      SUPABASE_STORAGE_SERVICE_KEY: { secret: `${role}-service-key`, version: "3" },
      SUPABASE_STORAGE_S3_ACCESS_KEY_ID: { secret: `${role}-s3-access-key-id`, version: "3" },
      SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: { secret: `${role}-s3-secret-access-key`, version: "3" },
    });
    const flags = success(run(`media_storage_secret_env ${role} | secret_env_flag`, supabase));
    assert.equal(flags.split(",").length, 3);
    assert.match(flags, new RegExp(`SUPABASE_STORAGE_SERVICE_KEY=${role}-service-key:3`));
  }
});

test("storage preflight retains one exact per-secret service account and never reads secret payloads", () => {
  const stub = `gcloud() {
    if [[ "$1 $2 $3" == 'secrets versions describe' ]]; then printf 'ENABLED\\n';
    elif [[ "$1 $2" == 'secrets get-iam-policy' ]]; then
      [[ "$3" == api-* ]] || return 94
      printf 'serviceAccount:api-runtime@dabboba-prod.iam.gserviceaccount.com\\n'
      [[ "\${BAD_IAM:-}" != yes ]] || printf 'allUsers\\n'
    else return 97; fi
  }`;
  success(run("assert_media_storage_secret_access api", supabase, stub));
  failure(run("assert_media_storage_secret_access api", { ...supabase, BAD_IAM: "yes" }, stub));
});

test("worker proof changes with provider, secondary config, bucket or exact worker secret version", () => {
  const proof = success(run("expected_worker_execution_attestation", supabase));
  assert.match(proof, /^worker-job:release-2026:storage-v1:[0-9a-f]{64}:SUCCEEDED$/);
  for (const extra of [
    { DABBOBA_MEDIA_STORAGE_PROVIDER: "gcs" }, { DABBOBA_GCS_BUCKET: undefined },
    { DABBOBA_GCS_BUCKET: "different-legacy" }, { DABBOBA_SUPABASE_STORAGE_BUCKET: "different-private" },
    { DABBOBA_WORKER_SUPABASE_STORAGE_SERVICE_KEY_SECRET_VERSION: "4" },
    { DABBOBA_WORKER_SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY_SECRET_VERSION: "4" },
    { DABBOBA_ARTIFACT_REPOSITORY: "different-images" },
  ]) {
    assert.notEqual(success(run("expected_worker_execution_attestation", { ...supabase, ...extra })), proof);
    failure(run("assert_worker_execution_attestation", { ...supabase, ...extra, DABBOBA_WORKER_EXECUTION_ATTESTATION: proof }));
  }
  success(run("assert_worker_execution_attestation", { ...supabase, DABBOBA_WORKER_EXECUTION_ATTESTATION: proof }));
  failure(run("assert_worker_execution_attestation", { ...supabase, DABBOBA_WORKER_EXECUTION_ATTESTATION: "worker-job:release-2026:SUCCEEDED" }));
  for (const extra of [
    { DABBOBA_GCP_PROJECT_ID: undefined }, { DABBOBA_ARTIFACT_REPOSITORY: undefined },
    { DABBOBA_ARTIFACT_REPOSITORY: "bad/repository" },
    { DABBOBA_MEDIA_STORAGE_PROVIDER: "bad" }, { DABBOBA_WORKER_DATABASE_SECRET_VERSION: "latest" },
  ]) {
    const result = run("expected_worker_execution_attestation", { ...supabase, ...extra });
    failure(result);
    assert.equal(result.stdout, "", "invalid config must not emit an empty or partial attestation");
  }
});

test("whole web-origin list rejects newlines, delimiter injection and empty entries", () => {
  for (const value of ["https://safe.example\n~API_SURFACE=admin", "https://safe.example,", ",https://safe.example", "https://safe.example,,https://two.example"]) {
    failure(run('assert_https_origin_list "$TEST_ORIGINS" TEST_ORIGINS', { TEST_ORIGINS: value }));
  }
  success(run('assert_https_origin_list "$TEST_ORIGINS" TEST_ORIGINS', { TEST_ORIGINS: "https://safe.example,https://two.example" }));
});

function jobFixture(mode = "mixed") {
  const plain = {
    NODE_ENV: "production", LOG_LEVEL: "info", WORKER_QUEUE_NAME: "dabboba_worker",
    WORKER_QUEUE_VISIBILITY_SECONDS: "900", WORKER_MAX_RUN_SECONDS: "45", WORKER_MAX_MESSAGES_PER_RUN: "100",
    WORKER_DATABASE_OPERATION_TIMEOUT_MS: "30000", DATABASE_POOL_MAX: "3",
    MEDIA_STORAGE_PROVIDER: mode === "gcs" || mode === "rollback" ? "gcs" : "supabase",
    ...(mode !== "supabase" ? { GCS_BUCKET: "legacy-media", GCS_PROJECT_ID: "dabboba-prod" } : {}),
    ...(mode !== "gcs" ? {
      SUPABASE_URL: supabase.DABBOBA_SUPABASE_URL, SUPABASE_STORAGE_BUCKET: "private-media",
      SUPABASE_STORAGE_S3_ENDPOINT: supabase.DABBOBA_SUPABASE_STORAGE_S3_ENDPOINT,
      SUPABASE_STORAGE_S3_REGION: "ap-northeast-2",
    } : {}),
  };
  const secrets = { WORKER_DATABASE_URL: { name: "worker-database", key: "7" } };
  if (mode !== "gcs") {
    for (const key of ["SERVICE_KEY", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      secrets[`SUPABASE_STORAGE_${key}`] = { name: `worker-${key.toLowerCase().replaceAll("_", "-")}`, key: "3" };
    }
  }
  const env = [...Object.entries(plain).map(([name, value]) => ({ name, value })),
    ...Object.entries(secrets).map(([name, secretKeyRef]) => ({ name, valueFrom: { secretKeyRef } }))];
  return {
    metadata: { generation: "3" }, status: { observedGeneration: "3", conditions: [{ type: "Ready", status: "True" }] },
    spec: { template: { spec: { taskCount: 1, parallelism: 1, template: { spec: {
      serviceAccountName: base.DABBOBA_WORKER_SERVICE_ACCOUNT, maxRetries: 3, timeoutSeconds: 600,
      containers: [{ image: "asia-northeast3-docker.pkg.dev/dabboba-prod/prod-images/dabboba-worker:release-2026", resources: { limits: { cpu: "1", memory: "512Mi" } }, env }],
    } } } } },
  };
}
function jobEnv(job) { return job.spec.template.spec.template.spec.containers[0].env; }
const jobStub = `image_digest_for() { printf '%s\\n' 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; }
gcloud() { [[ "$1 $2 $3" == 'run jobs describe' ]] || return 97; printf '%s\\n' "$FIXTURE_JOB"; }`;
function checkJob(job, extra = supabase) {
  return run("assert_worker_job_matches_scheduler_contract dabboba-worker", { ...extra, FIXTURE_JOB: JSON.stringify(job) }, jobStub);
}

test("actual Worker Job accepts exact GCS, Supabase, mixed and rollback maps independent of ordering", () => {
  for (const mode of ["gcs", "supabase", "mixed", "rollback"]) {
    const env = mode === "gcs" ? {} : { ...supabase,
      ...(mode === "supabase" ? { DABBOBA_GCS_BUCKET: undefined } : {}),
      ...(mode === "rollback" ? { DABBOBA_MEDIA_STORAGE_PROVIDER: "gcs" } : {}),
    };
    const fixture = jobFixture(mode);
    success(checkJob(fixture, env));
    jobEnv(fixture).reverse();
    success(checkJob(fixture, env));
    for (const entry of jobEnv(fixture)) {
      if (entry.valueFrom) {
        const { name, key } = entry.valueFrom.secretKeyRef;
        entry.valueSource = { secretKeyRef: { secret: `projects/dabboba-prod/secrets/${name}`, version: key } };
        delete entry.valueFrom;
      }
    }
    success(checkJob(fixture, env));
  }
});

test("actual Worker Job rejects stale, extra, duplicate, plaintext and ambiguous secret entries", () => {
  const mutations = [
    (env) => { env.find((entry) => entry.name === "MEDIA_STORAGE_PROVIDER").value = "gcs"; },
    (env) => { env.pop(); },
    (env) => { env.push({ name: "UNAPPROVED", value: "x" }); },
    (env) => { env.push(structuredClone(env[0])); },
    (env) => { env.push(structuredClone(env.at(-1))); },
    (env) => { env.at(-1).valueFrom.secretKeyRef.key = "latest"; },
    (env) => { env.at(-1).valueFrom.secretKeyRef.key = "4"; },
    (env) => { env.at(-1).valueFrom.secretKeyRef.name = "api-s3-secret-access-key"; },
    (env) => { env.at(-1).valueFrom.secretKeyRef.name = "projects/foreign-project/secrets/worker-s3-secret-access-key"; },
    (env) => { env.at(-1).value = "raw-secret"; delete env.at(-1).valueFrom; },
    (env) => { env.at(-1).value = "raw-secret"; },
    (env) => { env.at(-1).valueSource = { secretKeyRef: { secret: "worker-s3-secret-access-key", version: "3" } }; },
    (env) => { env.at(-1).valueFrom.secretKeyRef.extra = "unapproved"; },
    (env) => { env[0].value = 1; },
  ];
  for (const mutate of mutations) {
    const fixture = jobFixture();
    mutate(jobEnv(fixture));
    failure(checkJob(fixture));
  }
});

test("worker deployment flags use the same complete maps as the actual Job contract", () => {
  const fixture = jobFixture();
  const plain = success(run("worker_plain_env | plain_env_flag", supabase));
  const secrets = success(run("worker_secret_env | secret_env_flag", supabase));
  assert.ok(plain.startsWith("^~^"));
  assert.deepEqual(Object.fromEntries(plain.slice(3).split("~").map((entry) => {
    const position = entry.indexOf("="); return [entry.slice(0, position), entry.slice(position + 1)];
  })), Object.fromEntries(jobEnv(fixture).filter((entry) => "value" in entry).map((entry) => [entry.name, entry.value])));
  assert.deepEqual(secrets.split(",").sort(), jobEnv(fixture).filter((entry) => "valueFrom" in entry)
    .map((entry) => `${entry.name}=${entry.valueFrom.secretKeyRef.name}:${entry.valueFrom.secretKeyRef.key}`).sort());
});
