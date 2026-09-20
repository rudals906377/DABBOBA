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
