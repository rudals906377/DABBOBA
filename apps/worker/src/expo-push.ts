import { withTransaction, type DatabasePool } from "@dabboba/db";
import type { Logger } from "./logger.js";
import type { Notification, NotificationDelivery } from "./notifications.js";

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const SEND_BATCH_SIZE = 100;
const RECEIPT_BATCH_SIZE = 1_000;
const MAX_ATTEMPTS = 8;
const RECEIPT_INITIAL_DELAY_MS = 15 * 60_000;
const STALE_SENDING_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const EXPO_PROJECT_MESSAGES_PER_SECOND = 600;

type DeliveryRow = {
  delivery_id: string;
  notification_id: string;
  push_device_token_id: string;
  expo_push_token: string;
  title: string;
  body: string;
  send_attempt_count: number;
};

type ReceiptRow = {
  delivery_id: string;
  push_device_token_id: string;
  expo_ticket_id: string;
  send_attempt_count: number;
  receipt_attempt_count: number;
};

type ExpoResult = {
  status: "ok" | "error";
  id?: string;
  details?: { error?: string };
};

type ExpoPushDependencies = {
  fetch?: typeof fetch;
  sendUrl?: string;
  receiptsUrl?: string;
  now?: () => Date;
};

export class ExpoPushNotificationDelivery implements NotificationDelivery {
  readonly #fetch: typeof fetch;
  readonly #sendUrl: string;
  readonly #receiptsUrl: string;
  readonly #now: () => Date;
  #nextSendAtMs = 0;

