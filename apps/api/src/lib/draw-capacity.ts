import type { DatabaseClient } from "@dabboba/db";
import { conflict } from "./errors.js";
import { numberValue } from "./rows.js";

export type DrawCapacity = {
  unlimited: boolean;
  remainingPrizeUnits: number | null;
  outstandingEntitlements: number;
  sellableUnits: number | null;
};

export async function assertDrawCapacity(
  client: DatabaseClient,
  input: { probabilityVersionId: string; productId: string; onHand: number; requireQuantityRatio?: boolean },
): Promise<DrawCapacity> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))", [
    `draw-capacity:${input.probabilityVersionId}`,
  ]);
  const entries = await client.query<{ weight: number | string; remaining_quantity: number | string | null }>(
    "SELECT weight,remaining_quantity FROM draw_pool_entries WHERE probability_version_id=$1 ORDER BY id FOR UPDATE",
    [input.probabilityVersionId],
  );
  if (!entries.rowCount) throw conflict("추첨 경품 구성이 비어 있습니다.");
  if (input.requireQuantityRatio && entries.rows.some((entry) =>
    numberValue(entry.weight) !== 1 || entry.remaining_quantity === null
  )) throw conflict("가챠는 상세상품별 남은 수량으로 확률을 계산합니다. 기존 가중치·무제한 구성을 교체해 주세요.");
  if (entries.rows.some((entry) => entry.remaining_quantity === null)) {
    return { unlimited: true, remainingPrizeUnits: null, outstandingEntitlements: 0, sellableUnits: null };
  }
  const remainingPrizeUnits = entries.rows.reduce(
    (sum, entry) => sum + numberValue(entry.remaining_quantity),
    0,
  );
  const outstanding = await client.query<{ count: string }>(
    `SELECT count(*) FROM draw_entitlements
      WHERE product_id=$1 AND probability_version_id=$2 AND status='AVAILABLE'`,
    [input.productId, input.probabilityVersionId],
  );
  const outstandingEntitlements = numberValue(outstanding.rows[0]?.count);
  const sellableUnits = remainingPrizeUnits - outstandingEntitlements;
  if (sellableUnits < 0 || input.onHand > sellableUnits) {
    throw conflict("판매 재고가 남은 추첨 경품 수량을 초과합니다. 재고 또는 확률표를 조정해 주세요.");
  }
  return { unlimited: false, remainingPrizeUnits, outstandingEntitlements, sellableUnits };
}
