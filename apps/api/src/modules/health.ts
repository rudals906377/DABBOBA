import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "@dabboba/db";
import type { ApiContext } from "../types.js";

export const READINESS_RESPONSE_TIMEOUT_MS = 1_500;

export async function registerHealthRoutes(
  app: FastifyInstance,
  context: ApiContext,
  readinessPool: DatabasePool = context.pool,
) {
  const readiness = async () => {
    let database: "ok" | "unavailable" = "ok";
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        readinessPool.query("SELECT 1"),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("readiness database check timed out")),
            READINESS_RESPONSE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      database = "unavailable";
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return {
      status: database === "ok" ? "ok" as const : "unavailable" as const,
      database,
      timestamp: new Date().toISOString(),
    };
  };

  app.get("/healthz", { config: { rateLimit: false } }, async () => ({
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  }));
  app.get("/readyz", { config: { rateLimit: false } }, async (_request, reply) => {
    const health = await readiness();
    return reply.code(health.database === "ok" ? 200 : 503).send(health);
  });
}
