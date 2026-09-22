import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  PORTONE_CONFIG_PLUGIN,
  pluginsForCommerceCapability,
} = require("../apps/mobile/app.config.js");

const plugins = ["expo-router", ["expo-secure-store", {}], PORTONE_CONFIG_PLUGIN];

test("PRELAUNCH and missing capability omit the PortOne native config plugin", () => {
  assert.deepEqual(
    pluginsForCommerceCapability(plugins, "PRELAUNCH"),
    ["expo-router", ["expo-secure-store", {}]],
  );
  assert.deepEqual(
    pluginsForCommerceCapability(plugins, undefined),
    ["expo-router", ["expo-secure-store", {}]],
  );
});

test("LIVE keeps the PortOne native config plugin for the later payment build", () => {
  assert.deepEqual(pluginsForCommerceCapability(plugins, "LIVE"), plugins);
});
