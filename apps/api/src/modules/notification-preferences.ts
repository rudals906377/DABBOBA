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
  "personalizedRecommendations",
  "expectedVersion",
] as const;

type NotificationPreferenceRow = {
  user_id: string;
  exchange_updates: boolean;
  request_updates: boolean;
  restock_updates: boolean;
  marketing_sms: boolean;
  marketing_email: boolean;
  marketing_push: boolean;
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
  personalizedRecommendations: boolean;
  expectedVersion: number;
};

export function notificationPreferenceInput(body: unknown): NotificationPreferenceInput {
  const input = objectInput(body);
  const unknown = Object.keys(input).find((key) => !UPDATE_KEYS.includes(key as (typeof UPDATE_KEYS)[number]));
  if (unknown) throw badRequest(`지원하지 않는 입력 항목입니다: ${unknown}`);
  return {
    exchangeUpdates: booleanInput(input, "exchangeUpdates")!,
    requestUpdates: booleanInput(input, "requestUpdates")!,
    restockUpdates: booleanInput(input, "restockUpdates")!,
    marketingSms: booleanInput(input, "marketingSms")!,
    marketingEmail: booleanInput(input, "marketingEmail")!,
    marketingPush: booleanInput(input, "marketingPush")!,
    personalizedRecommendations: booleanInput(input, "personalizedRecommendations")!,
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
  personalizedRecommendations: row.personalized_recommendations,
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
    personalizedRecommendations: value.personalizedRecommendations,
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
          personalized_recommendations=$8,version=version+1
         WHERE user_id=$1 AND version=$9
         RETURNING *`,
        [
          actorId,
          input.exchangeUpdates,
          input.requestUpdates,
          input.restockUpdates,
          input.marketingSms,
          input.marketingEmail,
          input.marketingPush,
          input.personalizedRecommendations,
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
