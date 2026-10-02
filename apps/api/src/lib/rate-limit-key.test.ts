import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { tokenDigest } from "../plugins/auth.js";
import { clientIpForRateLimit, opaqueClientKey, rateLimitKey } from "./rate-limit-key.js";

const pepper = "rate-limit-key-test-pepper";
const token = "A".repeat(43);

function request(input: { headers?: Record<string, string>; ip?: string; url?: string }): FastifyRequest {
  return {
    headers: input.headers ?? {},
    ip: input.ip ?? "192.0.2.10",
    routeOptions: { url: input.url ?? "/v1/catalog/products" },
  } as unknown as FastifyRequest;
}

test("session-shaped bearer tokens key the limiter by the peppered session digest", () => {
  const key = rateLimitKey(request({ headers: { authorization: `Bearer ${token}` } }), {
    sessionTokenPepper: pepper,
    trustedClientIpHeader: null,
  });
  assert.equal(key, `session:${tokenDigest(token, pepper).slice(0, 32)}`);
  assert.doesNotMatch(key, new RegExp(token));
});

test("anonymous, malformed-token, and login-exchange requests are keyed by client IP", () => {
  const config = { sessionTokenPepper: pepper, trustedClientIpHeader: null };
  assert.equal(rateLimitKey(request({}), config), "ip:192.0.2.10");
  assert.equal(rateLimitKey(request({ headers: { authorization: "Bearer short" } }), config), "ip:192.0.2.10");
  assert.equal(rateLimitKey(request({ headers: { authorization: `Basic ${token}` } }), config), "ip:192.0.2.10");
  for (const url of ["/v1/auth/exchange", "/v1/auth/account-deletion-exchange", "/v1/auth/payment-review"]) {
    assert.equal(
      rateLimitKey(request({ url, headers: { authorization: `Bearer ${token}` } }), config),
      "ip:192.0.2.10",
      url,
    );
  }
});

test("only the configured trusted header can replace the socket address", () => {
  const spoofed = request({
    headers: { "x-forwarded-for": "198.51.100.1", "cf-connecting-ip": "198.51.100.2" },
  });
  assert.equal(clientIpForRateLimit(spoofed, { trustedClientIpHeader: null }), "192.0.2.10");
  assert.equal(clientIpForRateLimit(spoofed, { trustedClientIpHeader: "cf-connecting-ip" }), "198.51.100.2");
  // Proxies append to forwarding chains, so only the right-most hop is trusted.
  const chained = request({ headers: { "x-forwarded-for": "203.0.113.99, 198.51.100.7" } });
  assert.equal(clientIpForRateLimit(chained, { trustedClientIpHeader: "x-forwarded-for" }), "198.51.100.7");
  const invalid = request({ headers: { "cf-connecting-ip": "not-an-ip" } });
  assert.equal(clientIpForRateLimit(invalid, { trustedClientIpHeader: "cf-connecting-ip" }), "192.0.2.10");
});

test("IPv6 callers share one /64 bucket", () => {
  const config = { trustedClientIpHeader: null };
  const first = clientIpForRateLimit(request({ ip: "2001:db8:1:2::1" }), config);
  const second = clientIpForRateLimit(request({ ip: "2001:db8:1:2:ffff::9" }), config);
  const other = clientIpForRateLimit(request({ ip: "2001:db8:1:3::1" }), config);
  assert.equal(first, second);
  assert.notEqual(first, other);
});

test("IPv4-mapped IPv6 callers share the ordinary IPv4 rate-limit bucket", () => {
  const config = { trustedClientIpHeader: null };
  assert.equal(clientIpForRateLimit(request({ ip: "::ffff:192.0.2.10" }), config), "192.0.2.10");
  assert.equal(clientIpForRateLimit(request({ ip: "::ffff:c000:20a" }), config), "192.0.2.10");
});

test("expanded and compressed IPv6 forms cannot create different rate-limit buckets", () => {
  const config = { trustedClientIpHeader: null };
  assert.equal(
    clientIpForRateLimit(request({ ip: "2001:0db8:0001:0002:0000:0000:0000:0001" }), config),
    "2001:db8:1:2::",
  );
  assert.equal(clientIpForRateLimit(request({ ip: "2001:db8:1:2::abcd" }), config), "2001:db8:1:2::");
});

test("oversized or invalid trusted client-IP values fall back to the socket address", () => {
  const config = { trustedClientIpHeader: "cf-connecting-ip" };
  for (const candidate of ["!".repeat(512), "2001:db8::invalid", "203.0.113.1:443"]) {
    assert.equal(
      clientIpForRateLimit(request({ headers: { "cf-connecting-ip": candidate } }), config),
      "192.0.2.10",
    );
  }
});

test("opaque client keys are pepper-bound and never contain the raw key", () => {
  const key = opaqueClientKey("ip:192.0.2.10", pepper);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(opaqueClientKey("ip:192.0.2.10", pepper), key);
  assert.notEqual(opaqueClientKey("ip:192.0.2.10", `${pepper}-2`), key);
  assert.doesNotMatch(key, /192/);
});
