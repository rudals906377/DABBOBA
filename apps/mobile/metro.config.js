const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Development commerce helpers must never enter a packaged app. PRELAUNCH
// additionally removes checkout; LIVE keeps its real PortOne checkout intact.
const prelaunch = process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY === "PRELAUNCH";
const packagedBuild = process.env.NODE_ENV === "production" || Boolean(process.env.EAS_BUILD_PROFILE);
if (prelaunch || packagedBuild) {
  const isolatedModules = new Map([
    ["@/features/demo/demo-api", path.join(__dirname, packagedBuild
      ? "src/features/demo/production-demo-api.ts"
      : "src/features/demo/prelaunch-demo-api.ts")],
    ["@/features/demo/DemoPaymentControls", path.join(__dirname, "src/features/demo/prelaunch-commerce-ui.tsx")],
  ]);
  if (packagedBuild) {
    isolatedModules.set(
      "@/features/demo/development-payment-copy",
      path.join(__dirname, "src/features/demo/production-payment-copy.ts"),
    );
  }
  if (prelaunch) {
    isolatedModules.set(
      "@/features/checkout/CheckoutScreen",
      path.join(__dirname, "src/features/demo/prelaunch-commerce-ui.tsx"),
    );
  }

  config.resolver.resolveRequest = (context, moduleName, platform) =>
    context.resolveRequest(context, isolatedModules.get(moduleName) ?? moduleName, platform);
}

module.exports = config;
