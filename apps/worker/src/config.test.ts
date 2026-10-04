import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_RUN_TASK_TIMEOUT_SECONDS,
  loadWorkerConfig,
  MAX_WORKER_RUN_SECONDS,
  MIN_QUEUE_VISIBILITY_SECONDS,
  QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS,
} from "./config.js";

const base = {
  NODE_ENV: "test",
  WORKER_DATABASE_URL: "postgresql://worker:secret@127.0.0.1:5432/dabboba",
};

test("loadWorkerConfig applies bounded operational defaults", () => {
  const config = loadWorkerConfig(base);
  assert.equal(config.queueName, "dabboba_worker");
  assert.equal(config.outboxBatchSize, 50);
  assert.equal(config.queueVisibilitySeconds, 900);
  assert.equal(config.maxRunSeconds, 45);
  assert.equal(config.maxMessagesPerRun, 100);
  assert.equal(config.databasePoolMax, 3);
  assert.equal(config.databaseOperationTimeoutMs, 30_000);
  assert.equal(config.mediaPendingTtlMinutes, 5);
  assert.equal(config.gcsBucket, null);
  assert.equal(config.supabaseAuthAdmin, null);
  assert.equal(config.appleRevocation, null);
  assert.equal(config.expoPushAccessToken, null);
  assert.deepEqual(config.paymentReconciliation, { provider: "MANUAL_REVIEW" });
  assert.deepEqual(config.commerceRetention, { mode: "DISABLED", batchSize: 25 });
});

test("commerce retention requires an explicit bounded mode; other retention defaults do not enable it", () => {
  for (const mode of ["DISABLED", "PREVIEW", "EXECUTE"] as const) {
    assert.deepEqual(loadWorkerConfig({ ...base, WORKER_COMMERCE_RETENTION_MODE: mode,
      WORKER_COMMERCE_RETENTION_BATCH_SIZE: "10" }).commerceRetention, { mode, batchSize: 10 });
  }
  for (const mode of ["true", "enabled", "preview", "PURGE"]) {
    assert.throws(() => loadWorkerConfig({ ...base, WORKER_COMMERCE_RETENTION_MODE: mode }), /Commerce retention mode/);
  }
  for (const batch of ["0", "101", "1.5", "abc"]) {
    assert.throws(() => loadWorkerConfig({ ...base, WORKER_COMMERCE_RETENTION_BATCH_SIZE: batch }), /integer between 1 and 100/);
  }
});

test("loadWorkerConfig requires a complete Apple revocation credential set", () => {
  const encryptionKey = Buffer.alloc(32, 3).toString("base64url");
  assert.throws(() => loadWorkerConfig({
    ...base,
    APPLE_CLIENT_ID: "com.dabboba.app",
  }), /Apple revocation requires/);
  const config = loadWorkerConfig({
    ...base,
    APPLE_CLIENT_ID: "com.dabboba.app",
    APPLE_CLIENT_SECRET: "signed-client-secret-value-that-is-long-enough",
    APPLE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    APPLE_TOKEN_ENCRYPTION_KEY_VERSION: "1",
  });
  assert.deepEqual(config.appleRevocation, {
    clientId: "com.dabboba.app",
    clientSecret: "signed-client-secret-value-that-is-long-enough",
    encryptionKey,
    keyVersion: 1,
  });
});

test("loadWorkerConfig requires a server-only Supabase Auth deletion credential pair", () => {
  assert.throws(() => loadWorkerConfig({
    ...base,
    SUPABASE_URL: "http://127.0.0.1:54321",
  }), /requires SUPABASE_URL and SUPABASE_AUTH_ADMIN_SECRET_KEY together/);
  assert.throws(() => loadWorkerConfig({
    ...base,
    SUPABASE_AUTH_ADMIN_SECRET_KEY: "server-only-fixture-secret-key",
  }), /requires SUPABASE_URL and SUPABASE_AUTH_ADMIN_SECRET_KEY together/);
  assert.throws(() => loadWorkerConfig({
    ...base,
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_AUTH_ADMIN_SECRET_KEY: "sb_publishable_fixture_key",
  }), /server-only Supabase secret key/);
  const config = loadWorkerConfig({
    ...base,
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_AUTH_ADMIN_SECRET_KEY: "server-only-fixture-secret-key",
  });
  assert.deepEqual(config.supabaseAuthAdmin, {
    url: "http://127.0.0.1:54321",
    secretKey: "server-only-fixture-secret-key",
  });
});

