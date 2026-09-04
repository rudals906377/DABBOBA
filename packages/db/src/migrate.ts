import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadMigrationConfig } from "@dabboba/config";
import { createMigrationDatabasePool, type DatabasePool } from "./index.js";

const MIGRATION_LOCK_ID = 7_922_024_082_400_001n;
const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const WORKER_QUEUE_SECURITY_GROUP = [
  "0027_supabase_worker_queue.sql",
  "0028_harden_pgmq_public.sql",
  "0029_worker_database_role.sql",
  "0030_harden_pgmq_function_defaults.sql",
  "0031_enforce_worker_least_privilege.sql",
] as const;

type MigrationFile = {
  file: string;
  sql: string;
  checksum: string;
  applied: boolean;
};

export async function migrate(pool: DatabasePool): Promise<string[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  const applied: string[] = [];
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_ID.toString()]);
    const version = await client.query<{ server_version_num: string }>("SHOW server_version_num");
    const versionNumber = Number(version.rows[0]?.server_version_num);
    if (!Number.isInteger(versionNumber) || versionNumber < 170_000) {
      throw new Error(
        "DABBOBA migrations require PostgreSQL 17 or newer for the reviewed worker-role membership boundary",
      );
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrations: MigrationFile[] = [];
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
      }
      migrations.push({ file, sql, checksum, applied: Boolean(existing.rowCount) });
    }

    const protectedMigrations = migrations.filter((migration) => (
      WORKER_QUEUE_SECURITY_GROUP.includes(
        migration.file as (typeof WORKER_QUEUE_SECURITY_GROUP)[number],
      )
    ));
    if (protectedMigrations.length !== WORKER_QUEUE_SECURITY_GROUP.length) {
      throw new Error("Worker queue security migration group is incomplete");
    }
    const firstProtectedPending = protectedMigrations.findIndex((migration) => !migration.applied);
    if (
      firstProtectedPending !== -1
      && protectedMigrations.slice(firstProtectedPending).some((migration) => migration.applied)
    ) {
      throw new Error("Worker queue security migrations were applied out of order");
    }
    const protectedPending = new Set(
      protectedMigrations.filter((migration) => !migration.applied).map((migration) => migration.file),
    );
    let protectedGroupApplied = false;

    for (const migration of migrations) {
      if (migration.applied) continue;

      if (protectedPending.has(migration.file)) {
        if (protectedGroupApplied) continue;

        // Queue creation, API-role revocation, worker-role creation, and future
        // function hardening are one security transition. A fresh deployment
        // must never commit the temporary 0027 API queue grant by itself.
        await client.query("BEGIN");
        try {
          for (const protectedMigration of protectedMigrations.filter((candidate) => !candidate.applied)) {
            await client.query(protectedMigration.sql);
            await client.query(
              "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
              [protectedMigration.file, protectedMigration.checksum],
            );
            applied.push(protectedMigration.file);
          }
          await client.query("COMMIT");
          protectedGroupApplied = true;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [migration.file, migration.checksum],
        );
        await client.query("COMMIT");
        applied.push(migration.file);
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
  const config = loadMigrationConfig();
  const pool = createMigrationDatabasePool(config.databaseUrl);
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
