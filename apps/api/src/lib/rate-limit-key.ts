import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
  "/v1/auth/store-review",
  "/v1/auth/account-deletion-exchange",
]);

const PAYMENT_REVIEW_ROUTE = "/v1/auth/payment-review";
/** Headers the public review site worker adds to its login proxy request. */
export const PAYMENT_REVIEW_CLIENT_IP_HEADERS = Object.freeze({
  ip: "x-dabboba-review-client-ip",
  time: "x-dabboba-review-client-ip-time",
  signature: "x-dabboba-review-client-ip-signature",
});
const PAYMENT_REVIEW_CLIENT_IP_CONTEXT = "dabboba-review-client-ip:v1";
const PAYMENT_REVIEW_CLIENT_IP_SKEW_SECONDS = 60;

export function paymentReviewClientIpSignature(secret: string, time: string, ip: string): string {
  return createHmac("sha256", secret).update(`${PAYMENT_REVIEW_CLIENT_IP_CONTEXT}\n${time}\n${ip}`).digest("hex");
}

/**
 * Visitor IP observed by the review site worker, accepted only with a fresh
 * HMAC from the dedicated shared secret. Every request reaches the API from the
 * worker's egress address, so without this all reviewers share one login
 * bucket and anyone could lock them out with wrong passwords.
 */
export function signedPaymentReviewClientIp(
  request: FastifyRequest,
  secret: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!secret) return null;
  const ip = firstHeader(request.headers[PAYMENT_REVIEW_CLIENT_IP_HEADERS.ip])?.trim();
  const time = firstHeader(request.headers[PAYMENT_REVIEW_CLIENT_IP_HEADERS.time])?.trim();
  const signature = firstHeader(request.headers[PAYMENT_REVIEW_CLIENT_IP_HEADERS.signature])?.trim();
  if (!ip || !time || !signature || ip.length > 64 || !isIP(ip)
    || !/^\d{1,12}$/.test(time) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  if (Math.abs(Math.floor(nowMs / 1_000) - Number(time)) > PAYMENT_REVIEW_CLIENT_IP_SKEW_SECONDS) return null;
  const expected = Buffer.from(paymentReviewClientIpSignature(secret, time, ip), "hex");
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected) ? normalizedIp(ip) : null;
}

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
  config: Pick<ApiConfig, "trustedClientIpHeader" | "sessionTokenPepper" | "paymentReviewProxySecret">,
): string {
  const route = request.routeOptions?.url;
  if (route === PAYMENT_REVIEW_ROUTE) {
    const reviewer = signedPaymentReviewClientIp(request, config.paymentReviewProxySecret);
    if (reviewer) return `ip:${reviewer}`;
  }
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
