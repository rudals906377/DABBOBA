import pg from "pg";
import { SUPABASE_ROOT_2021_CA } from "./supabase-root-ca.js";
import { RUNTIME_DATABASE_ROLE, WORKER_DATABASE_ROLE } from "./runtime-role.js";

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
  lockKujiProductRoomAdvisory,
  lockLinkedKujiRoomForOrder,
  promoteNextKujiRoomEntryLocked,
  releaseLockedKujiOrderRoom,
  startLockedKujiOrderDrawing,
  type KujiRoomEntryState,
  type LockedKujiOrderRoom,
} from "./kuji-room.js";
export {
  RUNTIME_DATABASE_ROLE,
  WORKER_DATABASE_ROLE,
} from "./runtime-role.js";

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

export type DatabaseConnectionConfig = Pick<pg.PoolConfig, "connectionString" | "ssl">;

export type DatabasePoolFault = {
  errorCode: string | null;
};

const SAFE_DATABASE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);
const POSTGRES_ERROR_CLASSES = new Set([
  "00", "01", "02", "03", "08", "09", "0A", "0B", "0F", "0L", "0P", "0Z",
  "20", "21", "22", "23", "24", "25", "26", "27", "28", "2B", "2D", "2F",
  "34", "38", "39", "3B", "3D", "3F", "40", "42", "44", "53", "54", "55", "57",
  "58", "72", "F0", "HV", "P0", "XX",
]);

function databaseErrorCode(error: Error): string | null {
  const candidate = (error as Error & { code?: unknown }).code;
  if (typeof candidate !== "string") return null;
  if (
    (/^[0-9A-Z]{5}$/.test(candidate) && POSTGRES_ERROR_CLASSES.has(candidate.slice(0, 2)))
    || SAFE_DATABASE_ERROR_CODES.has(candidate)
  ) return candidate;
  return null;
}

function reportIdleClientError(fault: DatabasePoolFault): void {
  process.stderr.write(`${JSON.stringify({
    level: "error",
    service: "dabboba-db",
    message: "Idle database client failed and was removed",
    errorCode: fault.errorCode,
  })}\n`);
}

function observeIdleClientErrors(
  pool: pg.Pool,
  observer: ((fault: DatabasePoolFault) => void) | undefined,
): void {
  pool.on("error", (error) => {
    const fault = { errorCode: databaseErrorCode(error) };
    if (!observer) {
      reportIdleClientError(fault);
      return;
    }
    try {
      observer(fault);
    } catch {
      // An observability callback must not turn an already-discarded idle
      // connection into an unhandled EventEmitter error.
      reportIdleClientError(fault);
    }
  });
}

export function databaseConnectionConfig(databaseUrl: string): DatabaseConnectionConfig {
  try {
    const parsed = new URL(databaseUrl);
    const hostname = parsed.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
    if (hostname.endsWith(".supabase.com") || hostname.endsWith(".supabase.co")) {
      // node-postgres lets URL query parameters override the explicit TLS object.
      // Supabase URLs are canonicalized so sslmode=disable or a query-level host
      // override cannot silently bypass certificate and hostname verification.
      parsed.hostname = hostname;
      parsed.search = "";
      parsed.hash = "";
      return {
        connectionString: parsed.toString(),
        ssl: {
          ca: SUPABASE_ROOT_2021_CA,
          rejectUnauthorized: true,
        },
      };
    }
  } catch {
    // Pool construction owns the final invalid-URL error.
  }
  return { connectionString: databaseUrl };
}

export function databaseSslConfig(databaseUrl: string): pg.PoolConfig["ssl"] | undefined {
  return databaseConnectionConfig(databaseUrl).ssl;
}

