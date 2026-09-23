import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  planEasMobileReleaseGate,
  runEasMobileReleaseGate,
} from "../scripts/eas-mobile-release-gate.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("EAS profiles use Corepack's pinned package manager, select an Expo environment, and install the lifecycle gate", () => {
  const eas = JSON.parse(readFileSync(path.join(repositoryRoot, "apps/mobile/eas.json"), "utf8"));
  const rootPackage = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const mobilePackage = JSON.parse(readFileSync(path.join(repositoryRoot, "apps/mobile/package.json"), "utf8"));

  assert.deepEqual(eas.build.base, {
    node: "24.21.0",
    corepack: true,
  });
  assert.equal(rootPackage.packageManager, "pnpm@11.22.0");
  for (const [profile, environment, capability] of [
    ["preview", "preview", "PRELAUNCH"],
    ["pg-review", "preview", "LIVE"],
    ["production-prelaunch", "production", "PRELAUNCH"],
    ["production-live", "production", "LIVE"],
  ]) {
    assert.equal(eas.build[profile].extends, "base");
    assert.equal(eas.build[profile].environment, environment);
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_COMMERCE_CAPABILITY, capability);
  }
  assert.equal(
    mobilePackage.scripts["eas-build-post-install"],
    "node ../../scripts/eas-mobile-release-gate.mjs",
  );
});

test("release gate is inert outside an EAS Build", () => {
  const calls = [];
  const result = runEasMobileReleaseGate({
    environment: {
      EAS_BUILD_PROFILE: "production-prelaunch",
      EXPO_PUBLIC_COMMERCE_CAPABILITY: "PRELAUNCH",
    },
    runner: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
    log: () => {},
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "not-eas-build");
  assert.deepEqual(calls, []);
});

for (const [profile, capability, structureOnly] of [
  ["production-prelaunch", "PRELAUNCH", false],
  ["production-live", "LIVE", false],
  ["pg-review", "LIVE", true],
]) {
  test(`${profile} maps to ${capability} and runs both release gates from the repository root`, () => {
    const calls = [];
    const rootDir = "/workspace/dabboba-app";
    const environment = {
      EAS_BUILD: "true",
      EAS_BUILD_ID: "build-id",
      EAS_BUILD_PROFILE: profile,
      EXPO_PUBLIC_COMMERCE_CAPABILITY: capability,
    };

    const result = runEasMobileReleaseGate({
      environment,
      rootDir,
      runner: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0 };
      },
      log: () => {},
    });

    assert.equal(result.skipped, false);
    assert.equal(result.expectedCapability, capability);
    assert.deepEqual(calls.map(({ args }) => args), [
      [
        "scripts/check-mobile-release-config.mjs",
        ...(structureOnly ? ["--pg-review"] : []),
      ],
      ["scripts/check-mobile-production-bundle.mjs"],
    ]);
    assert.ok(calls.every(({ command }) => command === process.execPath));
    assert.ok(calls.every(({ options }) => options.cwd === path.resolve(rootDir)));
    assert.ok(calls.every(({ options }) => options.env === environment));
  });
}

test("release gate rejects a capability that does not match its EAS profile", () => {
  assert.throws(
    () => planEasMobileReleaseGate({
      environment: {
        EAS_BUILD_ID: "build-id",
        EAS_BUILD: "true",
        EAS_BUILD_PROFILE: "production-prelaunch",
        EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE",
      },
    }),
    /requires EXPO_PUBLIC_COMMERCE_CAPABILITY=PRELAUNCH/,
  );
});

test("release gate rejects unapproved EAS build profiles and fails closed on a gate error", () => {
  assert.throws(
    () => planEasMobileReleaseGate({
      environment: {
        EAS_BUILD_ID: "build-id",
        EAS_BUILD: "true",
        EAS_BUILD_PROFILE: "production",
      },
    }),
    /Unapproved EAS build profile/,
  );

  assert.throws(
    () => runEasMobileReleaseGate({
      environment: {
        EAS_BUILD: "true",
        EAS_BUILD_ID: "build-id",
        EAS_BUILD_PROFILE: "production-live",
        EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE",
      },
      runner: () => ({ status: 1 }),
      log: () => {},
    }),
    /gate failed with exit code 1/,
  );
});

test("preview remains an internal non-release profile", () => {
  const plan = planEasMobileReleaseGate({
    environment: {
      EAS_BUILD_ID: "build-id",
      EAS_BUILD: "true",
      EAS_BUILD_PROFILE: "preview",
      EXPO_PUBLIC_COMMERCE_CAPABILITY: "PRELAUNCH",
    },
  });

  assert.equal(plan.skipped, true);
  assert.equal(plan.reason, "non-release-profile");
  assert.deepEqual(plan.commands, []);
});

test("EAS Build fails closed when its built-in build identity is missing", () => {
  assert.throws(
    () => planEasMobileReleaseGate({
      environment: {
        EAS_BUILD: "true",
        EAS_BUILD_PROFILE: "production-prelaunch",
        EXPO_PUBLIC_COMMERCE_CAPABILITY: "PRELAUNCH",
      },
    }),
    /EAS_BUILD_ID is required/,
  );
});
