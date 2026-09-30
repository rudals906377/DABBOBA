import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_INTEGRATION_PROJECT_REF } from "./supabase-integration-profile.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const admin = join(root, "apps/admin");
const SUPABASE_CLI = "supabase@2.117.0";
const USAGE = "Usage: DABBOBA_FRIEND_CLOUDFLARE_XDG_CONFIG_HOME=<absolute directory> "
  + "DABBOBA_FRIEND_CLOUDFLARE_ACCOUNT_ID=<account id> DABBOBA_FRIEND_CLOUDFLARE_EMAIL=<owner email> "
  + "node scripts/provision-admin-edge-secrets.mjs --apply "
  + "[--cloudflare-account-id <id>] [--cloudflare-email <email>]";

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (typeof value !== "string" || value.startsWith("--")) throw new Error(`${name} requires a value.\n${USAGE}`);
  return value;
}

/**
 * The approved Cloudflare account and its owner email are operator inputs, not
 * repository constants: they come from flags or the environment.
 */
export function parseProvisionOptions(argv, env) {
  const known = new Set(["--apply", "--cloudflare-account-id", "--cloudflare-email"]);
  for (let index = 0; index < argv.length; index += 1) {
    if (!known.has(argv[index])) throw new Error(`Unknown argument: ${argv[index]}\n${USAGE}`);
    if (argv[index] !== "--apply") index += 1;
  }
  const cloudflareConfigHome = env.DABBOBA_FRIEND_CLOUDFLARE_XDG_CONFIG_HOME?.trim();
  const cloudflareAccountId = (argumentValue(argv, "--cloudflare-account-id")
    ?? env.DABBOBA_FRIEND_CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const cloudflareEmail = (argumentValue(argv, "--cloudflare-email")
    ?? env.DABBOBA_FRIEND_CLOUDFLARE_EMAIL ?? "").trim().toLowerCase();
  if (!argv.includes("--apply") || !cloudflareConfigHome?.startsWith("/")) throw new Error(USAGE);
  if (!/^[0-9a-f]{32}$/.test(cloudflareAccountId)) {
    throw new Error(`A 32-character hexadecimal Cloudflare account ID is required.\n${USAGE}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cloudflareEmail)) {
    throw new Error(`The approved Cloudflare owner email is required.\n${USAGE}`);
  }
  return { cloudflareConfigHome, cloudflareAccountId, cloudflareEmail };
}

/**
 * Writes KEY=value lines to a new file readable only by the current user in a
 * private temporary directory, so secrets never appear in process arguments.
 */
export function writePrivateEnvFile(entries, { parent = tmpdir() } = {}) {
  for (const [key, value] of entries) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(value)) {
      throw new Error("Secret env-file entries must be single-line KEY=value pairs.");
    }
  }
  const directory = mkdtempSync(join(parent, "dabboba-admin-secrets-"));
  const file = join(directory, "secrets.env");
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeFileSync(descriptor, `${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return { file, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function spawnRun(command, args, { cwd = root, env = process.env, input } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env: { ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", () => { /* Do not echo provider diagnostics that may contain secrets. */ });
    child.on("error", () => rejectRun(new Error(`${command} could not start`)));
    child.on("exit", (code) => code === 0 ? resolveRun(output) : rejectRun(new Error(`${command} operation failed`)));
    child.stdin.end(input);
  });
}

export async function setSupabaseAdminSecrets({
  run = spawnRun,
  projectRef = SUPABASE_INTEGRATION_PROJECT_REF,
  proxyIdentitySecret,
  serviceSecret,
  envFileParent,
}) {
  const envFile = writePrivateEnvFile([
    ["DABBOBA_ADMIN_ORIGINS", "https://admin.dabboba.net"],
    ["DABBOBA_ADMIN_EDGE_CLIENT_IP_HEADER", "cf-connecting-ip"],
    ["DABBOBA_ADMIN_PROXY_IDENTITY_SECRET", proxyIdentitySecret],
    ["DABBOBA_ADMIN_SERVICE_SECRET", serviceSecret],
  ], envFileParent ? { parent: envFileParent } : undefined);
  try {
    await run("npx", ["--yes", SUPABASE_CLI, "secrets", "set",
      "--env-file", envFile.file,
      "--project-ref", projectRef,
    ]);
  } finally {
    envFile.cleanup();
  }
}

export async function provisionAdminEdgeSecrets({
  argv = process.argv.slice(2),
  env = process.env,
  run = spawnRun,
  fetchImpl = globalThis.fetch,
  loadSigner = async () => (await import("../packages/config/dist/index.js")).signAdminServiceRequest,
  log = (message) => process.stdout.write(`${message}\n`),
  pause = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms)),
  envFileParent,
} = {}) {
  const { cloudflareConfigHome, cloudflareAccountId, cloudflareEmail } = parseProvisionOptions(argv, env);
  const projectRef = SUPABASE_INTEGRATION_PROJECT_REF;
  const cloudflareEnvironment = {
    ...env,
    XDG_CONFIG_HOME: cloudflareConfigHome,
    CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
  };

  const whoami = await run("corepack", ["pnpm", "--filter", "@dabboba/admin", "exec", "wrangler", "whoami"], {
    cwd: root,
    env: cloudflareEnvironment,
  });
  if (!whoami.includes(cloudflareAccountId) || !whoami.toLowerCase().includes(cloudflareEmail)) {
    throw new Error("Wrangler is not authenticated to the approved friend-owned Cloudflare account");
  }
  const projects = await run("npx", ["--yes", SUPABASE_CLI, "projects", "list", "--output", "json"]);
  if (!projects.includes(projectRef)) throw new Error("Supabase CLI cannot see the approved production project");

  const proxyIdentitySecret = randomBytes(48).toString("hex");
  const serviceSecret = randomBytes(48).toString("hex");
  await setSupabaseAdminSecrets({ run, projectRef, proxyIdentitySecret, serviceSecret, envFileParent });
  log("Supabase admin-only secrets configured.");

  for (const [name, value] of [
    ["ADMIN_PROXY_IDENTITY_SECRET", proxyIdentitySecret],
    ["DABBOBA_ADMIN_SERVICE_SECRET", serviceSecret],
  ]) {
    await run("corepack", ["pnpm", "exec", "wrangler", "secret", "put", name, "--name", "dabboba-admin"], {
      cwd: admin,
      env: cloudflareEnvironment,
      input: value,
    });
    log(`${name} configured on friend-owned Cloudflare Worker.`);
  }

  log("Admin Edge and BFF secrets are paired. Keep both services on the same generation when rotating.");
  log(`Admin service key ID: ${createHash("sha256").update(serviceSecret).digest("hex").slice(0, 12)}.`);

  const signAdminServiceRequest = await loadSigner();
  const smokeUrl = new URL(`https://${projectRef}.supabase.co/functions/v1/dabboba-admin-api/v1/admin/me`);
  const requestId = randomUUID();
  let smokeStatus = 0;
  let smokeCode = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetchImpl(smokeUrl, {
      method: "GET",
      headers: {
        "x-request-id": requestId,
        ...signAdminServiceRequest({
          secret: serviceSecret,
          method: "GET",
          path: "/v1/admin/me",
          requestId,
          authorization: null,
          reason: null,
          reasonEncoding: null,
          contentType: null,
          body: null,
        }),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    smokeStatus = response.status;
    smokeCode = result && typeof result === "object" && "error" in result ? result.error?.code : null;
    if (smokeStatus === 401) break;
    if (attempt < 7) await pause(3_000);
  }
  log(`Signed admin API smoke: HTTP ${smokeStatus}, ${smokeCode || "no-error-code"}.`);
  if (smokeStatus !== 401) throw new Error("Admin API did not reach the authenticated application surface after signing");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  provisionAdminEdgeSecrets().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Admin Edge secret provisioning failed."}\n`);
    process.exitCode = 1;
  });
}
