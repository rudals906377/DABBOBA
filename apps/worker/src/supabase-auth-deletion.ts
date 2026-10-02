import { createDecipheriv } from "node:crypto";
import { withTransaction, type DatabasePool } from "@dabboba/db";
import type { WorkerConfig } from "./config.js";
import { persistedErrorIdentity, type Logger } from "./logger.js";
import {
  mediaCleanupObjectKeys,
  mediaPendingFinalObjectKeys,
  mediaReadyStagingObjectKey,
  type MediaStore,
} from "./media.js";

type AuthDeletionJob = {
  id: string;
  deletion_request_id: string;
  user_id: string;
  supabase_user_id: string | null;
  external_deleted_at: Date | null;
  apple_revoked_at: Date | null;
  has_apple_identity: boolean;
  attempts: number;
};

type AppleCredentialRow = {
  ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  key_version: number;
};

type AuthoredMediaRow = {
  id: string;
  owner_id: string;
  object_key: string;
  status: string;
  metadata: Record<string, unknown>;
};

const ACCOUNT_DELETION_MEDIA_PURPOSES = [
  "PROFILE",
  "POST",
  "COMMENT",
  "INQUIRY",
  "EXCHANGE",
  "CATALOG_REQUEST",
  "WANTED_REQUEST",
] as const;

export type SupabaseAuthDeletionClient = {
  deleteUser(userId: string): Promise<void>;
};

export type AppleTokenRevocationClient = {
  revokeRefreshToken(token: string): Promise<void>;
};

export class HttpAppleTokenRevocationClient implements AppleTokenRevocationClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly request: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async revokeRefreshToken(token: string): Promise<void> {
    const response = await this.request("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        token,
        token_type_hint: "refresh_token",
      }).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 200) return;
    throw new Error(`Apple token revocation failed with HTTP ${response.status}`);
  }
}

function decryptAppleRefreshToken(
  row: AppleCredentialRow,
  config: NonNullable<WorkerConfig["appleRevocation"]>,
  userId: string,
): string {
  if (row.key_version !== config.keyVersion) {
    throw new Error("Apple credential encryption key version is unavailable");
  }
  const key = Buffer.from(
    config.encryptionKey,
    config.encryptionKey.includes("-") || config.encryptionKey.includes("_") ? "base64url" : "base64",
  );
  if (key.length !== 32 || row.nonce.length !== 12 || row.auth_tag.length !== 16) {
    throw new Error("Apple credential envelope is invalid");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, row.nonce);
    decipher.setAAD(Buffer.from(`dabboba:apple-refresh-token:${userId}:v${row.key_version}`, "utf8"));
    decipher.setAuthTag(row.auth_tag);
    const token = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
    if (token.length < 32 || token.length > 16_384 || /[\s\u0000-\u001f\u007f]/.test(token)) {
      throw new Error("invalid plaintext");
    }
    return token;
  } catch {
    throw new Error("Apple credential could not be decrypted");
  }
}

