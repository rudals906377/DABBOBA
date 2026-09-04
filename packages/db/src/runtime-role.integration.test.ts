import assert from "node:assert/strict";
import test from "node:test";
import {
  createDatabasePool,
  createMigrationDatabasePool,
} from "./index.js";
import { RUNTIME_DATABASE_ROLE } from "./runtime-role.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const runtimeDatabaseUrl = process.env.DABBOBA_RUNTIME_TEST_DATABASE_URL;

test("runtime database role can operate app data but cannot administer the schema", {
  skip: !migrationDatabaseUrl || !runtimeDatabaseUrl,
}, async () => {
  const migrationPool = createMigrationDatabasePool(migrationDatabaseUrl!, "dabboba-role-audit-integration");
  const runtimePool = createDatabasePool(runtimeDatabaseUrl!, "dabboba-role-runtime-integration");

  try {
    const role = await migrationPool.query<{
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolreplication: boolean;
      rolsuper: boolean;
    }>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit,
              rolreplication, rolbypassrls, rolcanlogin
       FROM pg_roles WHERE rolname = $1`,
      [RUNTIME_DATABASE_ROLE],
    );
    assert.deepEqual(role.rows, [{
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: true,
      rolcanlogin: true,
    }]);

    const tableAccess = await migrationPool.query<{
      can_delete: boolean;
      can_insert: boolean;
      can_select: boolean;
      can_update: boolean;
      relname: string;
    }>(
      `SELECT relation.relname,
              has_table_privilege($1, relation.oid, 'SELECT') AS can_select,
              has_table_privilege($1, relation.oid, 'INSERT') AS can_insert,
              has_table_privilege($1, relation.oid, 'UPDATE') AS can_update,
              has_table_privilege($1, relation.oid, 'DELETE') AS can_delete
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
       ORDER BY relation.relname`,
      [RUNTIME_DATABASE_ROLE],
    );
    assert.equal(tableAccess.rows.filter((row) => row.can_select).length, 64);
    assert.equal(tableAccess.rows.filter((row) => row.can_insert).length, 65);
    assert.equal(tableAccess.rows.filter((row) => row.can_update).length, 40);
    assert.equal(tableAccess.rows.filter((row) => row.can_delete).length, 7);
    for (const exchangeBundleTable of ["exchange_listing_items", "exchange_offer_items"]) {
      assert.deepEqual(tableAccess.rows.find((row) => row.relname === exchangeBundleTable), {
        relname: exchangeBundleTable,
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      });
    }
    for (const deniedTable of ["admin_permissions", "schema_migrations"]) {
      assert.deepEqual(tableAccess.rows.find((row) => row.relname === deniedTable), {
        relname: deniedTable,
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      });
    }

    const schemaAccess = await migrationPool.query<{ can_create: boolean; can_use: boolean }>(
      `SELECT has_schema_privilege($1, 'public', 'USAGE') AS can_use,
              has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
      [RUNTIME_DATABASE_ROLE],
    );
    assert.deepEqual(schemaAccess.rows, [{ can_use: true, can_create: false }]);

    const functionAccess = await migrationPool.query<{ function_name: string }>(
      `SELECT function.proname AS function_name
       FROM pg_proc AS function
       JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname = 'public'
         AND has_function_privilege($1, function.oid, 'EXECUTE')
       ORDER BY function.proname`,
      [RUNTIME_DATABASE_ROLE],
    );
    assert.deepEqual(functionAccess.rows, [{
      function_name: "default_notification_preference_state",
    }]);

    const extensionFunctionAccess = await migrationPool.query<{
      can_compare_citext: boolean;
      security_definer_count: string;
    }>(
      `SELECT
         has_function_privilege(
           $1,
           'extensions.citext_eq(extensions.citext,extensions.citext)',
           'EXECUTE'
         ) AS can_compare_citext,
         (
           SELECT count(*)::text
           FROM pg_proc AS function
           JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
           WHERE namespace.nspname = 'extensions'
             AND function.prosecdef
             AND has_function_privilege($1, function.oid, 'EXECUTE')
         ) AS security_definer_count`,
      [RUNTIME_DATABASE_ROLE],
    );
    assert.deepEqual(extensionFunctionAccess.rows, [{
      can_compare_citext: true,
      security_definer_count: "0",
    }]);

    const sequenceAccess = await migrationPool.query<{
      can_select: boolean;
      can_update: boolean;
      can_use: boolean;
      relname: string;
    }>(
      `SELECT relation.relname,
              has_sequence_privilege($1, relation.oid, 'USAGE') AS can_use,
              has_sequence_privilege($1, relation.oid, 'SELECT') AS can_select,
              has_sequence_privilege($1, relation.oid, 'UPDATE') AS can_update
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public' AND relation.relkind = 'S'
       ORDER BY relation.relname`,
      [RUNTIME_DATABASE_ROLE],
    );
    assert.deepEqual(sequenceAccess.rows, [{
      relname: "kuji_room_entries_queue_sequence_seq",
      can_use: true,
      can_select: false,
      can_update: false,
    }]);

    const identity = await runtimePool.query<{ current_user: string }>("SELECT current_user");
    assert.equal(identity.rows[0]?.current_user, RUNTIME_DATABASE_ROLE);

    const runtimeClient = await runtimePool.connect();
    try {
      await runtimeClient.query("BEGIN");
      const email = `runtime-role-${Date.now()}@example.invalid`;
      const inserted = await runtimeClient.query<{ id: string }>(
        "INSERT INTO users (email, nickname) VALUES ($1, $2) RETURNING id",
        [email, "runtime-probe"],
      );
      const userId = inserted.rows[0]!.id;
      await runtimeClient.query("UPDATE users SET nickname = $2 WHERE id = $1", [userId, "runtime-updated"]);
      const profile = await runtimeClient.query<{ user_id: string }>(
        "SELECT user_id FROM user_profiles WHERE user_id = $1",
        [userId],
      );
      assert.equal(profile.rows[0]?.user_id, userId);
      await runtimeClient.query("ROLLBACK");
    } catch (error) {
      await runtimeClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      runtimeClient.release();
    }

    const expectDenied = async (sql: string) => {
      await assert.rejects(
        runtimePool.query(sql),
        (error: unknown) => typeof error === "object"
          && error !== null
          && "code" in error
          && (error as { code: string }).code === "42501",
      );
    };
    await expectDenied("SELECT * FROM schema_migrations LIMIT 1");
    await expectDenied("SELECT * FROM admin_permissions LIMIT 1");
    await expectDenied("CREATE TABLE runtime_role_must_not_create_tables (id integer)");
    await expectDenied("TRUNCATE TABLE users");
    await expectDenied("DELETE FROM users WHERE false");
    await expectDenied("CREATE ROLE runtime_role_must_not_create_roles");
    await expectDenied("SET ROLE pg_read_all_data");
  } finally {
    await Promise.all([migrationPool.end(), runtimePool.end()]);
  }
});
