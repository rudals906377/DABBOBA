import { createServer, type Server } from "node:http";
import type { DatabasePool } from "@dabboba/db";
import type { Logger } from "./logger.js";
import type { WorkerMetrics } from "./metrics.js";

export type HealthServer = {
  address: string;
  close(): Promise<void>;
};

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Health dependency check timed out")), timeoutMs);
      timer.unref();
    }),
  ]);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function startHealthServer(options: {
  host: string;
  port: number;
  pool: DatabasePool;
  redisPing: () => Promise<string>;
  isShuttingDown: () => boolean;
  metrics: WorkerMetrics;
  logger: Logger;
}): Promise<HealthServer> {
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (request.method !== "GET") {
      response.writeHead(405).end(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }));
      return;
    }
    if (request.url === "/live") {
      response.writeHead(200).end(JSON.stringify({ ok: true, service: "dabboba-worker" }));
      return;
    }
    if (request.url === "/metrics") {
      response.writeHead(200).end(JSON.stringify(options.metrics.snapshot()));
      return;
    }
    if (request.url === "/ready" || request.url === "/health") {
      if (options.isShuttingDown()) {
        response.writeHead(503).end(JSON.stringify({ ok: false, status: "shutting_down" }));
        return;
      }
      try {
        await withTimeout(Promise.all([options.pool.query("SELECT 1"), options.redisPing()]), 2_000);
        response.writeHead(200).end(JSON.stringify({ ok: true, status: "ready" }));
      } catch (error) {
        options.logger.warn({ dependencyCheck: "failed", errorMessage: error instanceof Error ? error.message : String(error) }, "Worker is not ready");
        response.writeHead(503).end(JSON.stringify({ ok: false, status: "not_ready" }));
      }
      return;
    }
    response.writeHead(404).end(JSON.stringify({ ok: false, error: "NOT_FOUND" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = `http://${options.host}:${options.port}`;
  return { address, close: () => closeServer(server) };
}
