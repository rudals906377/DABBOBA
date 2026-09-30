import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const mobileRoot = fileURLToPath(new URL("../apps/mobile/", import.meta.url));
const configPath = path.join(mobileRoot, "metro.config.js");

function resolveWithCapability(capability, moduleName) {
  const previous = process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY;
  try {
    process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY = capability;
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    const context = { resolveRequest: (_context, resolvedName) => resolvedName };
    return config.resolver.resolveRequest?.(context, moduleName, "ios") ?? moduleName;
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY;
    else process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY = previous;
    delete require.cache[require.resolve(configPath)];
  }
}

test("PRELAUNCH bundles safe stubs instead of development payment modules", () => {
  assert.equal(
    resolveWithCapability("PRELAUNCH", "@/features/demo/demo-api"),
    path.join(mobileRoot, "src/features/demo/prelaunch-demo-api.ts"),
  );
  for (const moduleName of ["@/features/demo/DemoPaymentControls", "@/features/checkout/CheckoutScreen"]) {
    assert.equal(
      resolveWithCapability("PRELAUNCH", moduleName),
      path.join(mobileRoot, "src/features/demo/prelaunch-commerce-ui.tsx"),
    );
  }
  assert.equal(resolveWithCapability("PRELAUNCH", "react-native"), "react-native");
});

test("LIVE leaves commerce modules available for its separate release gate", () => {
  assert.equal(resolveWithCapability("LIVE", "@/features/checkout/CheckoutScreen"), "@/features/checkout/CheckoutScreen");
});
