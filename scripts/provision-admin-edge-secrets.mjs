import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const admin = join(root, "apps/admin");
const projectRef = "rconfxsykttfvznakile";
const cloudflareAccountId = "e2e1645ee7006824232a8b657bd784f5";
const cloudflareConfigHome = process.env.DABBOBA_FRIEND_CLOUDFLARE_XDG_CONFIG_HOME;

if (process.argv[2] !== "--apply" || !cloudflareConfigHome?.startsWith("/")) {
  throw new Error("Usage: DABBOBA_FRIEND_CLOUDFLARE_XDG_CONFIG_HOME=<absolute directory> node scripts/provision-admin-edge-secrets.mjs --apply");
}

function run(command, args, { cwd = root, env = process.env, input } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env: { ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", () => { /* Do not echo command arguments or provider diagnostics containing secrets. */ });
    child.on("error", () => rejectRun(new Error(`${command} could not start`)));
    child.on("exit", (code) => code === 0 ? resolveRun(output) : rejectRun(new Error(`${command} operation failed`)));
    child.stdin.end(input);
  });
}

const cloudflareEnvironment = {
  ...process.env,
  XDG_CONFIG_HOME: cloudflareConfigHome,
  CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
};

const whoami = await run("corepack", ["pnpm", "--filter", "@dabboba/admin", "exec", "wrangler", "whoami"], {
  cwd: root,
  env: cloudflareEnvironment,
});
if (!whoami.includes(cloudflareAccountId) || !whoami.includes("lk7889@naver.com")) {
  throw new Error("Wrangler is not authenticated to the approved friend-owned Cloudflare account");
}
const projects = await run("npx", ["--yes", "supabase@2.117.0", "projects", "list", "--output", "json"]);
if (!projects.includes(projectRef)) throw new Error("Supabase CLI cannot see the approved production project");

const proxyIdentitySecret = randomBytes(48).toString("hex");
const serviceSecret = randomBytes(48).toString("hex");
await run("npx", ["--yes", "supabase@2.117.0", "secrets", "set",
  `DABBOBA_ADMIN_ORIGINS=https://admin.dabboba.net`,
  `DABBOBA_ADMIN_EDGE_CLIENT_IP_HEADER=cf-connecting-ip`,
  `DABBOBA_ADMIN_PROXY_IDENTITY_SECRET=${proxyIdentitySecret}`,
  `DABBOBA_ADMIN_SERVICE_SECRET=${serviceSecret}`,
  "--project-ref", projectRef,
]);
process.stdout.write("Supabase admin-only secrets configured.\n");

for (const [name, value] of [
  ["ADMIN_PROXY_IDENTITY_SECRET", proxyIdentitySecret],
  ["DABBOBA_ADMIN_SERVICE_SECRET", serviceSecret],
]) {
  await run("corepack", ["pnpm", "exec", "wrangler", "secret", "put", name, "--name", "dabboba-admin"], {
    cwd: admin,
    env: cloudflareEnvironment,
    input: value,
  });
  process.stdout.write(`${name} configured on friend-owned Cloudflare Worker.\n`);
}

process.stdout.write("Admin Edge and BFF secrets are paired. Keep both services on the same generation when rotating.\n");
process.stdout.write(`Admin service key ID: ${createHash("sha256").update(serviceSecret).digest("hex").slice(0, 12)}.\n`);

const { signAdminServiceRequest } = await import("../packages/config/dist/index.js");
const smokeUrl = new URL(`https://${projectRef}.supabase.co/functions/v1/dabboba-admin-api/v1/admin/me`);
const requestId = randomUUID();
let smokeStatus = 0;
let smokeCode = null;
for (let attempt = 0; attempt < 8; attempt += 1) {
  const response = await fetch(smokeUrl, {
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
  if (attempt < 7) await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
}
process.stdout.write(`Signed admin API smoke: HTTP ${smokeStatus}, ${smokeCode || "no-error-code"}.\n`);
if (smokeStatus !== 401) throw new Error("Admin API did not reach the authenticated application surface after signing");
