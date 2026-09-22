import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { ApiContext } from "../types.js";
import { registerHealthRoutes } from "./health.js";

test("liveness is process-only while readiness reflects PostgreSQL", async () => {
  let databaseChecks = 0;
  const context = {
    pool: {
      async query() {
        databaseChecks += 1;
        if (databaseChecks === 2) throw new Error("database unavailable");
        return { rows: [{ ok: 1 }], rowCount: 1 };
      },
    },
  } as unknown as ApiContext;
  const app = Fastify({ logger: false });
  await registerHealthRoutes(app, context);

  try {
    const live = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(live.statusCode, 200);
    assert.equal(databaseChecks, 0);
    assert.deepEqual(Object.keys(live.json()).sort(), ["status", "timestamp"]);
    assert.equal(live.json().status, "ok");

    const ready = await app.inject({ method: "GET", url: "/readyz" });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), {
      status: "ok",
      database: "ok",
      timestamp: ready.json().timestamp,
    });

    const unavailable = await app.inject({ method: "GET", url: "/readyz" });
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.json(), {
      status: "unavailable",
      database: "unavailable",
      timestamp: unavailable.json().timestamp,
    });
  } finally {
    await app.close();
  }
});
