import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { createDatabasePool, withTransaction } from "@dabboba/db";
import { hashPassword } from "../lib/password.js";

const rootEnv = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const args = process.argv.slice(2);
const argument = (name: string) => args[args.indexOf(name) + 1];
const expectedProjectRef = argument("--project-ref");
const email = argument("--email")?.trim().toLowerCase();
const nickname = argument("--nickname")?.trim();
const dryRun = args.includes("--dry-run");
const databaseUrl = process.env.DATABASE_URL;

if (!process.stdin.isTTY || !expectedProjectRef || !email || !nickname || !databaseUrl) {
  throw new Error("Use an interactive terminal with --project-ref, --email, --nickname and DATABASE_URL.");
}
if (!/^\S+@\S+\.\S+$/.test(email) || nickname.length > 80) {
  throw new Error("Administrator email or nickname is invalid.");
}
if (!new URL(databaseUrl).username.includes(expectedProjectRef)) {
  throw new Error("Database project does not match the expected production project.");
}

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
