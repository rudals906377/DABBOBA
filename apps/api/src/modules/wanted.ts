import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTransaction, type DatabaseClient, type Queryable } from "@dabboba/db";
import { PRODUCT_CATEGORIES } from "@dabboba/domain";
import { writeOutbox } from "../lib/audit.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { beginIdempotency, completeIdempotency, idempotencyKey, requestHash } from "../lib/idempotency.js";
import { booleanInput, enumInput, integerInput, objectInput, queryString, slugIdInput, stringInput, uuidInput } from "../lib/input.js";
import { cursorPage, pagination } from "../lib/pagination.js";
import { iso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

type WantedRequestRow = {
  id: string;
  user_id: string;
  author_nickname: string;
  category: "gacha" | "figure" | "kuji" | "tcg";
  ip_id: string;
  ip_name_ko: string;
  desired_item: string;
  details: string;
  status: "ACTIVE" | "HIDDEN" | "DELETED";
  like_count: number | string;
  liked_by_viewer: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const wantedSelect = `SELECT w.id,w.user_id,u.nickname AS author_nickname,w.category,w.ip_id,
  i.name_ko AS ip_name_ko,w.desired_item,w.details,w.status,w.version,w.created_at,w.updated_at,
  (SELECT count(*) FROM wanted_request_likes l WHERE l.request_id=w.id) AS like_count,
  ($1::uuid IS NOT NULL AND EXISTS(
    SELECT 1 FROM wanted_request_likes viewer_like
    WHERE viewer_like.request_id=w.id AND viewer_like.user_id=$1
  )) AS liked_by_viewer
  FROM wanted_requests w JOIN users u ON u.id=w.user_id JOIN catalog_ips i ON i.id=w.ip_id`;

const mapWanted = (row: WantedRequestRow) => ({
  id: row.id,
  userId: row.user_id,
  authorNickname: row.author_nickname,
  category: row.category,
  ipId: row.ip_id,
  ipNameKo: row.ip_name_ko,
  desiredItem: row.desired_item,
  details: row.details,
  status: row.status,
  likeCount: numberValue(row.like_count),
  likedByViewer: row.liked_by_viewer,
  version: row.version,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

async function optionalUserId(context: ApiContext, request: FastifyRequest): Promise<string | null> {
  if (!request.headers.authorization) return null;
  try {
    const actor = await context.auth.loadActor(request);
    return actor.sessionKind === "USER" && actor.role === "USER" ? actor.userId : null;
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) return null;
    throw error;
  }
}

async function fetchWanted(queryable: Queryable, requestId: string, viewerId: string | null) {
  const result = await queryable.query<WantedRequestRow>(
    `${wantedSelect} WHERE w.id=$2`,
    [viewerId, requestId],
  );
  if (!result.rowCount) throw notFound("신청 글을 찾을 수 없습니다.");
  return mapWanted(result.rows[0]!);
}

async function idempotentMutation<T>(
  context: ApiContext,
  request: FastifyRequest,
  input: {
    scope: string;
    payload: unknown;
    resourceType: string;
    work: (client: DatabaseClient) => Promise<{ statusCode: number; body: T; resourceId: string }>;
  },
) {
  const key = idempotencyKey(request.headers);
  return withTransaction(context.pool, async (client) => {
    const started = await beginIdempotency(client, {
      actorId: request.actor!.userId,
      scope: input.scope,
      key,
      hash: requestHash(input.payload),
    });
    if (!started.fresh) return { replay: true, statusCode: started.statusCode, body: started.body as T };
    const result = await input.work(client);
    await completeIdempotency(client, started.id, {
      statusCode: result.statusCode,
      body: result.body,
      resourceType: input.resourceType,
      resourceId: result.resourceId,
    });
    return { replay: false, statusCode: result.statusCode, body: result.body };
  });
}

function sendMutation<T>(reply: FastifyReply, result: { replay: boolean; statusCode: number; body: T }) {
  if (result.replay) reply.header("x-idempotent-replay", "true");
  return reply.code(result.statusCode).send(result.body);
}

function wantedPatch(body: unknown) {
  const input = objectInput(body);
  const expectedVersion = integerInput(input, "expectedVersion", { min: 1 })!;
  const category = input.category === undefined
    ? undefined
    : enumInput(input, "category", PRODUCT_CATEGORIES);
  const ipId = input.ipId === undefined ? undefined : slugIdInput(input.ipId, "ipId");
  const desiredItem = stringInput(input, "desiredItem", { max: 240, optional: true });
  const details = stringInput(input, "details", { max: 5000, optional: true });
  if (category === undefined && ipId === undefined && desiredItem === undefined && details === undefined) {
    throw badRequest("수정할 신청 글 값을 보내 주세요.");
  }
  return { expectedVersion, category, ipId, desiredItem, details };
}

export async function registerWantedRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/wanted-requests", async (request) => {
    const viewerId = await optionalUserId(context, request);
    const query = (request.query || {}) as Record<string, unknown>;
    const { limit, cursor } = pagination(query);
    const search = queryString(query.q);
    const category = query.category === undefined
      ? undefined
      : enumInput(query, "category", PRODUCT_CATEGORIES);
    const ipId = query.ipId === undefined ? undefined : slugIdInput(query.ipId, "ipId");
    const values: unknown[] = [viewerId, limit + 1];
    const filters = ["w.status='ACTIVE'", "i.is_active=true"];
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(w.desired_item ILIKE $${values.length} OR w.details ILIKE $${values.length} OR i.name_ko ILIKE $${values.length})`);
    }
    if (category) {
      values.push(category);
      filters.push(`w.category=$${values.length}`);
    }
    if (ipId) {
      values.push(ipId);
      filters.push(`w.ip_id=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(w.created_at,w.id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<WantedRequestRow>(
      `${wantedSelect} WHERE ${filters.join(" AND ")} ORDER BY w.created_at DESC,w.id DESC LIMIT $2`,
      values,
    );
    return cursorPage(result.rows, limit, mapWanted);
  });

  app.post("/v1/wanted-requests", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = objectInput(request.body);
    const input = {
      category: enumInput(body, "category", PRODUCT_CATEGORIES)!,
      ipId: slugIdInput(body.ipId, "ipId"),
      desiredItem: stringInput(body, "desiredItem", { max: 240 })!,
      details: stringInput(body, "details", { max: 5000 })!,
    };
    const result = await idempotentMutation(context, request, {
      scope: "WANTED_REQUEST_CREATE",
      payload: input,
      resourceType: "WANTED_REQUEST",
      work: async (client) => {
        const ip = await client.query("SELECT 1 FROM catalog_ips WHERE id=$1 AND is_active=true", [input.ipId]);
        if (!ip.rowCount) throw badRequest("신청할 작품 IP를 찾을 수 없습니다.");
        const created = await client.query<{ id: string }>(
          `INSERT INTO wanted_requests(user_id,category,ip_id,desired_item,details)
           VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [request.actor!.userId, input.category, input.ipId, input.desiredItem, input.details],
        );
        const requestId = created.rows[0]!.id;
        await writeOutbox(client, request.id, {
          aggregateType: "WANTED_REQUEST",
          aggregateId: requestId,
          eventType: "wanted-request.created",
          payload: { requestId, userId: request.actor!.userId, ipId: input.ipId, category: input.category },
        });
        return {
          statusCode: 201,
          body: await fetchWanted(client, requestId, request.actor!.userId),
          resourceId: requestId,
        };
      },
    });
    return sendMutation(reply, result);
  });

  app.patch("/v1/wanted-requests/:requestId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const requestId = uuidInput((request.params as Record<string, unknown>).requestId, "requestId");
    const input = wantedPatch(request.body);
    const result = await idempotentMutation(context, request, {
      scope: "WANTED_REQUEST_UPDATE",
      payload: { requestId, ...input },
      resourceType: "WANTED_REQUEST",
      work: async (client) => {
        const before = await client.query<{
          user_id: string;
          status: WantedRequestRow["status"];
          version: number;
          category: WantedRequestRow["category"];
          ip_id: string;
          desired_item: string;
          details: string;
        }>(
          "SELECT user_id,status,version,category,ip_id,desired_item,details FROM wanted_requests WHERE id=$1 FOR UPDATE",
          [requestId],
        );
        if (!before.rowCount) throw notFound("신청 글을 찾을 수 없습니다.");
        const current = before.rows[0]!;
        if (current.user_id !== request.actor!.userId) throw forbidden();
        if (current.status !== "ACTIVE") throw conflict("공개 중인 신청 글만 수정할 수 있습니다.");
        if (current.version !== input.expectedVersion) throw conflict("신청 글이 다른 기기에서 먼저 수정되었습니다.");
        if (input.ipId !== undefined) {
          const ip = await client.query("SELECT 1 FROM catalog_ips WHERE id=$1 AND is_active=true", [input.ipId]);
          if (!ip.rowCount) throw badRequest("신청할 작품 IP를 찾을 수 없습니다.");
        }
        const updated = await client.query(
          `UPDATE wanted_requests
           SET category=$2,ip_id=$3,desired_item=$4,details=$5,version=version+1
           WHERE id=$1 AND version=$6 AND status='ACTIVE' RETURNING id`,
          [
            requestId,
            input.category ?? current.category,
            input.ipId ?? current.ip_id,
            input.desiredItem ?? current.desired_item,
            input.details ?? current.details,
            input.expectedVersion,
          ],
        );
        if (!updated.rowCount) throw conflict("신청 글이 다른 기기에서 먼저 수정되었습니다.");
        await writeOutbox(client, request.id, {
          aggregateType: "WANTED_REQUEST",
          aggregateId: requestId,
          eventType: "wanted-request.updated",
          payload: { requestId, userId: request.actor!.userId },
        });
        return {
          statusCode: 200,
          body: await fetchWanted(client, requestId, request.actor!.userId),
          resourceId: requestId,
        };
      },
    });
    return sendMutation(reply, result);
  });

  app.delete("/v1/wanted-requests/:requestId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const requestId = uuidInput((request.params as Record<string, unknown>).requestId, "requestId");
    const body = objectInput(request.body);
    const expectedVersion = integerInput(body, "expectedVersion", { min: 1 })!;
    const result = await idempotentMutation(context, request, {
      scope: "WANTED_REQUEST_DELETE",
      payload: { requestId, expectedVersion },
      resourceType: "WANTED_REQUEST",
      work: async (client) => {
        const before = await client.query<{ user_id: string; status: WantedRequestRow["status"]; version: number }>(
          "SELECT user_id,status,version FROM wanted_requests WHERE id=$1 FOR UPDATE",
          [requestId],
        );
        if (!before.rowCount) throw notFound("신청 글을 찾을 수 없습니다.");
        const current = before.rows[0]!;
        if (current.user_id !== request.actor!.userId) throw forbidden();
        if (current.status === "DELETED") throw conflict("이미 삭제된 신청 글입니다.");
        if (current.version !== expectedVersion) throw conflict("신청 글이 다른 기기에서 먼저 수정되었습니다.");
        const deleted = await client.query<{ version: number }>(
          `UPDATE wanted_requests SET status='DELETED',version=version+1
           WHERE id=$1 AND version=$2 AND status<>'DELETED' RETURNING version`,
          [requestId, expectedVersion],
        );
        if (!deleted.rowCount) throw conflict("신청 글이 다른 기기에서 먼저 수정되었습니다.");
        const response = { requestId, status: "DELETED" as const, version: deleted.rows[0]!.version };
        await writeOutbox(client, request.id, {
          aggregateType: "WANTED_REQUEST",
          aggregateId: requestId,
          eventType: "wanted-request.deleted",
          payload: { requestId, userId: request.actor!.userId },
        });
        return { statusCode: 200, body: response, resourceId: requestId };
      },
    });
    return sendMutation(reply, result);
  });

  app.post("/v1/wanted-requests/:requestId/like", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const requestId = uuidInput((request.params as Record<string, unknown>).requestId, "requestId");
    const body = objectInput(request.body);
    const liked = booleanInput(body, "liked")!;
    const result = await idempotentMutation(context, request, {
      scope: "WANTED_REQUEST_LIKE",
      payload: { requestId, liked },
      resourceType: "WANTED_REQUEST",
      work: async (client) => {
        const wanted = await client.query<{ user_id: string }>(
          "SELECT user_id FROM wanted_requests WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
          [requestId],
        );
        if (!wanted.rowCount) throw notFound("신청 글을 찾을 수 없습니다.");
        if (wanted.rows[0]!.user_id === request.actor!.userId) {
          throw forbidden("자신의 신청 글에는 좋아요를 누를 수 없습니다.");
        }
        const changed = liked
          ? await client.query(
            "INSERT INTO wanted_request_likes(request_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING request_id",
            [requestId, request.actor!.userId],
          )
          : await client.query(
            "DELETE FROM wanted_request_likes WHERE request_id=$1 AND user_id=$2 RETURNING request_id",
            [requestId, request.actor!.userId],
          );
        const count = await client.query<{ count: string }>(
          "SELECT count(*) FROM wanted_request_likes WHERE request_id=$1",
          [requestId],
        );
        if (changed.rowCount) {
          await writeOutbox(client, request.id, {
            aggregateType: "WANTED_REQUEST",
            aggregateId: requestId,
            eventType: liked ? "wanted-request.liked" : "wanted-request.unliked",
            payload: { requestId, userId: request.actor!.userId },
          });
        }
        return {
          statusCode: 200,
          body: { requestId, liked, likeCount: Number(count.rows[0]!.count) },
          resourceId: requestId,
        };
      },
    });
    return sendMutation(reply, result);
  });
}
