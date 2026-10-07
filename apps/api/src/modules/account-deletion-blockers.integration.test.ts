import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabasePool } from "@dabboba/db";
import { loadDeletionBlockers } from "./account.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "settled paid orders and finished exchanges do not block account deletion; unsettled ones still do",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-deletion-blockers-integration");
    t.after(async () => { await pool.end(); });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const user = async (label: string) => (await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
      [`${label}-${suffix}@example.test`, `${label} ${suffix}`],
    )).rows[0]!.id;
    const buyer = await user("deletion-buyer");
    const author = await user("deletion-author");
    const proposer = await user("deletion-proposer");

    const ipId = `deletion-ip-${suffix}`;
    const productId = `deletion-gacha-${suffix}`;
    await pool.query("INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$3)", [ipId, ipId, `탈퇴 ${suffix}`]);
    await pool.query(
      "INSERT INTO catalog_products(id,sku,ip_id,category,name,price) VALUES($1,$2,$3,'gacha',$4,3000)",
      [productId, `DEL-${suffix}`.toUpperCase(), ipId, `탈퇴 테스트 ${suffix}`],
    );

    // A paid order whose draws were all used and whose prizes are gone is settled.
    const paidOrder = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,status,subtotal,total,paid_at) VALUES($1,'PAID',3000,3000,now()) RETURNING id",
      [buyer],
    );
    await pool.query(
      "INSERT INTO payments(order_id,provider,status,amount,paid_at) VALUES($1,'TEST_PG','PAID',3000,now())",
      [paidOrder.rows[0]!.id],
    );
    const settled = await loadDeletionBlockers(pool, buyer);
    assert.equal(settled.activeOrderCount, 0);
    assert.equal(settled.activePaymentCount, 0);

    // An order frozen for a refund still blocks.
    const frozenOrder = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,status,subtotal,total,paid_at) VALUES($1,'REFUND_REVIEW',3000,3000,now()) RETURNING id",
      [buyer],
    );
    await pool.query(
      "INSERT INTO payments(order_id,provider,status,amount,paid_at) VALUES($1,'TEST_PG','REFUND_REVIEW',3000,now())",
      [frozenOrder.rows[0]!.id],
    );
    const frozen = await loadDeletionBlockers(pool, buyer);
    assert.equal(frozen.activeOrderCount, 1);
    assert.equal(frozen.activePaymentCount, 1);

    // An accepted offer blocks the proposer only while its listing is MATCHED.
    const unit = async (owner: string) => (await pool.query<{ id: string }>(
      "INSERT INTO inventory_units(owner_id,product_id,source_type,status) VALUES($1,$2,'GACHA','TRANSFERRED') RETURNING id",
      [owner, productId],
    )).rows[0]!.id;
    const acceptedListing = async (status: "COMPLETED" | "MATCHED" | "CANCELLED") => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const listing = await client.query<{ id: string }>(
          `INSERT INTO exchange_listings(author_id,offered_inventory_unit_id,title,details,status)
           VALUES($1,$2,'교환',' ','OPEN') RETURNING id`,
          [author, await unit(author)],
        );
        const offer = await client.query<{ id: string }>(
          `INSERT INTO exchange_offers(listing_id,proposer_id,offered_inventory_unit_id,message,status)
           VALUES($1,$2,$3,' ','ACCEPTED') RETURNING id`,
          [listing.rows[0]!.id, proposer, await unit(proposer)],
        );
        await client.query(
          "UPDATE exchange_listings SET status='MATCHED',accepted_offer_id=$2,matched_at=now() WHERE id=$1",
          [listing.rows[0]!.id, offer.rows[0]!.id],
        );
        if (status === "COMPLETED") {
          await client.query(
            "UPDATE exchange_listings SET status='COMPLETED',completed_at=now(),completion_mode='MUTUAL_CONFIRMATION' WHERE id=$1",
            [listing.rows[0]!.id],
          );
        } else if (status === "CANCELLED") {
          await client.query(
            "UPDATE exchange_listings SET status='CANCELLED',cancelled_at=now(),cancelled_by=$2,cancel_reason='AUTHOR_CANCELLED' WHERE id=$1",
            [listing.rows[0]!.id, author],
          );
        }
        await client.query("COMMIT");
        return listing.rows[0]!.id;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    await acceptedListing("COMPLETED");
    await acceptedListing("CANCELLED");
    assert.equal((await loadDeletionBlockers(pool, proposer)).activeExchangeOfferCount, 0);
    await acceptedListing("MATCHED");
    assert.equal((await loadDeletionBlockers(pool, proposer)).activeExchangeOfferCount, 1);
  },
);