test("loadWorkerConfig rejects dormant, partial, and local-test KG INICIS settings", () => {
  assert.throws(() => loadWorkerConfig({
    ...base,
    KG_INICIS_MID: "INIpayTest",
  }), /must be unset/);
  assert.throws(() => loadWorkerConfig({
    ...base,
    PAYMENT_RECONCILIATION_PROVIDER: "KG_INICIS",
    DABBOBA_ENVIRONMENT_TIER: "TEST",
    KG_INICIS_ENVIRONMENT: "TEST",
    KG_INICIS_MID: "INIpayTest",
  }), /requires environment, MID, INIAPI key, and client IPv4/);
  assert.throws(() => loadWorkerConfig({
    ...base,
    PAYMENT_RECONCILIATION_PROVIDER: "KG_INICIS",
    DABBOBA_ENVIRONMENT_TIER: "TEST",
    KG_INICIS_ENVIRONMENT: "TEST",
    KG_INICIS_MID: "INIpayTest",
    KG_INICIS_INIAPI_KEY: "fixture-inicis-api-key",
    KG_INICIS_CLIENT_IP: "127.0.0.1",
  }), /STAGING\+TEST or PRODUCTION\+LIVE/);
});

test("PortOne API reconciliation requires a separate secret, HTTPS in deployed tiers, and an explicit mode", () => {
  const portone = {
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    GCS_BUCKET: "staging-media",
    PAYMENT_RECONCILIATION_PROVIDER: "PORTONE_API",
    PORTONE_RECONCILIATION_API_BASE_URL: "https://api.example.test/functions/v1/dabboba-api",
    PAYMENT_RECONCILIATION_WORKER_SECRET: "separate-worker-requery-secret-for-tests",
  };
  assert.deepEqual(loadWorkerConfig({ ...base, ...portone }).paymentReconciliation, {
    provider: "PORTONE_API",
    apiBaseUrl: portone.PORTONE_RECONCILIATION_API_BASE_URL,
    secret: portone.PAYMENT_RECONCILIATION_WORKER_SECRET,
  });
  assert.throws(() => loadWorkerConfig({ ...base, ...portone, PORTONE_RECONCILIATION_API_BASE_URL: "http://api.example.test" }), /dedicated API origin/);
  assert.throws(() => loadWorkerConfig({ ...base, ...portone, PAYMENT_RECONCILIATION_WORKER_SECRET: "weak" }), /32-512 byte/);
  assert.throws(() => loadWorkerConfig({ ...base, ...portone, PAYMENT_RECONCILIATION_PROVIDER: "MANUAL_REVIEW" }), /must be unset/);
});

test("loadWorkerConfig requires explicit matching tiers for KG INICIS inquiry", () => {
  const kg = {
    PAYMENT_RECONCILIATION_PROVIDER: "KG_INICIS",
    KG_INICIS_ENVIRONMENT: "TEST",
    KG_INICIS_MID: "INIpayTest",
    KG_INICIS_INIAPI_KEY: "fixture-inicis-api-key",
    KG_INICIS_CLIENT_IP: "203.0.113.7",
  };
  assert.throws(() => loadWorkerConfig({
    ...base,
    ...kg,
  }), /explicit DABBOBA_ENVIRONMENT_TIER/);
  assert.throws(() => loadWorkerConfig({
    ...base,
    ...kg,
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    KG_INICIS_ENVIRONMENT: "LIVE",
    GCS_BUCKET: "staging-media",
  }), /STAGING\+TEST or PRODUCTION\+LIVE/);

  const staging = loadWorkerConfig({
    ...base,
    ...kg,
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    GCS_BUCKET: "staging-media",
  });
  assert.deepEqual(staging.paymentReconciliation, {
    provider: "KG_INICIS",
    environment: "TEST",
    mid: "INIpayTest",
    iniApiKey: "fixture-inicis-api-key",
    clientIp: "203.0.113.7",
  });

  assert.throws(() => loadWorkerConfig({
    ...base,
    ...kg,
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "PRODUCTION",
    DABBOBA_ENABLE_PRODUCTION_WORKER: "true",
    GCS_BUCKET: "production-media",
  }), /PRODUCTION\+LIVE/);
  assert.equal(loadWorkerConfig({
    ...base,
    ...kg,
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "PRODUCTION",
    DABBOBA_ENABLE_PRODUCTION_WORKER: "true",
    KG_INICIS_ENVIRONMENT: "LIVE",
    GCS_BUCKET: "production-media",
  }).paymentReconciliation?.provider, "KG_INICIS");
});

