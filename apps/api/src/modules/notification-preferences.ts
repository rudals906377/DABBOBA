import type { FastifyInstance, FastifyReply } from "fastify";
import { withTransaction } from "@dabboba/db";
import { writeOutbox } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  beginIdempotency,
  completeIdempotency,
  idempotencyKey,
  requestHash,
} from "../lib/idempotency.js";
import { booleanInput, integerInput, objectInput } from "../lib/input.js";
import { iso } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

const UPDATE_KEYS = [
  "exchangeUpdates",
  "requestUpdates",
  "restockUpdates",
  "marketingSms",
  "marketingEmail",
  "marketingPush",
  "expectedVersion",
] as const;

// The 2026-10-07 privacy policy removed the personalized-recommendation
// (맞춤 추천) consent because the feature was never built. Older app builds
// still send the field: it must be a boolean, is otherwise ignored, and the
// stored column stays false (migration 0091 withdrew every earlier consent).
const LEGACY_IGNORED_KEYS = ["personalizedRecommendations"] as const;

type NotificationPreferenceRow = {
  user_id: string;
  exchange_updates: boolean;
  request_updates: boolean;
  restock_updates: boolean;
  marketing_sms: boolean;
  marketing_email: boolean;
  marketing_push: boolean;
  /** Withdrawn for every customer by migration 0091; always false and never exposed. */
  personalized_recommendations: boolean;
  version: number;
  updated_at: Date;
};

export type NotificationPreferenceInput = {
  exchangeUpdates: boolean;
  requestUpdates: boolean;
  restockUpdates: boolean;
  marketingSms: boolean;
  marketingEmail: boolean;
  marketingPush: boolean;
  expectedVersion: number;
};

export function notificationPreferenceInput(body: unknown): NotificationPreferenceInput {
  const input = objectInput(body);
  const unknown = Object.keys(input).find((key) => (
    !UPDATE_KEYS.includes(key as (typeof UPDATE_KEYS)[number])
    && !LEGACY_IGNORED_KEYS.includes(key as (typeof LEGACY_IGNORED_KEYS)[number])
  ));
  if (unknown) throw badRequest(`지원하지 않는 입력 항목입니다: ${unknown}`);
  for (const key of LEGACY_IGNORED_KEYS) booleanInput(input, key, true);
  return {
    exchangeUpdates: booleanInput(input, "exchangeUpdates")!,
    requestUpdates: booleanInput(input, "requestUpdates")!,
    restockUpdates: booleanInput(input, "restockUpdates")!,
    marketingSms: booleanInput(input, "marketingSms")!,
    marketingEmail: booleanInput(input, "marketingEmail")!,
    marketingPush: booleanInput(input, "marketingPush")!,
    expectedVersion: integerInput(input, "expectedVersion", { min: 1 })!,
  };
}

const mapNotificationPreferences = (row: NotificationPreferenceRow) => ({
  orderUpdates: true as const,
  exchangeUpdates: row.exchange_updates,
  requestUpdates: row.request_updates,
  restockUpdates: row.restock_updates,
  marketingSms: row.marketing_sms,
  marketingEmail: row.marketing_email,
  marketingPush: row.marketing_push,
  version: row.version,
  updatedAt: iso(row.updated_at),
});

function consentState(value: ReturnType<typeof mapNotificationPreferences>) {
  return {
    orderUpdates: value.orderUpdates,
    exchangeUpdates: value.exchangeUpdates,
    requestUpdates: value.requestUpdates,
    restockUpdates: value.restockUpdates,
    marketingSms: value.marketingSms,
    marketingEmail: value.marketingEmail,
    marketingPush: value.marketingPush,
    version: value.version,
  };
}

function sendMutation<T>(reply: FastifyReply, result: { replay: boolean; body: T }) {
  if (result.replay) reply.header("x-idempotent-replay", "true");
  return reply.code(200).send(result.body);
}

export async function registerNotificationPreferenceRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/account/notification-preferences", { preHandler: context.auth.requireUser }, async (request) => {
    const result = await context.pool.query<NotificationPreferenceRow>(
      "SELECT * FROM notification_preferences WHERE user_id=$1",
      [request.actor!.userId],
    );
    if (!result.rowCount) throw notFound("알림 설정을 찾을 수 없습니다.");
    return mapNotificationPreferences(result.rows[0]!);
  });

  app.put("/v1/account/notification-preferences", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const input = notificationPreferenceInput(request.body);
    const actorId = request.actor!.userId;
    const key = idempotencyKey(request.headers);
    const result = await withTransaction(context.pool, async (client) => {
      const started = await beginIdempotency(client, {
        actorId,
        scope: "ACCOUNT_NOTIFICATION_PREFERENCES_UPDATE",
        key,
        hash: requestHash(input),
      });
      if (!started.fresh) return { replay: true, body: started.body as ReturnType<typeof mapNotificationPreferences> };

      const beforeResult = await client.query<NotificationPreferenceRow>(
        "SELECT * FROM notification_preferences WHERE user_id=$1 FOR UPDATE",
        [actorId],
      );
      if (!beforeResult.rowCount) throw notFound("알림 설정을 찾을 수 없습니다.");
      const before = mapNotificationPreferences(beforeResult.rows[0]!);
      if (before.version !== input.expectedVersion) {
        throw conflict("알림 설정이 다른 기기에서 먼저 수정되었습니다.");
      }

      const updated = await client.query<NotificationPreferenceRow>(
        `UPDATE notification_preferences SET
          exchange_updates=$2,request_updates=$3,restock_updates=$4,
          marketing_sms=$5,marketing_email=$6,marketing_push=$7,
          personalized_recommendations=false,version=version+1
         WHERE user_id=$1 AND version=$8
         RETURNING *`,
        [
          actorId,
          input.exchangeUpdates,
          input.requestUpdates,
          input.restockUpdates,
          input.marketingSms,
          input.marketingEmail,
          input.marketingPush,
          input.expectedVersion,
        ],
      );
      if (!updated.rowCount) throw conflict("알림 설정이 다른 기기에서 먼저 수정되었습니다.");
      const body = mapNotificationPreferences(updated.rows[0]!);

      await client.query(
        `INSERT INTO notification_preference_events(
          user_id,event_type,before_state,after_state,version,actor_user_id,idempotency_key,request_id
        ) VALUES($1,'UPDATED',$2,$3,$4,$1,$5,$6)`,
        [
          actorId,
          JSON.stringify(consentState(before)),
          JSON.stringify(consentState(body)),
          body.version,
          key,
          request.id,
        ],
      );
      await writeOutbox(client, request.id, {
        aggregateType: "NOTIFICATION_PREFERENCES",
        aggregateId: actorId,
        eventType: "notification.preferences.updated",
        payload: { userId: actorId, version: body.version },
      });
      await completeIdempotency(client, started.id, {
        statusCode: 200,
        body,
        resourceType: "NOTIFICATION_PREFERENCES",
        resourceId: actorId,
      });
      return { replay: false, body };
    });
    return sendMutation(reply, result);
  });
}
