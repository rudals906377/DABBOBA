import assert from "node:assert/strict";
import test from "node:test";
import { redisConnectionOptions } from "./redis.js";

test("Redis URL is converted without dropping TLS, credentials, or database", () => {
  const options = redisConnectionOptions("rediss://worker:p%40ss@redis.example.com:6380/3");
  assert.equal(options.host, "redis.example.com");
  assert.equal(options.port, 6_380);
  assert.equal(options.db, 3);
  assert.equal(options.password, "p@ss");
  assert.deepEqual(options.tls, { servername: "redis.example.com" });
  assert.equal(options.maxRetriesPerRequest, null);
});

test("Redis URL rejects an invalid database path", () => {
  assert.throws(() => redisConnectionOptions("redis://127.0.0.1/not-a-number"), /database/);
});
