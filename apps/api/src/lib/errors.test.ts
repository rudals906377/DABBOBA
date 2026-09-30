import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerErrorHandler, safeErrorFields } from "./errors.js";

test("safe error fields retain only an allowlisted classification and SQLSTATE", () => {
  const databaseError = Object.assign(new Error("postgres://user:secret@database.example.test/db"), {
    cause: new Error("nested token secret"),
    code: "57P01",
    detail: "Failing row contains private customer data",
    query: "SELECT private_value FROM users",
  });

  assert.deepEqual(safeErrorFields(databaseError), {
    errorKind: "database",
    sqlState: "57P01",
  });
  assert.doesNotMatch(
    JSON.stringify(safeErrorFields(databaseError)),
    /secret|private|SELECT|database\.example\.test/,
  );
  assert.deepEqual(
    safeErrorFields(Object.assign(new Error("parser internals"), { code: "FST_ERR_CTP_INVALID_JSON_BODY" })),
    { errorKind: "framework" },
  );
  assert.deepEqual(safeErrorFields(new Error("token secret")), { errorKind: "unexpected" });
  assert.deepEqual(
    safeErrorFields(Object.assign(new Error("token secret"), { code: "TOKEN" })),
    { errorKind: "unexpected" },
  );
  assert.deepEqual(safeErrorFields("token secret"), { errorKind: "non_error" });
});

test("request failure logs exclude raw error data while retaining request correlation", async () => {
  const logLines: string[] = [];
  const app = Fastify({
    genReqId: () => "safe-request-id",
    logger: {
      level: "error",
      stream: {
        write(message) {
          logLines.push(message);
        },
      },
    },
  });
  registerErrorHandler(app);
  app.get("/failure", async () => {
    throw Object.assign(new Error("postgres://user:secret@database.example.test/db"), {
      cause: new Error("nested token secret"),
      code: "57P01",
      detail: "private row contents",
    });
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/failure?token=secret-query-value",
      headers: { "x-request-id": "safe-request-id" },
    });
    assert.equal(response.statusCode, 500, response.body);
    const logs = logLines.join("\n");
    assert.match(logs, /"errorKind":"database"/);
    assert.match(logs, /"sqlState":"57P01"/);
    assert.match(logs, /"requestId":"safe-request-id"/);
    assert.doesNotMatch(logs, /secret|private|database\.example\.test|nested token|stack|detail|cause/);
  } finally {
    await app.close();
  }
});

test("PostgreSQL input-cast failures are client errors, not server faults", async () => {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  for (const code of ["22P02", "22007", "22008"]) {
    app.get(`/cast-${code}`, async () => {
      throw Object.assign(new Error('invalid input syntax for type uuid: "private-value"'), { code });
    });
  }
  try {
    for (const code of ["22P02", "22007", "22008"]) {
      const response = await app.inject({ method: "GET", url: `/cast-${code}` });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().error.code, "INVALID_REQUEST");
      assert.doesNotMatch(response.body, /private-value|uuid/);
    }
  } finally {
    await app.close();
  }
});
