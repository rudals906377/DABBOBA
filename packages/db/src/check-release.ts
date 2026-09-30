import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  databaseConnectionConfig,
  type DatabaseClient,
  type DatabasePool,
} from "./index.js";
import { RUNTIME_DATABASE_ROLE, WORKER_DATABASE_ROLE } from "./runtime-role.js";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const READ_TIMEOUT_MS = 10_000;

type ConnectionKind = "migration" | "runtime" | "worker";
type ReleaseCheckStatus = "pass" | "blocked" | "inconclusive";
type ClientTlsEvidence = "encrypted" | "not_required" | "inconclusive";

type RoleAttributes = {
  rolbypassrls: boolean;
  rolcanlogin: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolinherit: boolean;
  rolreplication: boolean;
  rolsuper: boolean;
};

type ConnectionEvidence = {
  actualRoleClass: "migration" | "runtime" | "worker" | "unexpected";
  actualRoleHash: string;
  clientTlsEvidence: ClientTlsEvidence;
  expectedRoleMatch: boolean;
};

type DatabaseAggregateEvidence = {
  migrations: {
    appliedCount: number;
    diskCount: number;
    matchedCount: number;
    mismatchedCount: number;
    missingCount: number;
    unexpectedCount: number;
  };
  publicTables: {
    anonRolePresent: boolean;
    anonExposedCount: number;
    authenticatedRolePresent: boolean;
    authenticatedExposedCount: number;
    rlsDisabledCount: number;
    rlsEnabledCount: number;
    /** Supabase's RLS-bypassing Data API role; absent on plain PostgreSQL. */
    serviceRoleRolePresent: boolean;
    serviceRoleExposedCount: number;
    totalCount: number;
  };
  roleMembershipEdgesBetweenRuntimeAndWorker: number;
  roles: {
    migration: RoleAttributes | null;
    runtime: RoleAttributes | null;
    worker: RoleAttributes | null;
  };
};

export type ReleaseCheckInputs = {
  environmentTier?: string;
  migrationDatabaseUrl?: string;
  runtimeDatabaseUrl?: string;
  workerDatabaseUrl?: string;
};

export type ReleaseCheckReport = {
  scope: "database-release-check/v1";
  status: ReleaseCheckStatus;
  environmentTier: string;
  sameTarget: boolean | null;
  targetHash: string | null;
  tlsConfigured: { migration: boolean | null; runtime: boolean | null; worker: boolean | null };
  connections: Partial<Record<ConnectionKind, ConnectionEvidence>>;
  database: DatabaseAggregateEvidence | null;
  blockers: string[];
  inconclusive: string[];
};

type ReleaseCheckDependencies = {
  createPool?: (kind: ConnectionKind, databaseUrl: string) => DatabasePool;
  loadDiskChecksums?: () => Promise<Map<string, string>>;
};

type TargetIdentity = {
  hash: string;
  poolerPort: string | null;
  requiresTls: boolean;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function decodedDatabaseName(parsed: URL): string | null {
  if (!parsed.pathname.startsWith("/") || parsed.pathname.length <= 1) return null;
  try {
    const name = decodeURIComponent(parsed.pathname.slice(1));
    return name && !name.includes("/") ? name : null;
  } catch {
    return null;
  }
}

export function databaseTargetIdentity(databaseUrl: string): TargetIdentity | null {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  const databaseName = decodedDatabaseName(parsed);
  if (!databaseName) return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

  const direct = hostname.match(/^db\.([a-z0-9]{20})\.supabase\.(?:co|com)$/);
  if (direct?.[1]) {
    if (parsed.port && parsed.port !== "5432") return null;
    return { hash: sha256(`supabase:${direct[1]}:${databaseName}`), poolerPort: null, requiresTls: true };
  }

  if (hostname.endsWith(".pooler.supabase.com")) {
    let username: string;
    try {
      username = decodeURIComponent(parsed.username);
    } catch {
      return null;
    }
    const separator = username.lastIndexOf(".");
    if (separator <= 0) return null;
    const projectReference = username.slice(separator + 1);
    if (!/^[a-z0-9]{20}$/.test(projectReference)) return null;
    return {
      hash: sha256(`supabase:${projectReference}:${databaseName}`),
      poolerPort: parsed.port,
      requiresTls: true,
    };
  }

  if (["127.0.0.1", "[::1]", "localhost"].includes(hostname)) {
    // Unlike Supabase URLs, local URL query parameters are not canonicalized by
    // databaseConnectionConfig. Reject them so `?host=...` cannot make a local
    // target fingerprint describe a different network destination.
    if (parsed.search) return null;
    const port = parsed.port || "5432";
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65_535) return null;
    return {
      hash: sha256(`loopback:${hostname}:${port}:${databaseName}`),
      poolerPort: null,
      requiresTls: false,
    };
  }
  return null;
}

