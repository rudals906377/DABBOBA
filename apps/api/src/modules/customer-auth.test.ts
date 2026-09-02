import assert from "node:assert/strict";
import test from "node:test";
import { customerLoginProviderDiscovery } from "./customer-auth.js";

test("customer auth discovery always exposes the approved methods and reports broker readiness", () => {
  assert.deepEqual(customerLoginProviderDiscovery(null), {
    methods: ["KAKAO", "NAVER", "PHONE"],
    brokerExchangeConfigured: false,
  });
  assert.deepEqual(customerLoginProviderDiscovery("https://project.supabase.co"), {
    methods: ["KAKAO", "NAVER", "PHONE"],
    brokerExchangeConfigured: true,
  });
});
