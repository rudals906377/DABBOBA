import type { InventoryUnit } from "@dabboba/contracts";

export function isPointReturnEligibleInventory(item: InventoryUnit): boolean {
  return item.status === "OWNED"
    && item.sourceType === "GACHA"
    && item.pointReturnEligible === true
    && typeof item.pointReturnAmount === "number"
    && Number.isSafeInteger(item.pointReturnAmount)
    && item.pointReturnAmount > 0;
}
