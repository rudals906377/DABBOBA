export const KUJI_BOARD_TICKET_COUNT = 50;
export const KUJI_MAX_SLOT_NUMBER = 10_000;

export type DrawPaymentUnit = "개" | "장";
export type KujiOpenMode = "single" | "all";
export type KujiOpenStep = "blocked" | "direct-open";

export type KujiRarityRemaining = {
  rarity: string;
  remainingQuantity: number | null;
};

export const KUJI_EXAMPLE_REMAINING: readonly KujiRarityRemaining[] = Object.freeze([
  Object.freeze({ rarity: "S", remainingQuantity: 1 }),
  Object.freeze({ rarity: "A", remainingQuantity: 3 }),
  Object.freeze({ rarity: "B", remainingQuantity: 7 }),
  Object.freeze({ rarity: "C", remainingQuantity: 12 }),
  Object.freeze({ rarity: "D", remainingQuantity: 21 }),
]);

export function createKujiTicketNumbers(count = KUJI_BOARD_TICKET_COUNT): string[] {
  const bounded = Math.max(1, Math.min(Math.trunc(count), KUJI_BOARD_TICKET_COUNT));
  return Array.from({ length: bounded }, (_, index) => formatKujiTicketNumber(index + 1));
}

export function parseKujiTicketNumbers(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<number>();
  for (const part of value.split(",")) {
    const ticket = Number(part);
    if (Number.isInteger(ticket) && ticket >= 1 && ticket <= KUJI_MAX_SLOT_NUMBER) {
      seen.add(ticket);
    }
  }
  return Array.from(seen)
    .sort((left, right) => left - right)
    .map(formatKujiTicketNumber);
}

export function toggleKujiTicketSelection(
  current: string[],
  ticket: string,
  maxSelections = KUJI_BOARD_TICKET_COUNT,
): string[] {
  const [canonical] = parseKujiTicketNumbers(ticket);
  if (!canonical) return current;
  if (current.includes(canonical)) {
    return current.filter((value) => value !== canonical);
  }
  const limit = Number.isFinite(maxSelections)
    ? Math.max(0, Math.min(Math.trunc(maxSelections), KUJI_MAX_SLOT_NUMBER))
    : 0;
  if (current.length >= limit) return current;
  const next = [...current, canonical];
  return next.sort((left, right) => Number(left) - Number(right));
}

export function hasExactKujiTicketSelection(
  tickets: string[],
  purchasedCount: number,
): boolean {
  const count = Number.isFinite(purchasedCount)
    ? Math.max(0, Math.min(Math.trunc(purchasedCount), KUJI_MAX_SLOT_NUMBER))
    : 0;
  const canonical = parseKujiTicketNumbers(tickets.join(","));
  return count > 0 && canonical.length === count && canonical.length === tickets.length;
}

export function buildDrawPaymentConfirmation(
  unitPrice: number,
  requestedCount: number,
  unit: DrawPaymentUnit,
) {
  const count = normalizeNonNegativeInteger(requestedCount);
  const price = normalizeNonNegativeInteger(unitPrice);
  const total = price * count;

  return {
    count,
    total,
    message: `${count}${unit} · ${total.toLocaleString("ko-KR")}원`,
  };
}

export function buildKujiPaymentConfirmation(unitPrice: number, tickets: string[]) {
  return buildDrawPaymentConfirmation(unitPrice, tickets.length, "장");
}

export function buildGachaPreviewParams(requestedCount: number) {
  const count = Math.max(1, normalizeNonNegativeInteger(requestedCount));

  return {
    category: "gacha" as const,
    count: String(count),
    mode: count > 1 ? "all" as const : "single" as const,
  };
}

export function resolveKujiOpenStep(selectedCount: number): KujiOpenStep {
  const count = Number.isFinite(selectedCount)
    ? Math.max(0, Math.trunc(selectedCount))
    : 0;
  if (count === 0) return "blocked";
  return "direct-open";
}

export function buildKujiPreviewParams(tickets: string[], mode: KujiOpenMode) {
  return {
    mode,
    count: String(tickets.length),
    tickets: tickets.join(","),
  };
}

export function aggregateKujiRemainingByRarity(
  entries: ReadonlyArray<{ rarity: string; remainingQuantity: number | null }>,
): KujiRarityRemaining[] {
  const grouped = new Map<string, number | null>();
  for (const entry of entries) {
    if (!grouped.has(entry.rarity)) {
      grouped.set(entry.rarity, entry.remainingQuantity);
      continue;
    }
    const current = grouped.get(entry.rarity) ?? null;
    grouped.set(
      entry.rarity,
      current === null || entry.remainingQuantity === null
        ? null
        : current + entry.remainingQuantity,
    );
  }
  return Array.from(grouped, ([rarity, remainingQuantity]) => ({ rarity, remainingQuantity }));
}

export function formatKujiRarityLabel(rarity: string): string {
  const label = rarity.trim();
  return label.endsWith("상") ? label : `${label}상`;
}

function formatKujiTicketNumber(ticket: number): string {
  return String(ticket).padStart(2, "0");
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
