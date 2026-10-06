import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertMigrationTargetAllowed,
  assertNoTransactionStatements,
  RETIRED_MIGRATION_TARGETS,
  supabaseProjectRefFromDatabaseUrl,
  isNoTransactionMigration,
  MIGRATION_LOCK_RETRIES,
  MIGRATION_LOCK_TIMEOUT,
  NO_TRANSACTION_HEADER,
  RENUMBERED_MIGRATIONS,
  renumberedMigrationRenames,
  runNoTransactionMigration,
  runTransactionalMigration,
  splitSqlStatements,
} from "./migrate.js";

function lockError(): Error & { code: string } {
  return Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
}

test("the no-transaction header is recognized only as the exact first line", () => {
  assert.equal(NO_TRANSACTION_HEADER, "-- dabboba:no-transaction");
  assert.equal(isNoTransactionMigration("-- dabboba:no-transaction\nCREATE INDEX x;"), true);
  assert.equal(isNoTransactionMigration("﻿-- dabboba:no-transaction  \r\nSELECT 1;"), true);
  assert.equal(isNoTransactionMigration("-- note\n-- dabboba:no-transaction\n"), false);
  assert.equal(isNoTransactionMigration("-- dabboba:no-transaction-please\n"), false);
  assert.equal(isNoTransactionMigration("SELECT 1; -- dabboba:no-transaction"), false);
});

test("no-transaction SQL is split into individual statements outside comments and quotes", () => {
  assert.deepEqual(splitSqlStatements(`-- dabboba:no-transaction
-- a comment; with a semicolon
CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx
ON public.orders (created_at)
WHERE status = 'A;B';
/* block; comment */
DROP INDEX CONCURRENTLY IF EXISTS public.b_idx;
`), [
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON public.orders (created_at) WHERE status = 'A;B'",
    "DROP INDEX CONCURRENTLY IF EXISTS public.b_idx",
  ]);
  assert.throws(() => splitSqlStatements("DO $$ BEGIN END $$;"), /Dollar-quoted/);
  assert.throws(() => splitSqlStatements("SELECT 'open"), /Unterminated/);
});

test("no-transaction migrations may contain only idempotent concurrent index statements", () => {
  assert.doesNotThrow(() => assertNoTransactionStatements("ok.sql", [
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON public.orders (created_at)",
    "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS b_idx ON public.orders (id)",
    "DROP INDEX CONCURRENTLY IF EXISTS public.c_idx",
  ]));
  for (const statement of [
    "CREATE INDEX CONCURRENTLY a_idx ON public.orders (created_at)",
    "CREATE INDEX IF NOT EXISTS a_idx ON public.orders (created_at)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON private.orders (created_at)",
    "ALTER TABLE public.orders ADD COLUMN x integer",
    "GRANT SELECT ON public.orders TO anon",
  ]) {
    assert.throws(() => assertNoTransactionStatements("bad.sql", [statement]), /only idempotent concurrent index/);
  }
  assert.throws(() => assertNoTransactionStatements("empty.sql", []), /no statements/);
});

test("a transactional migration sets a bounded lock timeout and retries lock_not_available", async () => {
  const queries: string[] = [];
  const sleeps: number[] = [];
  let attempts = 0;
  const client = { async query(sql: string) { queries.push(sql); return { rowCount: 0, rows: [] }; } };
  await runTransactionalMigration(client as never, async () => {
    attempts += 1;
    queries.push("work");
    if (attempts < 3) throw lockError();
  }, { sleep: async (ms) => { sleeps.push(ms); } });

  assert.equal(MIGRATION_LOCK_TIMEOUT, "5s");
  assert.equal(MIGRATION_LOCK_RETRIES, 3);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [1_000, 2_000]);
  assert.deepEqual(queries, [
    "BEGIN", "SET LOCAL lock_timeout = '5s'", "work", "ROLLBACK",
    "BEGIN", "SET LOCAL lock_timeout = '5s'", "work", "ROLLBACK",
    "BEGIN", "SET LOCAL lock_timeout = '5s'", "work", "COMMIT",
  ]);
});

test("a transactional migration gives up after three lock retries and never retries other errors", async () => {
  const client = { async query() { return { rowCount: 0, rows: [] }; } };
  let attempts = 0;
  await assert.rejects(
    runTransactionalMigration(client as never, async () => {
      attempts += 1;
      throw lockError();
    }, { sleep: async () => undefined }),
    /lock timeout/,
  );
  assert.equal(attempts, 1 + MIGRATION_LOCK_RETRIES);

  let other = 0;
  await assert.rejects(
    runTransactionalMigration(client as never, async () => {
      other += 1;
      throw Object.assign(new Error("syntax"), { code: "42601" });
    }, { sleep: async () => undefined }),
    /syntax/,
  );
  assert.equal(other, 1);
});

