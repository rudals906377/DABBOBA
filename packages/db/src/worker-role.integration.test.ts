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

    const pushSessionColumns = await migrationPool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.column_privileges
        WHERE grantee=$1 AND table_schema='public' AND table_name='sessions'
          AND privilege_type='SELECT'
        ORDER BY column_name`,
      [WORKER_DATABASE_ROLE],
    );
    assert.deepEqual(pushSessionColumns.rows.map((row) => row.column_name), [
      "expires_at",
      "id",
      "revoked_at",
      "session_kind",
      "user_id",
    ]);

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
      ["account_deletion_request_events", new Set(["insert"])],
      ["account_deletion_requests", new Set(["select"])],
      ["apple_auth_credentials", new Set(["select", "delete"])],
      ["auth_identities", new Set(["select", "delete"])],
      ["outbox_events", new Set(["select", "insert", "update"])],
      ["notifications", new Set(["select", "insert", "delete"])],
      ["notification_preferences", new Set(["select", "delete"])],
      ["push_device_tokens", new Set(["select", "update", "delete"])],
      ["push_notification_deliveries", new Set(["select", "insert", "update", "delete"])],
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
      ["account_auth_deletion_jobs", new Set(["select", "update", "delete"])],
      ["community_comments", new Set(["select"])],
      ["community_post_likes", new Set(["select", "delete"])],
      ["community_post_media", new Set(["select", "delete"])],
      ["community_posts", new Set(["select"])],
      ["content_reports", new Set(["select"])],
      ["default_shipping_addresses", new Set(["select", "delete"])],
      ["draw_entitlements", new Set(["select"])],
      ["exchange_listings", new Set(["select"])],
      ["exchange_offers", new Set(["select"])],
      ["exchange_listing_items", new Set(["select"])],
      ["exchange_offer_items", new Set(["select"])],
      ["inquiry_message_media", new Set(["select", "delete"])],
      ["inquiry_messages", new Set(["select"])],
      ["inventory_units", new Set(["select"])],
      ["inventory_storage_expiry_events", new Set(["select", "insert"])],
      ["user_blocks", new Set(["select", "delete"])],
      ["user_policy_acceptances", new Set(["select"])],
      ["user_profiles", new Set(["select"])],
      ["users", new Set(["select"])],
      ["wanted_request_likes", new Set(["select", "delete"])],
      ["wanted_requests", new Set(["select"])],
      ["wishlist_items", new Set(["select", "delete"])],
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

    const accountDeletionColumnAcl = await migrationPool.query<{
      can_update_auth_deleted_at: boolean;
      can_update_auth_deletion_status: boolean;
      can_update_request_status: boolean;
    }>(
      `SELECT
         has_column_privilege($1, 'public.account_deletion_requests', 'auth_deletion_status', 'UPDATE')
           AS can_update_auth_deletion_status,
         has_column_privilege($1, 'public.account_deletion_requests', 'auth_deleted_at', 'UPDATE')
           AS can_update_auth_deleted_at,
         has_column_privilege($1, 'public.account_deletion_requests', 'status', 'UPDATE')
           AS can_update_request_status`,
      [WORKER_DATABASE_ROLE],
    );
    assert.deepEqual(accountDeletionColumnAcl.rows, [{
      can_update_auth_deletion_status: true,
      can_update_auth_deleted_at: true,
      can_update_request_status: true,
    }]);

    const storageExpiryColumnAcl = await migrationPool.query<{
      can_select_catalog_user_id: boolean;
      can_select_catalog_status: boolean;
      can_update_catalog_description: boolean;
      can_update_catalog_media_id: boolean;
      can_update_catalog_name: boolean;
      can_update_catalog_reference_url: boolean;
      can_update_catalog_status: boolean;
      can_update_inventory_owner: boolean;
      can_update_inventory_status: boolean;
      can_update_listing_details: boolean;
      can_update_listing_status: boolean;
      can_update_listing_title: boolean;
      can_update_offer_status: boolean;
      can_update_offer_message: boolean;
    }>(
      `SELECT
         has_column_privilege($1, 'public.catalog_requests', 'user_id', 'SELECT')
           AS can_select_catalog_user_id,
         has_column_privilege($1, 'public.catalog_requests', 'status', 'SELECT')
           AS can_select_catalog_status,
         has_column_privilege($1, 'public.catalog_requests', 'name', 'UPDATE')
           AS can_update_catalog_name,
         has_column_privilege($1, 'public.catalog_requests', 'reference_url', 'UPDATE')
           AS can_update_catalog_reference_url,
         has_column_privilege($1, 'public.catalog_requests', 'description', 'UPDATE')
           AS can_update_catalog_description,
         has_column_privilege($1, 'public.catalog_requests', 'media_id', 'UPDATE')
           AS can_update_catalog_media_id,
         has_column_privilege($1, 'public.catalog_requests', 'status', 'UPDATE')
           AS can_update_catalog_status,
         has_column_privilege($1, 'public.inventory_units', 'status', 'UPDATE')
           AS can_update_inventory_status,
         has_column_privilege($1, 'public.inventory_units', 'owner_id', 'UPDATE')
           AS can_update_inventory_owner,
         has_column_privilege($1, 'public.exchange_listings', 'status', 'UPDATE')
           AS can_update_listing_status,
         has_column_privilege($1, 'public.exchange_listings', 'title', 'UPDATE')
           AS can_update_listing_title,
         has_column_privilege($1, 'public.exchange_listings', 'details', 'UPDATE')
           AS can_update_listing_details,
         has_column_privilege($1, 'public.exchange_offers', 'status', 'UPDATE')
           AS can_update_offer_status,
         has_column_privilege($1, 'public.exchange_offers', 'message', 'UPDATE')
           AS can_update_offer_message`,
      [WORKER_DATABASE_ROLE],
    );
    assert.deepEqual(storageExpiryColumnAcl.rows, [{
      can_select_catalog_user_id: true,
      can_select_catalog_status: false,
      can_update_catalog_description: true,
      can_update_catalog_media_id: true,
      can_update_catalog_name: true,
      can_update_catalog_reference_url: true,
      can_update_catalog_status: false,
      can_update_inventory_status: true,
      can_update_inventory_owner: false,
      can_update_listing_status: true,
      can_update_listing_title: true,
      can_update_listing_details: true,
      can_update_offer_status: true,
      can_update_offer_message: true,
    }]);

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
    const setVtDependency = await migrationPool.query<{
      timestamp_overload_exists: boolean;
      worker_can_execute: boolean | null;
      runtime_can_execute: boolean | null;
    }>(
      `WITH dependency AS (
         SELECT to_regprocedure('pgmq.set_vt(text,bigint,timestamp with time zone)') AS routine
       )
       SELECT routine IS NOT NULL AS timestamp_overload_exists,
              CASE WHEN routine IS NULL THEN NULL
                   ELSE has_function_privilege($1,routine::oid,'EXECUTE') END
                AS worker_can_execute,
              CASE WHEN routine IS NULL THEN NULL
                   ELSE has_function_privilege($2,routine::oid,'EXECUTE') END
                AS runtime_can_execute
         FROM dependency`,
      [WORKER_DATABASE_ROLE, RUNTIME_DATABASE_ROLE],
    );
    assert.equal(setVtDependency.rows.length, 1);
    assert.deepEqual(setVtDependency.rows[0],
      setVtDependency.rows[0]?.timestamp_overload_exists
        ? { timestamp_overload_exists: true, worker_can_execute: true, runtime_can_execute: false }
        : { timestamp_overload_exists: false, worker_can_execute: null, runtime_can_execute: null });

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
        "schema_migrations",
      ]) {
        await assert.rejects(
          workerClient.query(`SELECT 1 FROM public.${deniedTable} LIMIT 0`),
          isPrivilegeDenied,
        );
      }
      await assert.rejects(
        workerClient.query("SELECT token_digest FROM public.sessions LIMIT 0"),
        isPrivilegeDenied,
      );
      await workerClient.query(
        `EXPLAIN UPDATE public.catalog_requests
            SET name='삭제된 카탈로그 요청',reference_url=NULL,description=NULL,media_id=NULL
          WHERE user_id='00000000-0000-0000-0000-000000000000'::uuid`,
      );
      await workerClient.query(
        `EXPLAIN UPDATE public.exchange_listings
            SET title='삭제된 교환 게시물',details='삭제된 내용'
          WHERE author_id='00000000-0000-0000-0000-000000000000'::uuid`,
      );
      await workerClient.query(
        `EXPLAIN UPDATE public.exchange_offers
            SET message='삭제된 교환 제안'
          WHERE proposer_id='00000000-0000-0000-0000-000000000000'::uuid`,
      );
      await assert.rejects(
        workerClient.query("EXPLAIN UPDATE public.catalog_requests SET status='REJECTED'"),
        isPrivilegeDenied,
      );
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
