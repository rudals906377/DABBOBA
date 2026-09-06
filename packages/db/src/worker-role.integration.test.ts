import assert from "node:assert/strict";
import test from "node:test";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  RUNTIME_DATABASE_ROLE,
  WORKER_DATABASE_ROLE,
} from "./index.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const runtimeDatabaseUrl = process.env.DABBOBA_RUNTIME_TEST_DATABASE_URL;
const workerDatabaseUrl = process.env.DABBOBA_WORKER_TEST_DATABASE_URL;

function isPrivilegeDenied(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code: string }).code === "42501";
}

test("API and worker database identities are isolated around pgmq", {
  skip: !migrationDatabaseUrl || !runtimeDatabaseUrl || !workerDatabaseUrl,
}, async () => {
  const migrationPool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-role-audit-integration",
  );
  const runtimePool = createDatabasePool(
    runtimeDatabaseUrl!,
    "dabboba-api-role-integration",
  );
  const workerPool = createDatabasePool(
    workerDatabaseUrl!,
    "dabboba-worker-role-integration",
    { expectedRole: WORKER_DATABASE_ROLE },
  );

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
      [WORKER_DATABASE_ROLE],
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

    const membership = await migrationPool.query<{ granted_role: string }>(
      `SELECT granted_role.rolname AS granted_role
       FROM pg_auth_members AS membership
       JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       WHERE member_role.rolname = $1`,
      [WORKER_DATABASE_ROLE],
    );
    assert.deepEqual(membership.rows, []);

    const reverseMembership = await migrationPool.query(
      `SELECT 1
       FROM pg_auth_members AS membership
       JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       WHERE granted_role.rolname = $1 AND member_role.rolname = $2`,
      [WORKER_DATABASE_ROLE, RUNTIME_DATABASE_ROLE],
    );
    assert.equal(reverseMembership.rowCount, 0);

    const identities = await Promise.all([
      runtimePool.query<{ current_user: string }>("SELECT current_user"),
      workerPool.query<{ current_user: string }>("SELECT current_user"),
    ]);
    assert.equal(identities[0].rows[0]?.current_user, RUNTIME_DATABASE_ROLE);
    assert.equal(identities[1].rows[0]?.current_user, WORKER_DATABASE_ROLE);

    const expectedTablePrivileges = new Map<string, Set<string>>([
      ["outbox_events", new Set(["select", "insert", "update"])],
      ["notifications", new Set(["select", "insert"])],
      ["notification_preferences", new Set(["select"])],
      ["orders", new Set(["select", "update"])],
      ["inquiries", new Set(["select"])],
      ["shipping_requests", new Set(["select"])],
      ["payments", new Set(["select", "update"])],
      ["stock_reservations", new Set(["select", "update"])],
      ["product_stock", new Set(["select", "update"])],
      ["coupon_redemptions", new Set(["select", "update"])],
      ["coupons", new Set(["select", "update"])],
      ["point_ledger_entries", new Set(["insert"])],
      ["point_accounts", new Set(["select", "update"])],
      ["kuji_room_entries", new Set(["select", "update"])],
      ["kuji_rooms", new Set(["select", "update"])],
      ["catalog_products", new Set(["select"])],
      ["draw_probability_versions", new Set(["select"])],
      ["draw_pool_entries", new Set(["select"])],
      ["kuji_decks", new Set(["select"])],
      ["media_assets", new Set(["select", "update"])],
      ["worker_dead_letters", new Set(["insert"])],
      ["worker_payment_reconciliations", new Set(["select", "insert", "update"])],
    ]);
    const publicAcl = await migrationPool.query<{
      relation_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
      can_references: boolean;
      can_trigger: boolean;
    }>(
      `SELECT relation.relname AS relation_name,
              has_table_privilege($1,relation.oid,'SELECT') AS can_select,
              has_table_privilege($1,relation.oid,'INSERT') AS can_insert,
              has_table_privilege($1,relation.oid,'UPDATE') AS can_update,
              has_table_privilege($1,relation.oid,'DELETE') AS can_delete,
              has_table_privilege($1,relation.oid,'TRUNCATE') AS can_truncate,
              has_table_privilege($1,relation.oid,'REFERENCES') AS can_references,
              has_table_privilege($1,relation.oid,'TRIGGER') AS can_trigger
         FROM pg_class AS relation
        WHERE relation.relnamespace=to_regnamespace('public')
          AND relation.relkind IN ('r','p','v','m','f')
        ORDER BY relation.relname`,
      [WORKER_DATABASE_ROLE],
    );
    for (const relation of publicAcl.rows) {
      const expected = expectedTablePrivileges.get(relation.relation_name) ?? new Set<string>();
      assert.deepEqual(
        new Set(
          [
            ["select", relation.can_select],
            ["insert", relation.can_insert],
            ["update", relation.can_update],
            ["delete", relation.can_delete],
            ["truncate", relation.can_truncate],
            ["references", relation.can_references],
            ["trigger", relation.can_trigger],
          ].filter((entry) => entry[1]).map((entry) => String(entry[0])),
        ),
        expected,
        `unexpected worker ACL on public.${relation.relation_name}`,
      );
      expectedTablePrivileges.delete(relation.relation_name);
    }
    assert.deepEqual([...expectedTablePrivileges.keys()], []);

    const publicSequenceAccess = await migrationPool.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM pg_class AS sequence
        WHERE sequence.relnamespace=to_regnamespace('public')
          AND sequence.relkind='S'
          AND CASE WHEN sequence.relkind='S' THEN
            has_sequence_privilege($1,sequence.oid,'USAGE,SELECT,UPDATE')
          ELSE false END`,
      [WORKER_DATABASE_ROLE],
    );
    assert.equal(publicSequenceAccess.rows[0]?.count, "0");
    const schemaAcl = await migrationPool.query<{
      public_usage: boolean;
      public_create: boolean;
      pgmq_usage: boolean;
      pgmq_create: boolean;
      extensions_usage: boolean;
    }>(
      `SELECT has_schema_privilege($1,'public','USAGE') AS public_usage,
              has_schema_privilege($1,'public','CREATE') AS public_create,
              has_schema_privilege($1,'pgmq','USAGE') AS pgmq_usage,
              has_schema_privilege($1,'pgmq','CREATE') AS pgmq_create,
              has_schema_privilege($1,'extensions','USAGE') AS extensions_usage`,
      [WORKER_DATABASE_ROLE],
    );
    assert.deepEqual(schemaAcl.rows, [{
      public_usage: true,
      public_create: false,
      pgmq_usage: true,
      pgmq_create: false,
      extensions_usage: false,
    }]);
    const unreviewedCallable = await migrationPool.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM pg_proc AS routine
        WHERE routine.pronamespace IN (to_regnamespace('public'),to_regnamespace('extensions'))
          AND has_schema_privilege($1,routine.pronamespace,'USAGE')
          AND has_function_privilege($1,routine.oid,'EXECUTE')`,
      [WORKER_DATABASE_ROLE],
    );
    assert.equal(unreviewedCallable.rows[0]?.count, "0");

    // API data access remains intact while every direct queue/dead-letter path
    // fails closed after 0029.
    await runtimePool.query("SELECT 1 FROM public.users LIMIT 0");
    for (const sql of [
      "SELECT * FROM pgmq.q_dabboba_worker LIMIT 0",
      "SELECT 1 FROM public.worker_payment_reconciliations LIMIT 0",
      "SELECT nextval('pgmq.q_dabboba_worker_msg_id_seq')",
      "SELECT pgmq.send('dabboba_worker'::text, '{}'::jsonb, 0::integer)",
      "SELECT pgmq.send('dabboba_worker'::text, '{}'::jsonb, '{}'::jsonb, now())",
      "SELECT pgmq.format_table_name('dabboba_worker'::text, 'q'::text)",
      "SELECT * FROM pgmq.read('dabboba_worker'::text, 900::integer, 1::integer)",
      "SELECT pgmq.delete('dabboba_worker'::text, 1::bigint)",
      "SELECT * FROM pgmq.set_vt('dabboba_worker'::text, 1::bigint, 900::integer)",
      `INSERT INTO public.worker_dead_letters
         (queue_name, message_id, read_count, job_payload, error_message)
       VALUES ('dabboba_worker', 1, 1, '{}'::jsonb, 'must fail')`,
    ]) {
      await assert.rejects(runtimePool.query(sql), isPrivilegeDenied);
    }

    const workerClient = await workerPool.connect();
    try {
      await workerClient.query("SELECT 1 FROM public.outbox_events LIMIT 0");
      await assert.rejects(workerClient.query("SET ROLE dabboba_runtime"), isPrivilegeDenied);
      await assert.rejects(
        workerClient.query(
          "SELECT extensions.citext_eq('a'::extensions.citext,'a'::extensions.citext)",
        ),
        isPrivilegeDenied,
      );
      for (const deniedTable of [
        "admin_credentials",
        "sessions",
        "auth_identities",
        "users",
        "schema_migrations",
      ]) {
        await assert.rejects(
          workerClient.query(`SELECT 1 FROM public.${deniedTable} LIMIT 0`),
          isPrivilegeDenied,
        );
      }
      await workerClient.query("BEGIN");

      const sent = await workerClient.query<{ message_id: string }>(
        `SELECT pgmq.send(
           'dabboba_worker'::text,
           '{"kind":"reservation.sweep"}'::jsonb,
           0::integer
         )::text AS message_id`,
      );
      const messageId = sent.rows[0]!.message_id;
      const read = await workerClient.query<{ msg_id: string }>(
        `SELECT msg_id::text AS msg_id
         FROM pgmq.read('dabboba_worker'::text, 900::integer, 100::integer)`,
      );
      assert.ok(read.rows.some((row) => row.msg_id === messageId));
      await workerClient.query(
        "SELECT * FROM pgmq.set_vt('dabboba_worker'::text, $1::bigint, 900::integer)",
        [messageId],
      );
      const deleted = await workerClient.query<{ deleted: boolean }>(
        "SELECT pgmq.delete('dabboba_worker'::text, $1::bigint) AS deleted",
        [messageId],
      );
      assert.equal(deleted.rows[0]?.deleted, true);
      await workerClient.query(
        `INSERT INTO public.worker_dead_letters
           (queue_name, message_id, read_count, job_payload, error_message)
         VALUES ('dabboba_worker', $1::bigint, 1, '{}'::jsonb, 'worker role probe')`,
        [messageId],
      );
      await workerClient.query("ROLLBACK");
    } catch (error) {
      await workerClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      workerClient.release();
    }

    const pgmqPublic = await migrationPool.query<{ oid: string | null }>(
      "SELECT to_regnamespace('pgmq_public')::text AS oid",
    );
    if (pgmqPublic.rows[0]?.oid) {
      const exposed = await migrationPool.query<{ exposed: boolean }>(
        `SELECT has_schema_privilege($1, 'pgmq_public', 'USAGE')
           OR EXISTS (
             SELECT 1 FROM pg_proc AS routine
             WHERE routine.pronamespace = to_regnamespace('pgmq_public')
               AND has_function_privilege($1, routine.oid, 'EXECUTE')
           ) AS exposed`,
        [WORKER_DATABASE_ROLE],
      );
      assert.equal(exposed.rows[0]?.exposed, false);
    }
  } finally {
    await Promise.all([migrationPool.end(), runtimePool.end(), workerPool.end()]);
  }
});
