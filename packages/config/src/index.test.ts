import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_PROXY_IDENTITY_HEADERS,
  loadAdminConfig,
  loadApiConfig,
  loadMigrationConfig,
  normalizeAdminClientIp,
  signAdminProxyIdentity,
  verifyAdminProxyIdentity,
} from "./index.js";

test("migration config uses its dedicated URL without requiring API secrets", () => {
  const config = loadMigrationConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://dabboba_runtime:runtime-secret@db.example.test/postgres",
    DATABASE_MIGRATION_URL:
      "postgresql://postgres.abcdefghijklmnopqrst:migration-secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  });

  assert.equal(config.environment, "production");
  assert.equal(
    config.databaseUrl,
    "postgresql://postgres.abcdefghijklmnopqrst:migration-secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  );
});

test("migration config allows the legacy URL only outside production", () => {
  assert.equal(loadMigrationConfig({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://local:secret@127.0.0.1:55433/dabboba",
  }).databaseUrl, "postgresql://local:secret@127.0.0.1:55433/dabboba");

  assert.equal(loadMigrationConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://ci:secret@127.0.0.1:5432/dabboba_ci",
  }).databaseUrl, "postgresql://ci:secret@127.0.0.1:5432/dabboba_ci");

  assert.throws(
    () => loadMigrationConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://runtime:must-not-leak@db.example.test/postgres",
      DATABASE_MIGRATION_URL: "   ",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DATABASE_MIGRATION_URL/);
      assert.doesNotMatch(error.message, /must-not-leak/);
      return true;
    },
  );
});

test("migration config rejects Supabase Transaction pooler URLs", () => {
  assert.throws(
    () => loadMigrationConfig({
      NODE_ENV: "production",
      DATABASE_MIGRATION_URL:
        "postgresql://postgres.project:secret@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres",
    }),
    /Session pooler.*5432.*Transaction mode.*6543/,
  );

  assert.doesNotThrow(() => loadMigrationConfig({
    NODE_ENV: "production",
    DATABASE_MIGRATION_URL:
      "postgresql://postgres.project:p%40ss%3Aword@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  }));
});

test("production migration config rejects non-Supabase targets", () => {
  for (const databaseUrl of [
    "postgresql://postgres:secret@localhost:5432/postgres",
    "postgresql://postgres:secret@db.example.test:5432/postgres",
  ]) {
    assert.throws(
      () => loadMigrationConfig({
        NODE_ENV: "production",
        DATABASE_MIGRATION_URL: databaseUrl,
      }),
      /approved Supabase hostname/,
    );
  }
});

test("API config accepts the isolated local DABBOBA services", () => {
  const config = loadApiConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "test-pepper",
  });
  assert.equal(config.surface, "all");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8788);
  assert.equal(config.redisUrl, "redis://test");
  assert.deepEqual(config.webOrigins, ["http://127.0.0.1:4174"]);
  assert.deepEqual(config.adminOrigins, ["http://127.0.0.1:4180"]);
  assert.equal(config.adminProxyIdentitySecret, null);
  assert.equal(config.supabaseUrl, null);
  assert.equal(config.supabaseJwtAudience, null);
});

test("an explicit LOCAL API tier rejects remote and query-overridden databases", () => {
  const base = {
    NODE_ENV: "development",
    DABBOBA_ENVIRONMENT_TIER: "LOCAL",
    SESSION_TOKEN_PEPPER: "local-test-pepper",
  };
  assert.throws(() => loadApiConfig({
    ...base,
    DATABASE_URL: "postgresql://dabboba_runtime:secret@db.example.test/dabboba",
  }), /loopback/);
  assert.throws(() => loadApiConfig({
    ...base,
    DATABASE_URL: "postgresql://dabboba_runtime:secret@127.0.0.1:55433/dabboba?host=db.example.test",
  }), /query parameters/);
});

