import { createDatabasePool, type DatabasePool, WORKER_DATABASE_ROLE } from "@dabboba/db";
import type { WorkerConfig } from "./config.js";
import { processWorkerJob, type JobDependencies } from "./jobs.js";
import { createLogger, errorFields, type Logger } from "./logger.js";
import { DisabledMediaStore, GcsMediaStore } from "./media.js";
import { HttpNotificationDelivery, LogOnlyNotificationDelivery } from "./notifications.js";
import { dispatchOutboxBatch, outboxRetryDelayMs } from "./outbox.js";
import { ManualReviewPaymentProvider } from "./payments.js";
import {
  assertPgmqRuntime,
  createPgmqOutboxPublisher,
  deadLetterPgmqMessage,
  deferPgmqMessage,
  deletePgmqMessage,
  readPgmqMessages,
} from "./pgmq.js";

const WORKER_JOB_LOCK_ID = "7922024082400002";

type QueueConsumerOperations = {
  readMessages: typeof readPgmqMessages;
  processJob: typeof processWorkerJob;
  deleteMessage: typeof deletePgmqMessage;
  deferMessage: typeof deferPgmqMessage;
  deadLetterMessage: typeof deadLetterPgmqMessage;
};

const queueConsumerOperations: QueueConsumerOperations = {
  readMessages: readPgmqMessages,
  processJob: processWorkerJob,
  deleteMessage: deletePgmqMessage,
  deferMessage: deferPgmqMessage,
  deadLetterMessage: deadLetterPgmqMessage,
};

export type WorkerRunSummary = {
  status: "completed" | "overlap_skipped";
  pgmqVersion: string | null;
  outboxPublished: number;
  outboxDeferred: number;
  queueCompleted: number;
  queueRetried: number;
  queueDeadLettered: number;
  periodicCompleted: number;
};

function queueRetryDelaySeconds(readCount: number, baseDelayMs: number): number {
  return Math.max(1, Math.ceil(outboxRetryDelayMs(readCount, baseDelayMs) / 1_000));
}

export async function consumeQueue(
  pool: DatabasePool,
  dependencies: JobDependencies,
  config: WorkerConfig,
  summary: WorkerRunSummary,
  seenMessageIds: Set<string>,
  deadline: number,
  shouldStop: () => boolean,
  operations: QueueConsumerOperations = queueConsumerOperations,
) {
  while (
    summary.queueCompleted + summary.queueRetried + summary.queueDeadLettered < config.maxMessagesPerRun
    && Date.now() < deadline
    && !shouldStop()
  ) {
    const remaining = config.maxMessagesPerRun
      - summary.queueCompleted
      - summary.queueRetried
      - summary.queueDeadLettered;
    const messages = await operations.readMessages(
      pool,
      config.queueName,
      config.queueVisibilitySeconds,
      // Claim exactly one message so reaching the deadline while processing it
      // cannot increment read_ct or hide an unprocessed tail batch.
      Math.min(1, remaining),
    );
    if (!messages.length) return;

    let foundUnseenMessage = false;
    for (const message of messages) {
      if (Date.now() >= deadline || shouldStop()) return;
      if (seenMessageIds.has(message.id)) {
        dependencies.logger.warn(
          { queueMessageId: message.id, readCount: message.readCount },
          "Queue message was already attempted in this execution; leaving its refreshed visibility for a future execution",
        );
        continue;
      }
      seenMessageIds.add(message.id);
      foundUnseenMessage = true;
      try {
        await operations.processJob(dependencies, message.payload);
        const deleted = await operations.deleteMessage(pool, config.queueName, message.id);
        if (!deleted) throw new Error(`pgmq message disappeared before acknowledgement: ${message.id}`);
        summary.queueCompleted += 1;
      } catch (error) {
        if (message.readCount >= config.jobAttempts) {
          await operations.deadLetterMessage(pool, config.queueName, message, error);
          summary.queueDeadLettered += 1;
          dependencies.logger.error(
            { queueMessageId: message.id, readCount: message.readCount, ...errorFields(error) },
            "Worker job moved to the database dead-letter ledger",
          );
        } else {
          // Keep this ID invisible for the remainder of this invocation so a
          // short backoff cannot consume another read_ct before a future run.
          const remainingRunSeconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1_000) + 1);
          const retrySeconds = Math.max(
            queueRetryDelaySeconds(message.readCount, config.jobBackoffMs),
            remainingRunSeconds,
          );
          await operations.deferMessage(pool, config.queueName, message.id, retrySeconds);
          summary.queueRetried += 1;
          dependencies.logger.warn(
            { queueMessageId: message.id, readCount: message.readCount, retrySeconds, ...errorFields(error) },
            "Worker job deferred for retry",
          );
        }
      }
    }
    // A real pgmq.read refreshes visibility before returning a message. If a
    // short backoff made a previously attempted ID visible again during this
    // invocation, leave it untouched for the next invocation and avoid a hot
    // loop should a test double or database clock return it repeatedly.
    if (!foundUnseenMessage) return;
  }
}

