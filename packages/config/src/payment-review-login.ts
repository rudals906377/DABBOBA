import type { ApiConfig } from "./index.js";

export const PAYMENT_REVIEW_PROJECT_REF = "lyzcyrdiazorjaqlgblr";
export type PaymentReviewLogin = { email: string; subject: string; expiresAt: string };

export function assertPaymentReviewBoundary(config: Pick<ApiConfig, "environmentTier" | "databaseUrl" | "supabaseUrl" | "portOne">): void {
  const database = new URL(config.databaseUrl);
  const project = PAYMENT_REVIEW_PROJECT_REF;
  if (config.environmentTier !== "STAGING"
    || config.supabaseUrl !== `https://${project}.supabase.co`
    || config.portOne?.channelEnvironment !== "TEST"
    || !(database.hostname === `db.${project}.supabase.co`
      || (database.hostname.endsWith(".pooler.supabase.com")
        && decodeURIComponent(database.username).endsWith(`.${project}`)))) {
    throw new Error("Payment review login requires the pinned STAGING project and TEST payment rail");
  }
}

export function loadPaymentReviewLogin(
  env: Record<string, string | undefined>,
  config: Parameters<typeof assertPaymentReviewBoundary>[0],
  now = Date.now(),
): PaymentReviewLogin | null {
  const enabled = env.PAYMENT_REVIEW_LOGIN_ENABLED?.trim() || "false";
  const email = env.PAYMENT_REVIEW_LOGIN_EMAIL?.trim().toLowerCase();
  const subject = env.PAYMENT_REVIEW_LOGIN_SUBJECT?.trim();
  const expiresAt = env.PAYMENT_REVIEW_LOGIN_EXPIRES_AT?.trim();
  if (enabled !== "true" && enabled !== "false") throw new Error("PAYMENT_REVIEW_LOGIN_ENABLED must be true or false");
  if (enabled === "false") return null;
  assertPaymentReviewBoundary(config);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254
    || !subject || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subject)
    || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("Payment review login requires one email, Auth subject and fixed expiry");
  }
  // Expired settings fail closed at the route, without taking the whole API down.
  if (Date.parse(expiresAt) > now + 30 * 86_400_000) throw new Error("Payment review login expiry must be within 30 days");
  return { email, subject, expiresAt: new Date(expiresAt).toISOString() };
}
