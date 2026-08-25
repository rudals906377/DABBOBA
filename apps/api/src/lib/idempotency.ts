import { createHash } from "node:crypto";
import type { DatabaseClient } from "@dabboba/db";
import { conflict } from "./errors.js";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function idempotencyKey(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length < 16 || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw conflict("16자 이상의 올바른 Idempotency-Key가 필요합니다.");
  }
  return value;
}

export type IdempotencyStart =
  | { fresh: true; id: string }
  | { fresh: false; statusCode: number; body: unknown };

export async function beginIdempotency(
  client: DatabaseClient,
  input: { actorId: string; scope: string; key: string; hash: string },
): Promise<IdempotencyStart> {
  await client.query(
    "DELETE FROM idempotency_keys WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3 AND expires_at<=now()",
    [input.actorId, input.scope, input.key],
  );
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO idempotency_keys(actor_id,scope,idempotency_key,request_hash,expires_at)
     VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING id`,
    [input.actorId,input.scope,input.key,input.hash],
  );
  if (inserted.rowCount) return { fresh: true, id: inserted.rows[0]!.id };
  const existing = await client.query<{ request_hash: string; state: string; response_status: number | null; response_body: unknown }>(
    "SELECT request_hash,state,response_status,response_body FROM idempotency_keys WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3 FOR UPDATE",
    [input.actorId,input.scope,input.key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== input.hash) throw conflict("같은 Idempotency-Key를 다른 요청에 재사용할 수 없습니다.");
  if (row.state === "COMPLETED" && row.response_status && row.response_body !== null) {
    return { fresh: false, statusCode: row.response_status, body: row.response_body };
  }
  throw conflict("동일한 요청이 처리 중입니다.");
}

export async function completeIdempotency(
  client: DatabaseClient,
  id: string,
  input: { statusCode: number; body: unknown; resourceType: string; resourceId: string },
) {
  await client.query(
    `UPDATE idempotency_keys SET state='COMPLETED',response_status=$2,response_body=$3,resource_type=$4,resource_id=$5 WHERE id=$1`,
    [id,input.statusCode,JSON.stringify(input.body),input.resourceType,input.resourceId],
  );
}
