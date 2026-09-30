import type { FastifyInstance } from "fastify";

type ErrorLike = Error & {
  code?: string;
  constraint?: unknown;
  statusCode?: number;
  validation?: unknown;
};

type SafeErrorKind = "database" | "framework" | "non_error" | "unexpected";

const HTTP_ERROR_STATUS_MIN = 400;
const HTTP_ERROR_STATUS_MAX = 599;
const POSTGRES_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const POSTGRES_SQLSTATE_CLASSES = new Set([
  "00", "01", "02", "03", "08", "09", "0A", "0B", "0F", "0L", "0P", "0U", "0V", "0Z",
  "20", "21", "22", "23", "24", "25", "26", "27", "28", "2B", "2D", "2F",
  "34", "38", "39", "3B", "3D", "3F", "40", "42", "44", "53", "54", "55", "57", "58",
  "F0", "HV", "P0", "XX",
]);

/**
 * Data-exception SQLSTATEs caused by malformed client input: 22P02
 * invalid_text_representation, 22007 invalid_datetime_format, and 22008
 * datetime_field_overflow.
 */
const CLIENT_INPUT_SQLSTATES = new Set(["22P02", "22007", "22008"]);

function errorLike(error: unknown): ErrorLike | null {
  return error instanceof Error ? error as ErrorLike : null;
}

function boundedStatusCode(error: unknown): number {
  const statusCode = errorLike(error)?.statusCode;
  return typeof statusCode === "number"
    && Number.isInteger(statusCode)
    && statusCode >= HTTP_ERROR_STATUS_MIN
    && statusCode <= HTTP_ERROR_STATUS_MAX
    ? statusCode
    : 500;
}

/**
 * Keep operational classification without serializing Error fields. In
 * particular, PostgreSQL errors may contain row values in detail and runtime
 * errors may carry connection URLs, tokens, stacks, or nested causes.
 */
export function safeErrorFields(error: unknown): {
  errorKind: SafeErrorKind;
  sqlState?: string;
} {
  const typedError = errorLike(error);
  if (!typedError) return { errorKind: "non_error" };

  const code = typedError.code;
  if (
    code
    && POSTGRES_SQLSTATE_PATTERN.test(code)
    && POSTGRES_SQLSTATE_CLASSES.has(code.slice(0, 2))
  ) {
    return { errorKind: "database", sqlState: code };
  }
  if (code?.startsWith("FST_ERR_")) return { errorKind: "framework" };
  return { errorKind: "unexpected" };
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
  }
}

export function badRequest(message = "요청 값을 확인해 주세요.", details?: Record<string, unknown>) {
  return new AppError(400, "INVALID_REQUEST", message, details);
}

export function unauthorized(message = "로그인이 필요합니다.") {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "이 작업을 수행할 권한이 없습니다.") {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(message = "대상을 찾을 수 없습니다.") {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(message = "이미 변경된 상태입니다.", details?: Record<string, unknown>) {
  return new AppError(409, "CONFLICT", message, details);
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const statusCode = boundedStatusCode(error);
      if (statusCode === 500 && error.statusCode !== 500) {
        request.log.error(
          { requestId: request.id, statusCode, ...safeErrorFields(error) },
          "request failed",
        );
        return reply.code(statusCode).send({
          error: {
            code: "INTERNAL_ERROR",
            message: "요청을 처리하지 못했습니다.",
            requestId: request.id,
          },
        });
      }
      return reply.code(statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }
    const typedError = errorLike(error);
    if (typedError?.validation) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "요청 값을 확인해 주세요.",
          requestId: request.id,
        },
      });
    }
    if (typedError?.code === "23505") {
      return reply.code(409).send({
        error: { code: "CONFLICT", message: "이미 등록된 값입니다.", requestId: request.id },
      });
    }
    if (typedError?.code && CLIENT_INPUT_SQLSTATES.has(typedError.code)) {
      // A client-supplied value PostgreSQL could not cast (for example a
      // non-UUID path or cursor id) is a malformed request, not a server fault.
      request.log.warn(
        { requestId: request.id, statusCode: 400, ...safeErrorFields(error) },
        "request rejected",
      );
      return reply.code(400).send({
        error: { code: "INVALID_REQUEST", message: "요청 값을 확인해 주세요.", requestId: request.id },
      });
    }
    if (
      typedError?.code === "23514"
      && "constraint" in typedError
      && typedError.constraint === "account_deletion_approved_mutation_guard"
    ) {
      return reply.code(403).send({
        error: {
          code: "ACCOUNT_DELETION_APPROVED",
          message: "탈퇴가 승인된 계정은 더 이상 변경할 수 없습니다.",
          requestId: request.id,
        },
      });
    }
    const statusCode = boundedStatusCode(error);
    const logFields = { requestId: request.id, statusCode, ...safeErrorFields(error) };
    if (statusCode < 500) request.log.warn(logFields, "request rejected");
    else request.log.error(logFields, "request failed");
    return reply.code(statusCode).send({
      error: {
        code: statusCode < 500 ? "INVALID_REQUEST" : "INTERNAL_ERROR",
        message: statusCode < 500 ? "요청 값을 확인해 주세요." : "요청을 처리하지 못했습니다.",
        requestId: request.id,
      },
    });
  });
}