test("loadWorkerConfig validates KG INICIS MID, key, and canonical IPv4 without echoing secrets", () => {
  const secret = "secret-with-line\nbreak";
  const common = {
    ...base,
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    PAYMENT_RECONCILIATION_PROVIDER: "KG_INICIS",
    KG_INICIS_ENVIRONMENT: "TEST",
    KG_INICIS_MID: "INIpayTest",
    KG_INICIS_INIAPI_KEY: "fixture-inicis-api-key",
    KG_INICIS_CLIENT_IP: "203.0.113.7",
    GCS_BUCKET: "staging-media",
  };
  assert.throws(() => loadWorkerConfig({ ...common, KG_INICIS_MID: "short" }), /configuration is invalid/);
  assert.throws(() => loadWorkerConfig({ ...common, KG_INICIS_CLIENT_IP: "127.00.0.1" }), /configuration is invalid/);
  assert.throws(
    () => loadWorkerConfig({ ...common, KG_INICIS_INIAPI_KEY: secret }),
    (error) => error instanceof Error && !error.message.includes(secret),
  );
});

test("loadWorkerConfig bounds each database operation below the shutdown margin", () => {
  assert.throws(() => loadWorkerConfig({
    ...base,
    WORKER_DATABASE_OPERATION_TIMEOUT_MS: "30001",
  }), /WORKER_DATABASE_OPERATION_TIMEOUT_MS/);
  assert.equal(loadWorkerConfig({
    ...base,
    WORKER_DATABASE_OPERATION_TIMEOUT_MS: "1000",
  }).databaseOperationTimeoutMs, 1_000);
});

test("loadWorkerConfig requires a worker-specific database URL", () => {
  assert.throws(() => loadWorkerConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://api:secret@127.0.0.1:5432/dabboba",
  }), /WORKER_DATABASE_URL/);
});

test("explicit TEST worker config rejects remote databases and provider credentials", () => {
  assert.throws(() => loadWorkerConfig({
    ...base,
    DABBOBA_ENVIRONMENT_TIER: "TEST",
    WORKER_DATABASE_URL: "postgresql://worker:secret@db.example.test/dabboba",
  }), /loopback/);
  assert.throws(() => loadWorkerConfig({
    ...base,
    DABBOBA_ENVIRONMENT_TIER: "TEST",
    GOOGLE_APPLICATION_CREDENTIALS: "/private/provider.json",
  }), /Google Cloud/);
});

test("explicit production worker startup is opt-in", () => {
  const production = {
    ...base,
    NODE_ENV: "production",
    DABBOBA_ENVIRONMENT_TIER: "PRODUCTION",
    GCS_BUCKET: "prod-media",
  };
  assert.throws(() => loadWorkerConfig(production), /DABBOBA_ENABLE_PRODUCTION_WORKER/);
  assert.doesNotThrow(() => loadWorkerConfig({
    ...production,
    DABBOBA_ENABLE_PRODUCTION_WORKER: "true",
  }));
});

test("loadWorkerConfig rejects unsafe production boundaries", () => {
  assert.throws(() => loadWorkerConfig({ ...base, NODE_ENV: "production" }), /GCS_BUCKET/);
  assert.throws(
    () => loadWorkerConfig({
      ...base,
      NODE_ENV: "production",
      GCS_BUCKET: "prod-media",
      NOTIFICATION_DELIVERY_URL: "https://notify.example.test/deliver",
    }),
    /disabled in production until receiver-enforced idempotency/,
  );
});

