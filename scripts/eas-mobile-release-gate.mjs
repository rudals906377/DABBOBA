import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export const RELEASE_PROFILE_CAPABILITIES = Object.freeze({
  "production-prelaunch": "PRELAUNCH",
  "production-live": "LIVE",
  "pg-review": "LIVE",
});

const NON_RELEASE_PROFILES = new Set(["preview"]);
const PG_REVIEW_PROFILES = new Set(["pg-review"]);

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function planEasMobileReleaseGate({
  environment = process.env,
  rootDir = repositoryRoot,
} = {}) {
  if (environment.EAS_BUILD !== "true") {
    return {
      skipped: true,
      reason: "not-eas-build",
      commands: [],
    };
  }

  if (!nonEmpty(environment.EAS_BUILD_ID)) {
    throw new Error("EAS_BUILD_ID is required during an EAS Build");
  }

  const profile = environment.EAS_BUILD_PROFILE?.trim();
  if (!profile) {
    throw new Error("EAS_BUILD_PROFILE is required during an EAS Build");
  }
  if (NON_RELEASE_PROFILES.has(profile)) {
    return {
      skipped: true,
      reason: "non-release-profile",
      profile,
      commands: [],
    };
  }

  const expectedCapability = RELEASE_PROFILE_CAPABILITIES[profile];
  if (!expectedCapability) {
    throw new Error(`Unapproved EAS build profile: ${profile}`);
  }

  const actualCapability = environment.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim();
  if (actualCapability !== expectedCapability) {
    throw new Error(
      `EAS profile ${profile} requires EXPO_PUBLIC_COMMERCE_CAPABILITY=${expectedCapability}; received ${actualCapability || "unset"}`,
    );
  }

  const resolvedRoot = path.resolve(rootDir);
  const releaseConfigArgs = ["scripts/check-mobile-release-config.mjs"];
  if (PG_REVIEW_PROFILES.has(profile)) releaseConfigArgs.push("--pg-review");
  return {
    skipped: false,
    profile,
    expectedCapability,
    commands: [
      {
        label: "mobile release configuration",
        command: process.execPath,
        args: releaseConfigArgs,
        cwd: resolvedRoot,
      },
      {
        label: "mobile production bundle",
        command: process.execPath,
        args: ["scripts/check-mobile-production-bundle.mjs"],
        cwd: resolvedRoot,
      },
    ],
  };
}

export function runEasMobileReleaseGate({
  environment = process.env,
  rootDir = repositoryRoot,
  runner = spawnSync,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const plan = planEasMobileReleaseGate({ environment, rootDir });
  if (plan.skipped) {
    log(
      plan.reason === "not-eas-build"
        ? "Skipping mobile release gate outside EAS Build."
        : `Skipping mobile release gate for non-release profile ${plan.profile}.`,
    );
    return plan;
  }

  for (const step of plan.commands) {
    log(`Running ${step.label} gate for ${plan.profile}...`);
    const result = runner(step.command, step.args, {
      cwd: step.cwd,
      env: environment,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${step.label} gate failed with exit code ${result.status ?? "unknown"}`);
    }
  }

  log(`EAS mobile release gates passed for ${plan.profile}.`);
  return plan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runEasMobileReleaseGate();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "EAS mobile release gate failed"}\n`);
    process.exitCode = 1;
  }
}
