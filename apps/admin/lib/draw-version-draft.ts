export type DrawDraftCategory = "gacha" | "kuji";

export type DrawVersionDraftEntry = {
  prizeProductId: string;
  rarity: string;
  weight?: number;
  quantity: number;
  tierCode?: string;
  tierRank?: number;
};

export type DrawVersionDraftPayload = {
  totalSlots?: number;
  entries: DrawVersionDraftEntry[];
};

const PRIZE_PRODUCT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const KUJI_TIER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

function record(value: unknown, index: number): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`경품 ${index + 1}의 입력 형식이 올바르지 않습니다.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isProvided(value: unknown) {
  return value !== undefined && value !== null && (typeof value !== "string" || value.trim() !== "");
}

function integerValue(value: unknown, minimum: number, maximum: number) {
  if (!isProvided(value)) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function buildDrawVersionDraftPayload(
  category: DrawDraftCategory,
  rawEntries: unknown,
  rawTotalSlots?: unknown,
): DrawVersionDraftPayload {
  if (!Array.isArray(rawEntries) || rawEntries.length < 1 || rawEntries.length > 200) {
    throw new Error("경품 구성은 1~200개 배열이어야 합니다.");
  }

  const prizeProductIds = new Set<string>();
  const tierCodes = new Set<string>();
  const tierRanks = new Set<number>();
  let quantityTotal = 0;
  const entries = rawEntries.map((rawEntry, index) => {
    const entry = record(rawEntry, index);
    const prizeProductId = stringValue(entry.prizeProductId);
    const rarity = stringValue(entry.rarity);
    const quantity = integerValue(entry.quantity, 1, 10_000);
    if (!PRIZE_PRODUCT_ID_PATTERN.test(prizeProductId)) {
      throw new Error(`경품 ${index + 1}의 상품 ID가 올바르지 않습니다.`);
    }
    if (!rarity || rarity.length > 40 || /[\u0000-\u001f\u007f]/.test(rarity)) {
      throw new Error(`경품 ${index + 1}의 등급은 1~40자로 입력하세요.`);
    }
    if (quantity === null) {
      throw new Error(`경품 ${index + 1}의 유한 수량은 1~10,000 정수여야 합니다.`);
    }
    if (prizeProductIds.has(prizeProductId)) {
      throw new Error("같은 경품 SKU를 두 번 이상 입력할 수 없습니다.");
    }
    prizeProductIds.add(prizeProductId);
    quantityTotal += quantity;

    if (category === "gacha") {
      const weight = integerValue(entry.weight, 1, 1_000_000);
      if (weight === null) {
        throw new Error(`경품 ${index + 1}의 가중치는 1~1,000,000 정수여야 합니다.`);
      }
      if (isProvided(entry.tierCode)) {
        throw new Error("가챠 경품에는 쿠지 tierCode를 입력할 수 없습니다.");
      }
      if (isProvided(entry.tierRank)) {
        throw new Error("가챠 경품에는 쿠지 tierRank를 입력할 수 없습니다.");
      }
      return { prizeProductId, rarity, weight, quantity };
    }

    if (isProvided(entry.weight)) {
      throw new Error("봉인 쿠지는 가중치를 사용하지 않습니다.");
    }
    const tierCode = stringValue(entry.tierCode);
    const tierRank = integerValue(entry.tierRank, 0, 2_147_483_647);
    if (!KUJI_TIER_CODE_PATTERN.test(tierCode)) {
      throw new Error(`경품 ${index + 1}의 tierCode는 영문, 숫자, 밑줄, 하이픈만 1~40자로 입력하세요.`);
    }
    if (tierRank === null) {
      throw new Error(`경품 ${index + 1}의 tierRank는 0 이상의 정수여야 합니다.`);
    }
    if (tierCodes.has(tierCode)) throw new Error(`쿠지 tierCode가 중복되었습니다: ${tierCode}`);
    if (tierRanks.has(tierRank)) throw new Error(`쿠지 tierRank가 중복되었습니다: ${tierRank}`);
    tierCodes.add(tierCode);
    tierRanks.add(tierRank);
    return { prizeProductId, rarity, quantity, tierCode, tierRank };
  });

  if (category === "gacha") {
    if (isProvided(rawTotalSlots)) {
      throw new Error("가챠에는 쿠지 전체 장수를 입력할 수 없습니다.");
    }
    return { entries };
  }

  const totalSlots = integerValue(rawTotalSlots, 1, 10_000);
  if (totalSlots === null) throw new Error("전체 쿠지 장수는 1~10,000 정수여야 합니다.");
  if (quantityTotal !== totalSlots) {
    throw new Error("쿠지 경품 수량의 합계가 전체 쿠지 장수와 정확히 같아야 합니다.");
  }
  return { totalSlots, entries };
}
