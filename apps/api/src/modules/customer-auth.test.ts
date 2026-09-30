import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../lib/errors.js";
import { customerLoginProviderDiscovery, requiredPolicyAcceptance } from "./customer-auth.js";

test("customer auth discovery exposes the five approved methods only when live broker verification is configured", () => {
  assert.deepEqual(customerLoginProviderDiscovery(null, null), {
    methods: [],
    brokerExchangeConfigured: false,
    requiredPolicyVersions: { terms: "2026-09-30", privacy: "2026-09-30" },
  });
  assert.deepEqual(customerLoginProviderDiscovery("https://project.supabase.co", null, ["KAKAO"]), {
    methods: [],
    brokerExchangeConfigured: false,
    requiredPolicyVersions: { terms: "2026-09-30", privacy: "2026-09-30" },
  });
  assert.deepEqual(customerLoginProviderDiscovery(
    "https://project.supabase.co",
    "sb_publishable_fixture_key",
    ["PHONE", "KAKAO"],
  ), {
    methods: ["PHONE", "KAKAO"],
    brokerExchangeConfigured: true,
    requiredPolicyVersions: { terms: "2026-09-30", privacy: "2026-09-30" },
  });
});

test("customer auth rejects absent or stale legal acceptance with exact current versions", () => {
  const required = { terms: "2026-09-22", privacy: "2026-09-22" };
  for (const input of [
    {},
    { acceptedPolicies: { terms: "2026-09-22", privacy: "2026-09-21" } },
  ]) {
    assert.throws(
      () => requiredPolicyAcceptance(input, required),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 428
        && error.code === "LEGAL_ACCEPTANCE_REQUIRED"
        && JSON.stringify(error.details) === JSON.stringify({ requiredPolicyVersions: required }),
    );
  }
  assert.deepEqual(requiredPolicyAcceptance({ acceptedPolicies: required }, required), required);
});
