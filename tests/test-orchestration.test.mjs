import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the full verification builds, typechecks, and tests in deterministic phases", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(
    manifest.scripts["test:all"],
    /turbo run build && turbo run typecheck && turbo run test --concurrency=4/,
  );
});

test("the admin source security scan excludes generated dependency trees", () => {
  const source = readFileSync(
    new URL("../apps/admin/tests/security-boundaries.test.mjs", import.meta.url),
    "utf8",
  );
  for (const directory of [".next", ".turbo", "dist", "node_modules", "tests"]) {
    assert.match(source, new RegExp(`generatedDirectories[^;]+${directory.replace(".", "\\.")}`, "s"));
  }
});
