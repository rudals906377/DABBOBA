import type { DatabasePool } from "@dabboba/db";
import { isDeepStrictEqual } from "node:util";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { cleanupMediaBatch, type MediaStore } from "./media.js";
import { cleanupSupabaseAuthUsers } from "./supabase-auth-deletion.js";
import {
  ensureNotification,
  shouldDeliverNotificationExternally,
  type NotificationDelivery,
} from "./notifications.js";
import {
  reconcilePayment,
  reconcilePaymentBatch,
  type PaymentReconciliationProvider,
} from "./payments.js";
import { expireOrderReservations, expireReservationBatch } from "./reservations.js";
import { runRetentionBatch } from "./retention.js";
import { runCommerceRetentionBatch } from "./commerce-retention.js";
import { processInventoryStorageExpiryBatch } from "./storage-expiry.js";
import { parseOutboxEvent, parseWorkerJob, type OutboxEvent, type WorkerJob } from "./types.js";

export type JobDependencies = {
  pool: DatabasePool;
  config: WorkerConfig;
  logger: Logger;
  notificationDelivery: NotificationDelivery;
  paymentProvider: PaymentReconciliationProvider;
  mediaStore: MediaStore;
  shouldContinue?: () => boolean;
};

function assertMayContinue(dependencies: JobDependencies): void {
  if (dependencies.shouldContinue?.() === false) {
    throw new Error("Worker run deadline reached while processing a job");
  }
}

type CanonicalOutboxRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
  created_at: Date;
};

async function authenticateOutboxEvent(pool: DatabasePool, queuedEvent: OutboxEvent): Promise<OutboxEvent> {
  const result = await pool.query<CanonicalOutboxRow>(
    `SELECT id,aggregate_type,aggregate_id,event_type,payload,correlation_id,created_at
       FROM outbox_events
      WHERE id=$1`,
    [queuedEvent.id],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Canonical outbox event was not found: ${queuedEvent.id}`);

  const canonicalEvent = parseOutboxEvent({
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    correlationId: row.correlation_id,
    createdAt: row.created_at.toISOString(),
  });
  if (!isDeepStrictEqual(queuedEvent, canonicalEvent)) {
    throw new Error(`Queued outbox event does not match the canonical PostgreSQL event: ${queuedEvent.id}`);
  }
  return canonicalEvent;
}

function stringPayload(event: OutboxEvent, key: string): string | null {
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function processOutboxEvent(dependencies: JobDependencies, event: OutboxEvent) {
  // The finite Cloud Run Job runs the canonical reservation sweep every time.
  // Avoid a second delayed queue effect for order.created: pgmq has no BullMQ
  // jobId deduplication and the sweep already applies row locks and state guards.
  if (event.eventType === "payment.refund_requires_reconciliation") {
    assertMayContinue(dependencies);
    const paymentId = stringPayload(event, "paymentId") || event.aggregateId;
    await reconcilePayment(dependencies.pool, paymentId, dependencies.paymentProvider, dependencies.logger);
  }

  assertMayContinue(dependencies);
  const notification = await ensureNotification(dependencies.pool, event);
  assertMayContinue(dependencies);
  if (notification && await shouldDeliverNotificationExternally(dependencies.pool, notification)) {
    assertMayContinue(dependencies);
    await dependencies.notificationDelivery.deliver(notification);
  }

  dependencies.logger.debug(
    {
      outboxEventId: event.id,
      correlationId: event.correlationId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
    },
    "Outbox event processed",
  );
}

export async function processWorkerJob(dependencies: JobDependencies, raw: unknown): Promise<unknown> {
  assertMayContinue(dependencies);
  const job = parseWorkerJob(raw);
  switch (job.kind) {
    case "outbox.event": {
      const event = await authenticateOutboxEvent(dependencies.pool, job.event);
      assertMayContinue(dependencies);
      return processOutboxEvent(dependencies, event);
    }
    case "reservation.expire-order":
      return expireOrderReservations(dependencies.pool, job.orderId, new Date(), dependencies.shouldContinue);
    case "reservation.sweep":
      return expireReservationBatch(
        dependencies.pool,
        dependencies.config.outboxBatchSize,
        dependencies.logger,
        new Date(),
        dependencies.shouldContinue,
      );
    case "payment.reconcile":
      return reconcilePaymentBatch(
        dependencies.pool,
        dependencies.paymentProvider,
        {
          batchSize: dependencies.config.outboxBatchSize,
          staleMinutes: dependencies.config.paymentStaleMinutes,
          ...(dependencies.config.paymentWindowValidityMinutes === undefined
            ? {}
            : { paymentWindowValidityMinutes: dependencies.config.paymentWindowValidityMinutes }),
        },
        dependencies.logger,
        new Date(),
        dependencies.shouldContinue,
      );
    case "inventory.storage-expiry":
      return processInventoryStorageExpiryBatch(
        dependencies.pool,
        dependencies.config.outboxBatchSize,
        dependencies.logger,
        new Date(),
        dependencies.shouldContinue,
      );
    case "account-auth.cleanup":
      return cleanupSupabaseAuthUsers(
        dependencies.pool,
        dependencies.config,
        dependencies.logger,
        dependencies.shouldContinue,
        undefined,
        dependencies.mediaStore,
      );
    case "media.cleanup":
      return cleanupMediaBatch(
        dependencies.pool,
        dependencies.mediaStore,
        {
          batchSize: dependencies.config.outboxBatchSize,
          pendingTtlMinutes: dependencies.config.mediaPendingTtlMinutes,
          rejectedTtlHours: dependencies.config.mediaRejectedTtlHours,
        },
        new Date(),
        dependencies.shouldContinue,
      );
    case "retention.sweep":
      return runRetentionBatch(
        dependencies.pool,
        dependencies.config.retention,
        dependencies.logger,
        dependencies.shouldContinue,
      );
    case "commerce.retention.sweep":
      return runCommerceRetentionBatch(
        dependencies.pool,
        dependencies.config.commerceRetention,
        dependencies.logger,
        dependencies.shouldContinue,
      );
  }
}
