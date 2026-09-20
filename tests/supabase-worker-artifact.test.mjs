import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSupabaseWorker } from "../scripts/build-supabase-worker.mjs";

test("Supabase worker build produces one bounded Edge-safe bundle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dabboba-edge-artifact-test-"));
  const outputPath = join(directory, "worker.generated.js");
  try {
    const result = await buildSupabaseWorker(outputPath);
    const code = await readFile(outputPath, "utf8");
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.bytes, Buffer.byteLength(code, "utf8"));
    assert.ok(result.bytes > 0 && result.bytes <= 5 * 1024 * 1024);
    assert.ok(result.inputCount > 1);
    assert.ok(result.externalImports.every((specifier) => specifier.startsWith("node:")));
    assert.match(code, /createRequire as __dabbobaCreateRequire/);
    assert.match(code, /createSupabaseEdgeWorkerHandler/);
    assert.doesNotMatch(code, /@google-cloud\/storage|google-auth-library|gcp-metadata|gaxios|sharp/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
