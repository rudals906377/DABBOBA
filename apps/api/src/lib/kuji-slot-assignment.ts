import { randomInt as cryptoRandomInt } from "node:crypto";

export type SealedKujiTierAllocation = Readonly<{
  poolEntryId: string;
  tierCode: string;
  /** Lower ranks are higher prize tiers. Rank 0 is the highest possible tier. */
  tierRank: number;
  quantity: number;
}>;

export type SealedKujiSlotAssignment = Readonly<{
  slotNumber: number;
  poolEntryId: string;
  tierCode: string;
  /** Lower ranks are higher prize tiers. Rank 0 is the highest possible tier. */
  tierRank: number;
}>;

export type PublicKujiSlotAvailability = Readonly<{
  slotNumber: number;
  available: boolean;
}>;

export type KujiRandomInt = (maxExclusive: number) => number;

const secureRandomInt: KujiRandomInt = (maxExclusive) => cryptoRandomInt(maxExclusive);
export const MAX_SEALED_KUJI_SLOT_TOTAL = 10_000;
export const SEALED_KUJI_TIER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export function assignSealedKujiSlots(
  total: number,
  tiers: readonly SealedKujiTierAllocation[],
  randomInteger: KujiRandomInt = secureRandomInt,
): readonly SealedKujiSlotAssignment[] {
  const normalizedTiers = validateAndNormalizeTiers(total, tiers);
  const shuffledTiers: Array<Pick<SealedKujiTierAllocation, "poolEntryId" | "tierCode" | "tierRank">> = [];

  for (const tier of normalizedTiers) {
    for (let index = 0; index < tier.quantity; index += 1) {
      shuffledTiers.push({
        poolEntryId: tier.poolEntryId,
        tierCode: tier.tierCode,
        tierRank: tier.tierRank,
      });
    }
  }

  for (let index = shuffledTiers.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(index + 1);
    if (!Number.isSafeInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new RangeError(`Random integer must be in the inclusive range 0..${index}.`);
    }
    [shuffledTiers[index], shuffledTiers[swapIndex]] = [
      shuffledTiers[swapIndex]!,
      shuffledTiers[index]!,
    ];
  }

  return Object.freeze(
    shuffledTiers.map((tier, index) => Object.freeze({
      slotNumber: index + 1,
      poolEntryId: tier.poolEntryId,
      tierCode: tier.tierCode,
      tierRank: tier.tierRank,
    })),
  );
}

export function projectPublicKujiSlotAvailability(
  assignments: readonly SealedKujiSlotAssignment[],
  unavailableSlotNumbers: ReadonlySet<number> = new Set<number>(),
): readonly PublicKujiSlotAvailability[] {
  const slotNumbers = new Set<number>();
  for (const [index, assignment] of assignments.entries()) {
    const expectedSlotNumber = index + 1;
    if (assignment.slotNumber !== expectedSlotNumber || slotNumbers.has(assignment.slotNumber)) {
      throw new RangeError("Sealed kuji assignments must contain each consecutive slot number exactly once.");
    }
    slotNumbers.add(assignment.slotNumber);
  }

  for (const slotNumber of unavailableSlotNumbers) {
    if (!Number.isSafeInteger(slotNumber) || !slotNumbers.has(slotNumber)) {
      throw new RangeError("Unavailable kuji slot numbers must refer to an assigned positive integer slot.");
    }
  }

  return Object.freeze(
    assignments.map(({ slotNumber }) => Object.freeze({
      slotNumber,
      available: !unavailableSlotNumbers.has(slotNumber),
    })),
  );
}

function validateAndNormalizeTiers(
  total: number,
  tiers: readonly SealedKujiTierAllocation[],
): readonly SealedKujiTierAllocation[] {
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_SEALED_KUJI_SLOT_TOTAL) {
    throw new RangeError(`Sealed kuji slot total must be an integer from 1 to ${MAX_SEALED_KUJI_SLOT_TOTAL}.`);
  }

  const poolEntryIds = new Set<string>();
  const tierCodes = new Set<string>();
  const tierRanks = new Set<number>();
  let quantityTotal = 0n;
  const normalized = tiers.map((tier) => {
    const poolEntryId = typeof tier?.poolEntryId === "string" ? tier.poolEntryId.trim() : "";
    if (!poolEntryId) throw new RangeError("Each sealed kuji poolEntryId must be nonempty.");
    if (poolEntryIds.has(poolEntryId)) throw new RangeError(`Duplicate sealed kuji poolEntryId: ${poolEntryId}.`);
    poolEntryIds.add(poolEntryId);

    const tierCode = typeof tier?.tierCode === "string" ? tier.tierCode.trim() : "";
    if (!SEALED_KUJI_TIER_CODE_PATTERN.test(tierCode)) {
      throw new RangeError("Each sealed kuji tierCode must use 1-40 ASCII letters, digits, underscores, or hyphens.");
    }
    if (tierCodes.has(tierCode)) throw new RangeError(`Duplicate sealed kuji tierCode: ${tierCode}.`);
    tierCodes.add(tierCode);

    if (!Number.isSafeInteger(tier.quantity) || tier.quantity <= 0) {
      throw new RangeError(`Quantity for sealed kuji tier ${tierCode} must be a positive safe integer.`);
    }
    if (!Number.isSafeInteger(tier.tierRank) || tier.tierRank < 0) {
      throw new RangeError(`tierRank for sealed kuji tier ${tierCode} must be a nonnegative safe integer.`);
    }
    if (tierRanks.has(tier.tierRank)) {
      throw new RangeError(`Duplicate sealed kuji tierRank: ${tier.tierRank}.`);
    }
    tierRanks.add(tier.tierRank);
    quantityTotal += BigInt(tier.quantity);

    return Object.freeze({ poolEntryId, tierCode, tierRank: tier.tierRank, quantity: tier.quantity });
  });

  if (quantityTotal !== BigInt(total)) {
    throw new RangeError("Sealed kuji tier quantities must sum exactly to the slot total.");
  }

  return Object.freeze(normalized);
}
