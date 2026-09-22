import type { KujiRoomEntryState } from "@/features/kuji/kuji-room-api";

export const KUJI_DRAW_LEASE_SECONDS = 5 * 60;

export type KujiDrawLeaseClock = Readonly<{
  deadlineMs: number;
  serverClockOffsetMs: number;
  expiredByServer: boolean;
  valid: boolean;
}>;

const INVALID_DRAW_LEASE_CLOCK: KujiDrawLeaseClock = Object.freeze({
  deadlineMs: 0,
  serverClockOffsetMs: 0,
  expiredByServer: true,
  valid: false,
});

/**
 * Uses the server snapshot as the time origin so a device clock difference or
 * screen remount cannot restart the five-minute room occupancy lease.
 */
export function createKujiDrawLeaseClock(
  drawingExpiresAt: string | null,
  serverNow: string,
  state: KujiRoomEntryState,
  clientNowMs: number,
): KujiDrawLeaseClock {
  if (
    (state !== "DRAWING" && state !== "EXPIRED")
    || !drawingExpiresAt
    || !Number.isFinite(clientNowMs)
  ) return INVALID_DRAW_LEASE_CLOCK;

  const deadlineMs = Date.parse(drawingExpiresAt);
  const serverNowMs = Date.parse(serverNow);
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(serverNowMs)) {
    return INVALID_DRAW_LEASE_CLOCK;
  }

  return Object.freeze({
    deadlineMs,
    serverClockOffsetMs: serverNowMs - clientNowMs,
    expiredByServer: state === "EXPIRED",
    valid: true,
  });
}

export function kujiDrawLeaseRemainingSeconds(
  clock: KujiDrawLeaseClock,
  clientNowMs: number,
): number {
  if (!clock.valid || clock.expiredByServer || !Number.isFinite(clientNowMs)) return 0;
  const serverAdjustedNowMs = clientNowMs + clock.serverClockOffsetMs;
  const remaining = Math.ceil((clock.deadlineMs - serverAdjustedNowMs) / 1_000);
  if (!Number.isFinite(remaining)) return 0;
  return Math.max(0, Math.min(KUJI_DRAW_LEASE_SECONDS, remaining));
}

export function formatKujiDrawLeaseRemainingTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.min(KUJI_DRAW_LEASE_SECONDS, Math.trunc(seconds)))
    : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
