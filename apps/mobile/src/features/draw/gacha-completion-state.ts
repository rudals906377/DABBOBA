import type { PaidGachaDrawCompletion } from "@dabboba/contracts";
import type { GachaCheckoutOrderIntent } from "../checkout/gacha-checkout-intent";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** This read proof supplements past sessions; it never marks an unopened right consumed. */
export function assertPaidGachaDrawCompletion(
  proof: PaidGachaDrawCompletion,
  expected: {
    intent: GachaCheckoutOrderIntent;
    entitlementIds: readonly string[];
    currentEntitlementIds: readonly string[];
    settledResult: { id: string; entitlementId: string; productId: string; probabilityVersion: number };
  },
): void {
  const { intent, settledResult } = expected;
  const expectedIds = expected.entitlementIds.map((id) => id.toLowerCase());
  const expectedSet = new Set(expectedIds);
  const currentIds = expected.currentEntitlementIds.map((id) => id.toLowerCase());
  const serverNow = Date.parse(proof.serverNow);
  const results = new Map(proof.results.map((result) => [result.entitlementId.toLowerCase(), result]));
  // Draws an operator refunded as unused (owner rule 2026-10-06) hold no
  // result; the server names them so the order still proves complete.
  const refundedIds = (proof.refundedEntitlementIds ?? []).map((id) => id.toLowerCase());
  const refundedSet = new Set(refundedIds);
  if (
    proof.orderId.toLowerCase() !== intent.orderId || proof.userId.toLowerCase() !== intent.actorId
    || proof.productId !== intent.payload.productId || proof.probabilityVersion !== intent.payload.expectedDrawVersion
    || expectedIds.length !== intent.payload.quantity || expectedSet.size !== expectedIds.length
    || expectedIds.some((id) => !UUID_PATTERN.test(id))
    || currentIds.length < 1 || new Set(currentIds).size !== currentIds.length
    || currentIds.some((id) => !expectedSet.has(id))
    || refundedSet.size !== refundedIds.length
    || refundedIds.some((id) => !UUID_PATTERN.test(id) || !expectedSet.has(id) || results.has(id))
    || currentIds.some((id) => refundedSet.has(id))
    || results.size + refundedSet.size !== expectedIds.length || proof.results.length !== results.size
    || new Set(proof.results.map((result) => result.resultId.toLowerCase())).size !== results.size
    || expectedIds.some((id) => !results.has(id) && !refundedSet.has(id)) || !Number.isFinite(serverNow)
    || proof.results.some((result) => (
      !UUID_PATTERN.test(result.entitlementId) || !UUID_PATTERN.test(result.resultId)
      || !Number.isFinite(Date.parse(result.committedAt)) || Date.parse(result.committedAt) > serverNow
    ))
    || settledResult.entitlementId.toLowerCase() !== currentIds.at(-1)
    || settledResult.productId !== proof.productId || settledResult.probabilityVersion !== proof.probabilityVersion
    || results.get(settledResult.entitlementId.toLowerCase())?.resultId.toLowerCase() !== settledResult.id.toLowerCase()
  ) throw new Error("주문 전체의 확정된 가챠 결과를 안전하게 확인하지 못했습니다.");
}
