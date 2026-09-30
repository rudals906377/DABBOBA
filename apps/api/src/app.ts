import type { Redis } from "ioredis";
import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import { buildAppCore } from "./app-core.js";
import { nodeMediaRuntime } from "./lib/media-runtime-node.js";

export type BuildAppOptions = {
  config: ApiConfig;
  pool?: DatabasePool;
  redis?: Redis | null;
};

// ioredis is an optional dependency: it is loaded only when REDIS_URL configures
// the shared rate-limit store, so deployments without Redis never evaluate it.
async function createRedisClient(redisUrl: string): Promise<Redis> {
  let RedisClient: typeof Redis;
  try {
    ({ Redis: RedisClient } = await import("ioredis"));
  } catch (error) {
    throw new Error("REDIS_URL is configured but the optional ioredis dependency is not installed", {
      cause: error,
    });
  }
  return new RedisClient(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

export async function buildApp(options: BuildAppOptions) {
  const redis = options.redis === undefined
    ? options.config.redisUrl
      ? await createRedisClient(options.config.redisUrl)
      : null
    : options.redis;
  const ownsRedis = options.redis === undefined && redis !== null;

  if (ownsRedis && redis) {
    try {
      await redis.connect();
    } catch (error) {
      redis.disconnect();
      throw error;
    }
  }

  try {
    const built = await buildAppCore({
      config: options.config,
      mediaRuntime: nodeMediaRuntime,
      redis,
      ...(options.pool ? { pool: options.pool } : {}),
    });
    built.app.addHook("onClose", async () => {
      if (ownsRedis && redis) redis.disconnect();
    });
    return built;
  } catch (error) {
    if (ownsRedis && redis) redis.disconnect();
    throw error;
  }
}
