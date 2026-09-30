export const KUJI_CHECKOUT_LIMIT_SECONDS = 3 * 60;
/** A measured server-to-device offset beyond one day is treated as corrupt, not as a clock difference. */
export const KUJI_MAX_SERVER_CLOCK_OFFSET_MS = 24 * 60 * 60 * 1_000;

/**
 * Measures how far the server clock is ahead of this device when a server
 * snapshot is received. The difference between the two clocks stays valid
 * after the snapshot ages, so a traveler or a manually set device clock can
 * still use a granted lease without the snapshot extending it.
 */
export function measureKujiServerClockOffset(
  serverNow: string,
  receivedAtClientMs: number,
): number | null {
  const serverNowMs = Date.parse(serverNow);
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(receivedAtClientMs)) return null;
  return normalizeKujiServerClockOffset(serverNowMs - receivedAtClientMs);
}

export function normalizeKujiServerClockOffset(value: unknown): number | null {
  const offset = typeof value === "string" && /^-?\d{1,9}$/.test(value) ? Number(value) : value;
  return typeof offset === "number"
    && Number.isSafeInteger(offset)
    && Math.abs(offset) <= KUJI_MAX_SERVER_CLOCK_OFFSET_MS
    ? offset
    : null;
}

export type KujiCheckoutPhase = "ACTIVE" | "SUBMITTING" | "EXPIRED" | "PAID";

export type KujiCheckoutClock = Readonly<{
  deadlineMs: number;
  serverClockOffsetMs: number;
  /** True when the offset was measured at receipt rather than derived from an aging snapshot. */
  measuredOffset: boolean;
  valid: boolean;
}>;

const INVALID_KUJI_CHECKOUT_CLOCK: KujiCheckoutClock = Object.freeze({
  deadlineMs: 0,
  serverClockOffsetMs: 0,
  measuredOffset: false,
  valid: false,
});

function kujiCheckoutEffectiveNowMs(
  clientNowMs: number,
  serverClockOffsetMs: number,
  measuredOffset: boolean,
): number {
  const serverAdjustedNowMs = clientNowMs + serverClockOffsetMs;
  // A measured offset is the server's own clock, even when the device clock is
  // ahead. Without one, an aging serverNow snapshot must never extend the lease.
  return measuredOffset ? serverAdjustedNowMs : Math.max(clientNowMs, serverAdjustedNowMs);
}

/**
 * Captures the server-to-device clock offset once when checkout is entered.
 * Later countdown reads always use the absolute deadline, so rerenders and
 * app backgrounding cannot grant more time.
 */
export function createKujiCheckoutClock(
  expiresAt: string | undefined,
  serverNow: string | undefined,
  clientNowMs: number,
  measuredServerClockOffsetMs?: number | null,
): KujiCheckoutClock {
  if (!expiresAt || !Number.isFinite(clientNowMs)) return INVALID_KUJI_CHECKOUT_CLOCK;

  const deadlineMs = Date.parse(expiresAt);
  if (!Number.isFinite(deadlineMs)) return INVALID_KUJI_CHECKOUT_CLOCK;

  const measured = normalizeKujiServerClockOffset(measuredServerClockOffsetMs);
  let serverClockOffsetMs = measured ?? 0;
  if (measured === null && serverNow !== undefined) {
    const serverNowMs = Date.parse(serverNow);
    if (!Number.isFinite(serverNowMs)) return INVALID_KUJI_CHECKOUT_CLOCK;
    serverClockOffsetMs = serverNowMs - clientNowMs;
  }
  const measuredOffset = measured !== null;

  if (deadlineMs <= kujiCheckoutEffectiveNowMs(clientNowMs, serverClockOffsetMs, measuredOffset)) {
    return INVALID_KUJI_CHECKOUT_CLOCK;
  }

  return Object.freeze({ deadlineMs, serverClockOffsetMs, measuredOffset, valid: true });
}

export function kujiCheckoutRemainingSeconds(
  clock: KujiCheckoutClock,
  clientNowMs: number,
): number {
  if (!clock.valid || !Number.isFinite(clientNowMs)) return 0;

  const effectiveNowMs = kujiCheckoutEffectiveNowMs(
    clientNowMs,
    clock.serverClockOffsetMs,
    clock.measuredOffset,
  );
  const remaining = Math.ceil((clock.deadlineMs - effectiveNowMs) / 1_000);
  if (!Number.isFinite(remaining)) return 0;
  return Math.max(0, Math.min(KUJI_CHECKOUT_LIMIT_SECONDS, remaining));
}

export function formatKujiCheckoutRemainingTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.min(KUJI_CHECKOUT_LIMIT_SECONDS, Math.trunc(seconds)))
    : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function resolveKujiCheckoutPhase(
  clock: KujiCheckoutClock,
  clientNowMs: number,
  paid = false,
  submitting = false,
): KujiCheckoutPhase {
  if (paid) return "PAID";
  if (submitting) return "SUBMITTING";
  return kujiCheckoutRemainingSeconds(clock, clientNowMs) > 0 ? "ACTIVE" : "EXPIRED";
}
