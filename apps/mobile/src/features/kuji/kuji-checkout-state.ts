export const KUJI_CHECKOUT_LIMIT_SECONDS = 3 * 60;
export const KUJI_CLOCK_SKEW_WARNING_MS = 5 * 60 * 1_000;

export function isKujiServerClockSkewed(serverNow: string, clientNowMs: number): boolean {
  const serverNowMs = Date.parse(serverNow);
  return Number.isFinite(serverNowMs)
    && Number.isFinite(clientNowMs)
    && Math.abs(serverNowMs - clientNowMs) > KUJI_CLOCK_SKEW_WARNING_MS;
}

export type KujiCheckoutPhase = "ACTIVE" | "SUBMITTING" | "EXPIRED" | "PAID";

export type KujiCheckoutClock = Readonly<{
  deadlineMs: number;
  serverClockOffsetMs: number;
  valid: boolean;
}>;

const INVALID_KUJI_CHECKOUT_CLOCK: KujiCheckoutClock = Object.freeze({
  deadlineMs: 0,
  serverClockOffsetMs: 0,
  valid: false,
});

/**
 * Captures the server-to-device clock offset once when checkout is entered.
 * Later countdown reads always use the absolute deadline, so rerenders and
 * app backgrounding cannot grant more time.
 */
export function createKujiCheckoutClock(
  expiresAt: string | undefined,
  serverNow: string | undefined,
  clientNowMs: number,
): KujiCheckoutClock {
  if (!expiresAt || !Number.isFinite(clientNowMs)) return INVALID_KUJI_CHECKOUT_CLOCK;

  const deadlineMs = Date.parse(expiresAt);
  if (!Number.isFinite(deadlineMs)) return INVALID_KUJI_CHECKOUT_CLOCK;

  let serverClockOffsetMs = 0;
  if (serverNow !== undefined) {
    const serverNowMs = Date.parse(serverNow);
    if (!Number.isFinite(serverNowMs)) return INVALID_KUJI_CHECKOUT_CLOCK;
    serverClockOffsetMs = serverNowMs - clientNowMs;
  }

  const serverAdjustedNowMs = clientNowMs + serverClockOffsetMs;
  if (deadlineMs <= Math.max(clientNowMs, serverAdjustedNowMs)) {
    return INVALID_KUJI_CHECKOUT_CLOCK;
  }

  return Object.freeze({ deadlineMs, serverClockOffsetMs, valid: true });
}

export function kujiCheckoutRemainingSeconds(
  clock: KujiCheckoutClock,
  clientNowMs: number,
): number {
  if (!clock.valid || !Number.isFinite(clientNowMs)) return 0;

  const serverAdjustedNowMs = clientNowMs + clock.serverClockOffsetMs;
  // A stale serverNow snapshot must never extend an absolute checkout lease.
  const effectiveNowMs = Math.max(clientNowMs, serverAdjustedNowMs);
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
