import type { DatabasePool } from "@dabboba/db";
import { isDeepStrictEqual } from "node:util";
import { Queue } from "bullmq";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { cleanupMediaBatch, type MediaStore } from "./media.js";
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
import { expireOrderReservations, expireReservationBatch, nextReservationExpiry } from "./reservations.js";
import { parseOutboxEvent, parseWorkerJob, type OutboxEvent, type WorkerJob } from "./types.js";

export type JobDependencies = {
  pool: DatabasePool;
  queue: Queue;
  config: WorkerConfig;
  logger: Logger;
  notificationDelivery: NotificationDelivery;
  paymentProvider: PaymentReconciliationProvider;
  mediaStore: MediaStore;
};

const jobRetention = {
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 50_000 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 50_000 },
};

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
    throw new Error(`BullMQ outbox event does not match the canonical PostgreSQL event: ${queuedEvent.id}`);
  }
  return canonicalEvent;
}

function stringPayload(event: OutboxEvent, key: string): string | null {
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function scheduleOrderExpiry(dependencies: JobDependencies, event: OutboxEvent) {
  const orderId = stringPayload(event, "orderId") || event.aggregateId;
  const expiresAt = await nextReservationExpiry(dependencies.pool, orderId);
  if (!expiresAt) return;
  const delay = Math.max(0, expiresAt.getTime() - Date.now());
  await dependencies.queue.add(
    "reservation.expire-order",
    { kind: "reservation.expire-order", orderId } satisfies WorkerJob,
    { jobId: `reservation-expire-${orderId}`, delay, ...jobRetention },
  );
}

async function processOutboxEvent(dependencies: JobDependencies, event: OutboxEvent) {
  if (event.eventType === "order.created") await scheduleOrderExpiry(dependencies, event);
  if (event.eventType === "payment.refund_requires_reconciliation") {
    const paymentId = stringPayload(event, "paymentId") || event.aggregateId;
    await reconcilePayment(dependencies.pool, paymentId, dependencies.paymentProvider, dependencies.logger);
  }

  const notification = await ensureNotification(dependencies.pool, event);
  if (notification && await shouldDeliverNotificationExternally(dependencies.pool, notification)) {
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
  const job = parseWorkerJob(raw);
  switch (job.kind) {
    case "outbox.event": {
      const event = await authenticateOutboxEvent(dependencies.pool, job.event);
      return processOutboxEvent(dependencies, event);
    }
    case "reservation.expire-order":
      return expireOrderReservations(dependencies.pool, job.orderId);
    case "reservation.sweep":
      return expireReservationBatch(dependencies.pool, dependencies.config.outboxBatchSize, dependencies.logger);
    case "payment.reconcile":
      return reconcilePaymentBatch(
        dependencies.pool,
        dependencies.paymentProvider,
        { batchSize: dependencies.config.outboxBatchSize, staleMinutes: dependencies.config.paymentStaleMinutes },
        dependencies.logger,
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
      );
  }
}

export async function registerJobSchedulers(queue: Queue, config: WorkerConfig) {
  const opts = {
    attempts: config.jobAttempts,
    backoff: { type: "exponential" as const, delay: config.jobBackoffMs },
    ...jobRetention,
  };
  await Promise.all([
    queue.upsertJobScheduler(
      "reservation-sweep-v1",
      { every: config.reservationSweepMs },
      { name: "reservation.sweep", data: { kind: "reservation.sweep" } satisfies WorkerJob, opts },
    ),
    queue.upsertJobScheduler(
      "payment-reconciliation-v1",
      { every: config.paymentReconciliationMs },
      { name: "payment.reconcile", data: { kind: "payment.reconcile" } satisfies WorkerJob, opts },
    ),
    queue.upsertJobScheduler(
      "media-cleanup-v1",
      { every: config.mediaCleanupMs },
      { name: "media.cleanup", data: { kind: "media.cleanup" } satisfies WorkerJob, opts },
    ),
  ]);
}
