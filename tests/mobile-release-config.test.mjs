import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PG_REVIEW_PUBLIC_BUILD_VARIABLES,
  REQUIRED_PUBLIC_BUILD_VARIABLES,
  inspectMobileReleaseConfig,
} from "../scripts/check-mobile-release-config.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const productionPublicEnvironment = {
  DABBOBA_COMMERCE_MODE: "LIVE",
  PAYMENT_PROVIDER: "PORTONE_V2_INICIS",
  PORTONE_CHANNEL_ENVIRONMENT: "LIVE",
  EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE",
  EXPO_PUBLIC_DABBOBA_API_URL: "https://api.dabboba.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://dabbobaproduction.supabase.co",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_release_validation_only",
  EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL: "https://dabboba.com/privacy",
  EXPO_PUBLIC_DABBOBA_TERMS_URL: "https://dabboba.com/terms",
  EXPO_PUBLIC_DABBOBA_SUPPORT_URL: "https://dabboba.com/support",
  EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL: "https://dabboba.com/account-deletion",
  EXPO_PUBLIC_PORTONE_STORE_ID: "store-dabboba-production",
  EXPO_PUBLIC_PORTONE_CHANNEL_KEY: "channel-key-dabboba-production",
};

test("mobile release structure is store-shaped without external credentials", () => {
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: {},
    structureOnly: true,
  });

  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.some((issue) => issue.code === "ANDROID_ADAPTIVE_ICON_REQUIRED"), false);
  assert.equal(report.warnings.some((issue) => issue.code === "PG_REVIEW_BUSINESS_PHONE_MOBILE"), true);
  assert.equal(report.errors.some((issue) => issue.code === "IOS_APPLE_SIGN_IN_CAPABILITY_MISSING"), false);
  assert.equal(report.errors.some((issue) => issue.code === "EAS_PG_REVIEW_PROFILE_INVALID"), false);
});

test("mobile release CLI accepts the package-manager argument separator", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(rootDir, "scripts/check-mobile-release-config.mjs"), "--", "--structure-only"],
    { cwd: rootDir, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Mobile release structure check passed/);
});

test("production mobile release gate fails closed when public endpoints are absent", () => {
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: {},
  });
  const codes = new Set(report.errors.map((issue) => issue.code));

  for (const variable of REQUIRED_PUBLIC_BUILD_VARIABLES) {
    assert.ok(codes.has(`ENV_${variable}_MISSING`), `${variable} must be required`);
  }
  assert.ok(codes.has("MOBILE_COMMERCE_MODE_INVALID"));
  assert.ok(codes.has("PORTONE_LIVE_CHANNEL_REQUIRED"));
  assert.ok(codes.has("SERVER_COMMERCE_LIVE_REQUIRED"));
  assert.ok(codes.has("MOBILE_COMMERCE_LIVE_REQUIRED"));
  assert.ok(codes.has("PG_REVIEW_BUSINESS_PHONE_MOBILE"));
  assert.equal(codes.has("PAYMENT_CONNECTION_PLACEHOLDER_PRESENT"), false);
  assert.equal(codes.has("CHECKOUT_PAYMENT_PLACEHOLDER_PRESENT"), false);
});

test("PG-review gate requires payment client values without requiring public legal URLs", () => {
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: {
      EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE",
      EXPO_PUBLIC_DABBOBA_API_URL: "https://api-review.dabboba.com",
      EXPO_PUBLIC_SUPABASE_URL: "https://dabbobareview.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_pg_review_validation",
      EXPO_PUBLIC_PORTONE_STORE_ID: "store-dabboba-review",
      EXPO_PUBLIC_PORTONE_CHANNEL_KEY: "channel-key-dabboba-review",
    },
    pgReview: true,
  });
  const codes = new Set(report.errors.map((issue) => issue.code));

  for (const variable of PG_REVIEW_PUBLIC_BUILD_VARIABLES) {
    assert.equal(codes.has(`ENV_${variable}_MISSING`), false, `${variable} should be accepted`);
  }
  for (const variable of [
    "EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL",
    "EXPO_PUBLIC_DABBOBA_TERMS_URL",
    "EXPO_PUBLIC_DABBOBA_SUPPORT_URL",
    "EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL",
  ]) {
    assert.equal(codes.has(`ENV_${variable}_MISSING`), false, `${variable} is not a PG capture prerequisite`);
  }
  assert.equal(codes.has("LIVE_LEGAL_DOCUMENTS_PRELAUNCH_COPY"), false);
  assert.equal(codes.has("CHECKOUT_PAYMENT_PLACEHOLDER_PRESENT"), false);
  assert.equal(codes.has("PG_REVIEW_BUSINESS_PHONE_MOBILE"), true);
});

