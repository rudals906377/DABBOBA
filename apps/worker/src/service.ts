import { createDatabasePool } from "@dabboba/db";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { WorkerConfig } from "./config.js";
import { startHealthServer, type HealthServer } from "./health.js";
import { processWorkerJob, registerJobSchedulers, type JobDependencies } from "./jobs.js";
import { createLogger, errorFields, type Logger } from "./logger.js";
import { DisabledMediaStore, GcsMediaStore } from "./media.js";
import { WorkerMetrics } from "./metrics.js";
import { HttpNotificationDelivery, LogOnlyNotificationDelivery } from "./notifications.js";
import { dispatchOutboxBatch, type OutboxPublisher } from "./outbox.js";
import { ManualReviewPaymentProvider } from "./payments.js";
import { redisConnectionOptions } from "./redis.js";

export type WorkerService = {
  healthAddress: string;
  close(): Promise<void>;
};

function timeoutAfter(milliseconds: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker shutdown exceeded ${milliseconds}ms`)), milliseconds);
    timer.unref();
  });
}

export async function startWorkerService(config: WorkerConfig, logger: Logger = createLogger(config.logLevel)): Promise<WorkerService> {
  const pool = createDatabasePool(config.databaseUrl, "dabboba-worker");
  const connection = redisConnectionOptions(config.redisUrl);
  const healthRedis = new Redis(config.redisUrl, {
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  const queue = new Queue(config.queueName, {
    connection,
    defaultJobOptions: {
      attempts: config.jobAttempts,
      backoff: { type: "exponential", delay: config.jobBackoffMs },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 50_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 50_000 },
    },
  });
  const metrics = new WorkerMetrics();
  const notificationDelivery = config.notificationDeliveryUrl
    ? new HttpNotificationDelivery(config.notificationDeliveryUrl, config.notificationDeliveryToken)
    : new LogOnlyNotificationDelivery(logger);
  const mediaStore = config.gcsBucket
    ? new GcsMediaStore(config.gcsBucket, config.gcsProjectId)
    : new DisabledMediaStore(logger);
  const dependencies: JobDependencies = {
    pool,
    queue,
    config,
    logger,
    notificationDelivery,
    paymentProvider: new ManualReviewPaymentProvider(),
    mediaStore,
  };
  const worker = new Worker(
    config.queueName,
    async (job) => processWorkerJob(dependencies, job.data),
    { connection, concurrency: config.concurrency },
  );

  let health: HealthServer | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let activePoll: Promise<void> | null = null;
  let shuttingDown = false;
  let closePromise: Promise<void> | null = null;

  worker.on("completed", (job) => {
    metrics.recordJobCompleted();
    logger.debug({ jobId: job.id || null, jobName: job.name }, "Worker job completed");
  });
  worker.on("failed", (job, error) => {
    metrics.recordJobFailed();
    logger.error({ jobId: job?.id || null, jobName: job?.name || null, ...errorFields(error) }, "Worker job failed");
  });
  worker.on("error", (error) => logger.error(errorFields(error), "BullMQ worker error"));
  queue.on("error", (error) => logger.error(errorFields(error), "BullMQ queue error"));

  const publisher: OutboxPublisher = {
    add: (name, data, options) => queue.add(name, data, options),
  };
  const pollOutbox = async () => {
    if (shuttingDown || activePoll) return;
    activePoll = (async () => {
      try {
        const result = await dispatchOutboxBatch(
          pool,
          publisher,
          { batchSize: config.outboxBatchSize, jobAttempts: config.jobAttempts, jobBackoffMs: config.jobBackoffMs },
          logger,
        );
        metrics.recordOutboxPoll(result.published, result.deferred);
        if (result.published || result.deferred) logger.debug(result, "Outbox poll completed");
      } catch (error) {
        logger.error(errorFields(error), "Outbox poll failed");
      }
    })().finally(() => { activePoll = null; });
    await activePoll;
  };

  try {
    await Promise.all([pool.query("SELECT 1"), queue.waitUntilReady(), worker.waitUntilReady(), healthRedis.ping()]);
    await registerJobSchedulers(queue, config);
    health = await startHealthServer({
      host: config.healthHost,
      port: config.healthPort,
      pool,
      redisPing: () => healthRedis.ping(),
      isShuttingDown: () => shuttingDown,
      metrics,
      logger,
    });
    pollTimer = setInterval(() => { void pollOutbox(); }, config.outboxPollMs);
    void pollOutbox();
    logger.info(
      { queue: config.queueName, concurrency: config.concurrency, healthAddress: health.address },
      "DABBOBA worker started",
    );
  } catch (error) {
    shuttingDown = true;
    healthRedis.disconnect();
    await Promise.allSettled([worker.close(true), queue.close(), pool.end()]);
    throw error;
  }

  return {
    healthAddress: health.address,
    close() {
      if (closePromise) return closePromise;
      shuttingDown = true;
      if (pollTimer) clearInterval(pollTimer);
      closePromise = Promise.race([
        (async () => {
          if (activePoll) await activePoll;
          if (health) await health.close();
          await worker.close();
          await queue.close();
          if (healthRedis.status === "ready") await healthRedis.quit();
          else healthRedis.disconnect();
          await pool.end();
          logger.info({}, "DABBOBA worker stopped");
        })(),
        timeoutAfter(config.shutdownTimeoutMs),
      ]);
      return closePromise;
    },
  };
}
