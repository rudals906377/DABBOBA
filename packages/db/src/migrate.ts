import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadMigrationConfig } from "@dabboba/config";
import { createMigrationDatabasePool, type DatabaseClient, type DatabasePool } from "./index.js";

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

type MigrationClient = Pick<DatabaseClient, "query">;

/**
 * Migrations renumbered after a non-production database (staging) had already
 * applied them under an earlier file name. The SQL bytes are unchanged, so the
 * recorded checksum must match exactly; the runner then renames the record
 * instead of executing the SQL a second time. Production never recorded the
 * previous names.
 */
export const RENUMBERED_MIGRATIONS = Object.freeze([
  Object.freeze({
    file: "0084_portone_card_channel_binding.sql",
    previousFile: "0082_portone_card_channel_binding.sql",
  }),
]);

export type MigrationRename = { file: string; previousFile: string };

/**
 * Decides which renumbered migrations are already applied under their previous
 * name. Fails closed when the previous file still exists, when both names are
 * recorded, or when the recorded checksum differs from the renumbered bytes.
 */
export function renumberedMigrationRenames(
  diskChecksums: ReadonlyMap<string, string>,
  appliedChecksums: ReadonlyMap<string, string>,
  renumbered: readonly MigrationRename[] = RENUMBERED_MIGRATIONS,
): MigrationRename[] {
  const renames: MigrationRename[] = [];
  for (const entry of renumbered) {
    if (diskChecksums.has(entry.previousFile)) {
      throw new Error(`Renumbered migration ${entry.previousFile} must not remain on disk`);
    }
    const previousChecksum = appliedChecksums.get(entry.previousFile);
    if (previousChecksum === undefined) continue;
    if (appliedChecksums.has(entry.file)) {
      throw new Error(`Migration ${entry.file} is recorded under both ${entry.previousFile} and its new name`);
    }
    const checksum = diskChecksums.get(entry.file);
    if (checksum === undefined || previousChecksum !== checksum) {
      throw new Error(`Migration checksum mismatch: ${entry.previousFile} (renumbered to ${entry.file})`);
    }
    renames.push({ file: entry.file, previousFile: entry.previousFile });
  }
  return renames;
}

/**
 * A migration whose first line is exactly this header runs outside a
 * transaction, one statement at a time. It is still applied under the
 * migration advisory lock and recorded with its checksum only after every
 * statement succeeds. Only idempotent concurrent index statements are allowed
 * so that a retry after a partial failure converges instead of diverging.
 */
export const NO_TRANSACTION_HEADER = "-- dabboba:no-transaction";
/** Per-transaction bound on waiting for a table lock held by live traffic. */
export const MIGRATION_LOCK_TIMEOUT = "5s";
/** Retries after a lock_not_available (55P03) failure of a transactional migration. */
export const MIGRATION_LOCK_RETRIES = 3;
const LOCK_NOT_AVAILABLE = "55P03";

const NO_TRANSACTION_STATEMENT_PATTERNS = [
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+[a-z_][a-z0-9_]*\s+ON\s+(?:ONLY\s+)?public\.[a-z_][a-z0-9_]*\b/i,
  /^DROP\s+INDEX\s+CONCURRENTLY\s+IF\s+EXISTS\s+public\.[a-z_][a-z0-9_]*\s*$/i,
];

export function isNoTransactionMigration(sql: string): boolean {
  const firstLine = sql.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  return firstLine.trimEnd() === NO_TRANSACTION_HEADER;
}

