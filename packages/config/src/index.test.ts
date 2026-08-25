import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_PROXY_IDENTITY_HEADERS,
  loadAdminConfig,
  loadApiConfig,
  normalizeAdminClientIp,
  signAdminProxyIdentity,
  verifyAdminProxyIdentity,
} from "./index.js";

test("API config accepts the isolated local DABBOBA services", () => {
  const config = loadApiConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "test-pepper",
  });
  assert.equal(config.port, 8788);
  assert.deepEqual(config.webOrigins, ["http://127.0.0.1:4174"]);
  assert.deepEqual(config.adminOrigins, ["http://127.0.0.1:4180"]);
  assert.equal(config.adminProxyIdentitySecret, null);
});

test("production refuses insecure origins and development secrets", () => {
  assert.throws(() => loadApiConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "local-development-only-change-me",
    ADMIN_PROXY_IDENTITY_SECRET: "production-admin-proxy-secret-value",
    WEB_ORIGINS: "http://example.test",
  }));
});

test("admin config keeps API access server configurable", () => {
  const config = loadAdminConfig({
    NODE_ENV: "test",
    DABBOBA_API_URL: "http://127.0.0.1:8788/",
  });
  assert.equal(config.apiBaseUrl, "http://127.0.0.1:8788");
  assert.equal(config.sessionCookieName, "dabboba_admin_session");
  assert.equal(config.adminProxyIdentitySecret, null);
  assert.equal(config.adminEdgeClientIpHeader, null);
});

test("production requires a distinct admin proxy secret and explicit edge-overwritten IP header", () => {
  const productionApi = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    WEB_ORIGINS: "https://www.example.test",
    ADMIN_ORIGINS: "https://admin.example.test",
  };
  assert.throws(() => loadApiConfig(productionApi), /ADMIN_PROXY_IDENTITY_SECRET/);
  assert.throws(() => loadApiConfig({
    ...productionApi,
    ADMIN_PROXY_IDENTITY_SECRET: "too-short",
  }), /32-512 byte/);
  assert.throws(() => loadApiConfig({
    ...productionApi,
    ADMIN_PROXY_IDENTITY_SECRET: productionApi.SESSION_TOKEN_PEPPER,
  }), /distinct/);

  const productionAdmin = {
    NODE_ENV: "production",
    DABBOBA_API_URL: "https://api.example.test",
    ADMIN_PROXY_IDENTITY_SECRET: "admin-proxy-secret-that-is-long-and-production-only",
  };
  assert.throws(() => loadAdminConfig(productionAdmin), /ADMIN_EDGE_CLIENT_IP_HEADER/);
  assert.throws(() => loadAdminConfig({
    ...productionAdmin,
    ADMIN_EDGE_CLIENT_IP_HEADER: ADMIN_PROXY_IDENTITY_HEADERS.ipAddress,
  }), /dedicated/);
  assert.throws(() => loadAdminConfig({
    ...productionAdmin,
    ADMIN_EDGE_CLIENT_IP_HEADER: "X-Forwarded-For",
  }), /dedicated/);

  const config = loadAdminConfig({
    ...productionAdmin,
    ADMIN_EDGE_CLIENT_IP_HEADER: "CF-Connecting-IP",
  });
  assert.equal(config.adminEdgeClientIpHeader, "cf-connecting-ip");
});

test("production requires a strong dedicated payment webhook secret when a provider is configured", () => {
  const productionApi = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    ADMIN_PROXY_IDENTITY_SECRET: "admin-proxy-secret-that-is-long-and-production-only",
    WEB_ORIGINS: "https://www.example.test",
    ADMIN_ORIGINS: "https://admin.example.test",
  };

  const paymentsDisabled = loadApiConfig({
    ...productionApi,
    PAYMENT_PROVIDER: "UNCONFIGURED",
  });
  assert.equal(paymentsDisabled.paymentWebhookSecret, null);
  assert.throws(() => loadApiConfig({
    ...productionApi,
    PAYMENT_PROVIDER: "UNCONFIGURED",
    PAYMENT_WEBHOOK_SECRET: "unused-webhook-secret-that-must-not-stay-enabled",
  }), /must be unset/);
  assert.throws(() => loadApiConfig({
    ...productionApi,
    PAYMENT_PROVIDER: "INTERNAL_ZERO",
    PAYMENT_WEBHOOK_SECRET: "payment-webhook-secret-that-is-long-and-production-only",
  }), /reserved INTERNAL_ZERO/);

  assert.throws(() => loadApiConfig({
    ...productionApi,
    PAYMENT_PROVIDER: "TEST_PG",
  }), /PAYMENT_WEBHOOK_SECRET/);
  assert.throws(() => loadApiConfig({
    ...productionApi,
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: "too-short",
  }), /32-512 byte/);
  assert.throws(() => loadApiConfig({
    ...productionApi,
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: productionApi.SESSION_TOKEN_PEPPER,
  }), /distinct/);
  assert.throws(() => loadApiConfig({
    ...productionApi,
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: productionApi.ADMIN_PROXY_IDENTITY_SECRET,
  }), /distinct/);

  const config = loadApiConfig({
    ...productionApi,
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: "payment-webhook-secret-that-is-long-and-production-only",
  });
  assert.equal(config.paymentProvider, "TEST_PG");
  assert.equal(config.paymentWebhookSecret, "payment-webhook-secret-that-is-long-and-production-only");
});

test("signed admin proxy identity normalizes addresses and rejects tampering or stale timestamps", () => {
  const nowMs = 1_787_500_000_000;
  const secret = "focused-admin-proxy-signature-test-secret";
  const headers = signAdminProxyIdentity({
    secret,
    ipAddress: "2001:0DB8:0:0:0:0:0:1",
    userAgent: "  DABBOBA\t관리자\n브라우저  ",
    nowMs,
  });
  const readHeader = (name: string) => headers[name];
  assert.equal(normalizeAdminClientIp("::ffff:192.0.2.1"), "::ffff:c000:201");
  assert.deepEqual(verifyAdminProxyIdentity({ secret, readHeader, nowMs }), {
    ipAddress: "2001:db8::1",
    userAgent: "DABBOBA 관리자 브라우저",
    issuedAt: Math.floor(nowMs / 1_000),
  });

  const tampered: Record<string, string> = { ...headers, [ADMIN_PROXY_IDENTITY_HEADERS.ipAddress]: "203.0.113.9" };
  assert.equal(verifyAdminProxyIdentity({ secret, readHeader: (name) => tampered[name], nowMs }), null);
  assert.equal(verifyAdminProxyIdentity({ secret, readHeader, nowMs: nowMs + 61_000 }), null);
  assert.equal(verifyAdminProxyIdentity({
    secret,
    readHeader: (name) => name === ADMIN_PROXY_IDENTITY_HEADERS.signature ? [headers[name]!] : headers[name],
    nowMs,
  }), null);

  const withoutUserAgent = signAdminProxyIdentity({ secret, ipAddress: "192.0.2.9", nowMs });
  assert.equal(withoutUserAgent[ADMIN_PROXY_IDENTITY_HEADERS.userAgent], "-");
  assert.equal(verifyAdminProxyIdentity({
    secret,
    readHeader: (name) => withoutUserAgent[name],
    nowMs,
  })?.userAgent, null);
});
