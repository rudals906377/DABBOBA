import type { PaidKujiSelectionSnapshot, PublicKujiDeckSnapshot } from "@dabboba/contracts";
import type { DrawOpenMode } from "../draw/draw-open-mode";
import type { KujiPaidDrawRoute } from "./kuji-slot-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PaidKujiSelectionState =
  | { kind: "SELECT"; snapshot: PaidKujiSelectionSnapshot; board: PublicKujiDeckSnapshot }
  | { kind: "REVEAL"; path: string }
  | { kind: "DONE" };

/** Validates the owned snapshot without deriving any authority from catalog visibility. */
export function preparePaidKujiSelection(
  snapshot: PaidKujiSelectionSnapshot,
  expected: KujiPaidDrawRoute & { productId: string },
): PaidKujiSelectionState {
  const recovery = snapshot.recovery;
  const ids = recovery.entitlementIds;
  const expectedIds = new Set(expected.entitlementIds);
  if (
    recovery.orderId !== expected.orderId || recovery.productId !== expected.productId
    || recovery.roomEntryId !== expected.roomEntryId || !UUID_PATTERN.test(recovery.userId)
    || !Number.isSafeInteger(recovery.probabilityVersion) || recovery.probabilityVersion < 1
    || !Number.isSafeInteger(recovery.totalSlots) || recovery.totalSlots < 1 || recovery.totalSlots > 10_000
    || !Number.isFinite(Date.parse(recovery.serverNow)) || !Number.isFinite(Date.parse(recovery.drawingExpiresAt))
    || ids.length > 20 || new Set(ids).size !== ids.length
    || ids.some((id) => !UUID_PATTERN.test(id) || !expectedIds.has(id))
    || snapshot.product.category !== "kuji" || !snapshot.product.name.trim()
    || !Number.isSafeInteger(snapshot.product.unitPrice) || snapshot.product.unitPrice < 0
  ) throw new Error("결제한 주문과 쿠지 번호판 정보가 일치하지 않습니다.");
  if (!ids.length) {
    if (recovery.bindings.length || snapshot.board) throw new Error("완료된 쿠지 주문 정보를 다시 확인해 주세요.");
    return { kind: "DONE" };
  }
  if (recovery.roomState !== "DRAWING" && recovery.roomState !== "EXPIRED") {
    throw new Error("결제한 쿠지 뽑기방 상태를 확인할 수 없습니다.");
  }
  if (recovery.bindings.length) {
    if (snapshot.board) throw new Error("이미 선택한 쿠지 번호를 다시 선택할 수 없습니다.");
    const mapping = new Map(recovery.bindings.map((binding) => [binding.entitlementId, binding]));
    if (
      mapping.size !== ids.length || recovery.bindings.length !== ids.length
      || ids.some((id) => !mapping.has(id))
      || new Set(recovery.bindings.map((binding) => binding.slotNumber)).size !== ids.length
      || recovery.bindings.some((binding) => (
        binding.state !== "RESERVED" || !Number.isSafeInteger(binding.slotNumber)
        || binding.slotNumber < 1 || binding.slotNumber > recovery.totalSlots
      ))
    ) throw new Error("남은 추첨권과 선택한 쿠지 번호가 일치하지 않습니다.");
    return {
      kind: "REVEAL",
      path: paidKujiRevealPath({
        ...expected,
        bindings: ids.map((id) => mapping.get(id)!),
        totalSlots: recovery.totalSlots,
      }),
    };
  }
  const board = snapshot.board;
  if (
    ids.length !== expected.entitlementIds.length || expectedIds.size !== ids.length
    || !board || board.productId !== recovery.productId
    || board.probabilityVersion !== recovery.probabilityVersion
    || board.totalSlots !== recovery.totalSlots || board.calculatedAt !== recovery.serverNow
    || !Number.isSafeInteger(board.snapshotVersion) || board.snapshotVersion < 0
    || !Number.isFinite(Date.parse(board.publishedAt))
    || board.slots.length !== board.totalSlots
    || board.slots.some((slot, index) => slot.slotNumber !== index + 1 || typeof slot.available !== "boolean")
    || board.slots.filter((slot) => slot.available).length < ids.length
    || !board.tiers.length || new Set(board.tiers.map((tier) => tier.tierCode)).size !== board.tiers.length
    || board.tiers.some((tier) => (
      !Number.isSafeInteger(tier.initialQuantity) || tier.initialQuantity < 1
      || !Number.isSafeInteger(tier.remainingQuantity) || tier.remainingQuantity < 0
      || tier.remainingQuantity > tier.initialQuantity
    ))
    || board.tiers.reduce((sum, tier) => sum + tier.initialQuantity, 0) !== board.totalSlots
  ) throw new Error("구매한 쿠지 번호판의 버전과 남은 수량을 확인할 수 없습니다.");
  return { kind: "SELECT", snapshot, board };
}

export function paidKujiRevealPath(input: {
  productId: string;
  orderId: string;
  roomEntryId: string;
  totalSlots: number;
  bindings: ReadonlyArray<{ entitlementId: string; slotNumber: number }>;
  mode?: DrawOpenMode;
}): string {
  const firstBinding = input.bindings[0];
  if (!firstBinding) throw new Error("열 수 있는 쿠지 추첨권을 찾을 수 없습니다.");
  const query = new URLSearchParams({
    productId: input.productId,
    category: "kuji",
    orderId: input.orderId,
    kujiEntryId: input.roomEntryId,
    entitlementIds: input.bindings.map((binding) => binding.entitlementId).join(","),
    tickets: input.bindings.map((binding) => (
      String(binding.slotNumber).padStart(Math.max(2, String(input.totalSlots).length), "0")
    )).join(","),
  });
  if (input.mode) query.set("mode", input.mode);
  return `/draw/reveal/${encodeURIComponent(firstBinding.entitlementId)}?${query.toString()}`;
}