function tlsIsConfigured(databaseUrl: string): boolean {
  const ssl = databaseConnectionConfig(databaseUrl).ssl;
  return Boolean(ssl && typeof ssl === "object" && ssl.rejectUnauthorized === true);
}

function clientTlsEvidence(client: DatabaseClient, requiresTls: boolean): ClientTlsEvidence {
  if (!requiresTls) return "not_required";
  const encrypted = (client as unknown as {
    connection?: { stream?: { authorized?: unknown; encrypted?: unknown } };
  }).connection?.stream;
  return encrypted?.encrypted === true && encrypted.authorized === true
    ? "encrypted"
    : "inconclusive";
}

function roleClass(role: string): ConnectionEvidence["actualRoleClass"] {
  if (role === RUNTIME_DATABASE_ROLE) return "runtime";
  if (role === WORKER_DATABASE_ROLE) return "worker";
  if (!["anon", "authenticated", "authenticator"].includes(role)) return "migration";
  return "unexpected";
}

function expectedRoleMatches(kind: ConnectionKind, role: string): boolean {
  if (kind === "runtime") return role === RUNTIME_DATABASE_ROLE;
  if (kind === "worker") return role === WORKER_DATABASE_ROLE;
  return roleClass(role) === "migration"
    && role !== RUNTIME_DATABASE_ROLE
    && role !== WORKER_DATABASE_ROLE;
}

