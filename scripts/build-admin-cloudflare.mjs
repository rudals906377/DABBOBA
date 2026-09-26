import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const admin = join(root, "apps/admin");
const environmentFiles = [join(root, ".env"), join(admin, ".env.local")];
const output = join(admin, ".open-next");

for (const path of environmentFiles) {
  if (existsSync(`${path}.admin-build-hold`)) {
    throw new Error("Admin build hold file exists; restore it manually before trying again");
  }
}

const privateValues = environmentFiles.flatMap((path) => existsSync(path)
  ? [...readFileSync(path, "utf8").matchAll(/^[A-Z][A-Z0-9_]*=(.*)$/gm)]
    .filter((match) => /(?:SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL|DATABASE_URL)/.test(match[1]))
    .map((match) => match[2]?.trim())
    .filter((value) => value && value.length >= 16)
  : []);

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

function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) inspect(path);
    if (!entry.isFile()) continue;
    const bytes = readFileSync(path);
    if (privateValues.some((value) => bytes.includes(Buffer.from(value)))) {
      throw new Error(`Admin Cloudflare artifact contains a local setting: ${path.slice(root.length + 1)}`);
    }
    if (bytes.includes(Buffer.from("127.0.0.1:8788")) || bytes.includes(Buffer.from("yxkmvgfruphgghowzvmo"))) {
      throw new Error(`Admin Cloudflare artifact contains a local or retired API target: ${path.slice(root.length + 1)}`);
    }
  }
}

inspect(output);
process.stdout.write("Admin Cloudflare artifact passed local-secret and API-target checks.\n");
