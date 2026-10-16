import assert from "node:assert/strict";
import test from "node:test";
import { checkoutPaymentChannel } from "../apps/mobile/src/features/checkout/payment-channel.js";
const legacy = { storeId: "store-old", channelKey: "channel-key-old" };
const binding = { provider: "PORTONE_V2_NICE" as const, pgProvider: "NICE_V2" as const, merchantId: "merchant",
  storeId: "store-nice", channelKey: "channel-key-nice", channelEnvironment: "TEST" as const };
test("native NICE orders use their exact server channel, never the old installed INICIS channel", () => {
  assert.deepEqual(checkoutPaymentChannel({ cardPayment: binding }, legacy), { storeId: "store-nice", channelKey: "channel-key-nice" });
  assert.deepEqual(checkoutPaymentChannel({ cardPayment: null }, legacy), legacy);
  for (const value of [{ ...binding, pgProvider: "INICIS_V2" }, { ...binding, channelKey: "https://evil.test" },
    { ...binding, provider: "TOSSPAYMENTS_DIRECT" }]) assert.throws(() => checkoutPaymentChannel({ cardPayment: value as never }, legacy));
  assert.throws(() => checkoutPaymentChannel({ cardPayment: null }, { storeId: "", channelKey: "" }));
});
