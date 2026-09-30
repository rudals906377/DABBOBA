export const PHONE_OTP_TTL_MS = 10 * 60_000;
export const PHONE_OTP_RESEND_COOLDOWN_MS = 60_000;

export type PendingPhoneOtp = {
  phone: string;
  requestedAt: number;
  expiresAt: number;
  resendAvailableAt: number;
};

// The initial public service accepts Korean 010 mobile numbers only.
export function normalizeKoreanMobileNumber(value: string): string {
  const compact = value.replace(/[\s-]/g, "");
  if (/^010\d{8}$/.test(compact)) return `+82${compact.slice(1)}`;
  if (/^\+8210\d{8}$/.test(compact)) return compact;
  throw new Error("010으로 시작하는 휴대폰 번호를 확인해 주세요.");
}

export function parsePendingPhoneOtp(raw: string | null, nowMs = Date.now()): PendingPhoneOtp | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingPhoneOtp>;
    if (
      typeof value.phone !== "string"
      || typeof value.requestedAt !== "number"
      || typeof value.expiresAt !== "number"
      || typeof value.resendAvailableAt !== "number"
      || !Number.isSafeInteger(value.requestedAt)
      || !Number.isSafeInteger(value.expiresAt)
      || !Number.isSafeInteger(value.resendAvailableAt)
      || value.requestedAt <= 0
      || value.expiresAt <= value.requestedAt
      || value.expiresAt - value.requestedAt > PHONE_OTP_TTL_MS
      || value.resendAvailableAt < value.requestedAt
      || value.resendAvailableAt - value.requestedAt > PHONE_OTP_RESEND_COOLDOWN_MS
      || !/^\+8210\d{8}$/.test(value.phone)
      || value.expiresAt <= nowMs
    ) return null;
    return value as PendingPhoneOtp;
  } catch {
    return null;
  }
}
