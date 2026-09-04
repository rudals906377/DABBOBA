import { fileURLToPath } from "node:url";
import { loadMigrationConfig } from "@dabboba/config";
import { createMigrationDatabasePool } from "./index.js";
import { provisionWorkerDatabaseRole } from "./role-provisioning.js";

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
  const argumentsWithoutSeparator = process.argv.slice(2).filter((value) => value !== "--");
  if (argumentsWithoutSeparator.length !== 1 || argumentsWithoutSeparator[0] !== "--password-stdin") {
    throw new Error("Usage: provision-worker-role --password-stdin");
  }
  const config = loadMigrationConfig();
  const password = await readPasswordFromStdin();
  const pool = createMigrationDatabasePool(config.databaseUrl, "dabboba-provision-worker-role");
  try {
    await provisionWorkerDatabaseRole(pool, password);
    process.stdout.write("Worker database role login is configured.\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