async function readOnlySnapshot<T>(
  pool: DatabasePool,
  work: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL statement_timeout = '${READ_TIMEOUT_MS}ms'`);
    await client.query(`SET LOCAL lock_timeout = '${READ_TIMEOUT_MS}ms'`);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      destroyClient = true;
    }
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

export async function loadDiskMigrationChecksums(): Promise<Map<string, string>> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  const checksums = new Map<string, string>();
  for (const file of files) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    checksums.set(file, sha256(sql));
  }
  return checksums;
}

async function inspectConnection(
  kind: ConnectionKind,
  databaseUrl: string,
  target: TargetIdentity,
  createPool: NonNullable<ReleaseCheckDependencies["createPool"]>,
  work?: (client: DatabaseClient, role: string) => Promise<DatabaseAggregateEvidence>,
): Promise<{ connection: ConnectionEvidence; database?: DatabaseAggregateEvidence }> {
  const pool = createPool(kind, databaseUrl);
  try {
    return await readOnlySnapshot(pool, async (client) => {
      const identity = await client.query<{ current_role: string }>(
        "SELECT current_user::text AS current_role",
      );
      const role = identity.rows[0]?.current_role;
      if (!role) throw new Error("missing-current-role");
      const connection: ConnectionEvidence = {
        actualRoleClass: roleClass(role),
        actualRoleHash: sha256(`database-role:${role}`),
        clientTlsEvidence: clientTlsEvidence(client, target.requiresTls),
        expectedRoleMatch: expectedRoleMatches(kind, role),
      };
      const database = work ? await work(client, role) : undefined;
      return database ? { connection, database } : { connection };
    });
  } finally {
    await pool.end();
  }
}

function numberValue(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") {
    throw new Error("invalid-aggregate");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("invalid-aggregate");
  return parsed;
}

async function inspectDatabase(
  client: DatabaseClient,
  migrationRole: string,
  diskChecksums: Map<string, string>,
): Promise<DatabaseAggregateEvidence> {
  const applied = await client.query<{ checksum: string; version: string }>(
    "SELECT version,checksum FROM public.schema_migrations ORDER BY version",
  );
  const appliedChecksums = new Map(applied.rows.map((row) => [row.version, row.checksum]));
  let matchedCount = 0;
  let mismatchedCount = 0;
  let missingCount = 0;
  for (const [version, checksum] of diskChecksums) {
    const actual = appliedChecksums.get(version);
    if (actual === undefined) missingCount += 1;
    else if (actual === checksum) matchedCount += 1;
    else mismatchedCount += 1;
  }
  const unexpectedCount = [...appliedChecksums.keys()]
    .filter((version) => !diskChecksums.has(version)).length;

  const roleRows = await client.query<RoleAttributes & { rolname: string }>(
    `SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,
            rolcanlogin,rolreplication,rolbypassrls
       FROM pg_catalog.pg_roles
      WHERE rolname = ANY($1::text[])`,
    [[migrationRole, RUNTIME_DATABASE_ROLE, WORKER_DATABASE_ROLE]],
  );
  const attributes = new Map(roleRows.rows.map((row) => [row.rolname, {
    rolbypassrls: row.rolbypassrls,
    rolcanlogin: row.rolcanlogin,
    rolcreatedb: row.rolcreatedb,
    rolcreaterole: row.rolcreaterole,
    rolinherit: row.rolinherit,
    rolreplication: row.rolreplication,
    rolsuper: row.rolsuper,
  }]));

  const membership = await client.query<{ edge_count: string }>(
    `SELECT count(*)::text AS edge_count
       FROM pg_catalog.pg_auth_members AS membership
       JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid=membership.roleid
       JOIN pg_catalog.pg_roles AS member_role ON member_role.oid=membership.member
      WHERE (granted_role.rolname=$1 AND member_role.rolname=$2)
         OR (granted_role.rolname=$2 AND member_role.rolname=$1)`,
    [RUNTIME_DATABASE_ROLE, WORKER_DATABASE_ROLE],
  );

  const tables = await client.query<{
    anon_role_count: string;
    anon_exposed_count: string;
    authenticated_role_count: string;
    authenticated_exposed_count: string;
    rls_disabled_count: string;
    rls_enabled_count: string;
    service_role_count: string;
    service_role_exposed_count: string;
    total_count: string;
  }>(
    `WITH app_tables AS (
       SELECT relation.oid,relation.relrowsecurity
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname='public'
          AND relation.relkind IN ('r','p')
          AND relation.relname <> 'schema_migrations'
     ), exposed AS (
       SELECT database_role.rolname,app_table.oid
         FROM app_tables AS app_table
         JOIN pg_catalog.pg_roles AS database_role
           ON database_role.rolname IN ('anon','authenticated','service_role')
        WHERE pg_catalog.has_table_privilege(database_role.oid,app_table.oid,'SELECT')
           OR pg_catalog.has_table_privilege(database_role.oid,app_table.oid,'INSERT')
           OR pg_catalog.has_table_privilege(database_role.oid,app_table.oid,'UPDATE')
           OR pg_catalog.has_table_privilege(database_role.oid,app_table.oid,'DELETE')
           OR pg_catalog.has_table_privilege(database_role.oid,app_table.oid,'TRUNCATE')
           OR pg_catalog.has_table_privilege(database_role.oid,app_table.oid,'REFERENCES')
           OR pg_catalog.has_table_privilege(database_role.oid,app_table.oid,'TRIGGER')
     )
     SELECT count(*)::text AS total_count,
            count(*) FILTER (WHERE relrowsecurity)::text AS rls_enabled_count,
            count(*) FILTER (WHERE NOT relrowsecurity)::text AS rls_disabled_count,
            (SELECT count(DISTINCT oid)::text FROM exposed WHERE rolname='anon') AS anon_exposed_count,
            (SELECT count(DISTINCT oid)::text FROM exposed WHERE rolname='authenticated') AS authenticated_exposed_count,
            (SELECT count(DISTINCT oid)::text FROM exposed WHERE rolname='service_role') AS service_role_exposed_count,
            (SELECT count(*)::text FROM pg_catalog.pg_roles WHERE rolname='anon') AS anon_role_count,
            (SELECT count(*)::text FROM pg_catalog.pg_roles WHERE rolname='authenticated') AS authenticated_role_count,
            (SELECT count(*)::text FROM pg_catalog.pg_roles WHERE rolname='service_role') AS service_role_count
       FROM app_tables`,
  );
  const tableRow = tables.rows[0];
  if (!tableRow) throw new Error("missing-table-aggregate");

  return {
    migrations: {
      appliedCount: appliedChecksums.size,
      diskCount: diskChecksums.size,
      matchedCount,
      mismatchedCount,
      missingCount,
      unexpectedCount,
    },
    publicTables: {
      anonRolePresent: numberValue(tableRow.anon_role_count) === 1,
      anonExposedCount: numberValue(tableRow.anon_exposed_count),
      authenticatedRolePresent: numberValue(tableRow.authenticated_role_count) === 1,
      authenticatedExposedCount: numberValue(tableRow.authenticated_exposed_count),
      rlsDisabledCount: numberValue(tableRow.rls_disabled_count),
      rlsEnabledCount: numberValue(tableRow.rls_enabled_count),
      serviceRoleRolePresent: numberValue(tableRow.service_role_count) === 1,
      serviceRoleExposedCount: numberValue(tableRow.service_role_exposed_count),
      totalCount: numberValue(tableRow.total_count),
    },
    roleMembershipEdgesBetweenRuntimeAndWorker: numberValue(membership.rows[0]?.edge_count),
    roles: {
      migration: attributes.get(migrationRole) ?? null,
      runtime: attributes.get(RUNTIME_DATABASE_ROLE) ?? null,
      worker: attributes.get(WORKER_DATABASE_ROLE) ?? null,
    },
  };
}

function reviewedRestrictedRole(attributes: RoleAttributes | null): boolean {
  return Boolean(attributes
    && attributes.rolcanlogin
    && attributes.rolbypassrls
    && !attributes.rolsuper
    && !attributes.rolcreatedb
    && !attributes.rolcreaterole
    && !attributes.rolinherit
    && !attributes.rolreplication);
}

function defaultPoolFactory(kind: ConnectionKind, databaseUrl: string): DatabasePool {
  if (kind === "migration") return createMigrationDatabasePool(databaseUrl, "dabboba-release-check");
  return createDatabasePool(databaseUrl, `dabboba-release-check-${kind}`, {
    expectedRole: kind === "runtime" ? RUNTIME_DATABASE_ROLE : WORKER_DATABASE_ROLE,
    max: 1,
    queryTimeoutMs: READ_TIMEOUT_MS,
    statementTimeoutMs: READ_TIMEOUT_MS,
  });
}

export async function checkDatabaseRelease(
  inputs: ReleaseCheckInputs,
  dependencies: ReleaseCheckDependencies = {},
): Promise<ReleaseCheckReport> {
  const requestedTier = inputs.environmentTier?.trim().toUpperCase() || "UNKNOWN";
  const allowedTiers = new Set(["UNKNOWN", "DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"]);
  const report: ReleaseCheckReport = {
    scope: "database-release-check/v1",
    status: "blocked",
    environmentTier: allowedTiers.has(requestedTier) ? requestedTier : "UNKNOWN",
    sameTarget: null,
    targetHash: null,
    tlsConfigured: { migration: null, runtime: null, worker: null },
    connections: {},
    database: null,
    blockers: [],
    inconclusive: [],
  };
  if (!allowedTiers.has(requestedTier)) report.blockers.push("environment_tier_invalid");
  const urls = {
    migration: inputs.migrationDatabaseUrl?.trim(),
    runtime: inputs.runtimeDatabaseUrl?.trim(),
    worker: inputs.workerDatabaseUrl?.trim(),
  };
  for (const kind of ["migration", "runtime", "worker"] as const) {
    if (!urls[kind]) report.blockers.push(`missing_${kind}_database_url`);
  }
  if (report.blockers.length) return report;

  const targets = {
    migration: databaseTargetIdentity(urls.migration!),
    runtime: databaseTargetIdentity(urls.runtime!),
    worker: databaseTargetIdentity(urls.worker!),
  };
  for (const kind of ["migration", "runtime", "worker"] as const) {
    if (!targets[kind]) report.blockers.push(`unproven_${kind}_database_target`);
    report.tlsConfigured[kind] = tlsIsConfigured(urls[kind]!);
  }
  if (report.blockers.length) return report;

  for (const kind of ["migration", "worker"] as const) {
    const poolerPort = targets[kind]!.poolerPort;
    if (poolerPort !== null && poolerPort !== "5432") {
      report.blockers.push(`${kind}_session_pooler_5432_required`);
    }
  }
  if (report.blockers.length) return report;

  const targetHashes = new Set(Object.values(targets).map((target) => target!.hash));
  report.sameTarget = targetHashes.size === 1;
  report.targetHash = report.sameTarget ? targets.migration!.hash : null;
  if (!report.sameTarget) {
    report.blockers.push("database_targets_do_not_match");
    return report;
  }
  for (const kind of ["migration", "runtime", "worker"] as const) {
    if (targets[kind]!.requiresTls && report.tlsConfigured[kind] !== true) {
      report.blockers.push(`${kind}_tls_not_configured`);
    }
  }
  if (report.blockers.length) return report;

  const createPool = dependencies.createPool ?? defaultPoolFactory;
  const loadChecksums = dependencies.loadDiskChecksums ?? loadDiskMigrationChecksums;
  let diskChecksums: Map<string, string>;
  try {
    diskChecksums = await loadChecksums();
  } catch {
    report.blockers.push("disk_migration_checksums_unavailable");
    return report;
  }
  if (diskChecksums.size === 0) {
    report.blockers.push("disk_migrations_empty");
    return report;
  }

  try {
    const migration = await inspectConnection(
      "migration",
      urls.migration!,
      targets.migration!,
      createPool,
      (client, role) => inspectDatabase(client, role, diskChecksums),
    );
    report.connections.migration = migration.connection;
    report.database = migration.database ?? null;
  } catch {
    report.blockers.push("migration_readonly_snapshot_failed");
  }
  for (const kind of ["runtime", "worker"] as const) {
    try {
      const evidence = await inspectConnection(kind, urls[kind]!, targets[kind]!, createPool);
      report.connections[kind] = evidence.connection;
    } catch {
      report.blockers.push(`${kind}_readonly_snapshot_failed`);
    }
  }

  for (const kind of ["migration", "runtime", "worker"] as const) {
    const connection = report.connections[kind];
    if (!connection) continue;
    if (!connection.expectedRoleMatch) report.blockers.push(`${kind}_actual_role_mismatch`);
    if (connection.clientTlsEvidence === "inconclusive") {
      report.inconclusive.push(`${kind}_client_tls_unverified`);
    }
  }
  const identityHashes = (["migration", "runtime", "worker"] as const)
    .map((kind) => report.connections[kind]?.actualRoleHash)
    .filter((hash): hash is string => typeof hash === "string");
  if (identityHashes.length === 3 && new Set(identityHashes).size !== 3) {
    report.blockers.push("database_roles_not_separated");
  }

  const database = report.database;
  if (!database) {
    report.blockers.push("database_aggregate_unavailable");
  } else {
    const migrations = database.migrations;
    if (
      migrations.diskCount !== migrations.appliedCount
      || migrations.matchedCount !== migrations.diskCount
      || migrations.mismatchedCount !== 0
      || migrations.missingCount !== 0
      || migrations.unexpectedCount !== 0
    ) report.blockers.push("migration_checksums_not_exact");
    if (database.publicTables.totalCount === 0) report.blockers.push("public_application_tables_empty");
    if (database.publicTables.rlsDisabledCount !== 0) report.blockers.push("public_table_rls_disabled");
    if (!database.publicTables.anonRolePresent) report.blockers.push("anon_role_missing");
    if (!database.publicTables.authenticatedRolePresent) report.blockers.push("authenticated_role_missing");
    if (database.publicTables.anonExposedCount !== 0) report.blockers.push("anon_table_grants_exposed");
    if (database.publicTables.authenticatedExposedCount !== 0) {
      report.blockers.push("authenticated_table_grants_exposed");
    }
    // service_role bypasses RLS, so any public table grant would reopen the
    // Data API path around the Fastify API. Absent on plain PostgreSQL (count 0).
    if (database.publicTables.serviceRoleExposedCount !== 0) {
      report.blockers.push("service_role_table_grants_exposed");
    }
    if (!reviewedRestrictedRole(database.roles.runtime)) report.blockers.push("runtime_role_attributes_unreviewed");
    if (!reviewedRestrictedRole(database.roles.worker)) report.blockers.push("worker_role_attributes_unreviewed");
    if (!database.roles.migration?.rolcanlogin) report.blockers.push("migration_role_missing_or_no_login");
    if (database.roleMembershipEdgesBetweenRuntimeAndWorker !== 0) {
      report.blockers.push("runtime_worker_role_membership_present");
    }
  }

  report.blockers = [...new Set(report.blockers)];
  report.inconclusive = [...new Set(report.inconclusive)];
  report.status = report.blockers.length
    ? "blocked"
    : report.inconclusive.length
      ? "inconclusive"
      : "pass";
  return report;
}

async function main(): Promise<void> {
  const report = await checkDatabaseRelease({
    environmentTier: process.env.DABBOBA_RELEASE_ENVIRONMENT_TIER ?? "",
    migrationDatabaseUrl: process.env.DATABASE_MIGRATION_URL ?? "",
    runtimeDatabaseUrl: process.env.DATABASE_URL ?? "",
    workerDatabaseUrl: process.env.WORKER_DATABASE_URL ?? "",
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
