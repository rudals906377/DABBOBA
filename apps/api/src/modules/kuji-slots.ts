import type { FastifyInstance, FastifyReply } from "fastify";
import {
  bumpKujiRoomVersion,
  lockExistingKujiRoom,
  lockKujiRoomAdvisories,
  withTransaction,
  type DatabaseClient,
} from "@dabboba/db";
import { writeOutbox } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { beginIdempotency, completeIdempotency, idempotencyKey, requestHash } from "../lib/idempotency.js";
import { integerInput, objectInput, slugIdInput, uuidInput } from "../lib/input.js";
import { iso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

export const KUJI_SLOT_SELECTION_ALGORITHM = "KUJI_SEALED_SLOT_V1" as const;

type KujiSlotSelectionInput = {
  probabilityVersion: number;
  slotNumbers: number[];
};

type BoundKujiSlotRow = {
  binding_id: string;
  entitlement_id: string;
  binding_state: "RESERVED" | "CONSUMED";
  slot_id: string;
  slot_number: number;
};

type KujiSlotAssignmentRow = {
  id: string;
  slot_number: number;
};

export type SealedKujiConsumeRow = {
  binding_id: string;
  slot_id: string;
  slot_number: number;
  id: string;
  prize_product_id: string;
  prize_name_snapshot: string;
  prize_image_url_snapshot: string | null;
  prize_sku_snapshot: string;
  prize_ip_id_snapshot: string;
  prize_category_snapshot: "gacha" | "figure" | "kuji" | "tcg";
  rarity: string;
  weight: number;
  remaining_quantity: number;
};

export function parseKujiSlotSelection(body: unknown): KujiSlotSelectionInput {
  const input = objectInput(body);
  const probabilityVersion = integerInput(input, "probabilityVersion", { min: 1, max: 2_147_483_647 })!;
  if (!Array.isArray(input.slotNumbers) || input.slotNumbers.length < 1 || input.slotNumbers.length > 20) {
    throw badRequest("선택할 쿠지 번호를 1개 이상 20개 이하로 보내 주세요.");
  }
  const slotNumbers = input.slotNumbers.map((value) => integerInput(
    { value },
    "value",
    { min: 1, max: 10_000 },
  )!);
  const unique = new Set(slotNumbers);
  if (unique.size !== slotNumbers.length) throw badRequest("같은 쿠지 번호를 중복 선택할 수 없습니다.");
  return { probabilityVersion, slotNumbers: [...slotNumbers].sort((left, right) => left - right) };
}

export async function persistKujiSlotBindings(
  client: DatabaseClient,
  input: {
    roomEntryId: string;
    entitlementIds: readonly string[];
    assignments: readonly KujiSlotAssignmentRow[];
  },
): Promise<BoundKujiSlotRow[]> {
  if (input.entitlementIds.length !== input.assignments.length) {
    throw new RangeError("Each kuji entitlement must be paired with exactly one sorted slot assignment.");
  }

  const saved: BoundKujiSlotRow[] = [];
  for (const [index, assignment] of input.assignments.entries()) {
    const inserted = await client.query<BoundKujiSlotRow>(
      `INSERT INTO kuji_slot_bindings(slot_assignment_id,entitlement_id,room_entry_id)
       VALUES($1,$2,$3)
       ON CONFLICT DO NOTHING
       RETURNING id AS binding_id,entitlement_id,state AS binding_state,
                 $1::uuid AS slot_id,$4::integer AS slot_number`,
      [assignment.id, input.entitlementIds[index]!, input.roomEntryId, assignment.slot_number],
    );
    if (!inserted.rowCount) {
      throw conflict("선택한 쿠지 번호 중 이미 예약되었거나 판매된 번호가 있습니다.");
    }
    saved.push(inserted.rows[0]!);
  }
  return saved;
}

export async function loadSealedKujiSlotForConsume(
  client: DatabaseClient,
  input: { entitlementId: string; probabilityVersionId: string },
): Promise<SealedKujiConsumeRow | null> {
  const deck = await client.query(
    "SELECT 1 FROM kuji_decks WHERE probability_version_id=$1",
    [input.probabilityVersionId],
  );
  if (!deck.rowCount) return null;

  const binding = await client.query<SealedKujiConsumeRow>(
    `SELECT binding.id AS binding_id,
            assignment.id AS slot_id,
            assignment.slot_number,
            entry.id,
            entry.prize_product_id,
            entry.prize_name_snapshot,
            entry.prize_image_url_snapshot,
            entry.prize_sku_snapshot,
            entry.prize_ip_id_snapshot,
            entry.prize_category_snapshot,
            entry.rarity,
            entry.weight,
            entry.remaining_quantity
       FROM kuji_slot_bindings AS binding
       JOIN kuji_slot_assignments AS assignment ON assignment.id=binding.slot_assignment_id
       JOIN draw_pool_entries AS entry ON entry.id=assignment.pool_entry_id
      WHERE binding.entitlement_id=$1
        AND binding.state='RESERVED'
        AND assignment.probability_version_id=$2
        AND entry.probability_version_id=$2
      FOR UPDATE OF binding,entry`,
    [input.entitlementId, input.probabilityVersionId],
  );
  if (!binding.rowCount) throw conflict("먼저 결제한 수량만큼 사용할 쿠지 번호를 선택해 주세요.");
  return binding.rows[0]!;
}

function noStore(reply: FastifyReply) {
  reply.header("cache-control", "no-store");
}

function bindingResponse(input: {
  productId: string;
  roomEntryId: string;
  probabilityVersion: number;
  bindings: readonly BoundKujiSlotRow[];
}) {
  return {
    productId: input.productId,
    roomEntryId: input.roomEntryId,
    probabilityVersion: input.probabilityVersion,
    bindings: input.bindings.map((binding) => ({
      entitlementId: binding.entitlement_id,
      slotNumber: numberValue(binding.slot_number),
      state: binding.binding_state,
    })),
  };
}

export async function registerKujiSlotRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/catalog/products/:productId/kuji-slots", async (request, reply) => {
    noStore(reply);
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const deck = await context.pool.query<{
      probability_version_id: string;
      version: number;
      total_slots: number;
      published_at: Date;
      snapshot_version: number;
      reserved_slot_count: number;
      slots: Array<{ slotNumber: number; available: boolean }>;
      tiers: Array<{
        tierCode: string;
        tierRank: number;
        label: string;
        initialQuantity: number;
        remainingQuantity: number;
      }>;
    }>(
      `SELECT deck.probability_version_id,version.version,deck.total_slots,version.published_at,
              COALESCE(room.version,0) AS snapshot_version,
              (
                SELECT count(*)
                  FROM kuji_slot_assignments AS assignment
                  JOIN kuji_slot_bindings AS binding ON binding.slot_assignment_id=assignment.id
                 WHERE assignment.probability_version_id=deck.probability_version_id
                   AND binding.state='RESERVED'
              ) AS reserved_slot_count,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'slotNumber',assignment.slot_number,
                  'available',NOT EXISTS (
                    SELECT 1 FROM kuji_slot_bindings AS binding
                     WHERE binding.slot_assignment_id=assignment.id
                       AND binding.state IN ('RESERVED','CONSUMED')
                  )
                ) ORDER BY assignment.slot_number)
                  FROM kuji_slot_assignments AS assignment
                 WHERE assignment.probability_version_id=deck.probability_version_id
              ),'[]'::jsonb) AS slots,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'tierCode',tier.tier_code,
                  'tierRank',tier.tier_rank,
                  'label',entry.rarity,
                  'initialQuantity',entry.initial_quantity,
                  'remainingQuantity',(
                    SELECT count(*)
                      FROM kuji_slot_assignments AS assignment
                     WHERE assignment.pool_entry_id=tier.pool_entry_id
                       AND NOT EXISTS (
                         SELECT 1 FROM kuji_slot_bindings AS binding
                          WHERE binding.slot_assignment_id=assignment.id
                            AND binding.state='CONSUMED'
                       )
                  )
                ) ORDER BY tier.tier_rank,tier.tier_code)
                  FROM kuji_deck_tiers AS tier
                  JOIN draw_pool_entries AS entry ON entry.id=tier.pool_entry_id
                 WHERE tier.probability_version_id=deck.probability_version_id
              ),'[]'::jsonb) AS tiers
         FROM kuji_decks AS deck
         JOIN draw_probability_versions AS version ON version.id=deck.probability_version_id
         JOIN catalog_products AS product ON product.id=version.product_id
         LEFT JOIN kuji_rooms AS room ON room.product_id=version.product_id
        WHERE version.product_id=$1
          AND version.status='ACTIVE'
          AND product.category='kuji'
          AND product.is_active=true
          AND product.is_prize_only=false`,
      [productId],
    );
    if (!deck.rowCount) throw notFound("공개 중인 봉인 쿠지 번호판을 찾을 수 없습니다.");
    const current = deck.rows[0]!;
    const availableSlotCount = current.slots.filter((slot) => slot.available).length;
    const tierRemainingCount = current.tiers.reduce(
      (sum, tier) => sum + numberValue(tier.remainingQuantity),
      0,
    );
    if (availableSlotCount + numberValue(current.reserved_slot_count) !== tierRemainingCount) {
      throw new Error(`Kuji public snapshot count mismatch for ${productId}`);
    }
    return reply.code(200).send({
      productId,
      probabilityVersion: numberValue(current.version),
      snapshotVersion: numberValue(current.snapshot_version),
      totalSlots: numberValue(current.total_slots),
      publishedAt: iso(current.published_at),
      calculatedAt: new Date().toISOString(),
      slots: current.slots.map((slot) => ({
        slotNumber: numberValue(slot.slotNumber),
        available: slot.available,
      })),
      tiers: current.tiers.map((tier) => ({
        tierCode: tier.tierCode,
        tierRank: numberValue(tier.tierRank),
        label: tier.label,
        initialQuantity: numberValue(tier.initialQuantity),
        remainingQuantity: numberValue(tier.remainingQuantity),
      })),
    });
  });

  app.post(
    "/v1/kuji/rooms/:productId/entries/:entryId/slots",
    { preHandler: context.auth.requireUser },
    async (request, reply) => {
      noStore(reply);
      const params = request.params as Record<string, unknown>;
      const productId = slugIdInput(params.productId, "productId");
      const roomEntryId = uuidInput(params.entryId, "entryId");
      const userId = request.actor!.userId;
      const input = parseKujiSlotSelection(request.body);
      const key = idempotencyKey(request.headers);
      const hash = requestHash({ productId, roomEntryId, ...input });

      const result = await withTransaction(context.pool, async (client) => {
        const idem = await beginIdempotency(client, {
          actorId: userId,
          scope: "BIND_KUJI_SLOTS",
          key,
          hash,
        });
        if (!idem.fresh) return { replay: true, statusCode: idem.statusCode, body: idem.body };

        await lockKujiRoomAdvisories(client, { userId, productId });
        if (!(await lockExistingKujiRoom(client, productId))) throw notFound("쿠지 대기실을 찾을 수 없습니다.");
        const room = await client.query<{
          user_id: string;
          order_id: string | null;
          state: string;
        }>(
          `SELECT user_id,order_id,state
             FROM kuji_room_entries
            WHERE id=$1 AND product_id=$2
            FOR UPDATE`,
          [roomEntryId, productId],
        );
        if (!room.rowCount) throw notFound("쿠지 대기실 참여 내역을 찾을 수 없습니다.");
        const entry = room.rows[0]!;
        if (entry.user_id !== userId) throw forbidden();
        if (!entry.order_id || !["DRAWING", "EXPIRED"].includes(entry.state)) {
          throw conflict("결제가 끝난 본인 쿠지 뽑기방에서만 번호를 선택할 수 있습니다.");
        }

        const orderLine = await client.query<{
          id: string;
          order_status: string;
          probability_version_id: string;
          probability_version: number;
        }>(
          `SELECT line.id,orders.status AS order_status,line.probability_version_id,
                  version.version AS probability_version
             FROM orders
             JOIN order_lines AS line ON line.order_id=orders.id
             JOIN draw_probability_versions AS version ON version.id=line.probability_version_id
             JOIN kuji_decks AS deck ON deck.probability_version_id=version.id
            WHERE orders.id=$1
              AND orders.user_id=$2
              AND line.product_id=$3
              AND line.category_snapshot='kuji'
            FOR UPDATE OF orders,line,version`,
          [entry.order_id, userId, productId],
        );
        if (!orderLine.rowCount || !["PAID", "FULFILLED"].includes(orderLine.rows[0]!.order_status)) {
          throw conflict("결제 완료된 봉인 쿠지 주문을 찾을 수 없습니다.");
        }
        const line = orderLine.rows[0]!;
        if (numberValue(line.probability_version) !== input.probabilityVersion) {
          throw conflict("결제한 쿠지 번호판 버전과 선택 화면의 버전이 다릅니다.");
        }

        const entitlements = await client.query<{ id: string; status: string }>(
          `SELECT id,status
             FROM draw_entitlements
            WHERE order_line_id=$1
            ORDER BY created_at,id
            FOR UPDATE`,
          [line.id],
        );
        if (entitlements.rows.length !== input.slotNumbers.length) {
          throw conflict(`결제한 ${entitlements.rows.length}장과 같은 수의 쿠지 번호를 선택해 주세요.`);
        }

        const entitlementIds = entitlements.rows.map((entitlement) => entitlement.id);
        const existing = await client.query<BoundKujiSlotRow>(
          `SELECT binding.id AS binding_id,binding.entitlement_id,binding.state AS binding_state,
                  assignment.id AS slot_id,assignment.slot_number
             FROM kuji_slot_bindings AS binding
             JOIN kuji_slot_assignments AS assignment ON assignment.id=binding.slot_assignment_id
            WHERE binding.entitlement_id=ANY($1::uuid[])
              AND binding.state IN ('RESERVED','CONSUMED')
            ORDER BY assignment.slot_number
            FOR UPDATE OF binding`,
          [entitlementIds],
        );
        if (existing.rowCount) {
          const existingNumbers = existing.rows.map((binding) => numberValue(binding.slot_number));
          if (existing.rows.length !== entitlements.rows.length
            || existingNumbers.some((slotNumber, index) => slotNumber !== input.slotNumbers[index])) {
            throw conflict("이미 다른 쿠지 번호가 이 주문에 연결되어 있습니다.");
          }
          const body = bindingResponse({
            productId,
            roomEntryId,
            probabilityVersion: input.probabilityVersion,
            bindings: existing.rows,
          });
          await completeIdempotency(client, idem.id, {
            statusCode: 200,
            body,
            resourceType: "KUJI_ROOM_ENTRY",
            resourceId: roomEntryId,
          });
          return { replay: true, statusCode: 200, body };
        }
        if (entitlements.rows.some((entitlement) => entitlement.status !== "AVAILABLE")) {
          throw conflict("이미 사용했거나 취소된 쿠지 추첨권은 번호를 다시 선택할 수 없습니다.");
        }

        const assignments = await client.query<KujiSlotAssignmentRow>(
          `SELECT id,slot_number
             FROM kuji_slot_assignments
            WHERE probability_version_id=$1
              AND slot_number=ANY($2::integer[])
            ORDER BY slot_number`,
          [line.probability_version_id, input.slotNumbers],
        );
        if (assignments.rows.length !== input.slotNumbers.length) {
          throw conflict("현재 번호판에 없는 쿠지 번호가 포함되어 있습니다.");
        }
        const assignmentIds = assignments.rows.map((assignment) => assignment.id);
        const unavailable = await client.query(
          `SELECT 1
             FROM kuji_slot_bindings
            WHERE slot_assignment_id=ANY($1::uuid[])
              AND state IN ('RESERVED','CONSUMED')
            LIMIT 1
            FOR UPDATE`,
          [assignmentIds],
        );
        if (unavailable.rowCount) throw conflict("선택한 쿠지 번호 중 이미 예약되었거나 판매된 번호가 있습니다.");

        const saved = await persistKujiSlotBindings(client, {
          roomEntryId,
          entitlementIds,
          assignments: assignments.rows,
        });
        await bumpKujiRoomVersion(client, productId);
        const response = bindingResponse({
          productId,
          roomEntryId,
          probabilityVersion: input.probabilityVersion,
          bindings: saved,
        });
        await writeOutbox(client, request.id, {
          aggregateType: "ORDER",
          aggregateId: entry.order_id,
          eventType: "kuji.slots_bound",
          payload: {
            orderId: entry.order_id,
            roomEntryId,
            productId,
            probabilityVersion: input.probabilityVersion,
            slotNumbers: input.slotNumbers,
          },
        });
        await completeIdempotency(client, idem.id, {
          statusCode: 201,
          body: response,
          resourceType: "KUJI_ROOM_ENTRY",
          resourceId: roomEntryId,
        });
        return { replay: false, statusCode: 201, body: response };
      });

      if (result.replay) reply.header("x-idempotent-replay", "true");
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
