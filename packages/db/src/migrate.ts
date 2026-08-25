import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadApiConfig } from "@dabboba/config";
import { createDatabasePool, type DatabasePool } from "./index.js";

const MIGRATION_LOCK_ID = 7_922_024_082_400_001n;
const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function migrate(pool: DatabasePool): Promise<string[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  const applied: string[] = [];
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_ID.toString()]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [file],
      );
      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== checksum) {
          throw new Error(`Migration checksum mismatch: ${file}`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [file, checksum],
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_ID.toString()]).catch(() => undefined);
    client.release();
  }
  return applied;
}

async function main() {
  const config = loadApiConfig();
  const pool = createDatabasePool(config.databaseUrl, "dabboba-migrate");
  try {
    const applied = await migrate(pool);
    process.stdout.write(applied.length ? `Applied ${applied.length} migration(s).\n` : "Database schema is current.\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