/**
 * Split a no-transaction migration into individual statements. PostgreSQL runs
 * a multi-statement simple query as one implicit transaction, which CREATE
 * INDEX CONCURRENTLY rejects, so each statement must be sent separately.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", index);
      index = end === -1 ? sql.length : end + 1;
      if (current && !current.endsWith(" ")) current += " ";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) throw new Error("Unterminated block comment in no-transaction migration");
      index = end + 2;
      if (current && !current.endsWith(" ")) current += " ";
      continue;
    }
    if (char === "'" || char === "\"") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === char) {
          if (sql[end + 1] === char) {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      if (end >= sql.length) throw new Error("Unterminated quoted text in no-transaction migration");
      current += sql.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_]*\$/)?.[0];
      if (tag) throw new Error("Dollar-quoted bodies are not allowed in no-transaction migrations");
    }
    if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    // Collapse whitespace outside quoted text only, so literals keep meaning.
    if (/\s/.test(char)) {
      if (current && !current.endsWith(" ")) current += " ";
    } else {
      current += char;
    }
    index += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export function assertNoTransactionStatements(file: string, statements: string[]): void {
  if (!statements.length) throw new Error(`No-transaction migration ${file} has no statements`);
  for (const statement of statements) {
    if (!NO_TRANSACTION_STATEMENT_PATTERNS.some((pattern) => pattern.test(statement))) {
      throw new Error(
        `No-transaction migration ${file} may contain only idempotent concurrent index statements: ${statement.slice(0, 120)}`,
      );
    }
  }
}

function concurrentIndexNames(statements: string[]): string[] {
  return statements.flatMap((statement) => {
    const match = statement.match(
      /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s/i,
    );
    return match?.[1] ? [match[1].toLowerCase()] : [];
  });
}

function isLockNotAvailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === LOCK_NOT_AVAILABLE;
}

export type MigrationRetryOptions = {
  retries?: number;
  lockTimeout?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
};

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

/**
 * Run one transactional migration unit with a bounded lock wait. A lock
 * timeout rolls the whole unit back, so retrying it is safe.
 */
export async function runTransactionalMigration(
  client: MigrationClient,
  work: () => Promise<void>,
  options: MigrationRetryOptions = {},
): Promise<void> {
  const retries = options.retries ?? MIGRATION_LOCK_RETRIES;
  const lockTimeout = options.lockTimeout ?? MIGRATION_LOCK_TIMEOUT;
  if (!/^\d+(?:ms|s)$/.test(lockTimeout)) throw new Error("Migration lock timeout must be a duration literal");
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
      await work();
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK");
      if (!isLockNotAvailable(error) || attempt >= retries) throw error;
      options.onRetry?.(attempt + 1, error);
      await sleep(1_000 * (attempt + 1));
    }
  }
}

/**
 * Run a no-transaction migration one statement at a time. An interrupted
 * CREATE INDEX CONCURRENTLY leaves an INVALID index that IF NOT EXISTS would
 * otherwise skip forever, so drop those first and verify validity afterwards.
 */
