import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { ApiConfig, ApiSurface } from "@dabboba/config";
import { createDatabasePool, type DatabasePool } from "@dabboba/db";
import { badRequest, registerErrorHandler } from "./lib/errors.js";
import { serializeRequestForLog } from "./lib/logging.js";
import { registerAuthRoutes } from "./modules/auth.js";
import { registerAdminAccountDeletionRoutes } from "./modules/admin-account-deletions.js";
import { registerAdminCommerceRoutes } from "./modules/admin-commerce.js";
import { registerAdminRoutes } from "./modules/admin.js";
import { registerAccountRoutes } from "./modules/account.js";
import { registerCatalogRoutes } from "./modules/catalog.js";
import { registerCatalogMediaRoutes } from "./modules/catalog-media.js";
import { registerHomeCatalogRoutes } from "./modules/home-catalog.js";
import { registerStorefrontCategoryRoutes } from "./modules/storefront-categories.js";
import { registerCommerceRoutes } from "./modules/commerce.js";
import { registerCommunityRoutes } from "./modules/community.js";
import { registerCustomerAuthRoutes } from "./modules/customer-auth.js";
import { registerDrawRecoveryRoutes } from "./modules/draw-recovery.js";
import { registerDemoRoutes, registerDemoSafetyHook } from "./modules/demo.js";
import { registerExchangeRoutes } from "./modules/exchange.js";
import { registerHealthRoutes } from "./modules/health.js";
import { registerKujiRoomRoutes } from "./modules/kuji-rooms.js";
import { registerKujiSlotRoutes } from "./modules/kuji-slots.js";
import { registerMediaRoutes } from "./modules/media.js";
import { registerNotificationPreferenceRoutes } from "./modules/notification-preferences.js";
import { registerPublicConfigRoutes } from "./modules/public-config.js";
import { registerWantedRoutes } from "./modules/wanted.js";
import { createAuthHooks } from "./plugins/auth.js";
import type { ApiMediaRuntime } from "./lib/media-runtime.js";
import { demoRuntimeFromEnvironment } from "./lib/demo-testing.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody: Buffer | null;
  }
}

export type BuildAppCoreOptions = {
  config: ApiConfig;
  mediaRuntime: ApiMediaRuntime;
  pool?: DatabasePool;
  readinessPool?: DatabasePool;
  redis: Redis | null;
  loggerInstance?: FastifyBaseLogger;
  edgeSafeLogging?: boolean;
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

export async function buildAppCore(options: BuildAppCoreOptions) {
  const app = Fastify({
    bodyLimit: 1_048_576,
    ...(options.loggerInstance
      ? { loggerInstance: options.loggerInstance, disableRequestLogging: options.edgeSafeLogging === true }
      : { logger: {
          level: options.config.logLevel,
          serializers: { req: serializeRequestForLog },
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['x-dabboba-signature']",
            "req.headers['x-dabboba-admin-client-signature']",
            "body.password",
            "body.token",
            "body.accessToken",
          ],
        } }),
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
  const readinessPool = options.readinessPool || options.pool || createDatabasePool(
    options.config.databaseUrl,
    "dabboba-api-readiness",
    {
      connectionTimeoutMs: READINESS_DATABASE_TIMEOUT_MS,
      max: 1,
      queryTimeoutMs: READINESS_DATABASE_TIMEOUT_MS,
      statementTimeoutMs: READINESS_DATABASE_TIMEOUT_MS,
    },
  );
  const ownsReadinessPool = !options.readinessPool && !options.pool;
  const redis = options.redis;
  const surface = effectiveSurface(options.config);
  const allowedOrigins = new Set([
    ...(surface === "admin" ? [] : options.config.webOrigins),
    ...(surface === "customer" ? [] : options.config.adminOrigins),
  ]);

  app.decorateRequest("actor", null);
  app.decorateRequest("rawBody", null);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    request.rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody.toString("utf8")));
    } catch {
      done(badRequest(), undefined);
    }
  });
  if (options.edgeSafeLogging) {
    app.addHook("onResponse", async (request, reply) => {
      request.log.info({
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
      });
    });
  }

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
    mediaRuntime: options.mediaRuntime,
    auth: createAuthHooks(pool, options.config),
  };
  const demoRuntime = demoRuntimeFromEnvironment(process.env, options.config);
  registerDemoSafetyHook(app, context, demoRuntime);
  const routeApp = surfaceRouteRegistrar(app, surface);
  registerErrorHandler(app);
  await registerHealthRoutes(app, context, readinessPool);
  await registerAuthRoutes(routeApp, context);
  await registerCustomerAuthRoutes(routeApp, context);
  await registerPublicConfigRoutes(routeApp, context);
  await registerMediaRoutes(routeApp, context);
  await registerAccountRoutes(routeApp, context);
  await registerNotificationPreferenceRoutes(routeApp, context);
  await registerCatalogRoutes(routeApp, context);
  await registerCatalogMediaRoutes(routeApp, context);
  await registerHomeCatalogRoutes(routeApp, context);
  await registerStorefrontCategoryRoutes(routeApp, context);
  const communityEnabled = options.config.communityEnabled
    ?? options.config.environment !== "production";
  // The public community can be disabled at launch while its privileged
  // moderation and notice-management routes remain available to operators.
  if (communityEnabled || surface === "admin") await registerCommunityRoutes(routeApp, context);
  await registerWantedRoutes(routeApp, context);
  await registerExchangeRoutes(routeApp, context);
  await registerCommerceRoutes(routeApp, context);
  await registerDemoRoutes(routeApp, context, demoRuntime);
  await registerDrawRecoveryRoutes(routeApp, context);
  await registerKujiRoomRoutes(routeApp, context);
  await registerKujiSlotRoutes(routeApp, context);
  await registerAdminCommerceRoutes(routeApp, context);
  await registerAdminAccountDeletionRoutes(routeApp, context);
  await registerAdminRoutes(routeApp, context);

  app.addHook("onClose", async () => {
    if (ownsReadinessPool) await readinessPool.end();
    if (ownsPool) await pool.end();
  });

  return { app, context };
}
