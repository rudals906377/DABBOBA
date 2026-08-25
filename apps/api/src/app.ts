import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { Redis } from "ioredis";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool, type DatabasePool } from "@dabboba/db";
import { registerErrorHandler } from "./lib/errors.js";
import { registerAuthRoutes } from "./modules/auth.js";
import { registerAdminAccountDeletionRoutes } from "./modules/admin-account-deletions.js";
import { registerAdminCommerceRoutes } from "./modules/admin-commerce.js";
import { registerAdminRoutes } from "./modules/admin.js";
import { registerAccountRoutes } from "./modules/account.js";
import { registerCatalogRoutes } from "./modules/catalog.js";
import { registerCommerceRoutes } from "./modules/commerce.js";
import { registerCommunityRoutes } from "./modules/community.js";
import { registerExchangeRoutes } from "./modules/exchange.js";
import { registerHealthRoutes } from "./modules/health.js";
import { registerMediaRoutes } from "./modules/media.js";
import { registerNotificationPreferenceRoutes } from "./modules/notification-preferences.js";
import { registerWantedRoutes } from "./modules/wanted.js";
import { createAuthHooks } from "./plugins/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody: Buffer | null;
  }
}

export type BuildAppOptions = {
  config: ApiConfig;
  pool?: DatabasePool;
  redis?: Redis | null;
};

function requestId(rawRequest: { headers: Record<string, string | string[] | undefined> }) {
  const provided = rawRequest.headers["x-request-id"];
  const value = Array.isArray(provided) ? provided[0] : provided;
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : randomUUID();
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: {
      level: options.config.logLevel,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-dabboba-admin-client-signature']",
        "body.password",
        "body.token",
      ],
    },
    genReqId: requestId,
    trustProxy: false,
  });
  const ownsPool = !options.pool;
  const ownsRedis = options.redis === undefined;
  const pool = options.pool || createDatabasePool(options.config.databaseUrl, "dabboba-api");
  const redis = options.redis === undefined
    ? new Redis(options.config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false })
    : options.redis;
  const allowedOrigins = new Set([...options.config.webOrigins, ...options.config.adminOrigins]);

  if (ownsRedis && redis) {
    try {
      await redis.connect();
    } catch (error) {
      redis.disconnect();
      if (ownsPool) await pool.end();
      throw error;
    }
  }

  app.decorateRequest("actor", null);
  app.decorateRequest("rawBody", null);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    request.rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody.toString("utf8")));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    credentials: false,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) callback(null, true);
      else callback(null, false);
    },
  });
  await app.register(rateLimit, {
    max: 240,
    timeWindow: "1 minute",
    ...(redis ? { redis } : {}),
  });

  const context = {
    config: options.config,
    pool,
    redis,
    auth: createAuthHooks(pool, options.config),
  };
  registerErrorHandler(app);
  await registerHealthRoutes(app, context);
  await registerAuthRoutes(app, context);
  await registerMediaRoutes(app, context);
  await registerAccountRoutes(app, context);
  await registerNotificationPreferenceRoutes(app, context);
  await registerCatalogRoutes(app, context);
  await registerCommunityRoutes(app, context);
  await registerWantedRoutes(app, context);
  await registerExchangeRoutes(app, context);
  await registerCommerceRoutes(app, context);
  await registerAdminCommerceRoutes(app, context);
  await registerAdminAccountDeletionRoutes(app, context);
  await registerAdminRoutes(app, context);

  app.addHook("onClose", async () => {
    if (ownsPool) await pool.end();
    if (ownsRedis && redis) redis.disconnect();
  });

  return { app, context };
}
