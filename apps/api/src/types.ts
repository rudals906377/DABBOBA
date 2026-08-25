import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import type { Redis } from "ioredis";
import type { createAuthHooks } from "./plugins/auth.js";

export type ApiContext = {
  config: ApiConfig;
  pool: DatabasePool;
  redis: Redis | null;
  auth: ReturnType<typeof createAuthHooks>;
};