  constructor(
    private readonly pool: DatabasePool,
    private readonly accessToken: string,
    private readonly logger: Logger,
    dependencies: ExpoPushDependencies = {},
  ) {
    this.#fetch = dependencies.fetch ?? fetch;
    this.#sendUrl = dependencies.sendUrl ?? EXPO_SEND_URL;
    this.#receiptsUrl = dependencies.receiptsUrl ?? EXPO_RECEIPTS_URL;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async deliver(notification: Notification): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_notification_deliveries(notification_id,push_device_token_id)
       SELECT $1,device.id
         FROM push_device_tokens device
         JOIN sessions session
           ON session.id=device.session_id
          AND session.user_id=device.user_id
          AND session.session_kind='USER'
          AND session.revoked_at IS NULL
          AND session.expires_at>now()
        WHERE device.user_id=$2 AND device.disabled_at IS NULL
       ON CONFLICT (notification_id,push_device_token_id) DO NOTHING`,
      [notification.id, notification.userId],
    );
    await this.#sendPending(notification.id);
  }

  async reconcile(): Promise<number> {
    await this.#expireIneligibleAndRecoverStale();
    const receiptCount = await this.#checkReceipts();
    const sendCount = await this.#sendPending(null);
    return receiptCount + sendCount;
  }

  async #expireIneligibleAndRecoverStale(): Promise<void> {
    const staleBefore = new Date(this.#now().getTime() - STALE_SENDING_MS);
    await this.pool.query(
      `UPDATE push_notification_deliveries delivery
          SET status='INVALID',completed_at=now(),last_error_code='DEVICE_DISABLED'
        WHERE delivery.status IN ('PENDING','SENDING')
          AND EXISTS (
            SELECT 1 FROM push_device_tokens device
             WHERE device.id=delivery.push_device_token_id
               AND (
                 device.disabled_at IS NOT NULL
                 OR NOT EXISTS (
                   SELECT 1 FROM sessions session
                    WHERE session.id=device.session_id
                      AND session.user_id=device.user_id
                      AND session.session_kind='USER'
                      AND session.revoked_at IS NULL
                      AND session.expires_at>now()
                 )
               )
          )`,
    );
    await this.pool.query(
      `UPDATE push_notification_deliveries
          SET status=CASE WHEN send_attempt_count>=${MAX_ATTEMPTS} THEN 'FAILED' ELSE 'PENDING' END,
              completed_at=CASE WHEN send_attempt_count>=${MAX_ATTEMPTS} THEN now() ELSE NULL END,
              next_attempt_at=now(),last_error_code='AMBIGUOUS_SEND_INTERRUPTED'
        WHERE status='SENDING' AND last_attempt_at<$1`,
      [staleBefore],
    );
  }

  async #claimPending(notificationId: string | null): Promise<DeliveryRow[]> {
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query<DeliveryRow>(
        `SELECT delivery.id AS delivery_id,
                delivery.notification_id,
                delivery.push_device_token_id,
                device.expo_push_token,
                notification.title,
                notification.body,
                delivery.send_attempt_count
           FROM push_notification_deliveries delivery
           JOIN push_device_tokens device ON device.id=delivery.push_device_token_id
           JOIN notifications notification ON notification.id=delivery.notification_id
           JOIN sessions session
             ON session.id=device.session_id
            AND session.user_id=device.user_id
            AND session.session_kind='USER'
            AND session.revoked_at IS NULL
            AND session.expires_at>now()
          WHERE delivery.status='PENDING'
            AND delivery.next_attempt_at<=now()
            AND delivery.send_attempt_count<${MAX_ATTEMPTS}
            AND device.disabled_at IS NULL
            AND ($1::uuid IS NULL OR delivery.notification_id=$1)
          ORDER BY delivery.next_attempt_at,delivery.id
          FOR UPDATE OF delivery SKIP LOCKED
          LIMIT $2`,
        [notificationId, SEND_BATCH_SIZE],
      );
      if (!selected.rowCount) return [];
      const deliveryIds = selected.rows.map((row) => row.delivery_id);
      await client.query(
        `UPDATE push_notification_deliveries
            SET status='SENDING',send_attempt_count=send_attempt_count+1,
                last_attempt_at=now(),last_error_code=NULL
          WHERE id=ANY($1::uuid[])`,
        [deliveryIds],
      );
      return selected.rows.map((row) => ({
        ...row,
        send_attempt_count: row.send_attempt_count + 1,
      }));
    });
  }

  async #sendPending(notificationId: string | null): Promise<number> {
    const rows = await this.#claimPending(notificationId);
    if (!rows.length) return 0;
    const messages = rows.map((row) => ({
      to: row.expo_push_token,
      title: row.title,
      body: row.body,
      data: {
        kind: "ACCOUNT_NOTIFICATION",
        notificationId: row.notification_id,
      },
      sound: "default",
      priority: "high",
      channelId: "account",
    }));
    await this.#throttleSend(messages.length);

    let response: Response;
    try {
      response = await this.#fetch(this.#sendUrl, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(messages),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      await this.#retryRows(rows, "NETWORK_ERROR");
      this.logger.warn({ deliveryCount: rows.length }, "Expo push send failed; delivery was scheduled for retry");
      return rows.length;
    }

    if (!response.ok) {
      const code = `HTTP_${response.status}`;
      if (response.status === 429 || response.status >= 500) await this.#retryRows(rows, code);
      else await this.#failRows(rows, code);
      this.logger.warn(
        { deliveryCount: rows.length, statusCode: response.status },
        "Expo push send returned a non-success status",
      );
      return rows.length;
    }

    const results = await parseTicketResponse(response);
    if (!results || results.length !== rows.length) {
      await this.#retryRows(rows, "INVALID_TICKET_RESPONSE");
      this.logger.warn({ deliveryCount: rows.length }, "Expo push ticket response shape was invalid");
      return rows.length;
    }

    for (let index = 0; index < rows.length; index += 1) {
      await this.#applyTicket(rows[index]!, results[index]!);
    }
    this.logger.info({ deliveryCount: rows.length }, "Expo push batch accepted for ticket processing");
    return rows.length;
  }

  async #applyTicket(row: DeliveryRow, result: ExpoResult): Promise<void> {
    if (result.status === "ok" && validTicketId(result.id)) {
      await this.pool.query(
        `UPDATE push_notification_deliveries
            SET status='TICKETED',expo_ticket_id=$2,next_attempt_at=$3,last_error_code=NULL
          WHERE id=$1 AND status='SENDING'`,
        [row.delivery_id, result.id, new Date(this.#now().getTime() + RECEIPT_INITIAL_DELAY_MS)],
      );
      return;
    }

    const code = safeErrorCode(result.details?.error, "TICKET_ERROR");
    if (code === "DeviceNotRegistered") {
      await this.#invalidate(row.delivery_id, row.push_device_token_id, code);
    } else if (retryableExpoError(code)) {
      await this.#retryRows([row], code);
    } else {
      await this.#failRows([row], code);
    }
  }

  async #claimReceipts(): Promise<ReceiptRow[]> {
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query<ReceiptRow>(
        `SELECT id AS delivery_id,push_device_token_id,expo_ticket_id,
                send_attempt_count,receipt_attempt_count
           FROM push_notification_deliveries
          WHERE status='TICKETED' AND next_attempt_at<=now()
            AND receipt_attempt_count<${MAX_ATTEMPTS}
          ORDER BY next_attempt_at,id
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [RECEIPT_BATCH_SIZE],
      );
      if (!selected.rowCount) return [];
      const deliveryIds = selected.rows.map((row) => row.delivery_id);
      await client.query(
        `UPDATE push_notification_deliveries
            SET receipt_attempt_count=receipt_attempt_count+1,
                next_attempt_at=$2,last_error_code=NULL
          WHERE id=ANY($1::uuid[])`,
        [deliveryIds, new Date(this.#now().getTime() + receiptRetryDelayMs(1))],
      );
      return selected.rows.map((row) => ({
        ...row,
        receipt_attempt_count: row.receipt_attempt_count + 1,
      }));
    });
  }

  async #checkReceipts(): Promise<number> {
    const rows = await this.#claimReceipts();
    if (!rows.length) return 0;
    let response: Response;
    try {
      response = await this.#fetch(this.#receiptsUrl, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ ids: rows.map((row) => row.expo_ticket_id) }),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      await this.#deferReceipts(rows, "RECEIPT_NETWORK_ERROR");
      this.logger.warn({ receiptCount: rows.length }, "Expo push receipt lookup failed; check was deferred");
      return rows.length;
    }

    if (!response.ok) {
      await this.#deferReceipts(rows, `RECEIPT_HTTP_${response.status}`);
      this.logger.warn(
        { receiptCount: rows.length, statusCode: response.status },
        "Expo push receipt lookup returned a non-success status",
      );
      return rows.length;
    }

    const receipts = await parseReceiptResponse(response);
    if (!receipts) {
      await this.#deferReceipts(rows, "INVALID_RECEIPT_RESPONSE");
      return rows.length;
    }

    for (const row of rows) {
      const receipt = receipts[row.expo_ticket_id];
      if (!receipt) {
        await this.#deferReceipts([row], "RECEIPT_PENDING");
        continue;
      }
      if (receipt.status === "ok") {
        await this.pool.query(
          `UPDATE push_notification_deliveries
              SET status='DELIVERED',completed_at=now(),last_error_code=NULL
            WHERE id=$1 AND status='TICKETED'`,
          [row.delivery_id],
        );
        continue;
      }
      const code = safeErrorCode(receipt.details?.error, "RECEIPT_ERROR");
      if (code === "DeviceNotRegistered") {
        await this.#invalidate(row.delivery_id, row.push_device_token_id, code);
      } else if (retryableExpoError(code) && row.send_attempt_count < MAX_ATTEMPTS) {
        await this.pool.query(
          `UPDATE push_notification_deliveries
              SET status='PENDING',expo_ticket_id=NULL,next_attempt_at=$2,last_error_code=$3
            WHERE id=$1 AND status='TICKETED'`,
          [row.delivery_id, new Date(this.#now().getTime() + sendRetryDelayMs(row.send_attempt_count)), code],
        );
      } else {
        await this.#failReceipt(row.delivery_id, code);
      }
    }
    return rows.length;
  }

  async #invalidate(deliveryId: string, deviceId: string, code: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE push_notification_deliveries
            SET status='INVALID',completed_at=now(),last_error_code=$2
          WHERE id=$1 AND status IN ('SENDING','TICKETED')`,
        [deliveryId, code],
      );
      await client.query(
        `UPDATE push_device_tokens
            SET disabled_at=COALESCE(disabled_at,now()),
                disabled_reason=COALESCE(disabled_reason,'DEVICE_NOT_REGISTERED')
          WHERE id=$1`,
        [deviceId],
      );
    });
  }

  async #retryRows(rows: DeliveryRow[], code: string): Promise<void> {
    for (const row of rows) {
      if (row.send_attempt_count >= MAX_ATTEMPTS) {
        await this.#failRows([row], code);
        continue;
      }
      await this.pool.query(
        `UPDATE push_notification_deliveries
            SET status='PENDING',expo_ticket_id=NULL,next_attempt_at=$2,last_error_code=$3
          WHERE id=$1 AND status='SENDING'`,
        [row.delivery_id, new Date(this.#now().getTime() + sendRetryDelayMs(row.send_attempt_count)), code],
      );
    }
  }

  async #failRows(rows: DeliveryRow[], code: string): Promise<void> {
    if (!rows.length) return;
    await this.pool.query(
      `UPDATE push_notification_deliveries
          SET status='FAILED',completed_at=now(),last_error_code=$2
        WHERE id=ANY($1::uuid[]) AND status='SENDING'`,
      [rows.map((row) => row.delivery_id), code],
    );
  }

  async #deferReceipts(rows: ReceiptRow[], code: string): Promise<void> {
    for (const row of rows) {
      if (row.receipt_attempt_count >= MAX_ATTEMPTS) {
        await this.#failReceipt(row.delivery_id, "RECEIPT_UNAVAILABLE");
        continue;
      }
      await this.pool.query(
        `UPDATE push_notification_deliveries
            SET next_attempt_at=$2,last_error_code=$3
          WHERE id=$1 AND status='TICKETED'`,
        [row.delivery_id, new Date(this.#now().getTime() + receiptRetryDelayMs(row.receipt_attempt_count)), code],
      );
    }
  }

  async #failReceipt(deliveryId: string, code: string): Promise<void> {
    await this.pool.query(
      `UPDATE push_notification_deliveries
          SET status='FAILED',completed_at=now(),last_error_code=$2
        WHERE id=$1 AND status='TICKETED'`,
      [deliveryId, code],
    );
  }

  #headers(): Record<string, string> {
    return {
      accept: "application/json",
      "accept-encoding": "gzip, deflate",
      "content-type": "application/json",
      authorization: `Bearer ${this.accessToken}`,
    };
  }

  async #throttleSend(messageCount: number): Promise<void> {
    const now = Date.now();
    if (now < this.#nextSendAtMs) {
      await new Promise((resolve) => setTimeout(resolve, this.#nextSendAtMs - now));
    }
    const spacingMs = Math.ceil((messageCount / EXPO_PROJECT_MESSAGES_PER_SECOND) * 1_000);
    this.#nextSendAtMs = Date.now() + spacingMs;
  }
}

async function parseTicketResponse(response: Response): Promise<ExpoResult[] | null> {
  try {
    const value = await response.json() as unknown;
    if (!isRecord(value) || !Array.isArray(value.data)) return null;
    return value.data.every(isExpoResult) ? value.data : null;
  } catch {
    return null;
  }
}

async function parseReceiptResponse(response: Response): Promise<Record<string, ExpoResult> | null> {
  try {
    const value = await response.json() as unknown;
    if (!isRecord(value) || !isRecord(value.data)) return null;
    const receipts: Record<string, ExpoResult> = {};
    for (const [ticketId, receipt] of Object.entries(value.data)) {
      if (!validTicketId(ticketId) || !isExpoResult(receipt)) return null;
      receipts[ticketId] = receipt;
    }
    return receipts;
  } catch {
    return null;
  }
}

function isExpoResult(value: unknown): value is ExpoResult {
  if (!isRecord(value) || (value.status !== "ok" && value.status !== "error")) return false;
  if (value.id !== undefined && !validTicketId(value.id)) return false;
  if (value.details !== undefined && !isRecord(value.details)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTicketId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 120 && !/[\r\n]/.test(value);
}

function safeErrorCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,80}$/.test(value) ? value : fallback;
}

function retryableExpoError(code: string): boolean {
  return ["MessageRateExceeded", "TOO_MANY_REQUESTS"].includes(code);
}

function sendRetryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

function receiptRetryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60_000);
}
