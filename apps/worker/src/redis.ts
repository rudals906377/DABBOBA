export type ParsedRedisConnection = {
  host: string;
  port: number;
  db: number;
  maxRetriesPerRequest: null;
  enableReadyCheck: true;
  username?: string;
  password?: string;
  tls?: { servername: string };
};

export function redisConnectionOptions(redisUrl: string): ParsedRedisConnection {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error("REDIS_URL must use redis or rediss");
  const databasePath = url.pathname.replace(/^\//, "");
  const db = databasePath ? Number(databasePath) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error("REDIS_URL database must be a non-negative integer");

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6_379,
    db,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === "rediss:" ? { tls: { servername: url.hostname } } : {}),
  };
}
