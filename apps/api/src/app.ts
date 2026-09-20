import { Redis } from "ioredis";
import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import { buildAppCore } from "./app-core.js";
import { nodeMediaRuntime } from "./lib/media-runtime-node.js";

export type BuildAppOptions = {
  config: ApiConfig;
  pool?: DatabasePool;
  redis?: Redis | null;
};

export async function buildApp(options: BuildAppOptions) {
  const redis = options.redis === undefined
    ? options.config.redisUrl
      ? new Redis(options.config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        })
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
