import { loadWorkerConfig } from "./config.js";
import { createLogger, errorFields } from "./logger.js";
import { runWorkerOnce } from "./runner.js";

async function main() {
  const config = loadWorkerConfig();
  const logger = createLogger(config.logLevel);
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.warn({ signal }, "Worker termination requested; finishing the current database operation");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runWorkerOnce(config, logger, () => stopping);
    process.exitCode = stopping ? 1 : 0;
  } catch (error) {
    logger.error(errorFields(error), "Finite worker execution failed");
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

void main();
