import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { ApiConfig } from "@dabboba/config";
import { normalizeIP } from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";

/**
 * Routes whose limit must follow the caller's network address even when an
 * Authorization header is present. They are anonymous login exchanges, so an
 * attacker could otherwise mint a fresh bucket per request with a random
 * bearer value.
 */
export const IP_KEYED_RATE_LIMIT_ROUTES: ReadonlySet<string> = new Set([
  "/v1/auth/exchange",
  "/v1/auth/payment-review",
  "/v1/auth/account-deletion-exchange",
]);

/** Session tokens are 32 random bytes encoded as unpadded base64url. */
const SESSION_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Collapses IPv6 callers to their /64 so rotating in-allocation addresses share one bucket. */
function normalizedIp(value: string): string {
  return normalizeIP(value, 64);
}

/**
 * Client IP for rate limiting. When the deployment names a trusted header
 * (one the hosting edge overwrites on every request), its right-most valid
 * entry is used: proxies append, so earlier entries may be caller-supplied.
 * Otherwise the socket address is used.
 */
export function clientIpForRateLimit(request: FastifyRequest, config: Pick<ApiConfig, "trustedClientIpHeader">): string {
  const header = config.trustedClientIpHeader;
  if (header) {
    const raw = firstHeader(request.headers[header]);
    const candidate = raw?.split(",").map((entry) => entry.trim()).filter(Boolean).at(-1);
    if (candidate && candidate.length <= 64 && isIP(candidate)) return normalizedIp(candidate);
  }
  return normalizedIp(request.ip);
}

function bearerSessionToken(request: FastifyRequest): string | null {
  const value = firstHeader(request.headers.authorization);
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return SESSION_TOKEN_SHAPE.test(token) ? token : null;
}

/**
 * Global rate-limit identity. The rate-limit hook runs before route auth, so
 * an authenticated caller is keyed by the peppered digest of its bearer token
 * (the same digest that identifies its session row) without a second DB
 * lookup. Anonymous callers, malformed tokens and IP-keyed routes fall back
 * to the client IP.
 */
export function rateLimitKey(
  request: FastifyRequest,
  config: Pick<ApiConfig, "trustedClientIpHeader" | "sessionTokenPepper">,
): string {
  const route = request.routeOptions?.url;
  const token = route && IP_KEYED_RATE_LIMIT_ROUTES.has(route) ? null : bearerSessionToken(request);
  if (token) {
    return `session:${createHmac("sha256", config.sessionTokenPepper).update(token).digest("hex").slice(0, 32)}`;
  }
  return `ip:${clientIpForRateLimit(request, config)}`;
}

/**
 * Non-reversible, pepper-bound short identifier of a rate-limit key for
 * server-side dedupe records. The raw IP or token digest is never stored.
 */
export function opaqueClientKey(key: string, pepper: string): string {
  return createHash("sha256").update(createHmac("sha256", pepper).update(`client-key:${key}`).digest()).digest("hex");
}
