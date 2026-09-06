import type { KujiSlotBindingResult } from "@dabboba/contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type KujiPaidDrawRoute = {
  orderId: string;
  roomEntryId: string;
  entitlementIds: string[];
};

export function parseKujiPaidDrawRoute(input: {
  orderId: string | undefined;
  roomEntryId: string | undefined;
  entitlementIds: string | undefined;
  requestedCount: string | undefined;
}): KujiPaidDrawRoute | null {
  const orderId = input.orderId?.trim() ?? "";
  const roomEntryId = input.roomEntryId?.trim() ?? "";
  const entitlementIds = parseUniqueUuidList(input.entitlementIds);
  const requestedCount = Number(input.requestedCount);
  if (
    !UUID_PATTERN.test(orderId)
    || !UUID_PATTERN.test(roomEntryId)
    || entitlementIds.length < 1
    || !Number.isInteger(requestedCount)
    || requestedCount !== entitlementIds.length
  ) return null;
  return { orderId, roomEntryId, entitlementIds };
}

export function validateKujiSlotBinding(
  result: KujiSlotBindingResult,
  expected: {
    productId: string;
    roomEntryId: string;
    probabilityVersion: number;
    entitlementIds: readonly string[];
    slotNumbers: readonly number[];
  },
): KujiSlotBindingResult["bindings"] {
  const expectedEntitlementIds = [...expected.entitlementIds];
  const expectedSlotNumbers = [...expected.slotNumbers].sort((left, right) => left - right);
  const actualEntitlementIds = result.bindings.map((binding) => binding.entitlementId);
  const actualSlotNumbers = result.bindings.map((binding) => binding.slotNumber).sort((left, right) => left - right);
  if (
    result.productId !== expected.productId
    || result.roomEntryId !== expected.roomEntryId
    || result.probabilityVersion !== expected.probabilityVersion
    || result.bindings.length !== expectedEntitlementIds.length
    || actualEntitlementIds.some((id, index) => id !== expectedEntitlementIds[index])
    || actualSlotNumbers.some((slotNumber, index) => slotNumber !== expectedSlotNumbers[index])
    || result.bindings.some((binding) => binding.state !== "RESERVED" && binding.state !== "CONSUMED")
  ) {
    throw new Error("서버에서 확정한 쿠지 번호와 결제한 추첨권 정보가 일치하지 않습니다.");
  }
  return result.bindings;
}

export function formatKujiSlotNumber(slotNumber: number, totalSlots: number): string {
  const width = Math.max(2, String(Math.max(1, totalSlots)).length);
  return String(slotNumber).padStart(width, "0");
}

function parseUniqueUuidList(value: string | undefined): string[] {
  if (!value) return [];
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length > 20 || new Set(ids).size !== ids.length || ids.some((id) => !UUID_PATTERN.test(id))) {
    return [];
  }
  return ids;
}
