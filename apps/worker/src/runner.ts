import { createDatabasePool } from "@dabboba/db";
import type { WorkerConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { createRoutedMediaStore } from "./media-providers.js";
import {
  runWorkerOnceCore,
  type WorkerRunOperations,
  type WorkerRunSummary,
} from "./runner-core.js";

export {
  consumeQueue,
  createPaymentReconciliationProvider,
  queueRetryDelaySeconds,
  type WorkerRunOperations,
  type WorkerRunSummary,
} from "./runner-core.js";

/** Node entry compatibility wrapper retaining mixed GCS/Supabase cleanup routing. */
export function runWorkerOnce(
  config: WorkerConfig,
  logger: Logger = createLogger(config.logLevel),
  shouldStop: () => boolean = () => false,
  createPool: typeof createDatabasePool = createDatabasePool,
  operations?: WorkerRunOperations,
): Promise<WorkerRunSummary> {
  return runWorkerOnceCore(
    config,
    { createMediaStore: createRoutedMediaStore },
    logger,
    shouldStop,
    createPool,
    operations,
  );
}
