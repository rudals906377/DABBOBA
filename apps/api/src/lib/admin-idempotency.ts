import type { FastifyReply, FastifyRequest } from "fastify";
import { withTransaction, type DatabaseClient } from "@dabboba/db";
import type { ApiContext } from "../types.js";
import { adminMutationHeaders } from "./audit.js";
import { beginIdempotency, completeIdempotency, requestHash } from "./idempotency.js";

type AdminMutationWork<T> = {
  statusCode: number;
  body: T;
  resourceType: string;
  resourceId: string;
};

export type AdminMutationResult<T> = {
  replay: boolean;
  statusCode: number;
  body: T;
};

export async function adminIdempotentMutation<T>(
  context: ApiContext,
  request: FastifyRequest,
  input: {
    target: unknown;
    bodyReason?: string | null;
    beforeBegin?: (client: DatabaseClient) => Promise<void>;
    work: (client: DatabaseClient) => Promise<AdminMutationWork<T>>;
  },
): Promise<AdminMutationResult<T>> {
  const mutation = adminMutationHeaders(request, input.bodyReason);
  const path = request.routeOptions.url || request.url.split("?", 1)[0] || request.url;
  const hash = requestHash({
    method: request.method,
    path,
    target: input.target,
    body: request.body ?? null,
    reason: mutation.reason,
  });

  return withTransaction(context.pool, async (client) => {
    if (input.beforeBegin) await input.beforeBegin(client);
    const started = await beginIdempotency(client, {
      actorId: request.actor!.userId,
      scope: "ADMIN_MUTATION",
      key: mutation.idempotencyKey,
      hash,
    });
    if (!started.fresh) {
      return {
        replay: true,
        statusCode: started.statusCode,
        body: started.body as T,
      };
    }

    const result = await input.work(client);
    await completeIdempotency(client, started.id, result);
    return { replay: false, statusCode: result.statusCode, body: result.body };
  });
}

export function sendAdminMutation<T>(reply: FastifyReply, result: AdminMutationResult<T>) {
  if (result.replay) reply.header("x-idempotent-replay", "true");
  if (result.statusCode === 204) return reply.code(204).send();
  return reply.code(result.statusCode).send(result.body);
}