test("PG-review gate fails closed when PortOne client identifiers are absent", () => {
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: {
      EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE",
      EXPO_PUBLIC_DABBOBA_API_URL: "https://api-review.dabboba.com",
      EXPO_PUBLIC_SUPABASE_URL: "https://dabbobareview.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_pg_review_validation",
    },
    pgReview: true,
  });
  const codes = new Set(report.errors.map((issue) => issue.code));

  assert.ok(codes.has("ENV_EXPO_PUBLIC_PORTONE_STORE_ID_MISSING"));
  assert.ok(codes.has("ENV_EXPO_PUBLIC_PORTONE_CHANNEL_KEY_MISSING"));
});

test("production mobile release gate accepts a payment-disabled public prelaunch", () => {
  const { EXPO_PUBLIC_PORTONE_STORE_ID: _storeId, EXPO_PUBLIC_PORTONE_CHANNEL_KEY: _channelKey, ...base } = productionPublicEnvironment;
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: {
      ...base,
      DABBOBA_COMMERCE_MODE: "PRELAUNCH",
      PAYMENT_PROVIDER: "UNCONFIGURED",
      EXPO_PUBLIC_COMMERCE_CAPABILITY: "PRELAUNCH",
    },
  });
  const codes = new Set(report.errors.map((issue) => issue.code));

  assert.equal(codes.has("SERVER_COMMERCE_PRELAUNCH_REQUIRED"), false);
  assert.equal(codes.has("PRELAUNCH_PAYMENT_PROVIDER_MUST_BE_UNCONFIGURED"), false);
  assert.equal(codes.has("ENV_EXPO_PUBLIC_PORTONE_STORE_ID_MISSING"), false);
  assert.equal(codes.has("ENV_EXPO_PUBLIC_PORTONE_CHANNEL_KEY_MISSING"), false);
});

test("production mobile release gate accepts the wired PortOne boundary but blocks stale prelaunch legal copy", () => {
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: productionPublicEnvironment,
  });
  const codes = new Set(report.errors.map((issue) => issue.code));

  assert.equal(codes.has("PAYMENT_CONNECTION_PLACEHOLDER_PRESENT"), false);
  assert.equal(codes.has("CHECKOUT_PAYMENT_PLACEHOLDER_PRESENT"), false);
  assert.equal(codes.has("ANDROID_ADAPTIVE_ICON_REQUIRED"), false);
  assert.equal(codes.has("PAYMENT_PROVIDER_NOT_READY"), false);
  assert.equal(codes.has("PORTONE_LIVE_CHANNEL_REQUIRED"), false);
  assert.equal(codes.has("SERVER_COMMERCE_LIVE_REQUIRED"), false);
  assert.equal(codes.has("MOBILE_COMMERCE_LIVE_REQUIRED"), false);
  assert.equal(codes.has("LIVE_LEGAL_DOCUMENTS_PRELAUNCH_COPY"), true);
});

test("production mobile release gate rejects local URLs and privileged Supabase keys", () => {
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: {
      ...productionPublicEnvironment,
      PAYMENT_PROVIDER: "UNCONFIGURED",
      EXPO_PUBLIC_DABBOBA_API_URL: "http://127.0.0.1:8788",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_must_never_ship_to_a_customer_app",
    },
  });
  const codes = new Set(report.errors.map((issue) => issue.code));

  assert.ok(codes.has("ENV_EXPO_PUBLIC_DABBOBA_API_URL_INVALID"));
  assert.ok(codes.has("ENV_EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY_PRIVILEGED"));
  assert.ok(codes.has("PAYMENT_PROVIDER_NOT_READY"));
});
