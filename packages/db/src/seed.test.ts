import assert from "node:assert/strict";
import test from "node:test";
import { seedCatalog } from "./seed.js";

test("production seed fails closed without the one-time explicit flag", async () => {
  await assert.rejects(
    seedCatalog("postgresql://unused", { environment: "production" }),
    /Production catalog seed is disabled/,
  );
});
