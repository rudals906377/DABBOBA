import pg from "pg";

export {
  KUJI_CHECKOUT_LEASE_SECONDS,
  KUJI_DRAW_LEASE_SECONDS,
  bumpKujiRoomVersion,
  completeLockedKujiOrderRoomIfDrawn,
  expireLockedKujiOrderDrawing,
  kujiCheckoutExpiry,
  kujiDrawingExpiry,
  lockExistingKujiRoom,
  lockKujiRoomAdvisories,
  lockLinkedKujiRoomForOrder,
  promoteNextKujiRoomEntryLocked,
  releaseLockedKujiOrderRoom,
  startLockedKujiOrderDrawing,
  type KujiRoomEntryState,
  type LockedKujiOrderRoom,
} from "./kuji-room.js";

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

export function createDatabasePool(databaseUrl: string, applicationName = "dabboba") {
  assertDisposableIntegrationDatabaseTarget(
    databaseUrl,
    process.env.DATABASE_URL,
    applicationName,
  );
  return new Pool({
    connectionString: databaseUrl,
    application_name: applicationName,
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  });
}

export function assertDisposableIntegrationDatabaseTarget(
  databaseUrl: string,
  applicationDatabaseUrl: string | undefined,
  applicationName: string,
): void {
  if (!applicationName.endsWith("-integration") || !applicationDatabaseUrl) return;
  if (databaseTarget(databaseUrl) !== databaseTarget(applicationDatabaseUrl)) return;
  throw new Error(
    "통합 테스트 데이터베이스가 앱 데이터베이스와 같습니다. 별도의 DABBOBA_DISPOSABLE_TEST_DATABASE_URL을 사용해 주세요.",
  );
}

function databaseTarget(value: string): string {
  try {
    const parsed = new URL(value);
    const port = parsed.port || "5432";
    return `${parsed.hostname.toLocaleLowerCase("en-US")}:${port}${parsed.pathname}`;
  } catch {
    return value.trim();
  }
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
