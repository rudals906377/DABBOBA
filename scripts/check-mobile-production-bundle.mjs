import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const textExtensions = new Set([".js", ".json", ".html"]);

const forbiddenMarkers = Object.freeze([
  { code: "TEST_PAYMENT", pattern: /\bTEST_PG\b/ },
  { code: "DEMO_SESSION", pattern: /\/v1\/demo\/(?:capabilities|session|payments)/ },
  { code: "MOBILE_TEST_FIXTURE", pattern: /MOBILE_TEST_FIXTURE|mobile-test-account/i },
  { code: "LOOPBACK_HOST", pattern: /(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?/i },
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
    if (!textExtensions.has(path.extname(file)) || file.endsWith(".map")) continue;
    const source = readFileSync(file, "utf8");
    for (const marker of forbiddenMarkers) {
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

export function verifyMobileProductionBundles() {
  const capability = process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim();
  if (capability !== "PRELAUNCH" && capability !== "LIVE") {
    throw new Error("EXPO_PUBLIC_COMMERCE_CAPABILITY must be PRELAUNCH or LIVE before bundle verification");
  }

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "dabboba-mobile-release-bundle-"));
  try {
    const issues = [];
    for (const platform of ["ios", "android"]) {
      const outputDirectory = path.join(temporaryRoot, platform);
      exportPlatform(platform, outputDirectory);
      issues.push(...scanMobileProductionBundle(outputDirectory).map((issue) => ({ ...issue, platform })));
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
    verifyMobileProductionBundles();
    process.stdout.write("iOS and Android production bundles contain no test payment, demo-session, fixture, or loopback markers.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Mobile production bundle verification failed"}\n`);
    process.exitCode = 1;
  }
}
