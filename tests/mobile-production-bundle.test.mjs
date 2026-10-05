import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  mobileProductionExportInvocation,
  scanMobileProductionBundle,
  verifyMobileProductionBundles,
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

test("public bundle gate checks actual compiled settings on both platforms and refuses stale output", async () => {
  const platforms = [];
  const environment = { EXPO_PUBLIC_COMMERCE_CAPABILITY: "PRELAUNCH" };
  await verifyMobileProductionBundles({ environment, exporter() {}, scanner() { return []; },
    async artifactVerifier(input) {
      platforms.push(input.platform);
      assert.equal(input.environment, environment);
      return { status: "pass", bundles: [] };
    },
  });
  assert.deepEqual(platforms, ["ios", "android"]);
  await assert.rejects(verifyMobileProductionBundles({ environment, exporter() {}, scanner() { return []; },
    async artifactVerifier(input) { return { status: "fail", bundles: [{ entry: "entry.hbc", errors: [{ code: "COMPILED_VALUE_MISSING" }] }] }; },
  }), /COMPILED_VALUE_MISSING/);
});

test("internal PG-review keeps its existing marker gate without falsely requiring the production project", async () => {
  let markersChecked = 0;
  await verifyMobileProductionBundles({
    environment: { EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE", EAS_BUILD_PROFILE: "pg-review" },
    exporter() {}, scanner() { markersChecked += 1; return []; },
    async artifactVerifier() { throw new Error("not a production artifact"); },
  });
  assert.equal(markersChecked, 2);
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

test("production bundle scan inspects Hermes and embedded native bundles", async () => {
  const directory = await fixture({
    "_expo/static/js/ios/entry.hbc": "TEST_PG /v1/demo/session http://localhost:8788/v1/orders",
    "android/main.jsbundle": "MOBILE_TEST_FIXTURE",
  });
  try {
    assert.deepEqual(
      new Set(scanMobileProductionBundle(directory).map((issue) => issue.code)),
      new Set(["TEST_PAYMENT", "DEMO_SESSION", "LOOPBACK_HOST", "MOBILE_TEST_FIXTURE"]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production bundle scan finds markers stored as UTF-16 in Hermes bytecode", async () => {
  // Hermes keeps non-ASCII strings as UTF-16LE; test both byte alignments.
  const utf16 = Buffer.from("TEST_PG · 실제 과금 없음", "utf16le");
  for (const prefix of [Buffer.alloc(0), Buffer.from([0x00])]) {
    const directory = await fixture({});
    try {
      await mkdir(path.join(directory, "_expo/static/js/ios"), { recursive: true });
      await writeFile(path.join(directory, "_expo/static/js/ios/entry.hbc"), Buffer.concat([Buffer.from([0xc6, 0x1f]), prefix, utf16]));
      assert.deepEqual(scanMobileProductionBundle(directory).map((issue) => issue.code), ["TEST_PAYMENT"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("production bundle scan accepts loopback rejection logic without a configured loopback URL", async () => {
  const directory = await fixture({
    "_expo/static/js/ios/entry.hbc": 'if (hostname === "localhost") throw new Error("Invalid API host");',
  });
  try {
    assert.deepEqual(scanMobileProductionBundle(directory), []);
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