export class HttpSupabaseAuthDeletionClient implements SupabaseAuthDeletionClient {
  constructor(
    private readonly url: string,
    private readonly secretKey: string,
    private readonly request: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async deleteUser(userId: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      throw new Error("Supabase Auth deletion user ID is invalid");
    }
    const response = await this.request(
      `${this.url.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
        headers: {
          apikey: this.secretKey,
          authorization: `Bearer ${this.secretKey}`,
          accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.ok || response.status === 404) return;
    throw new Error(`Supabase Auth deletion failed with HTTP ${response.status}`);
  }
}

function retryDelayMs(attempts: number, baseDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, Math.min(attempts - 1, 20)), 15 * 60_000);
}

async function deletionHasBlockers(pool: DatabasePool, userId: string): Promise<boolean> {
  const result = await pool.query<Record<string, string | number>>(
    `SELECT
       COALESCE((SELECT balance FROM point_accounts WHERE user_id=$1),0) AS point_balance,
       (SELECT count(*) FROM orders
         WHERE user_id=$1 AND status IN ('PENDING_PAYMENT','PAID','REFUND_REVIEW')) AS active_order_count,
       (SELECT count(*) FROM payments p JOIN orders o ON o.id=p.order_id
         WHERE o.user_id=$1 AND p.status IN ('PENDING','AUTHORIZED','PAID','REFUND_REVIEW')) AS active_payment_count,
       (SELECT count(*) FROM draw_entitlements
         WHERE user_id=$1 AND status='AVAILABLE') AS available_draw_entitlement_count,
       (SELECT count(*) FROM inventory_units
         WHERE owner_id=$1 AND status IN ('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED','SHIPPING','EXPIRED_HOLD')) AS active_inventory_count,
       (SELECT count(*) FROM shipping_requests
         WHERE user_id=$1 AND status IN ('PAYMENT_PENDING','REQUESTED','PROCESSING','SHIPPED')) AS active_shipping_request_count,
       (SELECT count(*) FROM exchange_listings
         WHERE author_id=$1 AND status IN ('OPEN','MATCHED')) AS active_exchange_listing_count,
       (SELECT count(*) FROM exchange_offers
         WHERE proposer_id=$1 AND status IN ('PENDING','ACCEPTED')) AS active_exchange_offer_count`,
    [userId],
  );
  return Object.values(result.rows[0] ?? {}).some((value) => Number(value) > 0);
}

async function returnBlockedDeletionToCustomer(pool: DatabasePool, job: AuthDeletionJob): Promise<void> {
  await withTransaction(pool, async (transaction) => {
    const transitioned = await transaction.query(
      `UPDATE account_deletion_requests
          SET status='BLOCKED',blocker_snapshot=jsonb_build_object('reassessmentRequired',true),
              auth_deletion_status='NOT_REQUIRED',processing_started_at=NULL,version=version+1
        WHERE id=$1 AND user_id=$2 AND status='PROCESSING'`,
      [job.deletion_request_id, job.user_id],
    );
    if (transitioned.rowCount) {
      await transaction.query(
        `INSERT INTO account_deletion_request_events
          (deletion_request_id,user_id,event_type,status,blocker_snapshot,revoked_session_count,
           correlation_id,idempotency_key,metadata,reason)
         VALUES($1,$2,'STATUS_CHANGED','BLOCKED',jsonb_build_object('reassessmentRequired',true),0,
                $3,$4,jsonb_build_object('actor','SYSTEM_WORKER','externalIdentityDeleted',false),
                'AUTOMATED_ACCOUNT_DELETION')
         ON CONFLICT (deletion_request_id,idempotency_key) DO NOTHING`,
        [job.deletion_request_id, job.user_id, job.id, `worker:${job.id}:blocked`],
      );
    }
    await transaction.query("DELETE FROM account_auth_deletion_jobs WHERE id=$1", [job.id]);
  });
}

async function deleteAuthoredMediaObjects(
  pool: DatabasePool,
  mediaStore: MediaStore,
  userId: string,
  shouldContinue: () => boolean,
): Promise<void> {
  const media = await pool.query<AuthoredMediaRow>(
    `SELECT id,owner_id,object_key,status,metadata
       FROM media_assets
      WHERE owner_id=$1 AND purpose=ANY($2::text[])
      ORDER BY id`,
    [userId, ACCOUNT_DELETION_MEDIA_PURPOSES],
  );
  for (const row of media.rows) {
    if (!shouldContinue()) throw new Error("Worker run deadline reached during account deletion media cleanup");
    const objectKeys = new Set(mediaCleanupObjectKeys(row.object_key, row.metadata));
    const stagingObjectKey = mediaReadyStagingObjectKey(row.metadata, row.owner_id, row.id);
    if (stagingObjectKey) objectKeys.add(stagingObjectKey);
    for (const objectKey of mediaPendingFinalObjectKeys(row.id, row.object_key, row.status, row.metadata)) {
      objectKeys.add(objectKey);
    }
    for (const objectKey of objectKeys) {
      if (!shouldContinue()) throw new Error("Worker run deadline reached during account deletion media cleanup");
      const outcome = await mediaStore.deleteObject(objectKey, row.metadata);
      if (outcome !== "deleted") {
        throw new Error("Account deletion media storage cleanup is not configured");
      }
    }
  }
}

async function finalizeLocalAccountDeletion(pool: DatabasePool, job: AuthDeletionJob): Promise<void> {
  await withTransaction(pool, async (transaction) => {
    const request = await transaction.query<{ status: string }>(
      `SELECT status FROM account_deletion_requests
        WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [job.deletion_request_id, job.user_id],
    );
    if (!request.rowCount) {
      await transaction.query("DELETE FROM account_auth_deletion_jobs WHERE id=$1", [job.id]);
      return;
    }
    if (request.rows[0]!.status === "COMPLETED") {
      await transaction.query("DELETE FROM account_auth_deletion_jobs WHERE id=$1", [job.id]);
      return;
    }
    if (request.rows[0]!.status !== "PROCESSING" && request.rows[0]!.status !== "APPROVED") {
      throw new Error("Account deletion request is not ready for finalization");
    }

    await transaction.query(
      `UPDATE sessions
          SET revoked_at=COALESCE(revoked_at,now()),
              revoke_reason=COALESCE(revoke_reason,'ACCOUNT_DELETION_COMPLETED'),
              ip_address=NULL,user_agent=NULL
        WHERE user_id=$1`,
      [job.user_id],
    );
    await transaction.query("DELETE FROM auth_identities WHERE user_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM apple_auth_credentials WHERE user_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM default_shipping_addresses WHERE user_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM wishlist_items WHERE user_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM community_post_likes WHERE user_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM wanted_request_likes WHERE user_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM user_blocks WHERE blocker_id=$1 OR blocked_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM push_device_tokens WHERE user_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM notifications WHERE user_id=$1", [job.user_id]);
    await transaction.query("DELETE FROM notification_preferences WHERE user_id=$1", [job.user_id]);
    const authoredMedia = await transaction.query<{ media_id: string }>(
      `SELECT id AS media_id
         FROM media_assets
        WHERE owner_id=$1 AND purpose=ANY($2::text[])`,
      [job.user_id, ACCOUNT_DELETION_MEDIA_PURPOSES],
    );
    await transaction.query(
      "DELETE FROM community_post_media WHERE post_id IN (SELECT id FROM community_posts WHERE author_id=$1)",
      [job.user_id],
    );
    if (authoredMedia.rowCount) {
      await transaction.query(
        "DELETE FROM inquiry_message_media WHERE media_id=ANY($1::uuid[])",
        [authoredMedia.rows.map((row) => row.media_id)],
      );
    }
    await transaction.query(
      `UPDATE inquiry_messages
          SET content='삭제된 문의 내용'
        WHERE inquiry_id IN (SELECT id FROM inquiries WHERE user_id=$1)`,
      [job.user_id],
    );
    await transaction.query(
      "UPDATE inquiries SET title='삭제된 문의' WHERE user_id=$1",
      [job.user_id],
    );
    await transaction.query(
      `UPDATE wanted_requests
          SET status='DELETED',ip_name_ko='삭제된 신청',desired_item='삭제된 신청',
              details='삭제된 내용',media_id=NULL,version=version+1
        WHERE user_id=$1`,
      [job.user_id],
    );
    await transaction.query(
      `UPDATE catalog_requests
          SET name='삭제된 카탈로그 요청',reference_url=NULL,description=NULL,media_id=NULL
        WHERE user_id=$1`,
      [job.user_id],
    );
    await transaction.query(
      `UPDATE exchange_listings
          SET title='삭제된 교환 게시물',details='삭제된 내용'
        WHERE author_id=$1
          AND (title IS DISTINCT FROM '삭제된 교환 게시물'
               OR details IS DISTINCT FROM '삭제된 내용')`,
      [job.user_id],
    );
    await transaction.query(
      `UPDATE exchange_offers
          SET message='삭제된 교환 제안'
        WHERE proposer_id=$1 AND message IS DISTINCT FROM '삭제된 교환 제안'`,
      [job.user_id],
    );
    await transaction.query(
      `UPDATE community_comments
          SET status='DELETED',content='삭제된 댓글',hidden_reason=NULL,
              deleted_at=COALESCE(deleted_at,now())
        WHERE author_id=$1`,
      [job.user_id],
    );
    await transaction.query(
      `UPDATE community_posts
          SET status='DELETED',title='삭제된 게시물',content='삭제된 내용',hidden_reason=NULL,
              deleted_at=COALESCE(deleted_at,now()),version=version+1
        WHERE author_id=$1`,
      [job.user_id],
    );
    if (authoredMedia.rowCount) {
      await transaction.query(
        `UPDATE media_assets
            SET status='DELETED',metadata=metadata || jsonb_build_object(
              'accountDeletion',jsonb_build_object('requestedAt',now()::text)
            )
          WHERE id=ANY($1::uuid[]) AND owner_id=$2
            AND purpose=ANY($3::text[]) AND status<>'DELETED'`,
        [authoredMedia.rows.map((row) => row.media_id), job.user_id, ACCOUNT_DELETION_MEDIA_PURPOSES],
      );
    }
    await transaction.query("UPDATE content_reports SET details=NULL WHERE reporter_id=$1", [job.user_id]);
    await transaction.query(
      "UPDATE user_policy_acceptances SET ip_address=NULL,user_agent=NULL WHERE user_id=$1",
      [job.user_id],
    );
    await transaction.query(
      "UPDATE user_profiles SET bio=NULL,favorite_ip_id=NULL,birth_date=NULL,version=version+1 WHERE user_id=$1",
      [job.user_id],
    );
    await transaction.query(
      `UPDATE users
          SET email=NULL,phone_e164=NULL,nickname='탈퇴한 사용자',status='DELETED',
              deleted_at=COALESCE(deleted_at,now()),suspended_until=NULL,suspension_reason=NULL
        WHERE id=$1`,
      [job.user_id],
    );
    await transaction.query(
      `UPDATE account_deletion_requests
          SET status='COMPLETED',completed_at=COALESCE(completed_at,now()),
              decided_at=COALESCE(decided_at,now()),
              decided_by_admin_id=NULL,decision_reason='AUTOMATED_ACCOUNT_DELETION',
              auth_deletion_status=$2,auth_deleted_at=CASE WHEN $2='COMPLETED' THEN now() ELSE NULL END,
              version=version+1
        WHERE id=$1 AND status IN ('PROCESSING','APPROVED')`,
      [job.deletion_request_id, job.supabase_user_id ? "COMPLETED" : "NOT_REQUIRED"],
    );
    await transaction.query(
      `INSERT INTO account_deletion_request_events
        (deletion_request_id,user_id,event_type,status,blocker_snapshot,revoked_session_count,
         correlation_id,idempotency_key,metadata,reason)
       VALUES($1,$2,'STATUS_CHANGED','COMPLETED','{}'::jsonb,0,$3,$4,
              jsonb_build_object('actor','SYSTEM_WORKER','personalDataAnonymized',true,
                'externalIdentityDeleted',$5::boolean,
                'appleTokenRevokedAt',(SELECT apple_revoked_at FROM account_auth_deletion_jobs WHERE id=$3),
                'retainedData','LEGAL_AND_TRANSACTION_RECORDS'),
              'AUTOMATED_ACCOUNT_DELETION')
       ON CONFLICT (deletion_request_id,idempotency_key) DO NOTHING`,
      [job.deletion_request_id, job.user_id, job.id, `worker:${job.id}:completed`, Boolean(job.supabase_user_id)],
    );
    await transaction.query("DELETE FROM account_auth_deletion_jobs WHERE id=$1", [job.id]);
  });
}

