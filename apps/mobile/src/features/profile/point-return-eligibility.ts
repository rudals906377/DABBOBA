import type { InventoryUnit } from "@dabboba/contracts";

export function isPointReturnEligibleInventory(item: InventoryUnit): boolean {
  return item.status === "OWNED"
    && item.sourceType === "GACHA";
}
