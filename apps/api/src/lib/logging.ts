import type { FastifyRequest } from "fastify";

/**
 * Log only bounded request metadata. Raw URLs include query strings and request
 * objects include headers, so neither belongs in the default access log.
 */
export function serializeRequestForLog(request: FastifyRequest): {
  method: string;
  route: string;
} {
  const route = request.routeOptions?.url;
  return {
    method: request.method,
    route: typeof route === "string" && route ? route : "unmatched",
  };
}

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * The caller-supplied x-request-id, when well formed. It is diagnostic only:
 * request.id is always server-generated and is what audit rows persist.
 */
export function clientRequestId(request: Pick<FastifyRequest, "headers">): string | undefined {
  const provided = request.headers["x-request-id"];
  const value = Array.isArray(provided) ? provided[0] : provided;
  return value && CLIENT_REQUEST_ID_PATTERN.test(value) ? value : undefined;
}
