import type { DatabasePool, Queryable } from "./index.js";
import {
  assertRuntimeDatabasePassword,
  assertWorkerDatabasePassword,
} from "./role-credentials.js";
import { RUNTIME_DATABASE_ROLE, WORKER_DATABASE_ROLE } from "./runtime-role.js";

type RoleAttributes = {
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolinherit: boolean;
  rolreplication: boolean;
  rolsuper: boolean;
};

async function roleAttributes(pool: Queryable, role: string): Promise<RoleAttributes> {
  const result = await pool.query<RoleAttributes>(
    `SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit,
            rolreplication, rolbypassrls
     FROM pg_roles
     WHERE rolname = $1`,
    [role],
  );
  if (result.rowCount !== 1) {
    throw new Error(`${role} database role is missing; apply migrations first`);
  }
  return result.rows[0]!;
}

function assertRoleAttributes(
  attributes: RoleAttributes,
  expectedInherit: boolean,
  label: string,
): void {
  if (
    attributes.rolsuper
    || attributes.rolcreatedb
    || attributes.rolcreaterole
    || attributes.rolreplication
    || !attributes.rolbypassrls
    || attributes.rolinherit !== expectedInherit
  ) {
    throw new Error(`${label} database role attributes do not match the reviewed migration`);
  }
}

async function alterRoleLogin(pool: Queryable, role: string, password: string): Promise<void> {
  const statement = await pool.query<{ sql: string }>(
    "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
    [role, password],
  );
  await pool.query(statement.rows[0]!.sql);
}

export async function provisionRuntimeDatabaseRole(
  pool: DatabasePool,
  password: string,
): Promise<void> {
  assertRuntimeDatabasePassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    assertRoleAttributes(await roleAttributes(client, RUNTIME_DATABASE_ROLE), false, "Runtime");
    await alterRoleLogin(client, RUNTIME_DATABASE_ROLE, password);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function provisionWorkerDatabaseRole(
  pool: DatabasePool,
  password: string,
): Promise<void> {
  assertWorkerDatabasePassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    assertRoleAttributes(await roleAttributes(client, WORKER_DATABASE_ROLE), false, "Worker");

    const membership = await client.query<{ granted_role: string }>(
      `SELECT granted_role.rolname AS granted_role
       FROM pg_auth_members AS membership
       JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       WHERE member_role.rolname = $1`,
      [WORKER_DATABASE_ROLE],
    );
    if (membership.rowCount !== 0) {
      throw new Error("Worker role must not inherit the API database role");
    }

    const reverseMembership = await client.query(
      `SELECT 1
       FROM pg_auth_members AS membership
       JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       WHERE granted_role.rolname = $1 AND member_role.rolname = $2`,
      [WORKER_DATABASE_ROLE, RUNTIME_DATABASE_ROLE],
    );
    if (reverseMembership.rowCount) {
      throw new Error("Runtime role must not inherit the worker role");
    }

    await alterRoleLogin(client, WORKER_DATABASE_ROLE, password);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
