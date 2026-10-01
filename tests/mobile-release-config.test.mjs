import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PG_REVIEW_PUBLIC_BUILD_VARIABLES,
  REQUIRED_PUBLIC_BUILD_VARIABLES,
  inspectMobileReleaseConfig,
  representativePhoneMustBeLandline,
  validateCardReviewBusinessPhone,
} from "../scripts/check-mobile-release-config.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("iOS release configuration targets the verified friend-owned Apple team", () => {
  const appConfig = JSON.parse(readFileSync(path.join(rootDir, "apps/mobile/app.json"), "utf8"));

  assert.equal(appConfig.expo.ios.appleTeamId, "MCZ4884P7F");
});

test("Apple sign-in declares the native entitlement without relying on an absent config plugin", () => {
  const appConfig = JSON.parse(readFileSync(path.join(rootDir, "apps/mobile/app.json"), "utf8"));

  assert.deepEqual(appConfig.expo.ios.entitlements?.["com.apple.developer.applesignin"], ["Default"]);
});

test("release gate rejects a missing or malformed native Apple sign-in entitlement", () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "dabboba-apple-entitlement-"));
  try {
    mkdirSync(path.join(fixtureRoot, "apps/mobile"), { recursive: true });
    symlinkSync(path.join(rootDir, "apps/mobile/src"), path.join(fixtureRoot, "apps/mobile/src"), "dir");
    const appConfig = JSON.parse(readFileSync(path.join(rootDir, "apps/mobile/app.json"), "utf8"));
    for (const entitlement of [undefined, [], "Default", ["Unexpected"], ["Default", "Unexpected"]]) {
      appConfig.expo.ios.entitlements = { "com.apple.developer.applesignin": entitlement };
      writeFileSync(path.join(fixtureRoot, "apps/mobile/app.json"), JSON.stringify(appConfig));
      const report = inspectMobileReleaseConfig({ rootDir: fixtureRoot, environment: {}, structureOnly: true });
      assert.ok(report.errors.some((issue) => issue.code === "IOS_APPLE_SIGN_IN_ENTITLEMENT_MISSING"));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

const productionPublicEnvironment = {
  DABBOBA_COMMERCE_MODE: "LIVE",
  PAYMENT_PROVIDER: "PORTONE_V2_INICIS",
  PORTONE_CHANNEL_ENVIRONMENT: "LIVE",
  EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE",
  EXPO_PUBLIC_DABBOBA_API_URL: "https://api.dabboba.net",
  EXPO_PUBLIC_SUPABASE_URL: "https://dabbobaproduction.supabase.co",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_release_validation_only",
  EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL: "https://dabboba.net/privacy",
  EXPO_PUBLIC_DABBOBA_TERMS_URL: "https://dabboba.net/terms",
  EXPO_PUBLIC_DABBOBA_SUPPORT_URL: "https://dabboba.net/support",
  EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL: "https://dabboba.net/account-deletion",
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
  assert.equal(report.warnings.some((issue) => issue.code === "PG_REVIEW_BUSINESS_PHONE_MOBILE"), false);
  assert.equal(report.errors.some((issue) => issue.code === "IOS_APPLE_SIGN_IN_CAPABILITY_MISSING"), false);
  assert.equal(report.errors.some((issue) => issue.code === "IOS_RELEASE_TEAM_MISMATCH"), false);
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
  assert.equal(codes.has("PG_REVIEW_BUSINESS_PHONE_MOBILE"), false);
  assert.equal(codes.has("PAYMENT_CONNECTION_PLACEHOLDER_PRESENT"), false);
  assert.equal(codes.has("CHECKOUT_PAYMENT_PLACEHOLDER_PRESENT"), false);
});

test("PG-review gate requires payment client values without requiring public legal URLs", () => {
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: {
      EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE",
      EXPO_PUBLIC_DABBOBA_API_URL: "https://api-review.dabboba.net",
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
  assert.equal(codes.has("PG_REVIEW_BUSINESS_PHONE_MOBILE"), false);
});

test("PG-review gate fails closed when PortOne client identifiers are absent", () => {
  const report = inspectMobileReleaseConfig({
    rootDir,
    environment: {
      EXPO_PUBLIC_COMMERCE_CAPABILITY: "LIVE",
      EXPO_PUBLIC_DABBOBA_API_URL: "https://api-review.dabboba.net",
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
  assert.equal(codes.has("PG_REVIEW_BUSINESS_PHONE_MOBILE"), false);
  assert.equal(
    report.warnings.some((issue) => issue.code === "PG_REVIEW_BUSINESS_PHONE_MOBILE"),
    false,
  );
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
  assert.equal(codes.has("PG_REVIEW_BUSINESS_PHONE_MOBILE"), false);
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

function businessPhoneFixture({ appPhone = "031-947-9996", termsPhone = "031-947-9996", privacyPhone = "031-947-9996", omit = [] } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "dabboba-business-phone-"));
  const write = (relativePath, source) => {
    if (omit.includes(relativePath)) return;
    mkdirSync(path.dirname(path.join(directory, relativePath)), { recursive: true });
    writeFileSync(path.join(directory, relativePath), source);
  };
  const link = (phone) => `<a href="tel:${phone.replace(/\D/g, "")}">${phone}</a>`;
  write(
    "apps/mobile/src/features/profile/business-information.ts",
    `export const BUSINESS = { representativePhone: "${appPhone}" };\n`,
  );
  write("public/legal/terms/index.html", `<p>대표전화 ${link(termsPhone)}</p>`);
  write("public/legal/privacy/index.html", `<p>전화 ${link(privacyPhone)}</p>`);
  return directory;
}

function businessPhoneIssues(options) {
  const directory = businessPhoneFixture(options);
  const errors = [];
  const warnings = [];
  try {
    validateCardReviewBusinessPhone(directory, errors, warnings, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return { errors: errors.map((issue) => issue.code), warnings: warnings.map((issue) => issue.code) };
}

test("a mobile representative number blocks every full release check, PRELAUNCH store builds included", () => {
  assert.equal(representativePhoneMustBeLandline({ structureOnly: false }), true);
  assert.equal(representativePhoneMustBeLandline({ pgReview: true }), true);
  assert.equal(representativePhoneMustBeLandline({ structureOnly: true }), false);
  const { errors, warnings } = businessPhoneIssues({
    appPhone: "010-6374-4900",
    termsPhone: "010-6374-4900",
    privacyPhone: "010-6374-4900",
  });
  assert.deepEqual(errors, ["PG_REVIEW_BUSINESS_PHONE_MOBILE"]);
  assert.deepEqual(warnings, []);
});

test("business phone gate accepts matching app and public legal phones", () => {
  assert.deepEqual(businessPhoneIssues(), { errors: [], warnings: [] });
});

test("business phone gate fails when the public terms phone differs from the app", () => {
  const { errors } = businessPhoneIssues({ termsPhone: "010-6374-4900" });
  assert.deepEqual(errors, ["LEGAL_BUSINESS_PHONE_MISMATCH"]);
});

test("business phone gate fails when the public privacy phone differs from the app", () => {
  const { errors } = businessPhoneIssues({ privacyPhone: "031-947-9997" });
  assert.deepEqual(errors, ["LEGAL_BUSINESS_PHONE_MISMATCH"]);
});

test("business phone gate fails when a legal document omits the phone or is missing", () => {
  const directory = businessPhoneFixture();
  const errors = [];
  try {
    writeFileSync(path.join(directory, "public/legal/privacy/index.html"), "<p>문의 support@dabboba.net</p>");
    validateCardReviewBusinessPhone(directory, errors, [], true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.deepEqual(errors.map((issue) => issue.code), ["LEGAL_BUSINESS_PHONE_MISMATCH"]);
  assert.deepEqual(
    businessPhoneIssues({ omit: ["public/legal/terms/index.html"] }).errors,
    ["LEGAL_BUSINESS_PHONE_DOCUMENT_MISSING"],
  );
});

test("business phone gate compares the published documents with the current app constant", () => {
  const { errors } = businessPhoneIssues({ appPhone: "02-000-0000" });
  assert.deepEqual(errors, ["LEGAL_BUSINESS_PHONE_MISMATCH", "LEGAL_BUSINESS_PHONE_MISMATCH"]);
});

test("production mobile builds pin the customer API host to the approved backend", async () => {
  const { APPROVED_PRODUCTION_API_HOSTS, isApprovedProductionApiUrl } = await import(
    "../scripts/check-mobile-release-config.mjs"
  );
  const { SUPABASE_INTEGRATION_PROJECT_REF } = await import("../scripts/supabase-integration-profile.mjs");
  assert.ok(APPROVED_PRODUCTION_API_HOSTS.includes(`${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co`));
  assert.ok(APPROVED_PRODUCTION_API_HOSTS.includes("api.dabboba.net"));

  for (const approved of [
    "https://api.dabboba.net",
    `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`,
  ]) {
    assert.equal(isApprovedProductionApiUrl(approved), true, approved);
    for (const capability of ["LIVE", "PRELAUNCH"]) {
      const report = inspectMobileReleaseConfig({
        rootDir,
        environment: {
          ...productionPublicEnvironment,
          EXPO_PUBLIC_COMMERCE_CAPABILITY: capability,
          EXPO_PUBLIC_DABBOBA_API_URL: approved,
        },
      });
      assert.equal(
        report.errors.some((issue) => issue.code === "ENV_EXPO_PUBLIC_DABBOBA_API_URL_HOST_NOT_APPROVED"),
        false,
        `${capability} ${approved}`,
      );
    }
  }

  for (const rejected of [
    "https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api",
    "https://api-review.dabboba.net",
    "https://api.dabboba.net.attacker.example",
    `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co.evil.net`,
    "https://api.dabboba.net:8443",
  ]) {
    assert.equal(isApprovedProductionApiUrl(rejected), false, rejected);
    for (const capability of ["LIVE", "PRELAUNCH"]) {
      const report = inspectMobileReleaseConfig({
        rootDir,
        environment: {
          ...productionPublicEnvironment,
          EXPO_PUBLIC_COMMERCE_CAPABILITY: capability,
          EXPO_PUBLIC_DABBOBA_API_URL: rejected,
        },
      });
      assert.ok(
        report.errors.some((issue) => issue.code === "ENV_EXPO_PUBLIC_DABBOBA_API_URL_HOST_NOT_APPROVED"),
        `${capability} must reject ${rejected}`,
      );
    }
  }

  const structureOnly = inspectMobileReleaseConfig({
    rootDir,
    environment: { EXPO_PUBLIC_DABBOBA_API_URL: "https://api-review.dabboba.net" },
    structureOnly: true,
  });
  assert.equal(
    structureOnly.errors.some((issue) => issue.code === "ENV_EXPO_PUBLIC_DABBOBA_API_URL_HOST_NOT_APPROVED"),
    false,
  );
});
