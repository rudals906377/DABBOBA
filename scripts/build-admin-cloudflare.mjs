import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const admin = join(root, "apps/admin");
const environmentFiles = [join(root, ".env"), join(admin, ".env.local")];
const output = join(admin, ".open-next");

const PRIVATE_KEY_PATTERN = /(?:SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL|DATABASE_URL)/;
const MIN_PRIVATE_VALUE_LENGTH = 16;
export const FORBIDDEN_API_TARGETS = Object.freeze(["127.0.0.1:8788", "yxkmvgfruphgghowzvmo"]);

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Returns the values of every dotenv assignment whose KEY looks private
 * (SECRET, PASSWORD, TOKEN, KEY, CREDENTIAL, DATABASE_URL) and whose value is
 * long enough to identify a leak. The key, not the value, decides privacy.
 */
export function collectPrivateValues(text) {
  const values = [];
  for (const match of String(text).matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) {
    const [, key, rawValue] = match;
    if (!PRIVATE_KEY_PATTERN.test(key)) continue;
    const value = unquote(rawValue ?? "");
    if (value.length >= MIN_PRIVATE_VALUE_LENGTH && !values.includes(value)) values.push(value);
  }
  return values;
}

/**
 * Throws when the artifact contains any private value as an exact substring, or
 * a local/retired API target. `artifact` may be a Buffer or a string.
 */
export function inspectArtifact(artifact, privateValues, label = "artifact") {
  const bytes = Buffer.isBuffer(artifact) ? artifact : Buffer.from(String(artifact), "utf8");
  for (const value of privateValues) {
    if (typeof value === "string" && value.length > 0 && bytes.includes(Buffer.from(value, "utf8"))) {
      throw new Error(`Admin Cloudflare artifact contains a local setting: ${label}`);
    }
  }
  for (const target of FORBIDDEN_API_TARGETS) {
    if (bytes.includes(Buffer.from(target, "utf8"))) {
      throw new Error(`Admin Cloudflare artifact contains a local or retired API target: ${label}`);
    }
  }
}

export function inspectArtifactDirectory(directory, privateValues, baseDirectory = directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      inspectArtifactDirectory(path, privateValues, baseDirectory);
      continue;
    }
    if (!entry.isFile()) continue;
    inspectArtifact(readFileSync(path), privateValues, path.slice(baseDirectory.length + 1));
  }
}

function buildAdminCloudflare() {
  for (const path of environmentFiles) {
    if (existsSync(`${path}.admin-build-hold`)) {
      throw new Error("Admin build hold file exists; restore it manually before trying again");
    }
  }

  const privateValues = environmentFiles.flatMap((path) => (
    existsSync(path) ? collectPrivateValues(readFileSync(path, "utf8")) : []
  ));

  const held = [];
  try {
    for (const path of environmentFiles) {
      if (existsSync(path)) {
        renameSync(path, `${path}.admin-build-hold`);
        held.push(path);
      }
    }
    const build = spawnSync("corepack", ["pnpm", "--filter", "@dabboba/admin", "exec", "opennextjs-cloudflare", "build"], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, DABBOBA_API_URL: "", ADMIN_PROXY_IDENTITY_SECRET: "" },
    });
    if (build.status !== 0) throw new Error("Admin Cloudflare build failed");
  } finally {
    for (const path of held.reverse()) renameSync(`${path}.admin-build-hold`, path);
  }

  inspectArtifactDirectory(output, privateValues, root);
  process.stdout.write("Admin Cloudflare artifact passed local-secret and API-target checks.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAdminCloudflare();
}
