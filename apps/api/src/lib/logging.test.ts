import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { serializeRequestForLog } from "./logging.js";

test("INFO request logs keep correlation and fixed route metadata without raw URLs or credentials", async () => {
  const logLines: string[] = [];
  const app = Fastify({
    genReqId: () => "safe-request-id",
    logger: {
      level: "info",
      serializers: { req: serializeRequestForLog },
      stream: {
        write(message) {
          logLines.push(message);
        },
      },
    },
  });
  app.get("/items/:itemId", async () => ({ ok: true }));

  try {
    const response = await app.inject({
      method: "GET",
      url: "/items/private-item-id?token=secret-query-value",
      headers: {
        authorization: "Bearer secret-access-token",
        cookie: "session=secret-cookie",
      },
    });
    assert.equal(response.statusCode, 200, response.body);

    const entries = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const incoming = entries.find((entry) => entry.msg === "incoming request");
    assert.ok(incoming);
    assert.equal(incoming.reqId, "safe-request-id");
    assert.deepEqual(incoming.req, { method: "GET", route: "/items/:itemId" });

    const logs = logLines.join("\n");
    assert.doesNotMatch(
      logs,
      /private-item-id|secret-query-value|secret-access-token|secret-cookie|authorization|cookie/,
    );
  } finally {
    await app.close();
  }
});
