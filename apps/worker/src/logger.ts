export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
};

const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  return { errorMessage: String(error) };
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
