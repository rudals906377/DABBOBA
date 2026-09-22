import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const composeVersion = spawnSync("docker", ["compose", "version", "--short"], {
  encoding: "utf8",
  timeout: 10_000,
});
const skip = composeVersion.error || composeVersion.status !== 0
  ? "Docker Compose CLI is required for read-only configuration checks"
  : false;

function configuration(project) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("COMPOSE_")) delete env[key];
  }
  return JSON.parse(execFileSync("docker", [
    "compose",
    "--env-file", "/dev/null",
    ...(project ? ["--project-name", project] : []),
    "--file", "ops/local/compose.yaml",
    "config", "--format", "json",
  ], { cwd: root, env, encoding: "utf8", timeout: 10_000 }));
}

test("direct Compose commands use the same DABBOBA namespace as package scripts", { skip }, () => {
  const direct = configuration();
  const explicit = configuration("dabboba-local");
  assert.equal(direct.name, "dabboba-local");
  assert.deepEqual(direct, explicit);
  assert.deepEqual(Object.keys(direct.services).sort(), ["postgres", "redis"]);
});

test("Redis adopts the existing data volume without creating or owning a replacement", { skip }, () => {
  const config = configuration();
  assert.deepEqual(config.volumes.dabboba_redis_data, {
    name: "local_dabboba_redis_data",
    external: true,
  });
  assert.equal(config.services.redis.volumes.length, 1);
  assert.equal(config.services.redis.volumes[0].type, "volume");
  assert.equal(config.services.redis.volumes[0].source, "dabboba_redis_data");
  assert.equal(config.services.redis.volumes[0].target, "/data");
});

test("PostgreSQL retains its existing PG17 volume and local services retain loopback ports", { skip }, () => {
  const config = configuration();
  assert.equal(config.volumes.dabboba_postgres17_pgmq_data.name,
    "dabboba-local_dabboba_postgres17_pgmq_data");
  assert.equal(config.services.postgres.volumes[0].source, "dabboba_postgres17_pgmq_data");
  assert.equal(config.services.postgres.volumes[0].target, "/var/lib/postgresql/data");
  assert.equal(Object.keys(config.volumes).length, 2);
  for (const [service, published, target] of [
    ["postgres", "55433", 5432],
    ["redis", "56380", 6379],
  ]) {
    assert.equal(config.services[service].ports.length, 1);
    const port = config.services[service].ports[0];
    assert.equal(port.host_ip, "127.0.0.1");
    assert.equal(port.published, published);
    assert.equal(port.target, target);
    assert.equal(port.protocol, "tcp");
  }
});
