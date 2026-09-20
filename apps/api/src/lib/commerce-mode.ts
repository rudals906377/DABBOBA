import type { CommerceLaunchMode } from "@dabboba/config";
import { AppError } from "./errors.js";
import type { ApiContext } from "../types.js";

type CommerceModeConfig = {
  environment: "development" | "test" | "production";
  commerceMode?: CommerceLaunchMode;
};

/**
 * Older programmatic test fixtures do not declare a launch mode. Keep those
 * fixtures live outside production, while a missing production value always
 * fails closed to PRELAUNCH.
 */
export function effectiveCommerceMode(config?: CommerceModeConfig): CommerceLaunchMode {
  return config?.commerceMode ?? (config?.environment === "production" ? "PRELAUNCH" : "LIVE");
}

export function assertLiveCommerce(context: Pick<ApiContext, "config">): void {
  if (effectiveCommerceMode(context.config) !== "LIVE") {
    throw new AppError(
      503,
      "COMMERCE_NOT_AVAILABLE",
      "현재는 상품을 둘러보고 관심 상품을 저장할 수 있는 사전 오픈 기간입니다.",
      { commerceMode: "PRELAUNCH" },
    );
  }
}

export function requireLiveCommerce(context: Pick<ApiContext, "config">) {
  return async function commerceLaunchGate() {
    assertLiveCommerce(context);
  };
}
