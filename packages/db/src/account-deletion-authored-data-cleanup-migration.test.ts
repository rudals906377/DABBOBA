import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const migration = readFile(
  new URL("../migrations/0064_account_deletion_authored_data_cleanup.sql", import.meta.url),
  "utf8",
);

test("0064 backfills only user-authored catalog and exchange copy for deleted accounts", async () => {
  const source = await migration;
  const rewrittenColumns = [...source.matchAll(/UPDATE public\.[a-z_]+ AS [a-z_]+[\s\S]*?\bSET ([\s\S]*?)\n\s+(?:FROM|WHERE)\b/gi)]
    .map((match) => match[1] ?? "")
    .join("\n");

  assert.match(source, /UPDATE public\.catalog_requests AS request[\s\S]*account\.status = 'DELETED'/i);
  assert.match(source, /SET name = '[^']+'[\s\S]*reference_url = NULL[\s\S]*description = NULL[\s\S]*media_id = NULL/i);
  assert.match(source, /UPDATE public\.exchange_listings AS listing[\s\S]*SET title = '[^']+'[\s\S]*details = '[^']+'[\s\S]*account\.status = 'DELETED'/i);
  assert.match(source, /UPDATE public\.exchange_offers AS offer[\s\S]*SET message = '[^']+'[\s\S]*account\.status = 'DELETED'/i);

  for (const preserved of [
    "accepted_offer_id",
    "matched_at",
    "completed_at",
    "completion_mode",
    "cancelled_at",
    "cancelled_by",
    "cancel_reason",
    "resolved_by_admin_id",
    "decided_at",
    "canonical_target_id",
    "decision_reason",
  ]) {
    assert.doesNotMatch(rewrittenColumns, new RegExp(`\\b${preserved}\\s*=`, "i"));
  }
  assert.doesNotMatch(rewrittenColumns, /\bstatus\s*=/i);
  assert.doesNotMatch(source, /\b(?:DELETE|TRUNCATE)\b/i);
});

test("0064 grants the deletion worker only the authored columns it must rewrite", async () => {
  const source = await migration;

  assert.match(
    source,
    /GRANT SELECT \(user_id\),\s*UPDATE \(name,reference_url,description,media_id\)\s*ON TABLE public\.catalog_requests TO dabboba_worker/i,
  );
  assert.match(
    source,
    /GRANT UPDATE \(title,details\)\s*ON TABLE public\.exchange_listings TO dabboba_worker/i,
  );
  assert.match(
    source,
    /GRANT UPDATE \(message\)\s*ON TABLE public\.exchange_offers TO dabboba_worker/i,
  );
  assert.doesNotMatch(source, /GRANT (?:ALL|UPDATE) ON TABLE public\.(?:catalog_requests|exchange_listings|exchange_offers)/i);
});

