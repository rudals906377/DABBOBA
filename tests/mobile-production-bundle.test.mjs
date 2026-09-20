import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  mobileProductionExportInvocation,
  scanMobileProductionBundle,
} from "../scripts/check-mobile-production-bundle.mjs";

async function fixture(files) {
  const directory = await mkdtemp(path.join(tmpdir(), "dabboba-bundle-scan-test-"));
  for (const [relativePath, source] of Object.entries(files)) {
    const file = path.join(directory, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
  }
  return directory;
}

test("production bundle scan accepts ordinary release output and ignores source maps", async () => {
  const directory = await fixture({
    "_expo/static/js/ios/release.js": "const capability='PRELAUNCH';",
    "_expo/static/js/ios/release.js.map": "TEST_PG http://127.0.0.1:8788/v1/demo/session",
  });
  try {
    assert.deepEqual(scanMobileProductionBundle(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production bundle scan rejects test payment, demo-session, fixture, and loopback markers", async () => {
  const directory = await fixture({
    "bundle.js": "TEST_PG /v1/demo/session MOBILE_TEST_FIXTURE http://localhost:8788 /draw/preview/product",
  });
  try {
    assert.deepEqual(
      new Set(scanMobileProductionBundle(directory).map((issue) => issue.code)),
      new Set(["TEST_PAYMENT", "DEMO_SESSION", "MOBILE_TEST_FIXTURE", "LOOPBACK_HOST", "PREVIEW_ROUTE"]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production export runs from the Expo app root rather than the monorepo root", () => {
  const invocation = mobileProductionExportInvocation({
    platform: "ios",
    outputDirectory: "/tmp/dabboba-ios-export",
    rootDir: "/workspace/dabboba-app",
  });

  assert.equal(invocation.command, "corepack");
  assert.equal(invocation.cwd, "/workspace/dabboba-app/apps/mobile");
  assert.deepEqual(invocation.args, [
    "pnpm",
    "exec",
    "expo",
    "export",
    "--platform",
    "ios",
    "--output-dir",
    "/tmp/dabboba-ios-export",
    "--clear",
  ]);
});
