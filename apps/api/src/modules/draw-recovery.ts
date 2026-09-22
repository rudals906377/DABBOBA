import type { FastifyInstance } from "fastify";
import type { PaidGachaDrawCompletion, PaidKujiDrawRecovery, PaidKujiSelectionSnapshot, PublicKujiDeckSnapshot } from "@dabboba/contracts";
import { conflict, notFound } from "../lib/errors.js";
import { uuidInput } from "../lib/input.js";
import { iso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

type RecoveryEntitlement = {
  id: string;
  userId: string;
  productId: string;
  probabilityVersionId: string;
  status: string;
  slotNumber: number | null;
  bindingState: string | null;
};

export type PaidKujiRecoveryRow = {
  order_id: string;
  user_id: string;
  order_status: string;
  payment_status: string;
  product_id: string;
  quantity: number;
  probability_version_id: string;
  probability_version: number;
  room_entry_id: string;
  room_state: string;
  drawing_expires_at: Date | null;
  total_slots: number;
  server_now: Date;
  entitlements: RecoveryEntitlement[];
};

export type PaidKujiSelectionRow = PaidKujiRecoveryRow & {
  product_name_snapshot: string;
  unit_price: number;
  current_image_url: string | null;
  current_ip_name: string | null;
  published_at: Date;
  snapshot_version: number;
  reserved_slot_count: number;
  slots: PublicKujiDeckSnapshot["slots"];
  tiers: PublicKujiDeckSnapshot["tiers"];
};

export type PaidGachaCompletionRow = {
  order_id: string;
  user_id: string;
  order_status: string;
  payment_status: string;
  product_id: string;
  quantity: number;
  probability_version_id: string;
  probability_version: number;
  server_now: Date;
  entitlements: Array<{
    id: string;
    userId: string;
    productId: string;
    probabilityVersionId: string;
    status: string;
    consumedAt: string | null;
    resultId: string | null;
    resultUserId: string | null;
    resultProductId: string | null;
    resultVersion: number | null;
    committedAt: string | null;
  }>;
};

export function paidGachaCompletionResponse(row: PaidGachaCompletionRow): PaidGachaDrawCompletion {
  const quantity = numberValue(row.quantity);
  const version = numberValue(row.probability_version);
  if (
    !["PAID", "FULFILLED"].includes(row.order_status) || row.payment_status !== "PAID"
    || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20
    || row.entitlements.length !== quantity
    || new Set(row.entitlements.map((item) => item.id)).size !== quantity
    || new Set(row.entitlements.map((item) => item.resultId)).size !== quantity
    || row.entitlements.some((item) => (
      item.userId !== row.user_id || item.productId !== row.product_id
      || item.probabilityVersionId !== row.probability_version_id
      || item.status !== "CONSUMED" || !item.consumedAt || !Number.isFinite(Date.parse(item.consumedAt))
      || !item.resultId || item.resultUserId !== row.user_id || item.resultProductId !== row.product_id
      || item.resultVersion !== version || !item.committedAt || !Number.isFinite(Date.parse(item.committedAt))
    ))
  ) throw conflict("주문 전체의 결제 완료와 확정된 가챠 결과를 확인하지 못했습니다.");
  return {
    orderId: row.order_id, userId: row.user_id, productId: row.product_id,
    probabilityVersion: version, serverNow: iso(row.server_now),
    results: row.entitlements.map((item) => ({
      entitlementId: item.id, resultId: item.resultId!, committedAt: new Date(item.committedAt!).toISOString(),
    })),
  };
}

// These aggregates have the same MVCC snapshot as the owned order below. No
// slot-to-tier or slot-to-prize mapping crosses the API boundary.
const selectionColumns = `,
  line.product_name_snapshot,line.unit_price,version.published_at,
  (SELECT image_url FROM catalog_products WHERE id=line.product_id) AS current_image_url,
  (SELECT ip.name_ko FROM catalog_products product JOIN catalog_ips ip ON ip.id=product.ip_id
    WHERE product.id=line.product_id) AS current_ip_name,
  (SELECT version FROM kuji_rooms WHERE product_id=line.product_id) AS snapshot_version,
  (SELECT count(*) FROM kuji_slot_assignments assignment
    JOIN kuji_slot_bindings binding ON binding.slot_assignment_id=assignment.id
    WHERE assignment.probability_version_id=line.probability_version_id
      AND binding.state='RESERVED') AS reserved_slot_count,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'slotNumber',assignment.slot_number,
    'available',NOT EXISTS (SELECT 1 FROM kuji_slot_bindings binding
      WHERE binding.slot_assignment_id=assignment.id AND binding.state IN ('RESERVED','CONSUMED'))
    ) ORDER BY assignment.slot_number)
    FROM kuji_slot_assignments assignment
    WHERE assignment.probability_version_id=line.probability_version_id),'[]'::jsonb) AS slots,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'tierCode',tier.tier_code,'tierRank',tier.tier_rank,'label',entry.rarity,
    'initialQuantity',entry.initial_quantity,
    'remainingQuantity',(SELECT count(*) FROM kuji_slot_assignments assignment
      WHERE assignment.pool_entry_id=tier.pool_entry_id
        AND NOT EXISTS (SELECT 1 FROM kuji_slot_bindings binding
          WHERE binding.slot_assignment_id=assignment.id AND binding.state='CONSUMED'))
    ) ORDER BY tier.tier_rank,tier.tier_code)
    FROM kuji_deck_tiers tier JOIN draw_pool_entries entry ON entry.id=tier.pool_entry_id
    WHERE tier.probability_version_id=line.probability_version_id),'[]'::jsonb) AS tiers`;

export function paidKujiRecoveryResponse(row: PaidKujiRecoveryRow): PaidKujiDrawRecovery {
  if (!["PAID", "FULFILLED"].includes(row.order_status) || row.payment_status !== "PAID") {
    throw conflict("결제 완료된 쿠지 주문만 이어서 열 수 있습니다.");
  }
  if (!["DRAWING", "EXPIRED", "COMPLETED"].includes(row.room_state) || !row.drawing_expires_at) {
    throw conflict("결제한 쿠지 뽑기방 정보를 확인할 수 없습니다.");
  }

  const entitlements = row.entitlements;
  const bound = entitlements.filter((item) => item.bindingState !== null);
  if (
    entitlements.length !== numberValue(row.quantity)
    || new Set(entitlements.map((item) => item.id)).size !== entitlements.length
    || entitlements.some((item) => (
      item.userId !== row.user_id
      || item.productId !== row.product_id
      || item.probabilityVersionId !== row.probability_version_id
      || !["AVAILABLE", "CONSUMED"].includes(item.status)
    ))
    || (bound.length !== 0 && bound.length !== entitlements.length)
    || new Set(bound.map((item) => item.slotNumber)).size !== bound.length
    || bound.some((item) => (
      !Number.isInteger(item.slotNumber)
      || item.slotNumber! < 1
      || item.slotNumber! > numberValue(row.total_slots)
      || item.bindingState !== (item.status === "AVAILABLE" ? "RESERVED" : "CONSUMED")
    ))
    || (bound.length === 0 && entitlements.some((item) => item.status === "CONSUMED"))
    || (row.room_state === "COMPLETED" && entitlements.some((item) => item.status === "AVAILABLE"))
  ) {
    throw conflict("구매한 추첨권과 쿠지 번호 연결을 안전하게 확인할 수 없습니다.");
  }

  const remaining = entitlements.filter((item) => item.status === "AVAILABLE");
  return {
    orderId: row.order_id,
    userId: row.user_id,
    productId: row.product_id,
    roomEntryId: row.room_entry_id,
    roomState: row.room_state as PaidKujiDrawRecovery["roomState"],
    serverNow: iso(row.server_now),
    drawingExpiresAt: iso(row.drawing_expires_at),
    probabilityVersion: numberValue(row.probability_version),
    totalSlots: numberValue(row.total_slots),
    entitlementIds: remaining.map((item) => item.id),
    bindings: remaining.filter((item) => item.bindingState === "RESERVED").map((item) => ({
      entitlementId: item.id,
      slotNumber: item.slotNumber!,
      state: "RESERVED" as const,
    })),
  };
}

export function paidKujiSelectionResponse(row: PaidKujiSelectionRow): PaidKujiSelectionSnapshot {
  const recovery = paidKujiRecoveryResponse(row);
  let board: PublicKujiDeckSnapshot | null = null;
  if (recovery.entitlementIds.length && !recovery.bindings.length) {
    const total = numberValue(row.total_slots);
    const available = row.slots.filter((slot) => slot.available).length;
    const reserved = numberValue(row.reserved_slot_count);
    if (
      row.slots.length !== total
      || row.slots.some((slot, index) => slot.slotNumber !== index + 1 || typeof slot.available !== "boolean")
      || !row.tiers.length
      || new Set(row.tiers.map((tier) => tier.tierCode)).size !== row.tiers.length
      || row.tiers.some((tier) => (
        !Number.isSafeInteger(tier.initialQuantity) || tier.initialQuantity < 1
        || !Number.isSafeInteger(tier.remainingQuantity) || tier.remainingQuantity < 0
        || tier.remainingQuantity > tier.initialQuantity
      ))
      || row.tiers.reduce((sum, tier) => sum + tier.initialQuantity, 0) !== total
      || row.tiers.reduce((sum, tier) => sum + tier.remainingQuantity, 0) !== available + reserved
      || available < recovery.entitlementIds.length
    ) throw conflict("구매한 쿠지 번호판의 남은 수량을 안전하게 확인할 수 없습니다.");
    board = {
      productId: recovery.productId,
      probabilityVersion: recovery.probabilityVersion,
      snapshotVersion: numberValue(row.snapshot_version),
      totalSlots: total,
      publishedAt: iso(row.published_at),
      calculatedAt: recovery.serverNow,
      slots: row.slots.map((slot) => ({ slotNumber: slot.slotNumber, available: slot.available })),
      tiers: row.tiers.map((tier) => ({
        tierCode: tier.tierCode, tierRank: tier.tierRank, label: tier.label,
        initialQuantity: tier.initialQuantity, remainingQuantity: tier.remainingQuantity,
      })),
    };
  }
  return {
    recovery,
    product: {
      name: row.product_name_snapshot,
      category: "kuji",
      unitPrice: numberValue(row.unit_price),
      currentImageUrl: row.current_image_url,
      currentIpName: row.current_ip_name,
    },
    board,
  };
}

async function loadPaidKujiOrder(context: ApiContext, orderId: string, userId: string, includeSelection: boolean) {
  // A single statement protects consistency without renewing or locking room occupancy.
  const result = await context.pool.query<PaidKujiSelectionRow>(
        `SELECT orders.id AS order_id,orders.user_id,orders.status AS order_status,
                payment.status AS payment_status,line.product_id,line.quantity,
                line.probability_version_id,version.version AS probability_version,
                room.id AS room_entry_id,room.state AS room_state,room.drawing_expires_at,
                deck.total_slots,statement_timestamp() AS server_now,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id',entitlement.id,'userId',entitlement.user_id,
                    'productId',entitlement.product_id,
                    'probabilityVersionId',entitlement.probability_version_id,
                    'status',entitlement.status,'slotNumber',assignment.slot_number,
                    'bindingState',binding.state
                  ) ORDER BY entitlement.created_at,entitlement.id)
                    FROM draw_entitlements AS entitlement
                    LEFT JOIN kuji_slot_bindings AS binding
                      ON binding.entitlement_id=entitlement.id
                     AND binding.room_entry_id=room.id
                     AND binding.state IN ('RESERVED','CONSUMED')
                    LEFT JOIN kuji_slot_assignments AS assignment
                      ON assignment.id=binding.slot_assignment_id
                     AND assignment.probability_version_id=line.probability_version_id
                   WHERE entitlement.order_line_id=line.id
                ),'[]'::jsonb) AS entitlements
                ${includeSelection ? selectionColumns : ""}
           FROM orders
           JOIN payments AS payment ON payment.order_id=orders.id
           JOIN order_lines AS line ON line.order_id=orders.id
           JOIN draw_probability_versions AS version ON version.id=line.probability_version_id
           JOIN kuji_decks AS deck ON deck.probability_version_id=version.id
           JOIN kuji_room_entries AS room
             ON room.order_id=orders.id AND room.user_id=orders.user_id
            AND room.product_id=line.product_id
          WHERE orders.id=$1 AND orders.user_id=$2
            AND line.category_snapshot='kuji'
            AND version.product_id=line.product_id AND version.published_at IS NOT NULL
            AND (SELECT count(*) FROM order_lines WHERE order_id=orders.id)=1`,
    [orderId, userId],
  );
  if (!result.rowCount) throw notFound("본인이 결제한 쿠지 주문을 찾을 수 없습니다.");
  if (result.rows.length !== 1) throw conflict("쿠지 주문 정보를 안전하게 확인할 수 없습니다.");
  return result.rows[0]!;
}

export async function registerDrawRecoveryRoutes(app: FastifyInstance, context: ApiContext) {
  app.get(
    "/v1/orders/:orderId/draw-completion",
    { preHandler: context.auth.requireUser },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const orderId = uuidInput((request.params as Record<string, unknown>).orderId, "orderId");
      // Read the entire original order and immutable results in one MVCC snapshot.
      // Never probe completion with consume, or infer it from an empty AVAILABLE page.
      const result = await context.pool.query<PaidGachaCompletionRow>(
        `SELECT orders.id AS order_id,orders.user_id,orders.status AS order_status,
                payment.status AS payment_status,line.product_id,line.quantity,
                line.probability_version_id,version.version AS probability_version,
                statement_timestamp() AS server_now,
                COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id',entitlement.id,'userId',entitlement.user_id,'productId',entitlement.product_id,
                  'probabilityVersionId',entitlement.probability_version_id,
                  'status',entitlement.status,'consumedAt',entitlement.consumed_at,
                  'resultId',draw.id,'resultUserId',draw.user_id,'resultProductId',draw.product_id,
                  'resultVersion',draw.probability_version,'committedAt',draw.committed_at
                ) ORDER BY entitlement.created_at,entitlement.id)
                  FROM draw_entitlements entitlement
                  LEFT JOIN draw_results draw ON draw.entitlement_id=entitlement.id
                 WHERE entitlement.order_line_id=line.id),'[]'::jsonb) AS entitlements
           FROM orders
           JOIN payments payment ON payment.order_id=orders.id
           JOIN order_lines line ON line.order_id=orders.id
           JOIN draw_probability_versions version ON version.id=line.probability_version_id
          WHERE orders.id=$1 AND orders.user_id=$2
            AND line.category_snapshot='gacha' AND version.product_id=line.product_id
            AND version.published_at IS NOT NULL
            AND (SELECT count(*) FROM order_lines WHERE order_id=orders.id)=1`,
        [orderId, request.actor!.userId],
      );
      if (!result.rowCount) throw notFound("본인이 결제한 가챠 주문을 찾을 수 없습니다.");
      if (result.rows.length !== 1) throw conflict("가챠 주문 정보를 안전하게 확인할 수 없습니다.");
      return reply.code(200).send(paidGachaCompletionResponse(result.rows[0]!));
    },
  );
  app.get(
    "/v1/orders/:orderId/draw-recovery",
    { preHandler: context.auth.requireUser },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const orderId = uuidInput((request.params as Record<string, unknown>).orderId, "orderId");
      const row = await loadPaidKujiOrder(context, orderId, request.actor!.userId, false);
      return reply.code(200).send(paidKujiRecoveryResponse(row));
    },
  );
  app.get(
    "/v1/orders/:orderId/kuji-selection",
    { preHandler: context.auth.requireUser },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const orderId = uuidInput((request.params as Record<string, unknown>).orderId, "orderId");
      const row = await loadPaidKujiOrder(context, orderId, request.actor!.userId, true);
      return reply.code(200).send(paidKujiSelectionResponse(row));
    },
  );
}
