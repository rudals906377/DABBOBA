import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabasePool, createMigrationDatabasePool, WORKER_DATABASE_ROLE } from "@dabboba/db";
import type { Logger } from "./logger.js";
import { runCommerceRetentionBatch } from "./commerce-retention.js";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const workerUrl = process.env.DABBOBA_WORKER_TEST_DATABASE_URL;
const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;

test("real restricted worker previews approved components and scrubs only expired, unheld text/address", {
  skip: !migrationUrl || !workerUrl, timeout: 60_000,
}, async t => {
  const owner = createMigrationDatabasePool(migrationUrl!, "dabboba-commerce-retention-fixture");
  const worker = createDatabasePool(workerUrl!, "dabboba-commerce-retention-integration", { expectedRole: WORKER_DATABASE_ROLE });
  const ids = { admin: randomUUID(), replacementAdmin: randomUUID(), user: randomUUID(), shipping: randomUUID(), inquiry: randomUUID(), message: randomUUID(), order: randomUUID(), payment: randomUUID() };
  const policyIds = [randomUUID(), randomUUID()];
  const createdShipping: string[] = [ids.shipping];
  const createdInquiries: string[] = [ids.inquiry];
  const createdHolds: string[] = [];
  const createdMedia: string[] = [];
  const suffix = randomUUID();
  t.after(async () => {
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      // Only this fixture's exact IDs in the parent's disposable TEST DB.
      await client.query("SET LOCAL session_replication_role = replica");
      const registryExists = (await client.query("SELECT to_regclass('public.commerce_retention_policies') IS NOT NULL AS present")).rows[0]?.present;
      if (registryExists) {
        await client.query("DELETE FROM commerce_retention_disposals WHERE record_id=ANY($1::uuid[])", [[...createdShipping, ...createdInquiries]]);
        await client.query("DELETE FROM commerce_retention_holds WHERE id=ANY($1::uuid[])", [createdHolds]);
        await client.query("DELETE FROM commerce_retention_reviews WHERE policy_id=ANY($1::uuid[])", [policyIds]);
        await client.query("DELETE FROM commerce_retention_policies WHERE id=ANY($1::uuid[])", [policyIds]);
      }
      await client.query("DELETE FROM admin_commerce_reviews WHERE payment_id=$1", [ids.payment]);
      await client.query("DELETE FROM inquiry_message_media WHERE media_id=ANY($1::uuid[])", [createdMedia]);
      await client.query("DELETE FROM media_assets WHERE id=ANY($1::uuid[])", [createdMedia]);
      await client.query("DELETE FROM payment_ledger_entries WHERE payment_id=$1", [ids.payment]);
      await client.query("DELETE FROM payments WHERE id=$1", [ids.payment]);
      await client.query("DELETE FROM orders WHERE id=$1", [ids.order]);
      await client.query("DELETE FROM inquiry_messages WHERE inquiry_id=ANY($1::uuid[])", [createdInquiries]);
      await client.query("DELETE FROM inquiries WHERE id=ANY($1::uuid[])", [createdInquiries]);
      await client.query("DELETE FROM shipping_status_events WHERE shipping_request_id=ANY($1::uuid[])", [createdShipping]);
      await client.query("DELETE FROM shipping_requests WHERE id=ANY($1::uuid[])", [createdShipping]);
      await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ids.admin, ids.replacementAdmin, ids.user]]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await Promise.all([owner.end(), worker.end()]);
    }
  });

  await owner.query("INSERT INTO users(id,email,nickname,role) VALUES($1,$3,'파기 운영자','SUPER_ADMIN'),($2,$4,'보관 고객','USER')", [ids.admin, ids.user, `retention-admin-${suffix}@example.test`, `retention-user-${suffix}@example.test`]);
  await owner.query("INSERT INTO users(id,email,nickname,role) VALUES($1,$2,'정책 교체 운영자','ADMIN')", [ids.replacementAdmin, `retention-replacement-${suffix}@example.test`]);
  await owner.query(`INSERT INTO shipping_requests(id,user_id,status,address_snapshot,requested_at,updated_at)
    VALUES($1,$2,'CANCELLED','{"recipient":"Old recipient","phone":"010-0000-0000","addressLine1":"Old private address"}',now()-interval '7 years',now()-interval '7 years')`, [ids.shipping, ids.user]);
  await owner.query(`INSERT INTO orders(id,user_id,status,subtotal,total,order_kind,shipping_request_id,cancelled_at,created_at,updated_at)
    VALUES($1,$2,'CANCELLED',3000,3000,'SHIPPING_FEE',$3,now()-interval '7 years',now()-interval '7 years',now()-interval '7 years')`, [ids.order, ids.user, ids.shipping]);
  await owner.query(`INSERT INTO payments(id,order_id,provider,status,amount,created_at,updated_at)
    VALUES($1,$2,'TEST_PG','CANCELLED',3000,now()-interval '7 years',now()-interval '7 years')`, [ids.payment, ids.order]);
  await owner.query(`INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id,created_at)
    VALUES($1,$2,'ADJUSTMENT',-1,$3,now()-interval '7 years')`, [ids.payment, ids.order, suffix]);
  await owner.query(`INSERT INTO inquiries(id,user_id,category,title,status,closed_at,created_at,updated_at)
    VALUES($1,$2,'ORDER','Old private inquiry','CLOSED',now()-interval '4 years',now()-interval '4 years',now()-interval '4 years')`, [ids.inquiry, ids.user]);
  await owner.query(`INSERT INTO inquiry_messages(id,inquiry_id,author_id,author_role,content,created_at)
    VALUES($1,$2,$3,'USER','Private consumer complaint',now()-interval '4 years')`, [ids.message, ids.inquiry, ids.user]);
  const previewFor = async (id: string) => (await worker.query<{ blocker: string | null }>("SELECT blocker FROM public.preview_commerce_retention(100) WHERE record_id=$1", [id])).rows[0]?.blocker;
  await t.test("unregistered policy never infers a retention clock or permission", async () => {
    assert.equal(await previewFor(ids.shipping), "POLICY_MISSING");
    assert.equal(await previewFor(ids.inquiry), "POLICY_MISSING");
    assert.equal((await runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 25 }, logger)).disposed, 0);
  });
  await t.test("only owner may register policy; short windows and non-admin approval fail", async () => {
    await assert.rejects(worker.query("INSERT INTO commerce_retention_policies(record_kind,policy_version,retention_months,evidence_reference) VALUES('SHIPPING_ADDRESS','2026-10-04',60,'CI_POLICY')"), /permission denied/);
    await assert.rejects(owner.query("INSERT INTO commerce_retention_policies(record_kind,policy_version,retention_months,evidence_reference) VALUES('SHIPPING_ADDRESS','2026-10-04',59,'CI_POLICY')"), /check constraint/);
    await assert.rejects(owner.query("INSERT INTO commerce_retention_policies(record_kind,policy_version,retention_months,evidence_reference,approved_at,approved_by_admin_id) VALUES('INQUIRY_CONTENT','2026-10-04',36,'CI_POLICY',now(),$1)", [ids.user]), /active administrator/);
    await assert.rejects(worker.query("UPDATE shipping_requests SET address_snapshot='{}' WHERE id=$1", [ids.shipping]), /permission denied/);
    const roles = await owner.query<{ role: string; preview: boolean; execute: boolean }>(`SELECT role,
      has_function_privilege(role,'public.preview_commerce_retention(integer)','EXECUTE') AS preview,
      has_function_privilege(role,'public.execute_commerce_retention(integer)','EXECUTE') AS execute
      FROM unnest(ARRAY['anon','authenticated','service_role','dabboba_runtime','dabboba_worker']) role`);
    for (const row of roles.rows) {
      assert.equal(row.preview, row.role === "dabboba_worker");
      assert.equal(row.execute, row.role === "dabboba_worker");
    }
    // The full pipeline provisions both role logins before this integration
    // suite. Reprovisioning must not broaden protected registry privileges.
    const tableGrants = await owner.query<{ role: string; table_name: string; granted: boolean }>(`SELECT role,table_name,
      has_table_privilege(role,'public.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS granted
      FROM unnest(ARRAY['anon','authenticated','service_role','dabboba_runtime','dabboba_worker']) role
      CROSS JOIN unnest(ARRAY['commerce_retention_policies','commerce_retention_reviews','commerce_retention_holds','commerce_retention_disposals']) table_name`);
    assert.equal(tableGrants.rowCount, 20);
    for (const row of tableGrants.rows) assert.equal(row.granted, false, `${row.role} gained a direct ${row.table_name} privilege`);
  });
  await owner.query(`INSERT INTO commerce_retention_policies(id,record_kind,policy_version,retention_months,evidence_reference,approved_at,approved_by_admin_id)
    VALUES($1,'SHIPPING_ADDRESS','2026-10-04',60,'CI_APPROVED_COMPONENT_SCOPE',now(),$3),($2,'INQUIRY_CONTENT','2026-10-04',36,'CI_APPROVED_COMPONENT_SCOPE',now(),$3)`, [...policyIds, ids.admin]);
  await t.test("policy approval alone does not mean that hold registry or external copies are clear", async () => {
    assert.equal(await previewFor(ids.shipping), "HOLD_REVIEW_REQUIRED");
    assert.equal((await runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 25 }, logger)).disposed, 0);
    await owner.query(`INSERT INTO commerce_retention_reviews(policy_id,reviewed_by_admin_id,hold_registry_reviewed_at,evidence_reference)
      SELECT id,$1,now(),'CI_HOLD_REVIEW_ONLY' FROM commerce_retention_policies WHERE id=ANY($2::uuid[])`, [ids.admin, policyIds]);
    assert.equal(await previewFor(ids.inquiry), "EXTERNAL_COPIES_UNVERIFIED");
  });
  await owner.query(`INSERT INTO commerce_retention_reviews(policy_id,reviewed_by_admin_id,hold_registry_reviewed_at,external_copies_reviewed_at,external_copies_status,evidence_reference)
    SELECT id,$1,now(),now(),'CLEARED','CI_REVIEW_COMPLETE' FROM commerce_retention_policies WHERE id=ANY($2::uuid[])`, [ids.admin, policyIds]);
  await t.test("approved preview is SELECT-only and records no disposal evidence", async () => {
    assert.equal(await previewFor(ids.shipping), null);
    assert.equal(await previewFor(ids.inquiry), null);
    const before = await owner.query("SELECT address_snapshot FROM shipping_requests WHERE id=$1", [ids.shipping]);
    const preview = await runCommerceRetentionBatch(worker, { mode: "PREVIEW", batchSize: 100 }, logger);
    assert.ok(preview.eligible >= 2);
    assert.equal(preview.disposed, 0);
    assert.deepEqual((await owner.query("SELECT address_snapshot FROM shipping_requests WHERE id=$1", [ids.shipping])).rows, before.rows);
    assert.equal((await owner.query("SELECT 1 FROM commerce_retention_disposals WHERE record_id=ANY($1::uuid[])", [[ids.shipping, ids.inquiry]])).rowCount, 0);
  });
  await t.test("a stale hold/copy review fails closed until an administrator records fresh evidence", async () => {
    await owner.query(`INSERT INTO commerce_retention_reviews(policy_id,reviewed_by_admin_id,hold_registry_reviewed_at,external_copies_reviewed_at,external_copies_status,evidence_reference)
      SELECT id,$1,now()-interval '25 hours',now(),'CLEARED','CI_STALE_HOLD_REVIEW' FROM commerce_retention_policies WHERE id=ANY($2::uuid[])`, [ids.admin, policyIds]);
    assert.equal(await previewFor(ids.shipping), "HOLD_REVIEW_REQUIRED");
    await owner.query(`INSERT INTO commerce_retention_reviews(policy_id,reviewed_by_admin_id,hold_registry_reviewed_at,external_copies_reviewed_at,external_copies_status,evidence_reference)
      SELECT id,$1,now(),now()-interval '25 hours','CLEARED','CI_STALE_COPY_REVIEW' FROM commerce_retention_policies WHERE id=ANY($2::uuid[])`, [ids.admin, policyIds]);
    assert.equal(await previewFor(ids.shipping), "EXTERNAL_COPIES_UNVERIFIED");
    await owner.query(`INSERT INTO commerce_retention_reviews(policy_id,reviewed_by_admin_id,hold_registry_reviewed_at,external_copies_reviewed_at,external_copies_status,evidence_reference)
      SELECT id,$1,now(),now(),'CLEARED','CI_REVIEW_REFRESHED' FROM commerce_retention_policies WHERE id=ANY($2::uuid[])`, [ids.admin, policyIds]);
    assert.equal(await previewFor(ids.shipping), null);
    await assert.rejects(owner.query("UPDATE commerce_retention_policies SET retention_months=120 WHERE id=$1", [policyIds[0]]), /immutable/);
    await assert.rejects(owner.query("UPDATE commerce_retention_reviews SET external_copies_status='CLEARED' WHERE policy_id=$1", [policyIds[0]]), /append-only/);
  });
  await t.test("global and per-user legal holds override approved age eligibility", async () => {
    for (const scope of ["ALL", "USER"] as const) {
      const holdId = randomUUID(); createdHolds.push(holdId);
      await owner.query("INSERT INTO commerce_retention_holds(id,scope,user_id,case_reference,created_by_admin_id) VALUES($1,$2,$3,'CI_DISPUTE',$4)", [holdId, scope, scope === "USER" ? ids.user : null, ids.admin]);
      assert.equal(await previewFor(ids.shipping), "LEGAL_HOLD");
      assert.equal((await runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 25 }, logger)).disposed, 0);
      await owner.query("UPDATE commerce_retention_holds SET released_at=now(),released_by_admin_id=$2 WHERE id=$1", [holdId, ids.admin]);
    }
  });
  await t.test("active service, unexpired records and unresolved commerce stay blocked", async () => {
    const shippingId = randomUUID(); createdShipping.push(shippingId);
    await owner.query("INSERT INTO shipping_requests(id,user_id,status,address_snapshot,requested_at,updated_at) VALUES($1,$2,'REQUESTED','{}',now()-interval '7 years',now()-interval '7 years')", [shippingId, ids.user]);
    assert.equal(await previewFor(shippingId), "SERVICE_ACTIVE");
    const inquiryId = randomUUID(); createdInquiries.push(inquiryId);
    await owner.query("INSERT INTO inquiries(id,user_id,category,title,status,closed_at) VALUES($1,$2,'OTHER','Recent complaint','CLOSED',now())", [inquiryId, ids.user]);
    assert.equal(await previewFor(inquiryId), "NOT_EXPIRED");
    await owner.query("INSERT INTO admin_commerce_reviews(payment_id,status) VALUES($1,'PENDING')", [ids.payment]);
    assert.equal(await previewFor(ids.inquiry), "OPEN_COMMERCE_REVIEW");
    await owner.query("DELETE FROM admin_commerce_reviews WHERE payment_id=$1", [ids.payment]);
    await owner.query(`INSERT INTO worker_payment_reconciliations(payment_id,payment_version,attempts,last_outcome,last_observed_state,last_attempted_at,next_attempt_at)
      VALUES($1,1,1,'UNKNOWN','UNKNOWN',now(),now()+interval '1 hour')`, [ids.payment]);
    assert.equal(await previewFor(ids.shipping), "PAYMENT_UNRESOLVED");
    // A settled check stops blocking: a verified RECONCILED outcome, or a commerce
    // review an administrator closed after the last attempt. An unknown outcome
    // on a payment cancelled without provider confirmation keeps blocking.
    await owner.query("UPDATE worker_payment_reconciliations SET last_outcome='RECONCILED',last_observed_state='CANCELLED' WHERE payment_id=$1", [ids.payment]);
    assert.equal(await previewFor(ids.shipping), null);
    await owner.query("UPDATE worker_payment_reconciliations SET last_outcome='MANUAL_REVIEW',last_observed_state='UNKNOWN' WHERE payment_id=$1", [ids.payment]);
    assert.equal(await previewFor(ids.shipping), "PAYMENT_UNRESOLVED");
    await owner.query("INSERT INTO admin_commerce_reviews(payment_id,status,closed_at) VALUES($1,'CLOSED',now())", [ids.payment]);
    assert.equal(await previewFor(ids.shipping), null);
    await owner.query("UPDATE worker_payment_reconciliations SET last_attempted_at=now()+interval '1 minute',next_attempt_at=now()+interval '2 hours' WHERE payment_id=$1", [ids.payment]);
    assert.equal(await previewFor(ids.shipping), "PAYMENT_UNRESOLVED", "a review closed before a newer attempt does not settle it");
    await owner.query("DELETE FROM admin_commerce_reviews WHERE payment_id=$1", [ids.payment]);
    await owner.query("DELETE FROM worker_payment_reconciliations WHERE payment_id=$1", [ids.payment]);
    await owner.query("INSERT INTO payment_ledger_entries(payment_id,order_id,entry_type,amount,reference_id) VALUES($1,$2,'ADJUSTMENT',1,$3)", [ids.payment, ids.order, `${suffix}-recent`]);
    assert.equal(await previewFor(ids.shipping), "NOT_EXPIRED");
    const cleanup = await owner.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query("SET LOCAL session_replication_role=replica");
      await cleanup.query("DELETE FROM payment_ledger_entries WHERE reference_id=$1", [`${suffix}-recent`]);
      await cleanup.query("COMMIT");
    } finally { cleanup.release(); }
  });
  await t.test("media and excessive inquiry size are blocked instead of leaving a partially purged inquiry", async () => {
    for (const scenario of ["MEDIA", "LARGE"] as const) {
      const inquiryId = randomUUID(); createdInquiries.push(inquiryId);
      await owner.query(`INSERT INTO inquiries(id,user_id,category,title,status,closed_at,created_at,updated_at)
        VALUES($1,$2,'OTHER',$3,'CLOSED',now()-interval '8 years',now()-interval '8 years',now()-interval '8 years')`, [inquiryId, ids.user, `Private ${scenario}`]);
      const messages = await owner.query<{ id: string }>(`INSERT INTO inquiry_messages(inquiry_id,author_id,author_role,content,created_at)
        SELECT $1,$2,'USER','Private inquiry text',now()-interval '8 years' FROM generate_series(1,$3::integer) RETURNING id`, [inquiryId, ids.user, scenario === "MEDIA" ? 1 : 51]);
      if (scenario === "MEDIA") {
        const mediaId = randomUUID(); createdMedia.push(mediaId);
        await owner.query("INSERT INTO media_assets(id,owner_id,purpose,object_key,declared_mime_type,byte_size,checksum_sha256) VALUES($1,$2,'INQUIRY',$3,'image/jpeg',1,$4)", [mediaId, ids.user, `retention-${suffix}`, "a".repeat(64)]);
        await owner.query("INSERT INTO inquiry_message_media(message_id,media_id) VALUES($1,$2)", [messages.rows[0]!.id, mediaId]);
      }
      assert.equal(await previewFor(inquiryId), scenario === "MEDIA" ? "MEDIA_PRESENT" : "MESSAGE_LIMIT");
    }
    // Blocked eight-year records are older than the eligible four/seven-year
    // records, but cannot starve them in a one-record preview/execution batch.
    const preview = await runCommerceRetentionBatch(worker, { mode: "PREVIEW", batchSize: 1 }, logger);
    assert.equal(preview.eligible, 1);
  });
  await t.test("exact-record holds preserve only that record and hold release cannot be rewritten", async () => {
    const holdId = randomUUID(); createdHolds.push(holdId);
    await owner.query("INSERT INTO commerce_retention_holds(id,scope,record_kind,record_id,case_reference,created_by_admin_id) VALUES($1,'RECORD','SHIPPING_ADDRESS',$2,'CI_EXACT_RECORD',$3)", [holdId, ids.shipping, ids.admin]);
    assert.equal(await previewFor(ids.shipping), "LEGAL_HOLD");
    assert.equal(await previewFor(ids.inquiry), null);
    await owner.query("UPDATE commerce_retention_holds SET released_at=now(),released_by_admin_id=$2 WHERE id=$1", [holdId, ids.admin]);
    await assert.rejects(owner.query("UPDATE commerce_retention_holds SET released_at=NULL,released_by_admin_id=NULL WHERE id=$1", [holdId]), /one approved release/);
  });
  await t.test("a concurrent sweep/registry lock defers this entire sweep without mutating a source", async () => {
    const blocker = await worker.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(7922024082400083::bigint)");
      assert.equal((await runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 100 }, logger)).disposed, 0);
      assert.equal(await previewFor(ids.inquiry), null);
      await blocker.query("ROLLBACK");
    } finally { blocker.release(); }
  });
  await t.test("a disposal-evidence failure rolls back both source scrubbing and audit insertion", async () => {
    const constraint = `commerce_retention_test_${suffix.replaceAll("-", "")}`;
    await owner.query(`ALTER TABLE commerce_retention_disposals ADD CONSTRAINT ${constraint} CHECK (message_count<0) NOT VALID`);
    try {
      await assert.rejects(runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 25 }, logger), /check constraint/);
      assert.equal((await owner.query("SELECT address_snapshot->>'recipient' AS recipient FROM shipping_requests WHERE id=$1", [ids.shipping])).rows[0]?.recipient, "Old recipient");
      assert.equal((await owner.query("SELECT content FROM inquiry_messages WHERE id=$1", [ids.message])).rows[0]?.content, "Private consumer complaint");
      assert.equal((await owner.query("SELECT 1 FROM commerce_retention_disposals WHERE record_id=ANY($1::uuid[])", [[ids.shipping, ids.inquiry]])).rowCount, 0);
    } finally {
      await owner.query(`ALTER TABLE commerce_retention_disposals DROP CONSTRAINT ${constraint}`);
    }
  });
  await t.test("database execution requires both explicit flag and serializable transaction", async () => {
    await assert.rejects(worker.query("SELECT public.execute_commerce_retention(25)"), /explicit execution/);
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dabboba.commerce_retention_execute','on',true)");
      await assert.rejects(client.query("SELECT public.execute_commerce_retention(25)"), /serializable/);
      await client.query("ROLLBACK");
    } finally { client.release(); }
  });
  await t.test("a concurrent source update aborts the batch and rolls back an earlier scrub", async () => {
    const sourceWriter = await owner.connect();
    try {
      await sourceWriter.query("BEGIN");
      await sourceWriter.query("UPDATE inquiries SET title='Changed private inquiry' WHERE id=$1", [ids.inquiry]);
      const execution = runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 100 }, logger)
        .then(() => null, error => error as Error & { code: string });
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = await owner.query("SELECT 1 FROM pg_stat_activity WHERE application_name='dabboba-commerce-retention-integration' AND wait_event_type='Lock' AND query LIKE '%execute_commerce_retention%'");
        if (state.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await sourceWriter.query("COMMIT");
      const failure = await execution;
      assert.ok(waiting, "execution must reach the locked authoritative source");
      assert.equal(failure?.code, "40001");
      assert.equal((await owner.query("SELECT address_snapshot->>'recipient' AS recipient FROM shipping_requests WHERE id=$1", [ids.shipping])).rows[0]?.recipient, "Old recipient");
      assert.equal((await owner.query("SELECT 1 FROM commerce_retention_disposals WHERE record_id=ANY($1::uuid[])", [[ids.shipping, ids.inquiry]])).rowCount, 0);
      // Restore only this fixture's pre-race timestamp for the next scenario.
      await sourceWriter.query("BEGIN");
      await sourceWriter.query("SET LOCAL session_replication_role=replica");
      await sourceWriter.query("UPDATE inquiries SET title='Old private inquiry',updated_at=now()-interval '4 years' WHERE id=$1", [ids.inquiry]);
      await sourceWriter.query("COMMIT");
    } catch (error) {
      await sourceWriter.query("ROLLBACK");
      throw error;
    } finally { sourceWriter.release(); }
  });
  await t.test("bounded execution scrubs components atomically, preserves financial identities, and is idempotent", async () => {
    const delivered = randomUUID(); createdShipping.push(delivered);
    await owner.query(`INSERT INTO shipping_requests(id,user_id,status,address_snapshot,requested_at,updated_at,shipped_at,tracking_carrier,tracking_number)
      VALUES($1,$2,'DELIVERED','{"recipient":"Delivered recipient"}',now()-interval '7 years',now()-interval '7 years',now()-interval '7 years','CI_CARRIER','CI_IMMUTABLE_TRACKING')`, [delivered, ids.user]);
    await owner.query(`INSERT INTO shipping_status_events(shipping_request_id,admin_id,from_status,to_status,tracking_carrier,tracking_number,reason,request_id,idempotency_key,created_at)
      VALUES($1,$2,'SHIPPED','DELIVERED','CI_CARRIER','CI_IMMUTABLE_TRACKING','CI delivery complete',$3::text,$3::text,now()-interval '7 years')`, [delivered, ids.admin, suffix]);
    const trackingBefore = (await owner.query("SELECT to_jsonb(e) AS tracking FROM shipping_status_events e WHERE shipping_request_id=$1", [delivered])).rows;
    const financialBefore = (await owner.query("SELECT to_jsonb(p) AS payment,to_jsonb(o) AS purchase,to_jsonb(l) AS ledger FROM payments p JOIN orders o ON o.id=p.order_id JOIN payment_ledger_entries l ON l.payment_id=p.id WHERE p.id=$1", [ids.payment])).rows;
    const first = await runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 1 }, logger);
    assert.equal(first.disposed, 1);
    const second = await runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 100 }, logger);
    assert.equal(second.disposed, 2);
    assert.equal((await runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 100 }, logger)).disposed, 0);
    assert.deepEqual((await owner.query("SELECT address_snapshot FROM shipping_requests WHERE id=$1", [ids.shipping])).rows[0]?.address_snapshot, { retentionDisposed: true });
    assert.deepEqual((await owner.query("SELECT address_snapshot FROM shipping_requests WHERE id=$1", [delivered])).rows[0]?.address_snapshot, { retentionDisposed: true });
    assert.equal((await owner.query("SELECT tracking_number FROM shipping_requests WHERE id=$1", [delivered])).rows[0]?.tracking_number, "CI_IMMUTABLE_TRACKING");
    assert.deepEqual((await owner.query("SELECT to_jsonb(e) AS tracking FROM shipping_status_events e WHERE shipping_request_id=$1", [delivered])).rows, trackingBefore);
    assert.equal((await owner.query("SELECT title FROM inquiries WHERE id=$1", [ids.inquiry])).rows[0]?.title, "보관기한 만료로 파기된 문의");
    assert.equal((await owner.query("SELECT content FROM inquiry_messages WHERE id=$1", [ids.message])).rows[0]?.content, "보관기한 만료로 파기된 내용");
    assert.deepEqual((await owner.query("SELECT to_jsonb(p) AS payment,to_jsonb(o) AS purchase,to_jsonb(l) AS ledger FROM payments p JOIN orders o ON o.id=p.order_id JOIN payment_ledger_entries l ON l.payment_id=p.id WHERE p.id=$1", [ids.payment])).rows, financialBefore);
    const evidence = await owner.query("SELECT record_kind,record_id,message_count FROM commerce_retention_disposals WHERE record_id=ANY($1::uuid[])", [[ids.shipping, ids.inquiry]]);
    assert.equal(evidence.rowCount, 2);
    await assert.rejects(worker.query("UPDATE commerce_retention_disposals SET message_count=0"), /permission denied/);
    await assert.rejects(owner.query("DELETE FROM commerce_retention_disposals WHERE record_id=$1", [ids.shipping]), /append-only/);
    await assert.rejects(owner.query("UPDATE payment_ledger_entries SET amount=42 WHERE payment_id=$1", [ids.payment]), /append-only/);
  });
  await t.test("an active replacement administrator may retire an inactive approver's policy without changing approval history", async () => {
    const original = (await owner.query("SELECT to_jsonb(p) AS policy FROM commerce_retention_policies p WHERE id=$1", [policyIds[1]])).rows[0]!.policy;
    await owner.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [ids.admin]);
    const replacement = randomUUID(); policyIds.push(replacement);
    const insertReplacement = () => owner.query(`INSERT INTO commerce_retention_policies(id,record_kind,policy_version,retention_months,evidence_reference,approved_at,approved_by_admin_id)
      VALUES($1,'INQUIRY_CONTENT','2026-10-05',36,'CI_REPLACEMENT_POLICY',now(),$2)`, [replacement, ids.replacementAdmin]);
    await assert.rejects(insertReplacement(), /unique constraint/);
    await assert.rejects(owner.query("UPDATE commerce_retention_policies SET retired_at=now() WHERE id=$1", [policyIds[1]]), /check constraint/);
    await assert.rejects(owner.query("UPDATE commerce_retention_policies SET retired_at=now(),retired_by_admin_id=$2,retirement_evidence_reference='CI_RETIRE' WHERE id=$1", [policyIds[1], ids.admin]), /active administrator/);
    await assert.rejects(owner.query("UPDATE commerce_retention_policies SET retired_at=now(),retired_by_admin_id=$2,retirement_evidence_reference='CI_RETIRE' WHERE id=$1", [policyIds[1], ids.user]), /active administrator/);
    await assert.rejects(owner.query("UPDATE commerce_retention_policies SET retired_at=now()+interval '1 day',retired_by_admin_id=$2,retirement_evidence_reference='CI_RETIRE' WHERE id=$1", [policyIds[1], ids.replacementAdmin]), /future/);
    await owner.query("UPDATE commerce_retention_policies SET retired_at=now(),retired_by_admin_id=$2,retirement_evidence_reference='CI_NEW_ACTIVE_RETIREMENT' WHERE id=$1", [policyIds[1], ids.replacementAdmin]);
    const retired = (await owner.query("SELECT to_jsonb(p) AS policy FROM commerce_retention_policies p WHERE id=$1", [policyIds[1]])).rows[0]!.policy;
    assert.equal(retired.retired_by_admin_id, ids.replacementAdmin);
    assert.equal(retired.retirement_evidence_reference, "CI_NEW_ACTIVE_RETIREMENT");
    const historical = ({ retired_at: _at, retired_by_admin_id: _by, retirement_evidence_reference: _evidence, ...rest }: Record<string, unknown>) => rest;
    assert.deepEqual(historical(retired), historical(original));
    await assert.rejects(owner.query("UPDATE commerce_retention_policies SET retired_at=NULL,retired_by_admin_id=NULL,retirement_evidence_reference=NULL WHERE id=$1", [policyIds[1]]), /immutable/);
    await insertReplacement();
    const freshInquiry = randomUUID(); createdInquiries.push(freshInquiry);
    await owner.query(`INSERT INTO inquiries(id,user_id,category,title,status,closed_at,created_at,updated_at)
      VALUES($1,$2,'OTHER','Replacement still requires new review','CLOSED',now()-interval '4 years',now()-interval '4 years',now()-interval '4 years')`, [freshInquiry, ids.user]);
    assert.equal(await previewFor(freshInquiry), "HOLD_REVIEW_REQUIRED");
    assert.equal((await runCommerceRetentionBatch(worker, { mode: "EXECUTE", batchSize: 100 }, logger)).disposed, 0);
  });
});
