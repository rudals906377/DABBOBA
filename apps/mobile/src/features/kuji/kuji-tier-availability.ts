import type { CatalogProduct } from "@dabboba/contracts";

export type RemainingKujiTier = NonNullable<CatalogProduct["remainingKujiTiers"]>[number];

export type RemainingKujiTierSummary = {
  all: Array<RemainingKujiTier & { displayLabel: string }>;
  visible: Array<RemainingKujiTier & { displayLabel: string }>;
  hiddenCount: number;
  compactLabel: string;
  accessibilityLabel: string;
};

export function kujiTierDisplayLabel(tier: Pick<RemainingKujiTier, "label" | "tierCode">): string {
  const label = tier.label.trim() || tier.tierCode.trim();
  return /^[A-Za-z0-9]$/.test(label) ? `${label.toLocaleUpperCase("en-US")}상` : label;
}

export function remainingKujiTierSummary(
  tiers: readonly RemainingKujiTier[] | null | undefined,
  maxVisible: number,
  reserveOverflowSlotAtLimit = false,
): RemainingKujiTierSummary | null {
  const seen = new Set<string>();
  const all = [...(tiers ?? [])]
    .filter((tier) => (
      tier.tierCode.trim().length > 0
      && tier.label.trim().length > 0
      && Number.isFinite(tier.tierRank)
      && Number.isFinite(tier.remainingQuantity)
      && tier.remainingQuantity > 0
    ))
    .sort((left, right) => left.tierRank - right.tierRank || left.tierCode.localeCompare(right.tierCode, "en"))
    .filter((tier) => {
      if (seen.has(tier.tierCode)) return false;
      seen.add(tier.tierCode);
      return true;
    })
    .map((tier) => ({ ...tier, displayLabel: kujiTierDisplayLabel(tier) }));

  if (!all.length) return null;

  const displayLimit = Math.max(2, Math.floor(maxVisible));
  const hasOverflow = reserveOverflowSlotAtLimit
    ? all.length >= displayLimit
    : all.length > displayLimit;
  const visible = all.slice(0, hasOverflow ? displayLimit - 1 : displayLimit);
  const hiddenCount = all.length - visible.length;
  const compactParts = visible.map((tier) => tier.displayLabel);
  if (hiddenCount > 0) compactParts.push(`+${hiddenCount}`);

  return {
    all,
    visible,
    hiddenCount,
    compactLabel: compactParts.join(" · "),
    accessibilityLabel: `남은 상, ${all.map((tier) => `${tier.displayLabel} ${tier.remainingQuantity.toLocaleString("ko-KR")}개`).join(", ")}`,
  };
}

export function remainingKujiTierAccessibilityLabel(
  tiers: readonly RemainingKujiTier[] | null | undefined,
): string | null {
  return remainingKujiTierSummary(tiers, Number.MAX_SAFE_INTEGER)?.accessibilityLabel ?? null;
}
