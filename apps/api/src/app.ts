import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { Redis } from "ioredis";
import type { ApiConfig, ApiSurface } from "@dabboba/config";
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
import { registerCustomerAuthRoutes } from "./modules/customer-auth.js";
import { registerExchangeRoutes } from "./modules/exchange.js";
import { registerHealthRoutes } from "./modules/health.js";
import { registerKujiRoomRoutes } from "./modules/kuji-rooms.js";
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

const API_DATABASE_QUERY_TIMEOUT_MS = 12_000;
const API_DATABASE_STATEMENT_TIMEOUT_MS = 10_000;
const READINESS_DATABASE_TIMEOUT_MS = 1_000;

function requestId(rawRequest: { headers: Record<string, string | string[] | undefined> }) {
  const provided = rawRequest.headers["x-request-id"];
  const value = Array.isArray(provided) ? provided[0] : provided;
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : randomUUID();
}

const ROUTE_METHODS = new Set(["all", "delete", "get", "head", "options", "patch", "post", "put", "route"]);

function effectiveSurface(config: ApiConfig): ApiSurface {
  return config.surface || (config.environment === "production" ? "customer" : "all");
}

function routeUrl(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "url" in input && typeof input.url === "string") return input.url;
  return null;
}

function isAdminRoute(url: string): boolean {
  return url === "/v1/admin" || url.startsWith("/v1/admin/");
}

/**
 * Route modules predate the public/admin deployment split and some contain both
 * kinds of route. This registrar prevents out-of-surface routes from ever being
 * added to Fastify while the handlers are incrementally separated by module.
 */
function surfaceRouteRegistrar(app: ReturnType<typeof Fastify>, surface: ApiSurface) {
  if (surface === "all") return app;

  return new Proxy(app, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof property === "string" && ROUTE_METHODS.has(property) && typeof value === "function") {
        return (...args: unknown[]) => {
          const url = routeUrl(args[0]);
          if (!url) {
            throw new Error(`Unsupported ${String(property)} registration on the isolated ${surface} API surface`);
          }
          const allowed = surface === "admin" ? isAdminRoute(url) : !isAdminRoute(url);
          if (allowed) Reflect.apply(value, target, args);
          return target;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: {
      level: options.config.logLevel,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-dabboba-signature']",
        "req.headers['x-dabboba-admin-client-signature']",
        "body.password",
        "body.token",
        "body.accessToken",
      ],
    },
    genReqId: requestId,
    trustProxy: false,
  });
  const ownsPool = !options.pool;
  const pool = options.pool || createDatabasePool(
    options.config.databaseUrl,
    "dabboba-api",
    {
      max: options.config.databasePoolMax ?? 5,
      queryTimeoutMs: API_DATABASE_QUERY_TIMEOUT_MS,
      statementTimeoutMs: API_DATABASE_STATEMENT_TIMEOUT_MS,
    },
  );
  // Health probes use their own one-connection pool. Its server-side statement
  // timeout cancels the PostgreSQL work before Cloud Run's two-second probe
  // deadline instead of merely abandoning a still-running query promise.
  const readinessPool = options.pool || createDatabasePool(
    options.config.databaseUrl,
    "dabboba-api-readiness",
    {
      connectionTimeoutMs: READINESS_DATABASE_TIMEOUT_MS,
      max: 1,
      queryTimeoutMs: READINESS_DATABASE_TIMEOUT_MS,
      statementTimeoutMs: READINESS_DATABASE_TIMEOUT_MS,
    },
  );
  const ownsReadinessPool = !options.pool;
  const redis = options.redis === undefined
    ? options.config.redisUrl
      ? new Redis(options.config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false })
      : null
    : options.redis;
  const ownsRedis = options.redis === undefined && redis !== null;
  const surface = effectiveSurface(options.config);
  const allowedOrigins = new Set([
    ...(surface === "admin" ? [] : options.config.webOrigins),
    ...(surface === "customer" ? [] : options.config.adminOrigins),
  ]);

  if (ownsRedis && redis) {
    try {
      await redis.connect();
    } catch (error) {
      redis.disconnect();
      if (ownsReadinessPool) await readinessPool.end();
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
  const routeApp = surfaceRouteRegistrar(app, surface);
  registerErrorHandler(app);
  await registerHealthRoutes(app, context, readinessPool);
  await registerAuthRoutes(routeApp, context);
  await registerCustomerAuthRoutes(routeApp, context);
  await registerMediaRoutes(routeApp, context);
  await registerAccountRoutes(routeApp, context);
  await registerNotificationPreferenceRoutes(routeApp, context);
  await registerCatalogRoutes(routeApp, context);
  await registerCommunityRoutes(routeApp, context);
  await registerWantedRoutes(routeApp, context);
  await registerExchangeRoutes(routeApp, context);
  await registerCommerceRoutes(routeApp, context);
  await registerKujiRoomRoutes(routeApp, context);
  await registerAdminCommerceRoutes(routeApp, context);
  await registerAdminAccountDeletionRoutes(routeApp, context);
  await registerAdminRoutes(routeApp, context);

  app.addHook("onClose", async () => {
    if (ownsReadinessPool) await readinessPool.end();
    if (ownsPool) await pool.end();
    if (ownsRedis && redis) redis.disconnect();
  });

  return { app, context };
}