test("loadWorkerConfig allows HTTP notification delivery outside production", () => {
  for (const environment of ["development", "test"]) {
    const config = loadWorkerConfig({
      ...base,
      NODE_ENV: environment,
      NOTIFICATION_DELIVERY_URL: "http://127.0.0.1:8787/deliver",
    });
    assert.equal(config.notificationDeliveryUrl, "http://127.0.0.1:8787/deliver");
  }
});

test("loadWorkerConfig enables Expo push only with a valid server-only access token", () => {
  const token = "expo-server-access-token-for-tests";
  assert.equal(loadWorkerConfig({ ...base, EXPO_PUSH_ACCESS_TOKEN: token }).expoPushAccessToken, token);
  assert.throws(
    () => loadWorkerConfig({ ...base, EXPO_PUSH_ACCESS_TOKEN: "short" }),
    /server-only Expo access token/,
  );
  assert.throws(
    () => loadWorkerConfig({ ...base, EXPO_PUSH_ACCESS_TOKEN: `${token}\nleak` }),
    /server-only Expo access token/,
  );
  assert.throws(
    () => loadWorkerConfig({
      ...base,
      EXPO_PUSH_ACCESS_TOKEN: token,
      NOTIFICATION_DELIVERY_URL: "http://127.0.0.1:8787/deliver",
    }),
    /either EXPO_PUSH_ACCESS_TOKEN or NOTIFICATION_DELIVERY_URL/,
  );
});

test("loadWorkerConfig pins the queue name to its least-privilege database ACL", () => {
  assert.throws(() => loadWorkerConfig({ ...base, WORKER_QUEUE_NAME: "dabboba:worker" }), /WORKER_QUEUE_NAME/);
  assert.throws(() => loadWorkerConfig({ ...base, WORKER_QUEUE_NAME: "Dabboba_worker" }), /WORKER_QUEUE_NAME/);
  assert.throws(() => loadWorkerConfig({ ...base, WORKER_QUEUE_NAME: "x".repeat(48) }), /WORKER_QUEUE_NAME/);
});

test("loadWorkerConfig keeps visibility beyond the Cloud Run task timeout and safety margin", () => {
  assert.equal(
    MIN_QUEUE_VISIBILITY_SECONDS,
    CLOUD_RUN_TASK_TIMEOUT_SECONDS + QUEUE_VISIBILITY_SAFETY_MARGIN_SECONDS,
  );
  assert.throws(
    () => loadWorkerConfig({
      ...base,
      WORKER_QUEUE_VISIBILITY_SECONDS: String(MIN_QUEUE_VISIBILITY_SECONDS - 1),
    }),
    /Cloud Run task timeout plus .* safety margin/,
  );
  assert.equal(
    loadWorkerConfig({
      ...base,
      WORKER_QUEUE_VISIBILITY_SECONDS: String(MIN_QUEUE_VISIBILITY_SECONDS),
    }).queueVisibilitySeconds,
    MIN_QUEUE_VISIBILITY_SECONDS,
  );
});

test("loadWorkerConfig reserves shutdown time inside the Cloud Run task timeout", () => {
  assert.equal(MAX_WORKER_RUN_SECONDS, 45);
  assert.ok(MAX_WORKER_RUN_SECONDS < CLOUD_RUN_TASK_TIMEOUT_SECONDS);
  assert.throws(
    () => loadWorkerConfig({
      ...base,
      WORKER_MAX_RUN_SECONDS: String(MAX_WORKER_RUN_SECONDS + 1),
    }),
    /WORKER_MAX_RUN_SECONDS must be an integer between/,
  );
});

test("the PG window validity is bounded and defaults to thirty minutes", () => {
  assert.equal(loadWorkerConfig(base).paymentWindowValidityMinutes, 30);
  assert.equal(loadWorkerConfig({ ...base, WORKER_PAYMENT_WINDOW_VALIDITY_MINUTES: "45" }).paymentWindowValidityMinutes, 45);
  for (const value of ["9", "1441", "abc"]) {
    assert.throws(
      () => loadWorkerConfig({ ...base, WORKER_PAYMENT_WINDOW_VALIDITY_MINUTES: value }),
      /WORKER_PAYMENT_WINDOW_VALIDITY_MINUTES must be an integer between 10 and 1440/,
    );
  }
});
