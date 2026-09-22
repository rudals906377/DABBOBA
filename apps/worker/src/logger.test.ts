import assert from "node:assert/strict";
import test from "node:test";
import { errorFields, persistedErrorIdentity } from "./logger.js";

test("error fields omit arbitrary messages, stacks, causes, and provider codes", () => {
  const error = Object.assign(new Error("token=provider-secret", {
    cause: new Error("customer@example.test"),
  }), {
    name: "ProviderSecretError",
    code: "provider-secret-response",
    stack: "stack contains credential=secret",
  });

  assert.deepEqual(errorFields(error), { errorName: "Error" });
  assert.equal(persistedErrorIdentity(error), "Error");
  assert.equal(JSON.stringify(errorFields(error)).includes("secret"), false);
});

test("error fields retain only reviewed SQLSTATE and network identities", () => {
  const databaseError = Object.assign(new Error("duplicate customer data"), { code: "23505" });
  const networkError = Object.assign(new Error("upstream URL with token"), { code: "ETIMEDOUT" });

  assert.deepEqual(errorFields(databaseError), { errorName: "Error", errorCode: "23505" });
  assert.equal(persistedErrorIdentity(databaseError), "Error:23505");
  assert.deepEqual(errorFields(networkError), { errorName: "Error", errorCode: "ETIMEDOUT" });
});

test("non-Error throws never invoke arbitrary string conversion", () => {
  const thrown = { toString() { throw new Error("must not run"); } };

  assert.deepEqual(errorFields(thrown), { errorName: "NonError" });
  assert.equal(persistedErrorIdentity(thrown), "NonError");
});
