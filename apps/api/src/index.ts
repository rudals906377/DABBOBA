import { loadApiConfig } from "@dabboba/config";
import { buildApp } from "./app.js";
import { createGracefulShutdown } from "./shutdown.js";

const config = loadApiConfig();
const { app } = await buildApp({ config });

const shutdown = createGracefulShutdown(app);

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

await app.listen({ host: config.host, port: config.port });