test("production API config follows the Cloud Run port and defaults to the customer-only surface", () => {
  const config = loadApiConfig({
    NODE_ENV: "production",
    PORT: "8080",
    API_PORT: "8788",
    DATABASE_URL: "postgresql://dabboba_runtime:secret@db.example.test/postgres",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    SUPABASE_URL: "https://project.supabase.co",
    WEB_ORIGINS: "https://www.example.test",
  });

  assert.equal(config.surface, "customer");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(config.databasePoolMax, 5);
  assert.equal(config.redisUrl, null);
  assert.deepEqual(config.adminOrigins, []);
  assert.equal(config.adminProxyIdentitySecret, null);
  assert.equal(config.commerceMode, "PRELAUNCH");
});

test("commerce launch mode is explicit, fail-closed in production, and binds payment readiness", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://dabboba_runtime:secret@db.example.test/postgres",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    SUPABASE_URL: "https://project.supabase.co",
    WEB_ORIGINS: "https://www.example.test",
  };

  assert.equal(loadApiConfig(production).commerceMode, "PRELAUNCH");
  assert.throws(
    () => loadApiConfig({ ...production, DABBOBA_COMMERCE_MODE: "BETA" }),
    /DABBOBA_COMMERCE_MODE/,
  );
  assert.throws(
    () => loadApiConfig({ ...production, DABBOBA_COMMERCE_MODE: "LIVE" }),
    /LIVE requires a configured payment provider/,
  );
  assert.throws(
    () => loadApiConfig({
      ...production,
      DABBOBA_COMMERCE_MODE: "PRELAUNCH",
      PAYMENT_PROVIDER: "PORTONE_V2_INICIS",
      PAYMENT_WEBHOOK_SECRET: "normalized-payment-secret-unique-value",
      PORTONE_API_SECRET: "portone-api-secret-unique-value",
      PORTONE_MERCHANT_ID: "merchant-live",
      PORTONE_STORE_ID: "store-live",
      PORTONE_CHANNEL_KEY: "channel-live",
      PORTONE_CHANNEL_ENVIRONMENT: "LIVE",
      PORTONE_WEBHOOK_SECRET: "portone-webhook-secret-unique-value",
    }),
    /PRELAUNCH requires PAYMENT_PROVIDER=UNCONFIGURED/,
  );
});

test("API surfaces validate their names and require only surface-specific production auth", () => {
  const base = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://dabboba_runtime:secret@db.example.test/postgres",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
  };

  assert.throws(() => loadApiConfig({ ...base, API_SURFACE: "public" }), /API_SURFACE/);
  assert.throws(() => loadApiConfig({
    ...base,
    API_SURFACE: "admin",
    ADMIN_ORIGINS: "https://admin.example.test",
  }), /ADMIN_PROXY_IDENTITY_SECRET/);

  const admin = loadApiConfig({
    ...base,
    API_SURFACE: "admin",
    ADMIN_ORIGINS: "https://admin.example.test",
    ADMIN_PROXY_IDENTITY_SECRET: "admin-proxy-secret-that-is-long-and-production-only",
  });
  assert.equal(admin.surface, "admin");
  assert.deepEqual(admin.webOrigins, []);
  assert.equal(admin.supabaseUrl, null);
});

test("Supabase customer auth is optional and defaults to the authenticated audience", () => {
  const config = loadApiConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "test-pepper",
    SUPABASE_URL: "http://127.0.0.1:54321/",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_fixture_key",
    CUSTOMER_AUTH_ENABLED_PROVIDERS: "PHONE,KAKAO,NAVER,GOOGLE,APPLE",
    APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64url"),
    APPLE_TOKEN_ENCRYPTION_KEY_VERSION: "1",
  });
  assert.equal(config.supabaseUrl, "http://127.0.0.1:54321");
  assert.equal(config.supabaseJwtAudience, "authenticated");
  assert.equal(config.supabasePublishableKey, "sb_publishable_local_fixture_key");
  assert.deepEqual(config.customerLoginProviders, ["PHONE", "KAKAO", "NAVER", "GOOGLE", "APPLE"]);
  assert.equal(config.appleCredentialEncryption?.keyVersion, 1);
});

