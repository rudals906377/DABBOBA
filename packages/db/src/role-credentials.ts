import { RUNTIME_DATABASE_ROLE, WORKER_DATABASE_ROLE } from "./runtime-role.js";

function assertDatabasePassword(password: string, environmentName: string): void {
  const length = Buffer.byteLength(password, "utf8");
  if (length < 32 || length > 512) {
    throw new Error(`${environmentName} must be between 32 and 512 bytes`);
  }
  if (/[\r\n\0]/.test(password)) {
    throw new Error(`${environmentName} contains an unsupported control character`);
  }
}

export function assertRuntimeDatabasePassword(password: string): void {
  assertDatabasePassword(password, "DABBOBA_RUNTIME_DATABASE_PASSWORD");
}

export function assertWorkerDatabasePassword(password: string): void {
  assertDatabasePassword(password, "DABBOBA_WORKER_DATABASE_PASSWORD");
}

function databaseRoleUrl(
  migrationDatabaseUrl: string,
  password: string,
  role: typeof RUNTIME_DATABASE_ROLE | typeof WORKER_DATABASE_ROLE,
  assertPassword: (value: string) => void,
): string {
  assertPassword(password);

  let parsed: URL;
  try {
    parsed = new URL(migrationDatabaseUrl);
  } catch {
    throw new Error("DATABASE_MIGRATION_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_MIGRATION_URL must use postgres:// or postgresql://");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  let migrationUsername: string;
  try {
    migrationUsername = decodeURIComponent(parsed.username);
  } catch {
    throw new Error("DATABASE_MIGRATION_URL has an invalid database username");
  }

  if (hostname.endsWith(".pooler.supabase.com")) {
    const match = /^postgres\.([a-z0-9]{20})$/.exec(migrationUsername);
    if (!match) {
      throw new Error("Supabase Session pooler migration URLs must use postgres.<project-ref>");
    }
    parsed.username = `${role}.${match[1]}`;
  } else if (hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.com")) {
    if (migrationUsername !== "postgres") {
      throw new Error("Supabase direct migration URLs must use the postgres database role");
    }
    parsed.username = role;
  } else {
    parsed.username = role;
  }

  parsed.password = password;
  return parsed.toString();
}

export function runtimeDatabaseUrl(migrationDatabaseUrl: string, password: string): string {
  return databaseRoleUrl(
    migrationDatabaseUrl,
    password,
    RUNTIME_DATABASE_ROLE,
    assertRuntimeDatabasePassword,
  );
}

export function workerDatabaseUrl(migrationDatabaseUrl: string, password: string): string {
  return databaseRoleUrl(
    migrationDatabaseUrl,
    password,
    WORKER_DATABASE_ROLE,
    assertWorkerDatabasePassword,
  );
}
