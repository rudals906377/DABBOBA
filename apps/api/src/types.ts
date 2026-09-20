import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import type { Redis } from "ioredis";
import type { createAuthHooks } from "./plugins/auth.js";
import type { ApiMediaRuntime } from "./lib/media-runtime.js";

export type ApiContext = {
  config: ApiConfig;
  pool: DatabasePool;
  redis: Redis | null;
  mediaRuntime: ApiMediaRuntime;
  auth: ReturnType<typeof createAuthHooks>;
};