test("customer auth providers are explicit and fail closed", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    SESSION_TOKEN_PEPPER: "test-pepper",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_fixture_key",
  };
  assert.deepEqual(loadApiConfig(base).customerLoginProviders, []);
  assert.deepEqual(loadApiConfig({
    ...base,
    CUSTOMER_AUTH_ENABLED_PROVIDERS: "KAKAO,PHONE",
  }).customerLoginProviders, ["PHONE", "KAKAO"]);
  assert.throws(() => loadApiConfig({
    ...base,
    CUSTOMER_AUTH_ENABLED_PROVIDERS: "KAKAO,EMAIL",
  }), /CUSTOMER_AUTH_ENABLED_PROVIDERS/);
  assert.throws(() => loadApiConfig({
    ...base,
    SUPABASE_PUBLISHABLE_KEY: "",
    CUSTOMER_AUTH_ENABLED_PROVIDERS: "KAKAO",
  }), /requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY/);
  assert.throws(() => loadApiConfig({
    ...base,
    CUSTOMER_AUTH_ENABLED_PROVIDERS: "APPLE",
  }), /APPLE login requires encrypted token storage/);
});

test("Dukroom customer API is disabled by default and requires an explicit boolean flag", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    SESSION_TOKEN_PEPPER: "test-pepper",
  };
  assert.equal(loadApiConfig(base).communityEnabled, false);
  assert.equal(loadApiConfig({ ...base, DABBOBA_ENABLE_DUKROOM: "true" }).communityEnabled, true);
  assert.throws(
    () => loadApiConfig({ ...base, DABBOBA_ENABLE_DUKROOM: "yes" }),
    /DABBOBA_ENABLE_DUKROOM/,
  );
});

test("Supabase customer auth validates its URL, audience, and public-only key", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "test-pepper",
  };
  assert.throws(() => loadApiConfig({
    ...base,
    SUPABASE_JWT_AUDIENCE: "authenticated",
  }), /requires SUPABASE_URL/);
  assert.throws(() => loadApiConfig({
    ...base,
    SUPABASE_URL: "https://project.supabase.co/auth/v1",
  }), /without credentials, path, query, or fragment/);
  assert.throws(() => loadApiConfig({
    ...base,
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_JWT_AUDIENCE: "not valid with spaces",
  }), /1-128 character token/);
  assert.throws(() => loadApiConfig({
    ...base,
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_secret_must_not_reach_customer_auth",
  }), /public Supabase key/);
  assert.throws(() => loadApiConfig({
    ...base,
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "header.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
  }), /public Supabase key/);

  const config = loadApiConfig({
    ...base,
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_JWT_AUDIENCE: "dabboba-authenticated",
    SUPABASE_ANON_KEY: "legacy-anon-public-key-fixture",
  });
  assert.equal(config.supabaseUrl, "https://project.supabase.co");
  assert.equal(config.supabaseJwtAudience, "dabboba-authenticated");
  assert.equal(config.supabasePublishableKey, "legacy-anon-public-key-fixture");
  assert.equal("SUPABASE_SERVICE_ROLE_KEY" in config, false);
});

test("production Supabase customer auth requires HTTPS", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    ADMIN_PROXY_IDENTITY_SECRET: "admin-proxy-secret-that-is-long-and-production-only",
    WEB_ORIGINS: "https://www.example.test",
    ADMIN_ORIGINS: "https://admin.example.test",
  };
  assert.throws(() => loadApiConfig(production), /SUPABASE_URL is required/);
  assert.throws(() => loadApiConfig({
    ...production,
    SUPABASE_URL: "http://project.supabase.co",
  }), /HTTPS/);
  const config = loadApiConfig({
    ...production,
    SUPABASE_URL: "https://project.supabase.co",
  });
  assert.equal(config.supabaseUrl, "https://project.supabase.co");
});

test("production refuses insecure origins and development secrets", () => {
  assert.throws(() => loadApiConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "local-development-only-change-me",
    ADMIN_PROXY_IDENTITY_SECRET: "production-admin-proxy-secret-value",
    SUPABASE_URL: "https://project.supabase.co",
    WEB_ORIGINS: "http://example.test",
  }));
});