test("0064 removes historical authored PII without changing catalog decisions or exchange state", {
  skip: !process.env.DATABASE_MIGRATION_URL,
}, async () => {
  const pool = createMigrationDatabasePool(
    process.env.DATABASE_MIGRATION_URL!,
    "dabboba-account-deletion-authored-data-cleanup-integration",
  );
  const client = await pool.connect();
  const deletedUserId = randomUUID();
  const counterpartyId = randomUUID();
  const mediaId = randomUUID();
  const catalogRequestId = randomUUID();
  const authoredListingId = randomUUID();
  const counterpartyListingId = randomUUID();
  const rejectedOfferId = randomUUID();
  const productId = `cleanup-product-${randomUUID()}`;
  const ipId = `cleanup-ip-${randomUUID()}`;
  const authoredInventoryId = randomUUID();
  const counterpartyInventoryId = randomUUID();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO public.users(id,email,nickname)
       VALUES($1,$2,'cleanup-author'),($3,$4,'cleanup-counterparty')`,
      [
        deletedUserId,
        `cleanup-author-${deletedUserId}@example.test`,
        counterpartyId,
        `cleanup-counterparty-${counterpartyId}@example.test`,
      ],
    );
    await client.query(
      `INSERT INTO public.catalog_ips(id,slug,name_ko,name_en)
       VALUES($1,$2,'cleanup ip','cleanup ip')`,
      [ipId, `cleanup-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO public.catalog_products(id,sku,ip_id,category,name,price,is_active)
       VALUES($1,$2,$3,'gacha','cleanup product',1000,false)`,
      [productId, `cleanup-${randomUUID()}`, ipId],
    );
    await client.query(
      `INSERT INTO public.inventory_units(id,owner_id,product_id,source_type,status)
       VALUES($1,$2,$3,'ADMIN_ADJUSTMENT','OWNED'),
             ($4,$5,$3,'ADMIN_ADJUSTMENT','OWNED')`,
      [authoredInventoryId, deletedUserId, productId, counterpartyInventoryId, counterpartyId],
    );
    await client.query(
      `INSERT INTO public.media_assets
         (id,owner_id,purpose,object_key,declared_mime_type,byte_size,checksum_sha256,status)
       VALUES($1,$2,'CATALOG_REQUEST',$3,'image/webp',12,$4,'READY')`,
      [mediaId, deletedUserId, `cleanup/${mediaId}.webp`, "a".repeat(64)],
    );
    await client.query(
      `INSERT INTO public.catalog_requests
         (id,user_id,kind,name,reference_url,description,media_id,status,
          canonical_target_id,decision_reason,decided_by,decided_at)
       VALUES($1,$2,'PRODUCT','real name','https://example.test/private','private description',$3,
              'REJECTED','preserved-target','preserved decision',$4,now())`,
      [catalogRequestId, deletedUserId, mediaId, counterpartyId],
    );
    await client.query(
      `INSERT INTO public.exchange_listings
         (id,author_id,offered_inventory_unit_id,title,details,status,
          cancelled_at,cancelled_by,cancel_reason)
       VALUES($1,$2,$3,'private listing title','private listing details','CANCELLED',now(),$2,'preserved reason')`,
      [authoredListingId, deletedUserId, authoredInventoryId],
    );
    await client.query(
      `INSERT INTO public.exchange_listings
         (id,author_id,offered_inventory_unit_id,title,details,status,
          cancelled_at,cancelled_by,cancel_reason)
       VALUES($1,$2,$3,'counterparty title','counterparty details','CANCELLED',now(),$2,'counterparty reason')`,
      [counterpartyListingId, counterpartyId, counterpartyInventoryId],
    );
    await client.query(
      `INSERT INTO public.exchange_offers
         (id,listing_id,proposer_id,offered_inventory_unit_id,message,status,decided_at)
       VALUES($1,$2,$3,$4,'private rejected offer','REJECTED',now())`,
      [rejectedOfferId, counterpartyListingId, deletedUserId, authoredInventoryId],
    );
    await client.query(
      `UPDATE public.users
          SET status='DELETED',deleted_at=now()
        WHERE id=$1`,
      [deletedUserId],
    );

    await client.query(await migration);

    const request = await client.query<{
      canonical_target_id: string;
      decision_reason: string;
      description: string | null;
      media_id: string | null;
      name: string;
      reference_url: string | null;
      status: string;
    }>(
      `SELECT name,reference_url,description,media_id,status,canonical_target_id,decision_reason
         FROM public.catalog_requests WHERE id=$1`,
      [catalogRequestId],
    );
    assert.deepEqual(request.rows, [{
      name: "삭제된 카탈로그 요청",
      reference_url: null,
      description: null,
      media_id: null,
      status: "REJECTED",
      canonical_target_id: "preserved-target",
      decision_reason: "preserved decision",
    }]);

    const listing = await client.query<{
      cancel_reason: string;
      cancelled_by: string;
      details: string;
      status: string;
      title: string;
    }>(
      `SELECT title,details,status,cancelled_by,cancel_reason
         FROM public.exchange_listings WHERE id=$1`,
      [authoredListingId],
    );
    assert.deepEqual(listing.rows, [{
      title: "삭제된 교환 게시물",
      details: "삭제된 내용",
      status: "CANCELLED",
      cancelled_by: deletedUserId,
      cancel_reason: "preserved reason",
    }]);

    const offer = await client.query<{ decided_at: Date; message: string; status: string }>(
      `SELECT message,status,decided_at
         FROM public.exchange_offers WHERE id=$1`,
      [rejectedOfferId],
    );
    assert.equal(offer.rows[0]?.message, "삭제된 교환 제안");
    assert.equal(offer.rows[0]?.status, "REJECTED");
    assert.ok(offer.rows[0]?.decided_at instanceof Date);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