export async function runNoTransactionMigration(
  client: MigrationClient,
  migration: Pick<MigrationFile, "file" | "sql" | "checksum">,
): Promise<void> {
  const statements = splitSqlStatements(migration.sql);
  assertNoTransactionStatements(migration.file, statements);
  const indexNames = concurrentIndexNames(statements);
  const invalidIndexes = async () => (await client.query<{ name: string }>(
    `SELECT index_class.relname AS name
       FROM pg_catalog.pg_index AS index_state
       JOIN pg_catalog.pg_class AS index_class ON index_class.oid=index_state.indexrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=index_class.relnamespace
      WHERE namespace.nspname='public'
        AND index_class.relname=ANY($1::text[])
        AND NOT index_state.indisvalid
      ORDER BY 1`,
    [indexNames],
  )).rows.map((row) => row.name);

  if (indexNames.length) {
    for (const name of await invalidIndexes()) {
      await client.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${name}`);
    }
  }
  for (const statement of statements) {
    await client.query(statement);
  }
  if (indexNames.length) {
    const stillInvalid = await invalidIndexes();
    if (stillInvalid.length) {
      throw new Error(`No-transaction migration ${migration.file} left invalid indexes: ${stillInvalid.join(", ")}`);
    }
  }
  await client.query(
    "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
    [migration.file, migration.checksum],
  );
}

/**
 * Retired Supabase schema targets (mirrors RETIRED_SUPABASE_MIGRATION_TARGETS in
 * scripts/supabase-integration-profile.mjs). The historical QA project must
 * never receive the 0067 project rebase or any later migration.
 */
export const RETIRED_MIGRATION_TARGETS = Object.freeze([
  Object.freeze({ projectRef: "yxkmvgfruphgghowzvmo", firstBlockedMigration: "0067" }),
]);

export function supabaseProjectRefFromDatabaseUrl(databaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const direct = hostname.match(/^db\.([a-z0-9]{20})\.supabase\.(?:co|com)$/);
  if (direct?.[1]) return direct[1];
  if (hostname.endsWith(".pooler.supabase.com")) {
    let username: string;
    try {
      username = decodeURIComponent(parsed.username);
    } catch {
      return null;
    }
    const reference = username.slice(username.lastIndexOf(".") + 1);
    return /^[a-z0-9]{20}$/.test(reference) ? reference : null;
  }
  return null;
}

export function assertMigrationTargetAllowed(projectRef: string | null, pendingFiles: string[]): void {
  const retired = RETIRED_MIGRATION_TARGETS.find((target) => target.projectRef === projectRef);
  if (!retired) return;
  const blocked = pendingFiles.filter((file) => file.slice(0, 4) >= retired.firstBlockedMigration).sort();
  if (blocked.length) {
    throw new Error(
      `Refusing to migrate retired Supabase project ${projectRef}: migrations from `
      + `${retired.firstBlockedMigration} onward (${blocked[0]}) belong only to the approved DABBOBA project`,
    );
  }
}

export type MigrateOptions = {
  /** Supabase project ref of the target, used to refuse retired projects. */
  targetProjectRef?: string | null;
};

function logLockRetry(attempt: number): void {
  process.stderr.write(
    `Migration lock wait exceeded ${MIGRATION_LOCK_TIMEOUT}; retry ${attempt}/${MIGRATION_LOCK_RETRIES}.\n`,
  );
}

export async function migrate(pool: DatabasePool, options: MigrateOptions = {}): Promise<string[]> {
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

    const sources = new Map<string, { sql: string; checksum: string }>();
    for (const file of files) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      sources.set(file, { sql, checksum: createHash("sha256").update(sql).digest("hex") });
    }
    const recorded = await client.query<{ version: string; checksum: string }>(
      "SELECT version,checksum FROM schema_migrations",
    );
    const appliedChecksums = new Map(recorded.rows.map((row) => [row.version, row.checksum]));
    const renames = renumberedMigrationRenames(
      new Map([...sources].map(([file, source]) => [file, source.checksum])),
      appliedChecksums,
    );
    for (const rename of renames) {
      const renamed = await client.query(
        "UPDATE schema_migrations SET version=$1 WHERE version=$2 AND checksum=$3",
        [rename.file, rename.previousFile, sources.get(rename.file)!.checksum],
      );
      if (renamed.rowCount !== 1) throw new Error(`Could not record renumbered migration ${rename.file}`);
      appliedChecksums.delete(rename.previousFile);
      appliedChecksums.set(rename.file, sources.get(rename.file)!.checksum);
      process.stderr.write(`Recorded already-applied ${rename.previousFile} as ${rename.file}.\n`);
    }

    const migrations: MigrationFile[] = [];
    for (const file of files) {
      const { sql, checksum } = sources.get(file)!;
      const existing = appliedChecksums.get(file);
      if (existing !== undefined && existing !== checksum) {
        throw new Error(`Migration checksum mismatch: ${file}`);
      }
      migrations.push({ file, sql, checksum, applied: existing !== undefined });
    }

    assertMigrationTargetAllowed(
      options.targetProjectRef ?? null,
      migrations.filter((migration) => !migration.applied).map((migration) => migration.file),
    );

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
        const pendingGroup = protectedMigrations.filter((candidate) => !candidate.applied);
        if (pendingGroup.some((candidate) => isNoTransactionMigration(candidate.sql))) {
          throw new Error("Worker queue security migrations must remain transactional");
        }
        await runTransactionalMigration(client, async () => {
          for (const protectedMigration of pendingGroup) {
            await client.query(protectedMigration.sql);
            await client.query(
              "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
              [protectedMigration.file, protectedMigration.checksum],
            );
          }
        }, { onRetry: logLockRetry });
        applied.push(...pendingGroup.map((candidate) => candidate.file));
        protectedGroupApplied = true;
        continue;
      }

      if (isNoTransactionMigration(migration.sql)) {
        await runNoTransactionMigration(client, migration);
        applied.push(migration.file);
        continue;
      }

      await runTransactionalMigration(client, async () => {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [migration.file, migration.checksum],
        );
      }, { onRetry: logLockRetry });
      applied.push(migration.file);
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
    const applied = await migrate(pool, {
      targetProjectRef: supabaseProjectRefFromDatabaseUrl(config.databaseUrl),
    });
    process.stdout.write(applied.length ? `Applied ${applied.length} migration(s).\n` : "Database schema is current.\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
