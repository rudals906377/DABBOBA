const DAY_MS = 86_400_000;

export type StorageExpiryState = {
  expiresAtMs: number;
  remainingDays: number;
  isExpired: boolean;
};

export function storageExpiryState(
  storageExpiresAt: string | null | undefined,
  nowMs = Date.now(),
): StorageExpiryState | null {
  const expiresAtMs = storageExpiresAt ? Date.parse(storageExpiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) return null;

  const remainingMs = expiresAtMs - nowMs;
  return {
    expiresAtMs,
    remainingDays: Math.max(0, Math.ceil(remainingMs / DAY_MS)),
    isExpired: remainingMs <= 0,
  };
}
