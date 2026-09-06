import type { FastifyInstance, FastifyReply } from "fastify";
import {
  KUJI_CHECKOUT_LEASE_SECONDS,
  bumpKujiRoomVersion,
  kujiCheckoutExpiry,
  lockKujiRoomAdvisories,
  promoteNextKujiRoomEntryLocked,
  withTransaction,
  type DatabaseClient,
  type KujiRoomEntryState,
} from "@dabboba/db";
import { conflict, notFound } from "../lib/errors.js";
import { writeOutbox } from "../lib/audit.js";
import { slugIdInput, uuidInput } from "../lib/input.js";
import { releasePendingOrder } from "../lib/pending-order-release.js";
import { iso, nullableIso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

export { KUJI_CHECKOUT_LEASE_SECONDS, kujiCheckoutExpiry };
const RECENT_ACTIVITY_LIMIT = 8;

type KujiRoomEntryRow = {
  id: string;
  product_id: string;
  user_id: string;
  state: KujiRoomEntryState;
  queue_sequence: string | number | bigint;
  joined_at: Date;
  checkout_expires_at: Date | null;
  drawing_expires_at: Date | null;
  nickname: string;
};

type RecentActivityRow = {
  id: string;
  nickname: string;
  prize_name_snapshot: string;
  prize_image_url_snapshot: string | null;
  rarity: string;
  committed_at: Date;
};

export function maskKujiDisplayName(value: string): string {
  const characters = Array.from(value.trim() || "사용자");
  if (characters.length === 1) return `${characters[0]}*`;
  if (characters.length === 2) return `${characters[0]}*`;
  return `${characters[0]}${"*".repeat(Math.min(2, characters.length - 2))}${characters.at(-1)}`;
}

async function lockActorAndRoom(
  client: DatabaseClient,
  input: { productId: string; userId: string; createRoom: boolean },
): Promise<void> {
  await lockKujiRoomAdvisories(client, { userId: input.userId, productId: input.productId });
  const exists = await client.query(
    "SELECT 1 FROM catalog_products WHERE id=$1 AND category='kuji'",
    [input.productId],
  );
  if (!exists.rowCount) throw notFound("쿠지 상품을 찾을 수 없습니다.");
  if (input.createRoom) {
    await client.query(
      "INSERT INTO kuji_rooms(product_id) VALUES($1) ON CONFLICT (product_id) DO NOTHING",
      [input.productId],
    );
  }
  const room = await client.query<{ version: string | number | bigint }>(
    "SELECT version FROM kuji_rooms WHERE product_id=$1 FOR UPDATE",
    [input.productId],
  );
  if (!room.rowCount) throw notFound("쿠지 대기실을 찾을 수 없습니다.");

}

async function lockKujiProductState(
  client: DatabaseClient,
  productId: string,
): Promise<boolean> {
  const product = await client.query<{
    is_active: boolean;
    is_prize_only: boolean;
    has_stock: boolean;
    has_drawable_pool: boolean;
  }>(
    `SELECT p.is_active,p.is_prize_only,
            COALESCE(s.on_hand-s.reserved>0,false) AS has_stock,
            EXISTS (
              SELECT 1
                FROM draw_probability_versions v
                JOIN kuji_decks deck ON deck.probability_version_id=v.id
                JOIN draw_pool_entries e ON e.probability_version_id=v.id
               WHERE v.product_id=p.id
                 AND v.status='ACTIVE'
                 AND (e.remaining_quantity IS NULL OR e.remaining_quantity>0)
            ) AS has_drawable_pool
     FROM catalog_products p
     JOIN product_stock s ON s.product_id=p.id
     WHERE p.id=$1 AND p.category='kuji'
     FOR UPDATE OF p,s`,
    [productId],
  );
  if (!product.rowCount) throw notFound("쿠지 상품을 찾을 수 없습니다.");
  const row = product.rows[0]!;
  return row.is_active && !row.is_prize_only && row.has_stock && row.has_drawable_pool;
}

export async function expireAndPromoteKujiRoomLocked(
  client: DatabaseClient,
  input: { productId: string; serverNow: Date; requestId: string },
): Promise<{ changed: boolean; promotedEntryId: string | null }> {
  const expiring = await client.query<{
    id: string;
    state: "CHECKOUT_PENDING" | "DRAWING";
    order_id: string | null;
  }>(
    `SELECT id,state,order_id
       FROM kuji_room_entries
      WHERE product_id=$1
        AND (
          (state='CHECKOUT_PENDING' AND checkout_expires_at <= $2)
          OR (state='DRAWING' AND drawing_expires_at <= $2)
        )
      LIMIT 1
      FOR UPDATE`,
    [input.productId, input.serverNow],
  );

  const expiringEntry = expiring.rows[0] ?? null;
  if (expiringEntry?.order_id) {
    const payment = await client.query<{ id: string; status: string }>(
      "SELECT id,status FROM payments WHERE order_id=$1 FOR UPDATE",
      [expiringEntry.order_id],
    );
    const order = await client.query<{
      id: string;
      user_id: string;
      status: string;
      point_total: number;
      cancelled_at: Date | null;
    }>(
      "SELECT id,user_id,status,point_total,cancelled_at FROM orders WHERE id=$1 FOR UPDATE",
      [expiringEntry.order_id],
    );
    if (!payment.rowCount || !order.rowCount) {
      throw conflict("연결된 쿠지 주문 정보를 안전하게 확인할 수 없습니다.");
    }

    const paymentRow = payment.rows[0]!;
    const orderRow = order.rows[0]!;
    if (expiringEntry.state === "CHECKOUT_PENDING") {
      const unpaidPayment = ["PENDING", "FAILED", "CANCELLED"].includes(paymentRow.status);
      const reconciliationPayment = ["AUTHORIZED", "REFUND_REVIEW"].includes(paymentRow.status);
      const reconciliationRequired = reconciliationPayment || orderRow.status === "REFUND_REVIEW";
      const releasableOrder = ["PENDING_PAYMENT", "CANCELLED", "REFUND_REVIEW"].includes(orderRow.status);
      if (!releasableOrder || (!unpaidPayment && !reconciliationPayment)) {
        throw conflict("결제 상태가 변경된 쿠지 주문은 자동 만료할 수 없습니다.");
      }

      await releasePendingOrder(client, orderRow, "KUJI_CHECKOUT_LEASE_EXPIRED");
      if (reconciliationRequired) {
        await client.query(
          "UPDATE payments SET status='REFUND_REVIEW',version=version+1 WHERE id=$1 AND status IN ('AUTHORIZED','REFUND_REVIEW')",
          [paymentRow.id],
        );
        await client.query(
          `UPDATE orders
              SET status='REFUND_REVIEW',cancelled_at=COALESCE(cancelled_at,$2),version=version+1
            WHERE id=$1 AND status IN ('PENDING_PAYMENT','CANCELLED','REFUND_REVIEW')`,
          [orderRow.id, input.serverNow],
        );
        await writeOutbox(client, input.requestId, {
          aggregateType: "PAYMENT",
          aggregateId: paymentRow.id,
          eventType: "payment.kuji_checkout_expired_requires_reconciliation",
          payload: {
            paymentId: paymentRow.id,
            orderId: orderRow.id,
            roomEntryId: expiringEntry.id,
            previousPaymentStatus: paymentRow.status,
          },
        });
      } else {
        await client.query(
          "UPDATE payments SET status='CANCELLED',version=version+1 WHERE id=$1 AND status='PENDING'",
          [paymentRow.id],
        );
        await client.query(
          `UPDATE orders
              SET status='CANCELLED',cancelled_at=COALESCE(cancelled_at,$2),version=version+1
            WHERE id=$1 AND status IN ('PENDING_PAYMENT','CANCELLED')`,
          [orderRow.id, input.serverNow],
        );
        await writeOutbox(client, input.requestId, {
          aggregateType: "ORDER",
          aggregateId: orderRow.id,
          eventType: "order.cancelled",
          payload: {
            orderId: orderRow.id,
            userId: orderRow.user_id,
            reason: "KUJI_CHECKOUT_LEASE_EXPIRED",
          },
        });
      }
    } else if (
      !["PAID", "FULFILLED", "REFUND_REVIEW", "REFUNDED"].includes(orderRow.status)
      || !["PAID", "REFUND_REVIEW", "REFUNDED"].includes(paymentRow.status)
    ) {
      throw conflict("결제 완료 상태를 확인할 수 없는 쿠지 뽑기방은 자동 만료할 수 없습니다.");
    }
  }

  let expiredEntryId: string | null = null;
  if (expiringEntry) {
    const expired = await client.query<{ id: string }>(
      `UPDATE kuji_room_entries
          SET state='EXPIRED',resolved_at=$2
        WHERE id=$1 AND state=$3
        RETURNING id`,
      [expiringEntry.id, input.serverNow, expiringEntry.state],
    );
    if (!expired.rowCount) throw conflict("쿠지 대기실 상태가 동시에 변경되었습니다.");
    expiredEntryId = expired.rows[0]!.id;
    if (expiringEntry.state === "DRAWING" && expiringEntry.order_id) {
      await writeOutbox(client, input.requestId, {
        aggregateType: "ORDER",
        aggregateId: expiringEntry.order_id,
        eventType: "kuji.drawing_lease_expired",
        payload: {
          orderId: expiringEntry.order_id,
          roomEntryId: expiringEntry.id,
          entitlementsRemainConsumable: true,
        },
      });
    }
  }

  const active = await client.query<{ id: string }>(
    `SELECT id FROM kuji_room_entries
     WHERE product_id=$1 AND state IN ('CHECKOUT_PENDING','DRAWING')
     LIMIT 1
     FOR UPDATE`,
    [input.productId],
  );
  if (active.rowCount) {
    return { changed: expiredEntryId !== null, promotedEntryId: null };
  }

  const promotedEntryId = await promoteNextKujiRoomEntryLocked(client, input);
  if (!promotedEntryId) {
    return { changed: expiredEntryId !== null, promotedEntryId: null };
  }
  return { changed: true, promotedEntryId };
}

async function roomSnapshot(
  client: DatabaseClient,
  input: { productId: string; entryId: string; userId: string; serverNow: Date },
) {
  const room = await client.query<{ version: string | number | bigint }>(
    "SELECT version FROM kuji_rooms WHERE product_id=$1",
    [input.productId],
  );
  const viewer = await client.query<KujiRoomEntryRow>(
    `SELECT e.*,u.nickname
     FROM kuji_room_entries e
     JOIN users u ON u.id=e.user_id
     WHERE e.product_id=$1 AND e.id=$2 AND e.user_id=$3`,
    [input.productId, input.entryId, input.userId],
  );
  if (!viewer.rowCount || !room.rowCount) throw notFound("쿠지 대기실 참여 내역을 찾을 수 없습니다.");

  const active = await client.query<KujiRoomEntryRow>(
    `SELECT e.*,u.nickname
     FROM kuji_room_entries e
     JOIN users u ON u.id=e.user_id
     WHERE e.product_id=$1 AND e.state IN ('CHECKOUT_PENDING','DRAWING')
     LIMIT 1`,
    [input.productId],
  );
  const waiting = await client.query<KujiRoomEntryRow>(
    `SELECT e.*,u.nickname
     FROM kuji_room_entries e
     JOIN users u ON u.id=e.user_id
     WHERE e.product_id=$1 AND e.state='WAITING'
     ORDER BY e.queue_sequence`,
    [input.productId],
  );
  const activity = await client.query<RecentActivityRow>(
    `SELECT r.id,u.nickname,p.prize_name_snapshot,p.prize_image_url_snapshot,p.rarity,r.committed_at
     FROM draw_results r
     JOIN users u ON u.id=r.user_id
     JOIN draw_pool_entries p ON p.id=r.pool_entry_id
     WHERE r.product_id=$1
     ORDER BY r.committed_at DESC,r.id DESC
     LIMIT $2`,
    [input.productId, RECENT_ACTIVITY_LIMIT],
  );

  const viewerRow = viewer.rows[0]!;
  const waitingIndex = waiting.rows.findIndex((entry) => entry.id === viewerRow.id);
  const viewerPosition = waitingIndex >= 0 ? waitingIndex + 1 : null;
  const activeRow = active.rows[0] || null;
  return {
    serverNow: iso(input.serverNow),
    version: numberValue(room.rows[0]!.version),
    productId: input.productId,
    viewer: {
      entryId: viewerRow.id,
      state: viewerRow.state,
      position: viewerPosition,
      peopleAhead: viewerPosition === null ? 0 : viewerPosition - 1,
      checkoutExpiresAt: viewerRow.state === "CHECKOUT_PENDING"
        ? nullableIso(viewerRow.checkout_expires_at)
        : null,
      drawingExpiresAt: ["DRAWING", "EXPIRED"].includes(viewerRow.state)
        ? nullableIso(viewerRow.drawing_expires_at)
        : null,
    },
    active: activeRow
      ? {
          displayName: maskKujiDisplayName(activeRow.nickname),
          phase: activeRow.state as "CHECKOUT_PENDING" | "DRAWING",
          checkoutExpiresAt: activeRow.state === "CHECKOUT_PENDING"
            ? nullableIso(activeRow.checkout_expires_at)
            : null,
        }
      : null,
    waitingCount: waiting.rows.length,
    waitingPeople: waiting.rows.map((entry, index) => ({
      entryId: entry.id,
      displayName: maskKujiDisplayName(entry.nickname),
      position: index + 1,
      isViewer: entry.id === viewerRow.id,
    })),
    recentActivity: activity.rows.map((item) => ({
      id: item.id,
      displayName: maskKujiDisplayName(item.nickname),
      prizeName: item.prize_name_snapshot,
      prizeImageUrl: item.prize_image_url_snapshot,
      rarity: item.rarity,
      committedAt: iso(item.committed_at),
    })),
  };
}

function noStore(reply: FastifyReply) {
  reply.header("cache-control", "no-store");
}

export async function registerKujiRoomRoutes(app: FastifyInstance, context: ApiContext) {
  app.post(
    "/v1/kuji/rooms/:productId/entries",
    { preHandler: context.auth.requireUser },
    async (request, reply) => {
      noStore(reply);
      const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
      const userId = request.actor!.userId;
      const result = await withTransaction(context.pool, async (client) => {
        await lockActorAndRoom(client, { productId, userId, createRoom: true });
        const time = await client.query<{ server_now: Date }>("SELECT clock_timestamp() AS server_now");
        const serverNow = time.rows[0]!.server_now;
        const settled = await expireAndPromoteKujiRoomLocked(client, {
          productId,
          serverNow,
          requestId: request.id,
        });
        const joinable = await lockKujiProductState(client, productId);
        const existing = await client.query<{ id: string; product_id: string }>(
          `SELECT id,product_id FROM kuji_room_entries
           WHERE user_id=$1 AND state IN ('WAITING','CHECKOUT_PENDING','DRAWING')
           LIMIT 1
           FOR UPDATE`,
          [userId],
        );
        if (existing.rowCount) {
          const entry = existing.rows[0]!;
          if (entry.product_id !== productId) {
            if (settled.changed) await bumpKujiRoomVersion(client, productId);
            return {
              activeElsewhere: { productId: entry.product_id, entryId: entry.id },
            };
          }
          if (settled.changed) await bumpKujiRoomVersion(client, productId);
          return {
            replay: true,
            snapshot: await roomSnapshot(client, { productId, entryId: entry.id, userId, serverNow }),
          };
        }

        if (!joinable) {
          if (settled.changed) await bumpKujiRoomVersion(client, productId);
          return { unavailable: true as const };
        }

        const occupied = await client.query(
          `SELECT 1 FROM kuji_room_entries
           WHERE product_id=$1 AND state IN ('CHECKOUT_PENDING','DRAWING')
           LIMIT 1`,
          [productId],
        );
        const state: KujiRoomEntryState = occupied.rowCount ? "WAITING" : "CHECKOUT_PENDING";
        const checkoutStartedAt = state === "CHECKOUT_PENDING" ? serverNow : null;
        const checkoutExpiresAt = checkoutStartedAt ? kujiCheckoutExpiry(checkoutStartedAt) : null;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO kuji_room_entries(
             product_id,user_id,state,joined_at,checkout_started_at,checkout_expires_at
           ) VALUES($1,$2,$3,$4,$5,$6)
           RETURNING id`,
          [productId, userId, state, serverNow, checkoutStartedAt, checkoutExpiresAt],
        );
        const entryId = inserted.rows[0]!.id;
        await bumpKujiRoomVersion(client, productId);
        return {
          replay: false,
          snapshot: await roomSnapshot(client, { productId, entryId, userId, serverNow }),
        };
      });
      if ("unavailable" in result) throw conflict("현재 참여할 수 없는 쿠지 상품입니다.");
      if ("activeElsewhere" in result) {
        throw conflict(
          "이미 다른 쿠지 대기실 또는 뽑기 절차에 참여 중입니다.",
          result.activeElsewhere,
        );
      }
      if (result.replay) reply.header("x-idempotent-replay", "true");
      return reply.code(result.replay ? 200 : 201).send(result.snapshot);
    },
  );

  app.get(
    "/v1/kuji/rooms/:productId/entries/:entryId",
    { preHandler: context.auth.requireUser },
    async (request, reply) => {
      noStore(reply);
      const params = request.params as Record<string, unknown>;
      const productId = slugIdInput(params.productId, "productId");
      const entryId = uuidInput(params.entryId, "entryId");
      const userId = request.actor!.userId;
      const snapshot = await withTransaction(context.pool, async (client) => {
        await lockActorAndRoom(client, { productId, userId, createRoom: false });
        const owned = await client.query(
          "SELECT 1 FROM kuji_room_entries WHERE product_id=$1 AND id=$2 AND user_id=$3 FOR UPDATE",
          [productId, entryId, userId],
        );
        if (!owned.rowCount) throw notFound("쿠지 대기실 참여 내역을 찾을 수 없습니다.");
        const time = await client.query<{ server_now: Date }>("SELECT clock_timestamp() AS server_now");
        const serverNow = time.rows[0]!.server_now;
        const settled = await expireAndPromoteKujiRoomLocked(client, {
          productId,
          serverNow,
          requestId: request.id,
        });
        await lockKujiProductState(client, productId);
        if (settled.changed) await bumpKujiRoomVersion(client, productId);
        return roomSnapshot(client, { productId, entryId, userId, serverNow });
      });
      return reply.code(200).send(snapshot);
    },
  );

  app.delete(
    "/v1/kuji/rooms/:productId/entries/:entryId",
    { preHandler: context.auth.requireUser },
    async (request, reply) => {
      noStore(reply);
      const params = request.params as Record<string, unknown>;
      const productId = slugIdInput(params.productId, "productId");
      const entryId = uuidInput(params.entryId, "entryId");
      const userId = request.actor!.userId;
      const snapshot = await withTransaction(context.pool, async (client) => {
        await lockActorAndRoom(client, { productId, userId, createRoom: false });
        const owned = await client.query<{
          state: KujiRoomEntryState;
          order_id: string | null;
          checkout_expires_at: Date | null;
        }>(
          "SELECT state,order_id,checkout_expires_at FROM kuji_room_entries WHERE product_id=$1 AND id=$2 AND user_id=$3 FOR UPDATE",
          [productId, entryId, userId],
        );
        if (!owned.rowCount) throw notFound("쿠지 대기실 참여 내역을 찾을 수 없습니다.");
        const roomEntry = owned.rows[0]!;
        if (roomEntry.state === "DRAWING") {
          throw conflict("이미 뽑기가 시작된 쿠지방은 대기 취소로 종료할 수 없습니다.");
        }
        const time = await client.query<{ server_now: Date }>("SELECT clock_timestamp() AS server_now");
        const serverNow = time.rows[0]!.server_now;

        if (roomEntry.order_id) {
          const payment = await client.query<{ id: string; status: string }>(
            "SELECT id,status FROM payments WHERE order_id=$1 FOR UPDATE",
            [roomEntry.order_id],
          );
          const order = await client.query<{
            id: string;
            user_id: string;
            status: string;
            point_total: number;
          }>(
            "SELECT id,user_id,status,point_total FROM orders WHERE id=$1 FOR UPDATE",
            [roomEntry.order_id],
          );
          if (!payment.rowCount || !order.rowCount || order.rows[0]!.user_id !== userId) {
            throw conflict("연결된 쿠지 주문 정보를 안전하게 확인할 수 없습니다.");
          }
          if (
            order.rows[0]!.status === "CANCELLED"
            && ["CANCELLED", "FAILED"].includes(payment.rows[0]!.status)
            && ["CANCELLED", "EXPIRED"].includes(roomEntry.state)
          ) {
            return roomSnapshot(client, { productId, entryId, userId, serverNow });
          }
          if (order.rows[0]!.status !== "PENDING_PAYMENT" || payment.rows[0]!.status !== "PENDING") {
            throw conflict("결제가 시작되었거나 완료된 쿠지 주문은 대기 취소로 종료할 수 없습니다.");
          }
          await releasePendingOrder(client, order.rows[0]!, "KUJI_ROOM_ENTRY_CANCELLED");
          const cancelledPayment = await client.query(
            "UPDATE payments SET status='CANCELLED',version=version+1 WHERE id=$1 AND status='PENDING' RETURNING id",
            [payment.rows[0]!.id],
          );
          const cancelledOrder = await client.query(
            "UPDATE orders SET status='CANCELLED',cancelled_at=$2,version=version+1 WHERE id=$1 AND status='PENDING_PAYMENT' RETURNING id",
            [roomEntry.order_id, serverNow],
          );
          if (!cancelledPayment.rowCount || !cancelledOrder.rowCount) {
            throw conflict("쿠지 주문이 동시에 변경되어 안전하게 취소할 수 없습니다.");
          }
          const terminalState = roomEntry.checkout_expires_at
            && roomEntry.checkout_expires_at.getTime() <= serverNow.getTime()
            ? "EXPIRED"
            : "CANCELLED";
          if (roomEntry.state === "CHECKOUT_PENDING") {
            await client.query(
              "UPDATE kuji_room_entries SET state=$2,resolved_at=$3 WHERE id=$1 AND state='CHECKOUT_PENDING'",
              [entryId, terminalState, serverNow],
            );
          }
          await promoteNextKujiRoomEntryLocked(client, { productId, serverNow });
          await bumpKujiRoomVersion(client, productId);
          await writeOutbox(client, request.id, {
            aggregateType: "ORDER",
            aggregateId: roomEntry.order_id,
            eventType: "order.cancelled",
            payload: { orderId: roomEntry.order_id, userId, reason: "KUJI_ROOM_ENTRY_CANCELLED" },
          });
          return roomSnapshot(client, { productId, entryId, userId, serverNow });
        }

        const cancelled = await client.query(
          `UPDATE kuji_room_entries
              SET state='CANCELLED',resolved_at=$2
            WHERE id=$1 AND state IN ('WAITING','CHECKOUT_PENDING')`,
          [entryId, serverNow],
        );
        const promotedEntryId = await promoteNextKujiRoomEntryLocked(client, { productId, serverNow });
        if ((cancelled.rowCount ?? 0) > 0 || promotedEntryId) await bumpKujiRoomVersion(client, productId);
        return roomSnapshot(client, { productId, entryId, userId, serverNow });
      });
      return reply.code(200).send(snapshot);
    },
  );
}
