import type { PublicDrawOdds, PublicPrizeLineup } from "./shop-api";

export type IncludedPrize = {
  id: string;
  prizeName: string;
  prizeImageUrl: string | null;
  detail: string | null;
  accessibilityDetail: string | null;
};

/**
 * LIVE shows the server-calculated probability of each prize. Before LIVE the
 * server withholds odds, so the lineup shows each prize's composition quantity
 * in the set instead (never the product's own stock).
 */
export function includedPrizes(snapshot: {
  drawOdds: PublicDrawOdds | null;
  prizeLineup: PublicPrizeLineup | null;
}): IncludedPrize[] {
  if (snapshot.drawOdds?.entries.length) {
    return snapshot.drawOdds.entries.map((entry) => ({
      id: entry.id,
      prizeName: entry.prizeName,
      prizeImageUrl: entry.prizeImageUrl ?? null,
      detail: `${entry.probabilityPercent.toFixed(2)}%`,
      accessibilityDetail: `확률 ${entry.probabilityPercent.toFixed(2)}퍼센트`,
    }));
  }
  return (snapshot.prizeLineup?.entries ?? []).map((entry) => ({
    id: entry.id,
    prizeName: entry.prizeName,
    prizeImageUrl: entry.prizeImageUrl ?? null,
    detail: entry.quantity === null ? null : `${entry.quantity.toLocaleString("ko-KR")}개`,
    accessibilityDetail: entry.quantity === null ? null : `구성 ${entry.quantity}개`,
  }));
}
