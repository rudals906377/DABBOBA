import type { FastifyBaseLogger } from "fastify";

type LogWriter = (line: string) => void;
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

const LEVEL_VALUE: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
};
const METHODS = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "QUERY"]);
const ERROR_KINDS = new Set(["database", "framework", "non_error", "unexpected"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function token(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function safeFields(bindings: Record<string, unknown>, args: unknown[]): Record<string, unknown> {
  const first = record(args[0]) ?? {};
  const request = record(first.req) ?? {};
  const response = record(first.res) ?? {};
  const requestId = token(first.requestId ?? first.reqId ?? bindings.requestId ?? bindings.reqId, /^[A-Za-z0-9._:-]{8,128}$/);
  const method = token(first.method ?? request.method, /^[A-Z]{3,8}$/);
  const route = token(first.route, /^\/[A-Za-z0-9_:/.-]{0,199}$/);
  const statusCandidate = first.statusCode ?? response.statusCode;
  const statusCode = typeof statusCandidate === "number" && Number.isInteger(statusCandidate)
    && statusCandidate >= 100 && statusCandidate <= 599 ? statusCandidate : undefined;
  const errorKind = typeof first.errorKind === "string" && ERROR_KINDS.has(first.errorKind) ? first.errorKind : undefined;
  const sqlState = token(first.sqlState, /^[0-9A-Z]{5}$/);
  return {
    ...(requestId ? { requestId } : {}),
    ...(method && METHODS.has(method) ? { method } : {}),
    ...(route ? { route } : {}),
    ...(statusCode ? { statusCode } : {}),
    ...(errorKind ? { errorKind } : {}),
    ...(sqlState ? { sqlState } : {}),
  };
}

export function createEdgeApiLogger(
  configuredLevel: string,
  write: LogWriter = (line) => console.log(line),
  bindings: Record<string, unknown> = {},
): FastifyBaseLogger {
  const level = configuredLevel in LEVEL_VALUE ? configuredLevel as LogLevel : "info";
  const log = (eventLevel: Exclude<LogLevel, "silent">, args: unknown[]) => {
    if (LEVEL_VALUE[eventLevel] < LEVEL_VALUE[level]) return;
    write(JSON.stringify({
      level: eventLevel,
      service: "dabboba-api-edge",
      ...safeFields(bindings, args),
    }));
  };
  const logger = {
    level,
    silent: (...args: unknown[]) => { void args; },
    trace: (...args: unknown[]) => log("trace", args),
    debug: (...args: unknown[]) => log("debug", args),
    info: (...args: unknown[]) => log("info", args),
    warn: (...args: unknown[]) => log("warn", args),
    error: (...args: unknown[]) => log("error", args),
    fatal: (...args: unknown[]) => log("fatal", args),
    child(childBindings: Record<string, unknown> = {}) {
      return createEdgeApiLogger(level, write, { ...bindings, ...childBindings });
    },
  };
  return logger as FastifyBaseLogger;
}
