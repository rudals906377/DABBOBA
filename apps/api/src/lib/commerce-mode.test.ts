import assert from "node:assert/strict";
import test from "node:test";
import { assertLiveCommerce, effectiveCommerceMode } from "./commerce-mode.js";

test("production commerce mode fails closed while legacy non-production fixtures stay live", () => {
  assert.equal(effectiveCommerceMode({ environment: "production" }), "PRELAUNCH");
  assert.equal(effectiveCommerceMode({ environment: "test" }), "LIVE");
  assert.equal(effectiveCommerceMode({ environment: "production", commerceMode: "LIVE" }), "LIVE");
});

test("prelaunch mutation guard returns a stable public error code", () => {
  assert.throws(
    () => assertLiveCommerce({ config: { environment: "production", commerceMode: "PRELAUNCH" } } as never),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 503);
      assert.equal((error as { code?: string }).code, "COMMERCE_NOT_AVAILABLE");
      return true;
    },
  );
});
