const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Keep development payment helpers in source for later LIVE builds, but do not
// package them into a PRELAUNCH binary where commerce routes are unavailable.
if (process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY === "PRELAUNCH") {
  const prelaunchModules = new Map([
    ["@/features/demo/demo-api", path.join(__dirname, "src/features/demo/prelaunch-demo-api.ts")],
    ["@/features/demo/DemoPaymentControls", path.join(__dirname, "src/features/demo/prelaunch-commerce-ui.tsx")],
    ["@/features/checkout/CheckoutScreen", path.join(__dirname, "src/features/demo/prelaunch-commerce-ui.tsx")],
  ]);

  config.resolver.resolveRequest = (context, moduleName, platform) =>
    context.resolveRequest(context, prelaunchModules.get(moduleName) ?? moduleName, platform);
}

module.exports = config;