export async function runWorkerOnce(
  config: WorkerConfig,
  logger: Logger = createLogger(config.logLevel),
  shouldStop: () => boolean = () => false,
): Promise<WorkerRunSummary> {
  // Startup, connection, lock acquisition, and ACL attestation all consume the
  // same bounded work window. Slow startup reduces work instead of erasing the
  // margin to Cloud Run's 600-second task timeout.
  const deadline = Date.now() + config.maxRunSeconds * 1_000;
  const shouldContinue = () => Date.now() < deadline && !shouldStop();
  const pool = createDatabasePool(config.databaseUrl, "dabboba-worker-job", {
    expectedRole: WORKER_DATABASE_ROLE,
    max: config.databasePoolMax,
    queryTimeoutMs: config.databaseOperationTimeoutMs,
    statementTimeoutMs: config.databaseOperationTimeoutMs,
  });
  const lockClient = await pool.connect();
  let lockHeld = false;
  const summary: WorkerRunSummary = {
    status: "completed",
    pgmqVersion: null,
    outboxPublished: 0,
    outboxDeferred: 0,
    queueCompleted: 0,
    queueRetried: 0,
    queueDeadLettered: 0,
    periodicCompleted: 0,
  };

  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [WORKER_JOB_LOCK_ID],
    );
    lockHeld = lock.rows[0]?.locked === true;
    if (!lockHeld) {
      summary.status = "overlap_skipped";
      logger.info({}, "Another finite worker execution owns the advisory lock; exiting cleanly");
      return summary;
    }

    summary.pgmqVersion = await assertPgmqRuntime(pool);
    const publisher = createPgmqOutboxPublisher(config.queueName);
    const notificationDelivery = config.notificationDeliveryUrl
      ? new HttpNotificationDelivery(config.notificationDeliveryUrl, config.notificationDeliveryToken)
      : new LogOnlyNotificationDelivery(logger);
    const mediaStore = config.gcsBucket
      ? new GcsMediaStore(config.gcsBucket, config.gcsProjectId)
      : new DisabledMediaStore(logger);
    const dependencies: JobDependencies = {
      pool,
      config,
      logger,
      notificationDelivery,
      paymentProvider: new ManualReviewPaymentProvider(),
      mediaStore,
      shouldContinue,
    };
    // The set is bounded by maxMessagesPerRun and intentionally spans both
    // queue-consumption passes in this one-shot execution.
    const seenMessageIds = new Set<string>();
    const dispatchOptions = {
      batchSize: config.outboxBatchSize,
      jobAttempts: config.jobAttempts,
      jobBackoffMs: config.jobBackoffMs,
    };

    const firstDispatch = await dispatchOutboxBatch(pool, publisher, dispatchOptions, logger, shouldContinue);
    summary.outboxPublished += firstDispatch.published;
    summary.outboxDeferred += firstDispatch.deferred;
    await consumeQueue(pool, dependencies, config, summary, seenMessageIds, deadline, shouldStop);

    for (const job of [
      { kind: "reservation.sweep" } as const,
      { kind: "payment.reconcile" } as const,
      { kind: "media.cleanup" } as const,
    ]) {
      if (!shouldContinue()) break;
      await processWorkerJob(dependencies, job);
      summary.periodicCompleted += 1;
    }

    if (shouldContinue()) {
      const secondDispatch = await dispatchOutboxBatch(pool, publisher, dispatchOptions, logger, shouldContinue);
      summary.outboxPublished += secondDispatch.published;
      summary.outboxDeferred += secondDispatch.deferred;
      await consumeQueue(pool, dependencies, config, summary, seenMessageIds, deadline, shouldStop);
    }

    logger.info(summary, "Finite DABBOBA worker execution completed");
    return summary;
  } finally {
    if (lockHeld) {
      await lockClient.query("SELECT pg_advisory_unlock($1::bigint)", [WORKER_JOB_LOCK_ID]).catch(() => undefined);
    }
    lockClient.release();
    await pool.end();
  }
}

export { queueRetryDelaySeconds };
