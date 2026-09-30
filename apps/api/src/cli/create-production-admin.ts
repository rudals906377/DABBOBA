import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { createDatabasePool, withTransaction } from "@dabboba/db";
import { hashPassword } from "../lib/password.js";

const SUPABASE_PROJECT_REF = /^[a-z]{20}$/;
const APPROVED_ADMIN_DATABASE_ROLES = ["postgres", "dabboba_runtime"] as const;

/**
 * The database user must be exactly one of the Supabase pooler identities used
 * by the release tooling (`postgres.<ref>` or `dabboba_runtime.<ref>`). A
 * substring match would accept a user such as `x<ref>y` or another project's
 * role that merely contains the reference.
 */
export function assertProductionAdminDatabaseTarget(databaseUrl: string, expectedProjectRef: string): void {
  if (!SUPABASE_PROJECT_REF.test(expectedProjectRef)) {
    throw new Error("Expected Supabase project reference is invalid.");
  }
  let username: string;
  try {
    username = decodeURIComponent(new URL(databaseUrl).username);
  } catch {
    throw new Error("Database project does not match the expected production project.");
  }
  if (!APPROVED_ADMIN_DATABASE_ROLES.some((role) => username === `${role}.${expectedProjectRef}`)) {
    throw new Error("Database project does not match the expected production project.");
  }
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const rootEnv = fileURLToPath(new URL("../../../../.env", import.meta.url));
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const args = process.argv.slice(2);
  const expectedProjectRef = argumentValue(args, "--project-ref");
  const email = argumentValue(args, "--email")?.trim().toLowerCase();
  const nickname = argumentValue(args, "--nickname")?.trim();
  const dryRun = args.includes("--dry-run");
  const databaseUrl = process.env.DATABASE_URL;

  if (!process.stdin.isTTY || !expectedProjectRef || !email || !nickname || !databaseUrl) {
    throw new Error("Use an interactive terminal with --project-ref, --email, --nickname and DATABASE_URL.");
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || nickname.length > 80) {
    throw new Error("Administrator email or nickname is invalid.");
  }
  assertProductionAdminDatabaseTarget(databaseUrl, expectedProjectRef);

  const silentOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const input = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
  async function hiddenQuestion(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    const answer = await input.question("");
    process.stdout.write("\n");
    return answer;
  }

  let password: string;
  try {
    password = await hiddenQuestion("새 관리자 비밀번호 (12~256자, 입력 내용 숨김): ");
    const confirmation = await hiddenQuestion("비밀번호 다시 입력: ");
    if (password !== confirmation || password.length < 12 || password.length > 256) {
      throw new Error("Passwords do not match or violate the length rule.");
    }
  } finally {
    input.close();
  }

  const passwordRecord = await hashPassword(password);
  password = "";
  const pool = createDatabasePool(databaseUrl, "dabboba-production-admin-create");
  try {
    const createdId = await withTransaction(pool, async (client) => {
      const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rowCount) throw new Error("This email already belongs to a user; do not create a duplicate.");
      const user = await client.query<{ id: string }>(
        "INSERT INTO users (email, nickname, role, status) VALUES ($1,$2,'SUPER_ADMIN','ACTIVE') RETURNING id",
        [email, nickname],
      );
      const userId = user.rows[0]!.id;
      await client.query(
        "INSERT INTO auth_identities (user_id, provider, provider_subject, verified_at) VALUES ($1,'LOCAL_ADMIN',$2,now())",
        [userId, email],
      );
      await client.query(
        `INSERT INTO admin_credentials
          (user_id, password_hash, password_salt, scrypt_cost, scrypt_block_size, scrypt_parallelization)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, passwordRecord.hash, passwordRecord.salt, passwordRecord.cost, passwordRecord.blockSize, passwordRecord.parallelization],
      );
      await client.query(
        `INSERT INTO admin_audit_logs
          (admin_id, action, target_type, target_id, reason, request_id, idempotency_key, after_state, metadata)
         VALUES ($1,'ADMIN_BOOTSTRAPPED','USER',$2,$3,$4,$5,$6,'{}')`,
        [userId, userId, "User-requested administrator rotation", randomUUID(), `bootstrap-${userId}`, JSON.stringify({ role: "SUPER_ADMIN" })],
      );
      if (dryRun) throw new Error("ADMIN_DRY_RUN_ROLLBACK");
      return userId;
    });
    process.stdout.write(`새 관리자 생성 완료 (${createdId}). 기존 관리자 권한은 로그인 검증 후 정리하세요.\n`);
  } catch (error) {
    if (!dryRun || !(error instanceof Error) || error.message !== "ADMIN_DRY_RUN_ROLLBACK") throw error;
    process.stdout.write("관리자 생성 예행연습 통과. 데이터베이스 변경은 되돌렸습니다.\n");
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
