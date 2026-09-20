export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
};

const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SAFE_ERROR_NAMES = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
const SAFE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "MEDIA_PROCESSING_FAILED",
]);
const POSTGRES_ERROR_CLASSES = new Set([
  "00", "01", "02", "03", "08", "09", "0A", "0B", "0F", "0L", "0P", "0Z",
  "20", "21", "22", "23", "24", "25", "26", "27", "28", "2B", "2D", "2F",
  "34", "38", "39", "3B", "3D", "3F", "40", "42", "44", "53", "54", "55", "57",
  "58", "72", "F0", "HV", "P0", "XX",
]);

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  return SAFE_ERROR_NAMES.has(error.name) ? error.name : "Error";
}

function safeErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const candidate = (error as { code?: unknown }).code;
  if (typeof candidate !== "string") return null;
  if (
    (/^[0-9A-Z]{5}$/.test(candidate) && POSTGRES_ERROR_CLASSES.has(candidate.slice(0, 2)))
    || SAFE_ERROR_CODES.has(candidate)
  ) return candidate;
  return null;
}

export function errorFields(error: unknown): LogFields {
  const errorCode = safeErrorCode(error);
  return {
    errorName: safeErrorName(error),
    ...(errorCode ? { errorCode } : {}),
  };
}

export function persistedErrorIdentity(error: unknown): string {
  const fields = errorFields(error);
  return typeof fields.errorCode === "string"
    ? `${fields.errorName}:${fields.errorCode}`
    : String(fields.errorName);
}

export function createLogger(minimumLevel: LogLevel): Logger {
  const write = (level: LogLevel, fields: LogFields, message: string) => {
    if (priorities[level] < priorities[minimumLevel]) return;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, service: "dabboba-worker", message, ...fields });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (fields, message) => write("debug", fields, message),
    info: (fields, message) => write("info", fields, message),
    warn: (fields, message) => write("warn", fields, message),
    error: (fields, message) => write("error", fields, message),
  };
}
