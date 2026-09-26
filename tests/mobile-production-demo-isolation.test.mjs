import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const metroConfigPath = fileURLToPath(new URL("../apps/mobile/metro.config.js", import.meta.url));

function metroConfigFor({ nodeEnv, capability, easProfile = "" }) {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    EXPO_PUBLIC_COMMERCE_CAPABILITY: process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY,
    EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE,
  };
  process.env.NODE_ENV = nodeEnv;
  process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY = capability;
  process.env.EAS_BUILD_PROFILE = easProfile;
  try {
    delete require.cache[require.resolve(metroConfigPath)];
    return require(metroConfigPath);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function resolvedModule(config, moduleName) {
  const resolveRequest = config.resolver.resolveRequest;
  if (!resolveRequest) return moduleName;
  return resolveRequest({ resolveRequest: (_context, target) => target }, moduleName, "ios");
}

test("LIVE production bundles isolate development payment and session modules but retain real checkout", () => {
  const config = metroConfigFor({ nodeEnv: "production", capability: "LIVE" });
  assert.match(resolvedModule(config, "@/features/demo/demo-api"), /production-demo-api\.ts$/);
  assert.match(resolvedModule(config, "@/features/demo/DemoPaymentControls"), /prelaunch-commerce-ui\.tsx$/);
  assert.match(resolvedModule(config, "@/features/demo/development-payment-copy"), /production-payment-copy\.ts$/);
  assert.equal(resolvedModule(config, "@/features/checkout/CheckoutScreen"), "@/features/checkout/CheckoutScreen");
});

test("development LIVE keeps the internal controls while PRELAUNCH excludes checkout", () => {
  const development = metroConfigFor({ nodeEnv: "development", capability: "LIVE" });
  assert.equal(resolvedModule(development, "@/features/demo/demo-api"), "@/features/demo/demo-api");
  assert.equal(resolvedModule(development, "@/features/checkout/CheckoutScreen"), "@/features/checkout/CheckoutScreen");

  const prelaunch = metroConfigFor({ nodeEnv: "production", capability: "PRELAUNCH" });
  assert.match(resolvedModule(prelaunch, "@/features/checkout/CheckoutScreen"), /prelaunch-commerce-ui\.tsx$/);
});

test("EAS packaged LIVE builds remain isolated even if NODE_ENV is not set to production", () => {
  const config = metroConfigFor({ nodeEnv: "development", capability: "LIVE", easProfile: "pg-review" });
  assert.match(resolvedModule(config, "@/features/demo/demo-api"), /production-demo-api\.ts$/);
});
