import type { FastifyInstance } from "fastify";

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
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }
    const typedError = error as Error & {
      statusCode?: number;
      code?: string;
      validation?: unknown;
    };
    if (typedError.validation) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "요청 값을 확인해 주세요.",
          requestId: request.id,
        },
      });
    }
    if (typedError.code === "23505") {
      return reply.code(409).send({
        error: { code: "CONFLICT", message: "이미 등록된 값입니다.", requestId: request.id },
      });
    }
    if (
      typedError.code === "23514"
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
    request.log.error({ err: error }, "request failed");
    return reply.code(typedError.statusCode && typedError.statusCode >= 400 ? typedError.statusCode : 500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "요청을 처리하지 못했습니다.",
        requestId: request.id,
      },
    });
  });
}
