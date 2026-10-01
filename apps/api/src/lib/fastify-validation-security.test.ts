import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

// GHSA-667r-xxjv-c9mm: validated async data is not the custom compiler's
// { value, error } envelope. Keep this entirely in-process, without a DB.
test("async validation cannot replace the request body with its value property", async () => {
  const app = Fastify({ logger: false });
  app.post("/fixture", {
    schema: {
      body: {
        $async: true,
        type: "object",
        required: ["action", "value"],
        properties: {
          action: { type: "string", const: "read" },
          value: { type: "object" },
        },
      },
    },
  }, async (request) => request.body);
  try {
    const payload = { action: "read", value: { action: "write" } };
    const response = await app.inject({ method: "POST", url: "/fixture", payload });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), payload);
    const rejected = await app.inject({
      method: "POST", url: "/fixture", payload: { ...payload, action: "write" },
    });
    assert.equal(rejected.statusCode, 400);
  } finally {
    await app.close();
  }
});
