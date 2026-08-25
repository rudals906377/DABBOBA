import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";

export async function registerHealthRoutes(app: FastifyInstance, context: ApiContext) {
  const check = async () => {
    let database: "ok" | "unavailable" = "ok";
    let redis: "ok" | "unavailable" = "ok";
    await context.pool.query("SELECT 1").catch(() => { database = "unavailable"; });
    if (context.redis) await context.redis.ping().catch(() => { redis = "unavailable"; });
    else redis = "unavailable";
    return {
      status: database === "ok" && redis === "ok" ? "ok" as const : "degraded" as const,
      database,
      redis,
      timestamp: new Date().toISOString(),
    };
  };

  app.get("/healthz", async () => check());
  app.get("/readyz", async (_request, reply) => {
    const health = await check();
    return reply.code(health.database === "ok" ? 200 : 503).send(health);
  });
}