test("a no-transaction migration drops invalid leftovers, runs statements separately and records its checksum", async () => {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  let invalidChecks = 0;
  const client = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes("indisvalid")) {
        invalidChecks += 1;
        return { rowCount: 1, rows: invalidChecks === 1 ? [{ name: "b_idx" }] : [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  await runNoTransactionMigration(client as never, {
    file: "9999_test.sql",
    checksum: "abc",
    sql: `-- dabboba:no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON public.orders (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS b_idx ON public.orders (id);
`,
  });
  const statements = queries.map(({ sql }) => sql.includes("indisvalid") ? "check" : sql);
  assert.deepEqual(statements, [
    "check",
    "DROP INDEX CONCURRENTLY IF EXISTS public.b_idx",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON public.orders (created_at)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS b_idx ON public.orders (id)",
    "check",
    "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
  ]);
  assert.deepEqual(queries[0]?.params, [["a_idx", "b_idx"]]);
  assert.deepEqual(queries.at(-1)?.params, ["9999_test.sql", "abc"]);
  assert.equal(statements.includes("BEGIN"), false);
});

test("a no-transaction migration is not recorded while an index remains invalid", async () => {
  const recorded: string[] = [];
  const client = {
    async query(sql: string) {
      if (sql.includes("indisvalid")) return { rowCount: 1, rows: [{ name: "a_idx" }] };
      if (sql.startsWith("INSERT INTO schema_migrations")) recorded.push(sql);
      return { rowCount: 0, rows: [] };
    },
  };
  await assert.rejects(
    runNoTransactionMigration(client as never, {
      file: "9999_test.sql",
      checksum: "abc",
      sql: "-- dabboba:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON public.orders (id);\n",
    }),
    /left invalid indexes: a_idx/,
  );
  assert.deepEqual(recorded, []);
});

test("every committed no-transaction migration satisfies the statement allow-list", async () => {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  const noTransaction: string[] = [];
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    if (!isNoTransactionMigration(sql)) {
      assert.doesNotMatch(sql, /\bCONCURRENTLY\b/i, `${file} uses CONCURRENTLY inside a transaction`);
      continue;
    }
    noTransaction.push(file);
    assert.doesNotThrow(() => assertNoTransactionStatements(file, splitSqlStatements(sql)));
  }
  assert.deepEqual(noTransaction, ["0078_commerce_indexes.sql", "0080_retention_indexes.sql"]);
});

test("the migration runner refuses to apply 0067+ to the retired demo project", () => {
  assert.deepEqual(RETIRED_MIGRATION_TARGETS, [{ projectRef: "yxkmvgfruphgghowzvmo", firstBlockedMigration: "0067" }]);
  const pooler = "postgresql://postgres.yxkmvgfruphgghowzvmo:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres";
  const direct = "postgresql://postgres:x@db.yxkmvgfruphgghowzvmo.supabase.co:5432/postgres";
  assert.equal(supabaseProjectRefFromDatabaseUrl(pooler), "yxkmvgfruphgghowzvmo");
  assert.equal(supabaseProjectRefFromDatabaseUrl(direct), "yxkmvgfruphgghowzvmo");
  assert.equal(supabaseProjectRefFromDatabaseUrl("postgresql://dabboba:x@127.0.0.1:55433/dabboba"), null);
  assert.throws(
    () => assertMigrationTargetAllowed("yxkmvgfruphgghowzvmo", ["0066_a.sql", "0078_commerce_indexes.sql"]),
    /Refusing to migrate retired Supabase project yxkmvgfruphgghowzvmo/,
  );
  assert.doesNotThrow(() => assertMigrationTargetAllowed("yxkmvgfruphgghowzvmo", ["0066_a.sql"]));
  assert.doesNotThrow(() => assertMigrationTargetAllowed("yxkmvgfruphgghowzvmo", []));
  assert.doesNotThrow(() => assertMigrationTargetAllowed("rconfxsykttfvznakile", ["0080_retention_indexes.sql"]));
  assert.doesNotThrow(() => assertMigrationTargetAllowed(null, ["0080_retention_indexes.sql"]));
});

test("a renumbered migration already applied under its previous name is renamed, never re-run", () => {
  const renumbered = [{ file: "0084_new.sql", previousFile: "0082_old.sql" }];
  const disk = new Map([["0082_other.sql", "a"], ["0084_new.sql", "same"]]);
  assert.deepEqual(renumberedMigrationRenames(disk, new Map([["0082_old.sql", "same"]]), renumbered), renumbered);
  // Fresh databases and databases that already use the new name do nothing.
  assert.deepEqual(renumberedMigrationRenames(disk, new Map(), renumbered), []);
  assert.deepEqual(renumberedMigrationRenames(disk, new Map([["0084_new.sql", "same"]]), renumbered), []);
  assert.throws(
    () => renumberedMigrationRenames(disk, new Map([["0082_old.sql", "changed"]]), renumbered),
    /checksum mismatch: 0082_old\.sql/,
  );
  assert.throws(
    () => renumberedMigrationRenames(disk, new Map([["0082_old.sql", "same"], ["0084_new.sql", "same"]]), renumbered),
    /recorded under both/,
  );
  assert.throws(
    () => renumberedMigrationRenames(new Map([...disk, ["0082_old.sql", "same"]]), new Map(), renumbered),
    /must not remain on disk/,
  );
});

test("every renumbered migration exists on disk only under its new name", async () => {
  const files = new Set(await readdir(new URL("../migrations/", import.meta.url)));
  for (const entry of RENUMBERED_MIGRATIONS) {
    assert.equal(files.has(entry.file), true, entry.file);
    assert.equal(files.has(entry.previousFile), false, entry.previousFile);
    assert.equal(entry.file.slice(5), entry.previousFile.slice(5), "only the number may change");
  }
});
