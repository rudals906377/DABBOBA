export function normalizedCheckoutPointInput(raw: string, pointBalance: number, subtotal: number) {
  const trimmed = raw.trim();
  const validInteger = /^\d+$/.test(trimmed);
  const validGroupedInteger = /^\d{1,3}(,\d{3})+$/.test(trimmed);
  const digits = (validInteger || validGroupedInteger)
    ? trimmed.replace(/,/g, "").replace(/^0+(?=\d)/, "").slice(0, 10)
    : "0";
  const parsed = Number(digits || "0");
  const maximum = Math.max(0, Math.min(
    Number.isSafeInteger(pointBalance) ? pointBalance : 0,
    Number.isSafeInteger(subtotal) ? subtotal : 0,
  ));
  return String(Number.isSafeInteger(parsed) ? Math.min(parsed, maximum) : 0);
}

export function checkoutPointUsed(pointInput: string, pointBalance: number, subtotal: number) {
  return Number(normalizedCheckoutPointInput(pointInput, pointBalance, subtotal));
}

export function checkoutNeedsAgreement(pendingGachaOrderRecovery: boolean) {
  return !pendingGachaOrderRecovery;
}

export type CheckoutPaymentAvailability = "live" | "demo" | "points" | "unavailable";

export function checkoutPaymentAvailability(
  paymentTotal: number,
  demoEnabled: boolean,
  liveEnabled = false,
): CheckoutPaymentAvailability {
  if (Number.isFinite(paymentTotal) && paymentTotal <= 0) return "points";
  if (liveEnabled) return "live";
  return demoEnabled ? "demo" : "unavailable";
}

export function toggleCheckoutNoticeState(
  current: Readonly<Record<string, boolean>>,
  sectionId: string,
) {
  return { ...current, [sectionId]: !current[sectionId] };
}
