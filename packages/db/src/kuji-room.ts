import type { DatabaseClient } from "./index.js";

export const KUJI_CHECKOUT_LEASE_SECONDS = 180;
export const KUJI_DRAW_LEASE_SECONDS = 300;

export type KujiRoomEntryState =
  | "WAITING"
  | "CHECKOUT_PENDING"
  | "DRAWING"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export type LockedKujiOrderRoom = {
  id: string;
  order_id: string;
  product_id: string;
  user_id: string;
  state: KujiRoomEntryState;
  checkout_expires_at: Date | null;
  drawing_expires_at: Date | null;
};

export function kujiCheckoutExpiry(grantedAt: Date): Date {
  return new Date(grantedAt.getTime() + KUJI_CHECKOUT_LEASE_SECONDS * 1_000);
}

export function kujiDrawingExpiry(startedAt: Date): Date {
  return new Date(startedAt.getTime() + KUJI_DRAW_LEASE_SECONDS * 1_000);
}

export async function lockKujiProductRoomAdvisory(
  client: DatabaseClient,
  productId: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))", [
    `kuji-room:${productId}`,
  ]);
}

export async function lockKujiRoomAdvisories(
  client: DatabaseClient,
  input: { userId: string; productId: string },
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))", [
    `kuji-user:${input.userId}`,
  ]);
  await lockKujiProductRoomAdvisory(client, input.productId);
}

export async function lockExistingKujiRoom(
  client: DatabaseClient,
  productId: string,
): Promise<boolean> {
  const room = await client.query(
    "SELECT 1 FROM kuji_rooms WHERE product_id=$1 FOR UPDATE",
    [productId],
  );
  return Boolean(room.rowCount);
}

export async function lockLinkedKujiRoomForOrder(
  client: DatabaseClient,
  orderId: string,
): Promise<LockedKujiOrderRoom | null> {
  const lookup = await client.query<Pick<LockedKujiOrderRoom, "product_id" | "user_id">>(
    "SELECT product_id,user_id FROM kuji_room_entries WHERE order_id=$1",
    [orderId],
  );
  if (!lookup.rowCount) return null;

  const target = lookup.rows[0]!;
  await lockKujiRoomAdvisories(client, { userId: target.user_id, productId: target.product_id });
  if (!(await lockExistingKujiRoom(client, target.product_id))) {
    throw new Error(`Linked kuji room is missing for order ${orderId}`);
  }
  const entry = await client.query<LockedKujiOrderRoom>(
    `SELECT id,order_id,product_id,user_id,state,checkout_expires_at,drawing_expires_at
       FROM kuji_room_entries
      WHERE order_id=$1
      FOR UPDATE`,
    [orderId],
  );
  if (!entry.rowCount) throw new Error(`Linked kuji room entry disappeared for order ${orderId}`);
  return entry.rows[0]!;
}

export async function promoteNextKujiRoomEntryLocked(
  client: DatabaseClient,
  input: { productId: string; serverNow: Date },
): Promise<string | null> {
  const active = await client.query(
    `SELECT 1 FROM kuji_room_entries
      WHERE product_id=$1 AND state IN ('CHECKOUT_PENDING','DRAWING')
      LIMIT 1
      FOR UPDATE`,
    [input.productId],
  );
  if (active.rowCount) return null;

  const joinable = await client.query(
    `SELECT 1
       FROM catalog_products p
       JOIN product_stock s ON s.product_id=p.id
      WHERE p.id=$1
        AND p.category='kuji'
        AND p.is_active=true
        AND p.is_prize_only=false
        AND s.on_hand-s.reserved>0
        AND EXISTS (
          SELECT 1
            FROM draw_probability_versions v
            JOIN kuji_decks deck ON deck.probability_version_id=v.id
            JOIN draw_pool_entries e ON e.probability_version_id=v.id
           WHERE v.product_id=p.id
             AND v.status='ACTIVE'
             AND (e.remaining_quantity IS NULL OR e.remaining_quantity>0)
        )
      -- The worker needs to serialize inventory changes, but must not receive
      -- broad UPDATE privileges on catalog metadata merely to lock that row.
      FOR UPDATE OF s`,
    [input.productId],
  );
  if (!joinable.rowCount) return null;

  const next = await client.query<{ id: string }>(
    `SELECT id FROM kuji_room_entries
      WHERE product_id=$1 AND state='WAITING'
      ORDER BY queue_sequence
      LIMIT 1
      FOR UPDATE`,
    [input.productId],
  );
  if (!next.rowCount) return null;

  const entryId = next.rows[0]!.id;
  await client.query(
    `UPDATE kuji_room_entries
        SET state='CHECKOUT_PENDING',checkout_started_at=$2,checkout_expires_at=$3
      WHERE id=$1 AND state='WAITING'`,
    [entryId, input.serverNow, kujiCheckoutExpiry(input.serverNow)],
  );
  return entryId;
}

