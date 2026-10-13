import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { adapterOptionsForBinding, checkoutCardChannels, configuredCardChannels, selectCardChannel } from "./portone-channel-binding.js";

const config = {
  paymentProvider: "PORTONE_V2_INICIS", paymentWebhookSecret: "synthetic-webhook-secret",
  portOne: { merchantId: "merchant", storeId: "store", channelKey: "channel-inicis",
    kcpChannelKey: "channel-key-kcp", channelEnvironment: "TEST", apiSecret: "synthetic-api-secret" },
} as ApiConfig;

test("optional KCP preserves primary INICIS and exposes no secrets", () => {
  const channels = configuredCardChannels(config);
  assert.equal(channels.length, 2);
  assert.equal(selectCardChannel(config).provider, "PORTONE_V2_INICIS");
  assert.equal(selectCardChannel(config, "KCP").provider, "PORTONE_V2_KCP");
  assert.doesNotMatch(JSON.stringify(channels), /synthetic-api-secret|webhook|apiSecret/);
  const { kcpChannelKey: ignored, ...primary } = config.portOne!;
  assert.equal(configuredCardChannels({ ...config, portOne: primary }).length, 1);
  assert.throws(() => selectCardChannel({ ...config, portOne: primary }, "KCP"), /구성되지/);
  assert.deepEqual(configuredCardChannels({ ...config, paymentProvider: "UNCONFIGURED" }), []);
});

test("adapter selection binds exact provider, store, merchant, channel and environment", () => {
  for (const channel of configuredCardChannels(config)) {
    assert.equal(adapterOptionsForBinding(config, channel.provider, channel).pgProvider, channel.pgProvider);
    for (const [key, value] of Object.entries(channel)) {
      assert.throws(() => adapterOptionsForBinding(config, channel.provider, { ...channel, [key]: `${value}-forged` }), /채널/);
    }
    assert.throws(() => adapterOptionsForBinding(config, channel.provider === "PORTONE_V2_KCP" ? "PORTONE_V2_INICIS" : "PORTONE_V2_KCP", channel), /채널/);
  }
  assert.equal(adapterOptionsForBinding(config, "PORTONE_V2_INICIS", null).pgProvider, "INICIS_V2");
  assert.throws(() => adapterOptionsForBinding(config, "PORTONE_V2_KCP", null), /채널/);
  assert.throws(() => adapterOptionsForBinding(config, "TEST_PG", null), /채널/);
});

test("NICE is the only new checkout rail while historical INICIS/KCP remain query-only", () => {
  const nice = { ...config, paymentProvider: "PORTONE_V2_NICE", portOne: { ...config.portOne!,
    channelKey: "channel-key-nice", inicisChannelKey: config.portOne!.channelKey } } as ApiConfig;
  const selected = selectCardChannel(nice);
  assert.equal(selected.provider, "PORTONE_V2_NICE");
  assert.equal(selected.pgProvider, "NICE_V2");
  assert.deepEqual(checkoutCardChannels(nice), [selected]);
  for (const pg of ["INICIS", "KCP"] as const) assert.throws(() => selectCardChannel(nice, pg), /구성되지/);
  for (const old of configuredCardChannels(config)) {
    assert.equal(adapterOptionsForBinding(nice, old.provider, old).channelKey, old.channelKey);
  }
  assert.equal(adapterOptionsForBinding(nice, "PORTONE_V2_INICIS", null).channelKey, config.portOne!.channelKey);
  assert.throws(() => adapterOptionsForBinding(nice, "PORTONE_V2_NICE", null), /채널/);
  assert.throws(() => adapterOptionsForBinding(nice, "PORTONE_V2_NICE", { ...selected, pgProvider: "INICIS_V2" }), /채널/);
});