test("API origins reject credentials, paths, queries, fragments, and malformed values", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    SESSION_TOKEN_PEPPER: "test-pepper",
  };
  for (const origin of [
    "https://user:password@example.test",
    "https://example.test/api",
    "https://example.test?token=secret-query-value",
    "https://example.test#secret-fragment-value",
    "not-a-url-secret-value",
  ]) {
    assert.throws(
      () => loadApiConfig({ ...base, WEB_ORIGINS: origin }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /WEB_ORIGINS/);
        assert.doesNotMatch(error.message, /password|secret-query-value|secret-fragment-value|not-a-url-secret-value/);
        return true;
      },
    );
  }
});

test("API origins are normalized and deduplicated as origins", () => {
  const config = loadApiConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    SESSION_TOKEN_PEPPER: "test-pepper",
    WEB_ORIGINS: "HTTPS://EXAMPLE.TEST:443/, https://example.test",
  });
  assert.deepEqual(config.webOrigins, ["https://example.test"]);
});

test("catalog media base URL is optional and validated as a server-trusted API base", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test/db",
    SESSION_TOKEN_PEPPER: "test-pepper",
  };
  assert.equal(loadApiConfig(base).catalogMediaBaseUrl, null);
  assert.equal(loadApiConfig({
    ...base,
    DABBOBA_CATALOG_MEDIA_BASE_URL: "https://project.supabase.co/functions/v1/dabboba-api/",
  }).catalogMediaBaseUrl, "https://project.supabase.co/functions/v1/dabboba-api");
  assert.throws(() => loadApiConfig({
    ...base,
    DABBOBA_CATALOG_MEDIA_BASE_URL: "https://media-api.example.test/catalog?origin=untrusted",
  }), /DABBOBA_CATALOG_MEDIA_BASE_URL/);
  assert.throws(() => loadApiConfig({
    ...base,
    DABBOBA_CATALOG_MEDIA_BASE_URL: "https://media-api.example.test/functions/../admin",
  }), /DABBOBA_CATALOG_MEDIA_BASE_URL/);
  assert.throws(() => loadApiConfig({
    ...base,
    NODE_ENV: "production",
    API_SURFACE: "admin",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    ADMIN_PROXY_IDENTITY_SECRET: "admin-proxy-secret-that-is-long-and-production-only",
    ADMIN_EDGE_CLIENT_IP_HEADER: "CF-Connecting-IP",
    ADMIN_ORIGINS: "https://admin.example.test",
    DABBOBA_CATALOG_MEDIA_BASE_URL: "http://media-api.example.test",
  }), /DABBOBA_CATALOG_MEDIA_BASE_URL must use HTTPS/);
});