export async function bumpKujiRoomVersion(client: DatabaseClient, productId: string): Promise<void> {
  await client.query("UPDATE kuji_rooms SET version=version+1 WHERE product_id=$1", [productId]);
}

export async function startLockedKujiOrderDrawing(
  client: DatabaseClient,
  input: { orderId: string; serverNow: Date },
): Promise<boolean> {
  const transitioned = await client.query<{ product_id: string }>(
    `UPDATE kuji_room_entries
        SET state='DRAWING',drawing_started_at=$2,drawing_expires_at=$3
      WHERE order_id=$1 AND state='CHECKOUT_PENDING'
      RETURNING product_id`,
    [input.orderId, input.serverNow, kujiDrawingExpiry(input.serverNow)],
  );
  if (!transitioned.rowCount) return false;
  await bumpKujiRoomVersion(client, transitioned.rows[0]!.product_id);
  return true;
}

export async function releaseLockedKujiOrderRoom(
  client: DatabaseClient,
  input: { orderId: string; serverNow: Date; terminalState: "CANCELLED" | "EXPIRED" },
): Promise<boolean> {
  const transitioned = await client.query<{ product_id: string }>(
    `UPDATE kuji_room_entries
        SET state=$2,resolved_at=$3
      WHERE order_id=$1 AND state='CHECKOUT_PENDING'
      RETURNING product_id`,
    [input.orderId, input.terminalState, input.serverNow],
  );
  if (!transitioned.rowCount) return false;
  const productId = transitioned.rows[0]!.product_id;
  await promoteNextKujiRoomEntryLocked(client, { productId, serverNow: input.serverNow });
  await bumpKujiRoomVersion(client, productId);
  return true;
}

/** Release a paid kuji room only after its full refund has been committed. */
export async function releaseRefundedKujiOrderRoom(
  client: DatabaseClient,
  input: { orderId: string; serverNow: Date },
): Promise<boolean> {
  const transitioned = await client.query<{ product_id: string }>(
    `UPDATE kuji_room_entries
        SET state='CANCELLED',resolved_at=$2
      WHERE order_id=$1 AND state IN ('CHECKOUT_PENDING','DRAWING')
      RETURNING product_id`,
    [input.orderId, input.serverNow],
  );
  if (!transitioned.rowCount) return false;
  const productId = transitioned.rows[0]!.product_id;
  await promoteNextKujiRoomEntryLocked(client, { productId, serverNow: input.serverNow });
  await bumpKujiRoomVersion(client, productId);
  return true;
}

export async function expireLockedKujiOrderDrawing(
  client: DatabaseClient,
  input: { orderId: string; serverNow: Date },
): Promise<{ productId: string; promotedEntryId: string | null } | null> {
  const transitioned = await client.query<{ product_id: string }>(
    `UPDATE kuji_room_entries
        SET state='EXPIRED',resolved_at=$2
      WHERE order_id=$1
        AND state='DRAWING'
        AND drawing_expires_at <= $2
      RETURNING product_id`,
    [input.orderId, input.serverNow],
  );
  if (!transitioned.rowCount) return null;

  const productId = transitioned.rows[0]!.product_id;
  const promotedEntryId = await promoteNextKujiRoomEntryLocked(client, {
    productId,
    serverNow: input.serverNow,
  });
  await bumpKujiRoomVersion(client, productId);
  return { productId, promotedEntryId };
}

export async function completeLockedKujiOrderRoomIfDrawn(
  client: DatabaseClient,
  input: { orderId: string; productId: string; serverNow: Date },
): Promise<boolean> {
  const remaining = await client.query<{ count: string }>(
    `SELECT count(*) AS count
       FROM draw_entitlements e
       JOIN order_lines l ON l.id=e.order_line_id
      WHERE l.order_id=$1 AND e.status='AVAILABLE'`,
    [input.orderId],
  );
  let completed = false;
  if (Number(remaining.rows[0]!.count) === 0) {
    const transition = await client.query<{ product_id: string }>(
      `UPDATE kuji_room_entries
          SET state='COMPLETED',completed_at=$2,resolved_at=$2
        WHERE order_id=$1 AND state='DRAWING'
        RETURNING product_id`,
      [input.orderId, input.serverNow],
    );
    if (transition.rowCount) {
      const transitionedProductId = transition.rows[0]!.product_id;
      if (transitionedProductId !== input.productId) {
        throw new Error(`Kuji room product changed for order ${input.orderId}`);
      }
      await promoteNextKujiRoomEntryLocked(client, {
        productId: input.productId,
        serverNow: input.serverNow,
      });
      completed = true;
    }
  }

  // Every committed reveal changes the public tier projection. Keep its version
  // moving for partial and expired-room consumes as well as final completion,
  // while representing a final completion and its FIFO promotion with one bump.
  await bumpKujiRoomVersion(client, input.productId);
  return completed;
}