export async function cleanupSupabaseAuthUsers(
  pool: DatabasePool,
  config: WorkerConfig,
  logger: Logger,
  shouldContinue: () => boolean = () => true,
  client: SupabaseAuthDeletionClient | null = config.supabaseAuthAdmin
    ? new HttpSupabaseAuthDeletionClient(config.supabaseAuthAdmin.url, config.supabaseAuthAdmin.secretKey)
    : null,
  mediaStore: MediaStore | null = null,
  appleClient: AppleTokenRevocationClient | null = config.appleRevocation
    ? new HttpAppleTokenRevocationClient(config.appleRevocation.clientId, config.appleRevocation.clientSecret)
    : null,
): Promise<{ completed: number; deferred: number }> {
  const result = { completed: 0, deferred: 0 };

  for (let index = 0; index < config.outboxBatchSize && shouldContinue(); index += 1) {
    const claimed = await pool.query<AuthDeletionJob>(
      `WITH candidate AS (
         SELECT id
           FROM account_auth_deletion_jobs
          WHERE available_at<=now()
            AND (status='PENDING' OR (status='PROCESSING' AND lease_expires_at<=now()))
          ORDER BY available_at,created_at,id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE account_auth_deletion_jobs job
          SET status='PROCESSING',attempts=attempts+1,
              lease_expires_at=now()+interval '5 minutes',updated_at=now(),last_error=NULL
         FROM candidate
        WHERE job.id=candidate.id
       RETURNING job.id,job.deletion_request_id,job.user_id,job.supabase_user_id,
                 job.external_deleted_at,job.apple_revoked_at,job.attempts,
                 EXISTS(SELECT 1 FROM auth_identities identity
                         WHERE identity.user_id=job.user_id AND identity.provider='APPLE') AS has_apple_identity`,
    );
    const job = claimed.rows[0];
    if (!job) break;

    try {
      if (!job.external_deleted_at) {
        if (await deletionHasBlockers(pool, job.user_id)) {
          await returnBlockedDeletionToCustomer(pool, job);
          result.deferred += 1;
          continue;
        }
      }
      if (!job.apple_revoked_at) {
        if (job.has_apple_identity) {
          if (!config.appleRevocation || !appleClient) {
            throw new Error("Apple token revocation is not configured");
          }
          const credential = await pool.query<AppleCredentialRow>(
            `SELECT ciphertext,nonce,auth_tag,key_version
               FROM apple_auth_credentials
              WHERE user_id=$1 AND credential_kind='REFRESH_TOKEN'`,
            [job.user_id],
          );
          if (!credential.rowCount) throw new Error("Apple token revocation credential is unavailable");
          const refreshToken = decryptAppleRefreshToken(credential.rows[0]!, config.appleRevocation, job.user_id);
          await appleClient.revokeRefreshToken(refreshToken);
          await pool.query(
            "UPDATE account_auth_deletion_jobs SET apple_revoked_at=now(),updated_at=now() WHERE id=$1",
            [job.id],
          );
        }
      }
      if (!job.external_deleted_at) {
        if (job.supabase_user_id) {
          if (!client) throw new Error("Supabase Auth admin deletion is not configured");
          await client.deleteUser(job.supabase_user_id);
        }
        await pool.query(
          "UPDATE account_auth_deletion_jobs SET external_deleted_at=now(),updated_at=now() WHERE id=$1",
          [job.id],
        );
      }
      if (!mediaStore) throw new Error("Account deletion media storage cleanup is not configured");
      await deleteAuthoredMediaObjects(pool, mediaStore, job.user_id, shouldContinue);
      if (!shouldContinue()) throw new Error("Worker run deadline reached before account deletion finalization");
      await finalizeLocalAccountDeletion(pool, job);
      result.completed += 1;
    } catch (error) {
      const retryAt = new Date(Date.now() + retryDelayMs(job.attempts, config.jobBackoffMs));
      await pool.query(
        `UPDATE account_auth_deletion_jobs
            SET status='PENDING',available_at=$2,lease_expires_at=NULL,last_error=$3,updated_at=now()
          WHERE id=$1`,
        [job.id, retryAt, persistedErrorIdentity(error)],
      );
      result.deferred += 1;
      logger.warn(
        { accountAuthDeletionJobId: job.id, attempts: job.attempts },
        "Account identity deletion was deferred for retry",
      );
    }
  }
  return result;
}
