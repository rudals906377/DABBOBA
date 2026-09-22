import { fileURLToPath } from "node:url";
import { loadMigrationConfig, type BackendEnvironmentTier } from "@dabboba/config";
import { databaseTargetIdentity } from "./check-release.js";
import { createMigrationDatabasePool, databaseConnectionConfig } from "./index.js";
import { provisionWorkerDatabaseRole } from "./role-provisioning.js";

type ProvisionWorkerRoleArguments = {
  allowExistingLoginRotation: boolean;
  expectedTargetHash: string | null;
};

const safeProvisioningErrors = new WeakSet<Error>();

function safeFailure(message: string): Error {
  const error = new Error(message);
  safeProvisioningErrors.add(error);
  return error;
}

export function safeProvisioningErrorMessage(error: unknown): string {
  return error instanceof Error && safeProvisioningErrors.has(error)
    ? error.message
    : "Worker database role provisioning failed; inspect the database state privately.";
}

export function parseProvisionWorkerRoleArguments(args: readonly string[]): ProvisionWorkerRoleArguments {
  const values = args.filter((value) => value !== "--");
  let passwordStdin = false;
  let allowExistingLoginRotation = false;
  let expectedTargetHash: string | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--password-stdin" && !passwordStdin) {
      passwordStdin = true;
      continue;
    }
    if (value === "--authorize-existing-login-rotation" && !allowExistingLoginRotation) {
      allowExistingLoginRotation = true;
      continue;
    }
    if (value === "--expected-target-hash" && expectedTargetHash === null) {
      const hash = values[index + 1];
      if (!hash || !/^[0-9a-f]{64}$/.test(hash)) {
        throw safeFailure("--expected-target-hash must be followed by 64 lowercase hexadecimal characters");
      }
      expectedTargetHash = hash;
      index += 1;
      continue;
    }
    throw safeFailure(
      "Usage: provision-worker-role --password-stdin [--expected-target-hash <sha256>] [--authorize-existing-login-rotation]",
    );
  }
  if (!passwordStdin) {
    throw safeFailure(
      "Usage: provision-worker-role --password-stdin [--expected-target-hash <sha256>] [--authorize-existing-login-rotation]",
    );
  }
  return { allowExistingLoginRotation, expectedTargetHash };
}

export function assertWorkerProvisioningTarget(
  databaseUrl: string,
  environmentTier: BackendEnvironmentTier | undefined,
  expectedTargetHash: string | null,
): void {
  const identity = databaseTargetIdentity(databaseUrl);
  if (!identity) throw safeFailure("Worker provisioning database target is not approved");

  if (!identity.requiresTls) {
    if (environmentTier !== "LOCAL" && environmentTier !== "TEST") {
      throw safeFailure("Loopback worker provisioning requires an explicit LOCAL or TEST tier");
    }
    if (expectedTargetHash && identity.hash !== expectedTargetHash) {
      throw safeFailure("Loopback worker provisioning target does not match the approved target hash");
    }
    return;
  }

  if (environmentTier !== "STAGING" && environmentTier !== "PRODUCTION") {
    throw safeFailure("Remote worker provisioning requires an explicit STAGING or PRODUCTION tier");
  }
  if (identity.poolerPort !== "5432") {
    throw safeFailure("Remote worker provisioning requires the Supabase Session pooler on port 5432");
  }
  if (!expectedTargetHash || identity.hash !== expectedTargetHash) {
    throw safeFailure("Remote worker provisioning target does not match the approved target hash");
  }
  const ssl = databaseConnectionConfig(databaseUrl).ssl;
  if (!ssl || typeof ssl !== "object" || ssl.rejectUnauthorized !== true) {
    throw safeFailure("Remote worker provisioning requires certificate-verified TLS");
  }
}

async function readPasswordFromStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.pause();
    };
    const finish = () => {
      cleanup();
      resolve(value.replace(/[\r\n]+$/, ""));
    };
    const onData = (chunk: string | Buffer) => {
      value += String(chunk);
      if (Buffer.byteLength(value, "utf8") > 1_024) {
        cleanup();
        reject(new Error("Worker database password input is too large"));
        return;
      }
      if (/[\r\n]/.test(value)) finish();
    };
    const onEnd = () => finish();
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}

async function main() {
  const args = parseProvisionWorkerRoleArguments(process.argv.slice(2));
  const config = loadMigrationConfig();
  assertWorkerProvisioningTarget(config.databaseUrl, config.environmentTier, args.expectedTargetHash);
  const password = await readPasswordFromStdin();
  const pool = createMigrationDatabasePool(config.databaseUrl, "dabboba-provision-worker-role");
  try {
    await provisionWorkerDatabaseRole(pool, password, {
      allowExistingLoginRotation: args.allowExistingLoginRotation,
    });
    process.stdout.write("Worker database role login is configured.\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeProvisioningErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
