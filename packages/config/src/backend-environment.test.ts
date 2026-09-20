import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDatabaseUrlForTier,
  assertLocalTestProviderBoundary,
  assertTestDatabaseEnvironment,
  loadBackendEnvironmentTier,
} from "./backend-environment.js";

test("startup tiers are explicit, bounded, and consistent with NODE_ENV", () => {
  assert.equal(loadBackendEnvironmentTier({ DABBOBA_ENVIRONMENT_TIER: "LOCAL" }, "development", true), "LOCAL");
  assert.equal(loadBackendEnvironmentTier({}, "test"), "TEST");
  assert.throws(() => loadBackendEnvironmentTier({}, "development", true), /DABBOBA_ENVIRONMENT_TIER/);
  assert.throws(
    () => loadBackendEnvironmentTier({ DABBOBA_ENVIRONMENT_TIER: "PRODUCTION" }, "development", true),
    /does not match NODE_ENV/,
  );
});

test("LOCAL and TEST database URLs cannot escape loopback through hosts or query overrides", () => {
  assert.equal(
    assertDatabaseUrlForTier("postgresql://role:secret@127.0.0.1:55433/dabboba_test", "DATABASE_URL", "TEST"),
    "postgresql://role:secret@127.0.0.1:55433/dabboba_test",
  );
  for (const value of [
    "postgresql://role:secret@db.example.test/dabboba",
    "postgresql://role:secret@127.0.0.1:55433/dabboba?host=db.example.test",
    "postgresql://role:secret@127.0.0.1:55433/dabboba#remote",
  ]) {
    assert.throws(() => assertDatabaseUrlForTier(value, "DATABASE_URL", "TEST"), /DATABASE_URL/);
  }
});

test("LOCAL and TEST accept only explicitly local provider fixtures", () => {
  assert.doesNotThrow(() => assertLocalTestProviderBoundary({
    PAYMENT_PROVIDER: "TEST_PG",
    NOTIFICATION_DELIVERY_URL: "http://127.0.0.1:9999/deliver",
  }, "TEST"));
  assert.throws(() => assertLocalTestProviderBoundary({ PAYMENT_PROVIDER: "LIVE_PG" }, "LOCAL"), /PAYMENT_PROVIDER/);
  assert.throws(() => assertLocalTestProviderBoundary({ SUPABASE_URL: "https://project.supabase.co" }, "TEST"), /SUPABASE_URL/);
  assert.throws(() => assertLocalTestProviderBoundary({ GOOGLE_APPLICATION_CREDENTIALS: "/private/key.json" }, "LOCAL"), /Google Cloud/);
});

test("test command guard rejects a production-tier or remotely poisoned test URL", () => {
  assert.doesNotThrow(() => assertTestDatabaseEnvironment({
    DABBOBA_ENVIRONMENT_TIER: "TEST",
    DABBOBA_TEST_DATABASE_URL: "postgresql://owner:secret@localhost:55433/dabboba_test",
  }));
  assert.throws(() => assertTestDatabaseEnvironment({
    DABBOBA_TEST_DATABASE_URL: "postgresql://owner:secret@db.example.test/dabboba",
  }), /loopback/);
  assert.throws(() => assertTestDatabaseEnvironment({
    DABBOBA_ENVIRONMENT_TIER: "PRODUCTION",
  }), /require DABBOBA_ENVIRONMENT_TIER=TEST/);
  assert.throws(() => assertTestDatabaseEnvironment({
    DABBOBA_TEST_DATABASE_URL: "postgresql://owner:secret@localhost:55433/one",
    DABBOBA_RUNTIME_TEST_DATABASE_URL: "postgresql://runtime:secret@127.0.0.1:55433/two",
    DABBOBA_WORKER_TEST_DATABASE_URL: "postgresql://worker:secret@localhost:55433/one",
  }), /same local database/);
});