export function createDatabasePool(
  databaseUrl: string,
  applicationName = "dabboba",
  options: {
    expectedRole?: typeof RUNTIME_DATABASE_ROLE | typeof WORKER_DATABASE_ROLE;
    runtimeEnvironment?: string;
    connectionTimeoutMs?: number;
    max?: number;
    onIdleClientError?: (fault: DatabasePoolFault) => void;
    queryTimeoutMs?: number;
    statementTimeoutMs?: number;
  } = {},
) {
  assertProductionRuntimeDatabaseRole(
    databaseUrl,
    options.runtimeEnvironment ?? process.env.NODE_ENV,
    options.expectedRole ?? RUNTIME_DATABASE_ROLE,
  );
  assertDisposableIntegrationDatabaseTarget(
    databaseUrl,
    process.env.DATABASE_URL,
    applicationName,
  );
  for (const [name, value] of [
    ["connectionTimeoutMs", options.connectionTimeoutMs],
    ["queryTimeoutMs", options.queryTimeoutMs],
    ["statementTimeoutMs", options.statementTimeoutMs],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 60_000)) {
      throw new Error(`${name} must be an integer between 1 and 60000 milliseconds`);
    }
  }
  const connection = databaseConnectionConfig(databaseUrl);
  const pool = new Pool({
    ...connection,
    application_name: applicationName,
    max: options.max ?? 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    query_timeout: options.queryTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
    allowExitOnIdle: false,
  });
  observeIdleClientErrors(pool, options.onIdleClientError);
  return pool;
}

export function createMigrationDatabasePool(
  databaseUrl: string,
  applicationName = "dabboba-migrate",
  options: { onIdleClientError?: (fault: DatabasePoolFault) => void } = {},
) {
  assertProductionMigrationDatabaseTarget(databaseUrl, process.env.NODE_ENV);
  const connection = databaseConnectionConfig(databaseUrl);
  const pool = new Pool({
    ...connection,
    application_name: applicationName,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  });
  observeIdleClientErrors(pool, options.onIdleClientError);
  return pool;
}

function productionSupabaseDatabaseUrl(
  databaseUrl: string,
  runtimeEnvironment: string | undefined,
): URL | null {
  if (runtimeEnvironment !== "production") return null;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Production database URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Production database URL must use postgres:// or postgresql://");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname.endsWith(".supabase.com") && !hostname.endsWith(".supabase.co")) {
    throw new Error("Production database URLs must use an approved Supabase hostname");
  }
  return parsed;
}

export function assertProductionMigrationDatabaseTarget(
  databaseUrl: string,
  runtimeEnvironment: string | undefined,
): void {
  productionSupabaseDatabaseUrl(databaseUrl, runtimeEnvironment);
}

export function assertProductionRuntimeDatabaseRole(
  databaseUrl: string,
  runtimeEnvironment: string | undefined,
  expectedRole: typeof RUNTIME_DATABASE_ROLE | typeof WORKER_DATABASE_ROLE = RUNTIME_DATABASE_ROLE,
): void {
  const parsed = productionSupabaseDatabaseUrl(databaseUrl, runtimeEnvironment);
  if (!parsed) return;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

  let username: string;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    throw new Error("Production Supabase DATABASE_URL has an invalid database username");
  }

  const sessionPooler = hostname.endsWith(".pooler.supabase.com");
  if (expectedRole === WORKER_DATABASE_ROLE && sessionPooler && parsed.port !== "5432") {
    throw new Error(
      "Production Supabase worker database URL must use Session mode on port 5432 because the worker holds a session advisory lock",
    );
  }
  const valid = sessionPooler
    ? new RegExp(`^${expectedRole}\\.[a-z0-9]{20}$`).test(username)
    : username === expectedRole;
  if (!valid) {
    throw new Error(
      `Production Supabase database URL must use the restricted ${expectedRole} database role`,
    );
  }
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
  let destroyClient = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the operation error while ensuring a connection whose
      // transaction state is unknown can never return to the pool.
      destroyClient = true;
    }
    throw error;
  } finally {
    client.release(destroyClient);
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
