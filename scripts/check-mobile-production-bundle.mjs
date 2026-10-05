import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMobileArtifactConfig } from "./verify-mobile-artifact-config.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const bundleExtensions = new Set([".js", ".json", ".html", ".hbc", ".bundle", ".jsbundle"]);

const forbiddenMarkers = Object.freeze([
  { code: "TEST_PAYMENT", pattern: /TEST_PG/ },
  { code: "DEMO_SESSION", pattern: /\/v1\/demo\/(?:capabilities|session|payments)/ },
  { code: "MOBILE_TEST_FIXTURE", pattern: /MOBILE_TEST_FIXTURE|mobile-test-account/i },
  { code: "LOOPBACK_HOST", pattern: /(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?/i },
  { code: "PREVIEW_ROUTE", pattern: /\/draw\/preview(?:\/|\\\/)/ },
]);

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const candidate = path.join(directory, entry);
    return statSync(candidate).isDirectory() ? walk(candidate) : [candidate];
  });
}

export function mobileProductionExportInvocation({
  platform,
  outputDirectory,
  rootDir = repositoryRoot,
}) {
  if (!new Set(["ios", "android"]).has(platform)) {
    throw new Error(`Unsupported mobile export platform: ${platform}`);
  }
  return {
    command: "corepack",
    args: [
      "pnpm",
      "exec",
      "expo",
      "export",
      "--platform",
      platform,
      "--output-dir",
      outputDirectory,
      "--clear",
    ],
    cwd: path.join(rootDir, "apps", "mobile"),
  };
}

export function scanMobileProductionBundle(directory) {
  const issues = [];
  for (const file of walk(directory)) {
    if (!bundleExtensions.has(path.extname(file)) || file.endsWith(".map")) continue;
    const bytes = readFileSync(file);
    const isBytecode = path.extname(file) === ".hbc";
    // Hermes stores non-ASCII string-table entries as UTF-16LE, so a marker inside
    // Korean copy never appears as UTF-8 text. Scan both UTF-16 alignments too.
    const source = isBytecode
      ? [bytes.toString("utf8"), bytes.toString("utf16le"), bytes.subarray(1).toString("utf16le")].join("\n")
      : bytes.toString("utf8");
    for (const marker of forbiddenMarkers) {
      // Hermes embeds Expo/dev-library URL defaults in its string table. The
      // release config gate checks the actual API origin; here only a loopback
      // customer API route is actionable in bytecode.
      if (isBytecode && marker.code === "LOOPBACK_HOST") {
        if (/(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?\/v1\//i.test(source)) {
          issues.push({ code: marker.code, file: path.relative(directory, file) });
        }
        continue;
      }
      if (marker.pattern.test(source)) {
        issues.push({ code: marker.code, file: path.relative(directory, file) });
      }
    }
  }
  return [...new Map(issues.map((issue) => [`${issue.code}:${issue.file}`, issue])).values()];
}

function exportPlatform(platform, outputDirectory) {
  const invocation = mobileProductionExportInvocation({ platform, outputDirectory });
  const result = spawnSync(
    invocation.command,
    invocation.args,
    {
      cwd: invocation.cwd,
      env: {
        ...process.env,
        CI: "1",
        NODE_ENV: "production",
        EXPO_NO_DOTENV: "1",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(`Expo ${platform} production export failed${detail ? `: ${detail}` : ""}`);
  }
}

export async function verifyMobileProductionBundles({
  environment = process.env,
  exporter = exportPlatform,
  scanner = scanMobileProductionBundle,
  artifactVerifier = verifyMobileArtifactConfig,
} = {}) {
  const capability = environment.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim();
  if (capability !== "PRELAUNCH" && capability !== "LIVE") {
    throw new Error("EXPO_PUBLIC_COMMERCE_CAPABILITY must be PRELAUNCH or LIVE before bundle verification");
  }

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "dabboba-mobile-release-bundle-"));
  try {
    const issues = [];
    for (const platform of ["ios", "android"]) {
      const outputDirectory = path.join(temporaryRoot, platform);
      await exporter(platform, outputDirectory);
      issues.push(...scanner(outputDirectory).map((issue) => ({ ...issue, platform })));
      // The internal PG-review profile is deliberately a different test
      // project. Public release profiles must also prove exact compiled
      // public settings, rather than only absence of forbidden markers.
      if (environment.EAS_BUILD_PROFILE !== "pg-review") {
        const report = await artifactVerifier({ artifactPath: outputDirectory, platform, environment });
        if (report.status !== "pass") {
          for (const bundle of report.bundles) {
            issues.push(...bundle.errors.map(({ code }) => ({ code, platform, file: bundle.entry })));
          }
          if (!report.bundles.length || !issues.length) issues.push({ code: "ARTIFACT_CONFIG_FAILED", platform, file: "metadata.json" });
        }
      }
    }
    if (issues.length > 0) {
      const summary = issues.map((issue) => `${issue.platform}:${issue.code}:${issue.file}`).join("\n");
      throw new Error(`Production bundle contains forbidden release markers:\n${summary}`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await verifyMobileProductionBundles();
    process.stdout.write("iOS and Android production bundle gates passed; this is not device, signing or authentication proof.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Mobile production bundle verification failed"}\n`);
    process.exitCode = 1;
  }
}
