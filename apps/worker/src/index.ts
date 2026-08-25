import { loadWorkerConfig } from "./config.js";
import { createLogger, errorFields } from "./logger.js";
import { startWorkerService } from "./service.js";

async function main() {
  const config = loadWorkerConfig();
  const logger = createLogger(config.logLevel);
  try {
    const service = await startWorkerService(config, logger);
    let stopping = false;
    const stop = (signal: NodeJS.Signals) => {
      if (stopping) return;
      stopping = true;
      logger.info({ signal }, "Worker shutdown requested");
      void service.close().then(
        () => { process.exitCode = 0; },
        (error) => {
          logger.error(errorFields(error), "Worker shutdown failed");
          process.exitCode = 1;
        },
      );
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    logger.error(errorFields(error), "Worker startup failed");
    process.exitCode = 1;
  }
}

void main();
