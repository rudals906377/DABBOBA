import type { DatabaseClient } from "@dabboba/db";

type ExpiredPrize = {
  id: string;
  owner_id: string;
  source_type: "GACHA" | "KUJI";
  storage_expires_at: Date;
  storage_return_reference_amount: number;
  storage_return_rate: number;
};

export function storageReturnPoints(referenceAmount: number, source: "GACHA" | "KUJI"): number {
  if (!Number.isSafeInteger(referenceAmount) || referenceAmount <= 0 || referenceAmount > 2_147_483_647) {
    throw new Error("Invalid storage return reference amount");
  }
  return Math.floor(referenceAmount * (source === "GACHA" ? 50 : 15) / 100);
}

/** Caller owns the transaction: balance, ledgers, terminal state and outbox commit together. */
export async function returnExpiredStoragePoints(
  client: DatabaseClient,
  limit: number,
  now: Date,
  shouldContinue: () => boolean,
): Promise<number> {
  const candidates = await client.query<ExpiredPrize>(
    `SELECT inventory.id,inventory.owner_id,inventory.source_type,inventory.storage_expires_at,
            inventory.storage_return_reference_amount,inventory.storage_return_rate
       FROM inventory_units inventory
      WHERE inventory.status='EXPIRED_HOLD' AND inventory.storage_expires_at<=$2
        AND inventory.source_type IN ('GACHA','KUJI')
        AND inventory.storage_return_reference_amount>0
        AND floor(inventory.storage_return_reference_amount::numeric*inventory.storage_return_rate/100)>0
        AND NOT EXISTS (
          SELECT 1 FROM point_accounts account WHERE account.user_id=inventory.owner_id
            AND account.balance>2147483647-floor(inventory.storage_return_reference_amount::numeric*inventory.storage_return_rate/100)
        )
        AND EXISTS (
          SELECT 1 FROM draw_results result
          JOIN draw_entitlements entitlement ON entitlement.id=result.entitlement_id
          JOIN order_lines line ON line.id=entitlement.order_line_id
          JOIN orders source_order ON source_order.id=line.order_id
          WHERE result.prize_inventory_unit_id=inventory.id
            AND source_order.status IN ('PAID','FULFILLED')
        )
        AND NOT EXISTS (SELECT 1 FROM inventory_storage_point_returns credited WHERE credited.inventory_unit_id=inventory.id)
      ORDER BY inventory.owner_id,inventory.id LIMIT $1
      FOR UPDATE OF inventory SKIP LOCKED`,
    [limit, now],
  );
  let credited = 0;
  for (const item of candidates.rows) {
    if (!shouldContinue()) throw new Error("Worker run deadline reached before storage point return");
    const expectedRate = item.source_type === "GACHA" ? 50 : 15;
    if (item.storage_return_rate !== expectedRate) throw new Error("Invalid storage return rate snapshot");
    const amount = storageReturnPoints(item.storage_return_reference_amount, item.source_type);
    // Zero-point/overflow cases keep the item on hold for operator review.
    if (amount === 0) continue;
    await client.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,0) ON CONFLICT DO NOTHING", [item.owner_id]);
    const balance = await client.query(
      `UPDATE point_accounts SET balance=balance+$2,version=version+1
        WHERE user_id=$1 AND balance<=2147483647-$2 RETURNING user_id`,
      [item.owner_id, amount],
    );
    if (balance.rowCount !== 1) continue;
    const event = await client.query<{ id: string; outbox_event_id: string }>(
      `INSERT INTO inventory_storage_expiry_events(inventory_unit_id,owner_id,storage_expires_at,event_kind,outbox_event_id)
       VALUES($1,$2,$3,'POINT_RETURNED',gen_random_uuid()) RETURNING id,outbox_event_id`,
      [item.id, item.owner_id, item.storage_expires_at],
    );
    if (event.rowCount !== 1) throw new Error("Storage point return event missing");
    const evidence = event.rows[0]!;
    await client.query(
      `INSERT INTO inventory_storage_point_returns(inventory_unit_id,expiry_event_id,owner_id,source_type,reference_amount,rate,point_amount)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [item.id, evidence.id, item.owner_id, item.source_type, item.storage_return_reference_amount, expectedRate, amount],
    );
    await client.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',$2,'STORAGE_EXPIRY_RETURN',$3,'보관기간 만료 포인트 환급')`,
      [item.owner_id, amount, item.id],
    );
    const transitioned = await client.query(
      "UPDATE inventory_units SET status='POINT_RETURNED' WHERE id=$1 AND owner_id=$2 AND status='EXPIRED_HOLD' RETURNING id",
      [item.id, item.owner_id],
    );
    if (transitioned.rowCount !== 1) throw new Error("Storage point return state changed");
    await client.query(
      `INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,correlation_id)
       VALUES($1,'INVENTORY_UNIT',$2,'inventory.storage_point_returned',$3,$4)`,
      [evidence.outbox_event_id, item.id, JSON.stringify({ userId: item.owner_id, inventoryUnitId: item.id, pointAmount: amount, rate: expectedRate }), `worker-storage-return:${evidence.outbox_event_id}`],
    );
    credited += 1;
  }
  return credited;
}
