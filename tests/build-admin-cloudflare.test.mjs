import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FORBIDDEN_API_TARGETS,
  collectPrivateValues,
  inspectArtifact,
  inspectArtifactDirectory,
} from "../scripts/build-admin-cloudflare.mjs";

const environmentFixture = [
  "# local admin settings",
  "DABBOBA_API_URL=https://api.example.test",
  "ADMIN_PROXY_IDENTITY_SECRET=proxy-identity-secret-value-0123456789",
  "DATABASE_PASSWORD=\"quoted-database-password-value\"",
  "SUPABASE_ACCESS_TOKEN='sbp_token_value_that_is_long_enough'",
  "DABBOBA_API_DATABASE_URL=postgresql://runtime:secret@runtime.example.test/postgres",
  "SHORT_SECRET=tiny",
  "ADMIN_ORIGINS=https://admin.example.test",
  "lowercase_secret=not-an-exported-dotenv-key-value",
].join("\n");

test("private values are selected by their KEY name, not by the value text", () => {
  const values = collectPrivateValues(environmentFixture);
  assert.deepEqual(values, [
    "proxy-identity-secret-value-0123456789",
    "quoted-database-password-value",
    "sbp_token_value_that_is_long_enough",
    "postgresql://runtime:secret@runtime.example.test/postgres",
  ]);
  assert.equal(values.includes("https://api.example.test"), false);
  assert.equal(values.includes("tiny"), false);
  assert.equal(values.includes("https://admin.example.test"), false);
});

test("an empty or key-free environment yields no private values", () => {
  assert.deepEqual(collectPrivateValues(""), []);
  assert.deepEqual(collectPrivateValues("DABBOBA_API_URL=https://api.example.test\nLOG_LEVEL=info\n"), []);
});

test("artifact inspection throws on an exact private value and passes clean output", () => {
  const privateValues = collectPrivateValues(environmentFixture);
  assert.throws(
    () => inspectArtifact("var config = { secret: \"proxy-identity-secret-value-0123456789\" };", privateValues, "server.js"),
    /contains a local setting: server\.js/,
  );
  assert.throws(
    () => inspectArtifact(Buffer.from("db=postgresql://runtime:secret@runtime.example.test/postgres"), privateValues, "env.js"),
    /contains a local setting: env\.js/,
  );
  assert.doesNotThrow(() => inspectArtifact("var config = { apiUrl: \"https://api.example.test\" };", privateValues, "clean.js"));
  assert.doesNotThrow(() => inspectArtifact("proxy-identity-secret-value", privateValues, "partial.js"));
});

test("artifact inspection still rejects local and retired API targets", () => {
  for (const target of FORBIDDEN_API_TARGETS) {
    assert.throws(
      () => inspectArtifact(`fetch("https://${target}/v1/admin/me")`, [], "worker.js"),
      /local or retired API target: worker\.js/,
    );
  }
});

test("artifact directory inspection reports the offending relative file path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dabboba-admin-artifact-"));
  try {
    const privateValues = collectPrivateValues(environmentFixture);
    await mkdir(join(directory, ".open-next/server"), { recursive: true });
    await writeFile(join(directory, ".open-next/server/clean.js"), "export const ok = true;\n");
    assert.doesNotThrow(() => inspectArtifactDirectory(join(directory, ".open-next"), privateValues, directory));

    await writeFile(join(directory, ".open-next/server/leak.js"), "const t = 'sbp_token_value_that_is_long_enough';\n");
    assert.throws(
      () => inspectArtifactDirectory(join(directory, ".open-next"), privateValues, directory),
      /contains a local setting: \.open-next\/server\/leak\.js/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
