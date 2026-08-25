import { loadApiConfig } from "@dabboba/config";
import { createDatabasePool, withTransaction } from "@dabboba/db";
import { hashPassword } from "../lib/password.js";

const config = loadApiConfig();
if (config.environment === "production" && process.env.ALLOW_ADMIN_BOOTSTRAP !== "true") {
  throw new Error("Set ALLOW_ADMIN_BOOTSTRAP=true for the deliberate one-time production bootstrap.");
}

const email = process.env.DABBOBA_BOOTSTRAP_ADMIN_EMAIL?.trim().toLocaleLowerCase("en-US");
const nickname = process.env.DABBOBA_BOOTSTRAP_ADMIN_NICKNAME?.trim();
const password = process.env.DABBOBA_BOOTSTRAP_ADMIN_PASSWORD;
const role = process.env.DABBOBA_BOOTSTRAP_ADMIN_ROLE === "ADMIN" ? "ADMIN" : "SUPER_ADMIN";
if (!email || !nickname || !password || password.length < 12) {
  throw new Error("DABBOBA_BOOTSTRAP_ADMIN_EMAIL, _NICKNAME, and a 12+ character _PASSWORD are required.");
}

const passwordRecord = await hashPassword(password);
const pool = createDatabasePool(config.databaseUrl, "dabboba-bootstrap-admin");
try {
  const id = await withTransaction(pool, async (client) => {
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rowCount) throw new Error("The bootstrap email already exists; use the authenticated admin flow instead.");
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (email, nickname, role, status) VALUES ($1,$2,$3,'ACTIVE') RETURNING id`,
      [email, nickname, role],
    );
    const userId = user.rows[0]!.id;
    await client.query(
      `INSERT INTO auth_identities (user_id, provider, provider_subject, verified_at)
       VALUES ($1,'LOCAL_ADMIN',$2,now())`,
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
       VALUES ($1,'ADMIN_BOOTSTRAPPED','USER',$2,'Initial administrator bootstrap','bootstrap-cli',$3,$4,'{}')`,
      [userId, userId, `bootstrap-${userId}`, JSON.stringify({ role })],
    );
    return userId;
  });
  process.stdout.write(`Administrator bootstrap completed for user ${id}.\n`);
} finally {
  await pool.end();
}
