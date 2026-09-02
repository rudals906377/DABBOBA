import assert from "node:assert/strict";
import test from "node:test";
import { assertDisposableIntegrationDatabaseTarget } from "./index.js";

test("integration pools reject the application database target", () => {
  assert.throws(
    () => assertDisposableIntegrationDatabaseTarget(
      "postgresql://test:test@127.0.0.1:55433/dabboba?sslmode=disable",
      "postgres://app:app@127.0.0.1:55433/dabboba",
      "dabboba-exchange-integration",
    ),
    /별도의 DABBOBA_DISPOSABLE_TEST_DATABASE_URL/,
  );
});

test("non-integration pools and disposable database targets are allowed", () => {
  assert.doesNotThrow(() => assertDisposableIntegrationDatabaseTarget(
    "postgresql://test:test@127.0.0.1:55434/dabboba_test",
    "postgresql://app:app@127.0.0.1:55433/dabboba",
    "dabboba-exchange-integration",
  ));
  assert.doesNotThrow(() => assertDisposableIntegrationDatabaseTarget(
    "postgresql://app:app@127.0.0.1:55433/dabboba",
    "postgresql://app:app@127.0.0.1:55433/dabboba",
    "dabboba-api",
  ));
});
