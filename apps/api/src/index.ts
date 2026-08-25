import { loadApiConfig } from "@dabboba/config";
import { buildApp } from "./app.js";

const config = loadApiConfig();
const { app } = await buildApp({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

await app.listen({ host: config.host, port: config.port });
