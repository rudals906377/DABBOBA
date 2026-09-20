import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createEdgeApiLogger } from "./edge-logger.js";

test("Edge API logger emits only bounded diagnostic fields", () => {
  const lines: string[] = [];
  const logger = createEdgeApiLogger("info", (line) => lines.push(line))
    .child({ reqId: "request-id-1234", authorization: "Bearer binding-secret" });
  logger.info({
    req: { method: "POST", url: "/v1/orders?token=query-secret", headers: { cookie: "session-secret" } },
    route: "/v1/orders/:orderId",
    statusCode: 503,
    errorKind: "database",
    sqlState: "08006",
    err: new Error("postgresql://user:password@host/database"),
  }, "message-with-secret");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), {
    level: "info",
    service: "dabboba-api-edge",
    requestId: "request-id-1234",
    method: "POST",
    route: "/v1/orders/:orderId",
    statusCode: 503,
    errorKind: "database",
    sqlState: "08006",
  });
  assert.doesNotMatch(lines[0]!, /query-secret|session-secret|binding-secret|password|message-with-secret/);
});

test("Edge-only Pino adapter fails closed if a Pino logger or transport is requested", () => {
  const require = createRequire(import.meta.url);
  const pino = require(fileURLToPath(new URL("../../src/lib/pino-edge-adapter.cjs", import.meta.url))) as {
    (): never;
    destination(): never;
  };
  assert.throws(() => pino(), /Pino transports are unavailable/);
  assert.throws(() => pino.destination(), /Pino transports are unavailable/);
});