test("production API origins require HTTPS after URL parsing", () => {
  assert.throws(() => loadApiConfig({
    NODE_ENV: "production",
    API_SURFACE: "customer",
    DATABASE_URL: "postgresql://test/db",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    SUPABASE_URL: "https://project.supabase.co",
    WEB_ORIGINS: "http://www.example.test",
  }), /WEB_ORIGINS entries must use HTTPS/);
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

test("admin API base URLs allow safe Edge prefixes and never leak invalid values", () => {
  const prefixed = loadAdminConfig({
    NODE_ENV: "test",
    DABBOBA_API_URL: "https://project.supabase.co/functions/v1/dabboba-api/",
    NEXT_PUBLIC_DABBOBA_API_URL: "https://public-project.supabase.co/functions/v1/dabboba-api/",
  });
  assert.equal(prefixed.apiBaseUrl, "https://project.supabase.co/functions/v1/dabboba-api");
  assert.equal(prefixed.publicApiBaseUrl, "https://public-project.supabase.co/functions/v1/dabboba-api");

  const invalidValues = [
    "https://user:password@api.example.test",
    "https://api.example.test/functions/../admin",
    "https://api.example.test/functions/%2e%2e/admin",
    "https://api.example.test?token=secret-query-value",
    "https://api.example.test#secret-fragment-value",
    "not-a-url-secret-value",
  ];
  for (const value of invalidValues) {
    assert.throws(
      () => loadAdminConfig({ NODE_ENV: "test", DABBOBA_API_URL: value }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DABBOBA_API_URL/);
        assert.doesNotMatch(error.message, /password|secret-query-value|secret-fragment-value|not-a-url-secret-value/);
        return true;
      },
    );
  }

  assert.throws(() => loadAdminConfig({
    NODE_ENV: "test",
    DABBOBA_API_URL: "https://api.example.test",
    NEXT_PUBLIC_DABBOBA_API_URL: "https://public.example.test/v1?token=secret-query-value",
  }), /NEXT_PUBLIC_DABBOBA_API_URL/);

  assert.throws(
    () => loadAdminConfig({
      NODE_ENV: "production",
      DABBOBA_API_URL: "http://api.example.test",
      ADMIN_PROXY_IDENTITY_SECRET: "admin-proxy-secret-that-is-long-and-production-only",
      ADMIN_EDGE_CLIENT_IP_HEADER: "CF-Connecting-IP",
    }),
    /DABBOBA_API_URL must use HTTPS/,
  );
});

test("production requires a distinct admin proxy secret and explicit edge-overwritten IP header", () => {
  const productionApi = {
    NODE_ENV: "production",
    API_SURFACE: "all",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    SUPABASE_URL: "https://project.supabase.co",
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
    API_SURFACE: "all",
    DATABASE_URL: "postgresql://test/db",
    REDIS_URL: "redis://test",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    ADMIN_PROXY_IDENTITY_SECRET: "admin-proxy-secret-that-is-long-and-production-only",
    SUPABASE_URL: "https://project.supabase.co",
    WEB_ORIGINS: "https://www.example.test",
    ADMIN_ORIGINS: "https://admin.example.test",
  };
  const supabaseDemoApi = {
    ...productionApi,
    DABBOBA_COMMERCE_MODE: "LIVE",
    DABBOBA_BACKEND_PROFILE: "supabase-demo",
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    DABBOBA_RELEASE_ENVIRONMENT_TIER: "STAGING",
    DABBOBA_ENABLE_DEMO_TESTING: "true",
    DABBOBA_DEMO_FIXTURE_TAG: "supabase-demo-v1",
    API_HOST: "127.0.0.1",
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
    PAYMENT_WEBHOOK_SECRET: "payment-webhook-secret-that-is-long-and-production-only",
  }), /explicit loopback supabase-demo STAGING profile/);
  assert.throws(() => loadApiConfig({
    ...supabaseDemoApi,
    DABBOBA_RELEASE_ENVIRONMENT_TIER: "PRODUCTION",
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: "payment-webhook-secret-that-is-long-and-production-only",
  }), /explicit loopback supabase-demo STAGING profile/);
  assert.throws(() => loadApiConfig({
    ...supabaseDemoApi,
    API_HOST: "0.0.0.0",
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: "payment-webhook-secret-that-is-long-and-production-only",
  }), /explicit loopback supabase-demo STAGING profile/);

  assert.throws(() => loadApiConfig({
    ...supabaseDemoApi,
    PAYMENT_PROVIDER: "TEST_PG",
  }), /PAYMENT_WEBHOOK_SECRET/);
  assert.throws(() => loadApiConfig({
    ...supabaseDemoApi,
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: "too-short",
  }), /32-512 byte/);
  assert.throws(() => loadApiConfig({
    ...supabaseDemoApi,
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: productionApi.SESSION_TOKEN_PEPPER,
  }), /distinct/);
  assert.throws(() => loadApiConfig({
    ...supabaseDemoApi,
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: productionApi.ADMIN_PROXY_IDENTITY_SECRET,
  }), /distinct/);

  const config = loadApiConfig({
    ...supabaseDemoApi,
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: "payment-webhook-secret-that-is-long-and-production-only",
  });
  assert.equal(config.paymentProvider, "TEST_PG");
  assert.equal(config.paymentWebhookSecret, "payment-webhook-secret-that-is-long-and-production-only");
});

