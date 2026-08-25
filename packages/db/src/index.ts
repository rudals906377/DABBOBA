import pg from "pg";

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

export function createDatabasePool(databaseUrl: string, applicationName = "dabboba") {
  return new Pool({
    connectionString: databaseUrl,
    application_name: applicationName,
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  });
}

export async function withTransaction<T>(pool: DatabasePool, work: (client: DatabaseClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type CursorValue = {
  createdAt: string;
  id: string;
  sort?: string;
};

export function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(value: string | undefined): CursorValue | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorValue>;
    if (typeof decoded.createdAt !== "string" || Number.isNaN(Date.parse(decoded.createdAt))) return null;
    if (typeof decoded.id !== "string" || decoded.id.length < 1 || decoded.id.length > 200) return null;
    if (decoded.sort !== undefined && typeof decoded.sort !== "string") return null;
    return {
      createdAt: decoded.createdAt,
      id: decoded.id,
      ...(typeof decoded.sort === "string" ? { sort: decoded.sort } : {}),
    };
  } catch {
    return null;
  }
}

export function boundedLimit(raw: unknown, fallback = 30, maximum = 100): number {
  const parsed = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}
