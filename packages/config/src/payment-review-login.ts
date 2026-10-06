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

function loadReviewLogin(
  env: Record<string, string | undefined>,
  prefix: "PAYMENT_REVIEW_LOGIN" | "STORE_REVIEW_LOGIN",
  label: string,
  assertBoundary: () => void,
  now: number,
): PaymentReviewLogin | null {
  const enabled = env[`${prefix}_ENABLED`]?.trim() || "false";
  const email = env[`${prefix}_EMAIL`]?.trim().toLowerCase();
  const subject = env[`${prefix}_SUBJECT`]?.trim();
  const expiresAt = env[`${prefix}_EXPIRES_AT`]?.trim();
  if (enabled !== "true" && enabled !== "false") throw new Error(`${prefix}_ENABLED must be true or false`);
  if (enabled === "false") return null;
  assertBoundary();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254
    || !subject || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subject)
    || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error(`${label} requires one email, Auth subject and fixed expiry`);
  }
  // Expired settings fail closed at the route, without taking the whole API down.
  if (Date.parse(expiresAt) > now + 30 * 86_400_000) throw new Error(`${label} expiry must be within 30 days`);
  return { email, subject, expiresAt: new Date(expiresAt).toISOString() };
}

export function loadPaymentReviewLogin(
  env: Record<string, string | undefined>,
  config: Parameters<typeof assertPaymentReviewBoundary>[0],
  now = Date.now(),
): PaymentReviewLogin | null {
  return loadReviewLogin(env, "PAYMENT_REVIEW_LOGIN", "Payment review login", () => assertPaymentReviewBoundary(config), now);
}

/** The friend-owned production project that app-store reviewers sign in to. */
export const STORE_REVIEW_PROJECT_REF = "rconfxsykttfvznakile";
export type StoreReviewLogin = PaymentReviewLogin;

/**
 * App Store / Google Play reviewer access: one password-verified customer on
 * the pinned production project only. It is not a customer login method and
 * never authenticates administrators.
 */
export function assertStoreReviewBoundary(config: Pick<ApiConfig, "environmentTier" | "databaseUrl" | "supabaseUrl">): void {
  const database = new URL(config.databaseUrl);
  const project = STORE_REVIEW_PROJECT_REF;
  if (config.environmentTier !== "PRODUCTION"
    || config.supabaseUrl !== `https://${project}.supabase.co`
    || !(database.hostname === `db.${project}.supabase.co`
      || (database.hostname.endsWith(".pooler.supabase.com")
        && decodeURIComponent(database.username).endsWith(`.${project}`)))) {
    throw new Error("Store review login requires the pinned PRODUCTION project");
  }
}

export function loadStoreReviewLogin(
  env: Record<string, string | undefined>,
  config: Parameters<typeof assertStoreReviewBoundary>[0],
  now = Date.now(),
): StoreReviewLogin | null {
  return loadReviewLogin(env, "STORE_REVIEW_LOGIN", "Store review login", () => assertStoreReviewBoundary(config), now);
}

/**
 * Optional secret shared only with the public review site worker, which signs
 * the visitor IP so the review login limit applies per reviewer. Ignored while
 * the review login is disabled; otherwise it must be a distinct server secret.
 */
export function loadPaymentReviewProxySecret(
  env: Record<string, string | undefined>,
  review: PaymentReviewLogin | null,
  otherSecrets: readonly (string | null | undefined)[],
): string | null {
  const secret = env.PAYMENT_REVIEW_PROXY_SECRET?.trim();
  if (!review || !secret) return null;
  const size = Buffer.byteLength(secret, "utf8");
  if (size < 32 || size > 512 || /[\r\n]/.test(secret) || /(?:change-me|local-development)/i.test(secret)
    || otherSecrets.some((other) => other && other === secret)) {
    throw new Error("PAYMENT_REVIEW_PROXY_SECRET must be a distinct 32-512 byte server-only secret");
  }
  return secret;
}