test("PortOne KG INICIS requires a complete environment-specific credential set", () => {
  const base = {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://test/db",
    SESSION_TOKEN_PEPPER: "portone-config-test-pepper",
    PAYMENT_PROVIDER: "PORTONE_V2_INICIS",
    PAYMENT_WEBHOOK_SECRET: "normalized-payment-secret-unique-value",
    PORTONE_API_SECRET: "portone-api-secret-unique-value",
    PORTONE_MERCHANT_ID: "merchant-test",
    PORTONE_STORE_ID: "store-test",
    PORTONE_CHANNEL_KEY: "channel-test",
    PORTONE_CHANNEL_ENVIRONMENT: "TEST",
    PORTONE_WEBHOOK_SECRET: "portone-webhook-secret-unique-value",
  };

  const config = loadApiConfig(base);
  assert.equal(config.paymentProvider, "PORTONE_V2_INICIS");
  assert.equal(config.paymentReconciliationWorkerSecret, null);
  const workerSecret = "separate-portone-worker-requery-secret";
  assert.equal(loadApiConfig({
    ...base, PAYMENT_RECONCILIATION_WORKER_SECRET: workerSecret,
  }).paymentReconciliationWorkerSecret, workerSecret);
  assert.throws(() => loadApiConfig({
    ...base, PAYMENT_RECONCILIATION_WORKER_SECRET: base.PAYMENT_WEBHOOK_SECRET,
  }), /distinct/);
  assert.throws(() => loadApiConfig({
    ...base, DABBOBA_COMMERCE_MODE: "PRELAUNCH", PAYMENT_RECONCILIATION_WORKER_SECRET: workerSecret,
  }), /requires LIVE PortOne/);
  assert.deepEqual(config.portOne, {
    apiSecret: base.PORTONE_API_SECRET,
    merchantId: base.PORTONE_MERCHANT_ID,
    storeId: base.PORTONE_STORE_ID,
    channelKey: base.PORTONE_CHANNEL_KEY,
    channelEnvironment: "TEST",
    webhookSecret: base.PORTONE_WEBHOOK_SECRET,
  });

  assert.throws(() => loadApiConfig({ ...base, PORTONE_API_SECRET: "" }), /configured together/);
  assert.throws(() => loadApiConfig({ ...base, PORTONE_CHANNEL_ENVIRONMENT: "SANDBOX" }), /LIVE or TEST/);
  assert.throws(() => loadApiConfig({
    ...base,
    PAYMENT_PROVIDER: "UNCONFIGURED",
    PAYMENT_WEBHOOK_SECRET: "",
  }), /require PAYMENT_PROVIDER/);
});

test("production LIVE PortOne refuses to start without the worker requery key", () => {
  const live = {
    NODE_ENV: "production", DABBOBA_COMMERCE_MODE: "LIVE",
    DATABASE_URL: "postgresql://dabboba_runtime:secret@db.example.test/postgres",
    SESSION_TOKEN_PEPPER: "session-pepper-that-is-long-and-production-only",
    SUPABASE_URL: "https://project.supabase.co", WEB_ORIGINS: "https://www.example.test",
    PAYMENT_PROVIDER: "PORTONE_V2_INICIS",
    PAYMENT_WEBHOOK_SECRET: "normalized-payment-secret-unique-value",
    PORTONE_API_SECRET: "portone-api-secret-unique-value",
    PORTONE_MERCHANT_ID: "merchant-live", PORTONE_STORE_ID: "store-live",
    PORTONE_CHANNEL_KEY: "channel-live", PORTONE_CHANNEL_ENVIRONMENT: "LIVE",
    PORTONE_WEBHOOK_SECRET: "portone-webhook-secret-unique-value",
  };
  assert.throws(() => loadApiConfig(live), /LIVE PortOne commerce requires PAYMENT_RECONCILIATION_WORKER_SECRET/);
  assert.equal(loadApiConfig({
    ...live, PAYMENT_RECONCILIATION_WORKER_SECRET: "distinct-portone-worker-secret-for-production",
  }).commerceMode, "LIVE");
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
