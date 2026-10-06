import { assertPaymentReviewBoundary, assertStoreReviewBoundary, type ApiConfig, type PaymentReviewLogin } from "@dabboba/config";
import { AppError, notFound, unauthorized } from "./errors.js";
import { readBoundedAuthJson, verifySupabaseCustomerAccessToken, type VerifiedSupabaseCustomer } from "./supabase-auth.js";

/**
 * A dedicated password-verified customer for one review audience: the PG
 * card review on the pinned staging project, or app-store review on the pinned
 * production project. Each is one Auth user with a fixed expiry.
 */
export type ReviewLoginKind = "PAYMENT" | "STORE";
export type ConfiguredReviewLogin = { kind: ReviewLoginKind; login: PaymentReviewLogin };

function withinBoundary(config: ApiConfig, kind: ReviewLoginKind): boolean {
  try {
    if (kind === "PAYMENT") assertPaymentReviewBoundary(config);
    else assertStoreReviewBoundary(config);
    return true;
  } catch {
    return false;
  }
}

/** Review logins present in configuration whose pinned environment matches. */
export function configuredReviewLogins(config: ApiConfig): ConfiguredReviewLogin[] {
  const configured: ConfiguredReviewLogin[] = [];
  if (config.paymentReviewLogin && withinBoundary(config, "PAYMENT")) {
    configured.push({ kind: "PAYMENT", login: config.paymentReviewLogin });
  }
  if (config.storeReviewLogin && withinBoundary(config, "STORE")) {
    configured.push({ kind: "STORE", login: config.storeReviewLogin });
  }
  return configured;
}

export function isReviewLoginActive(review: ConfiguredReviewLogin, now = Date.now()): boolean {
  return Date.parse(review.login.expiresAt) > now + 60_000;
}

function activeReviewLogin(config: ApiConfig, kind: ReviewLoginKind, now: number): PaymentReviewLogin | null {
  const review = configuredReviewLogins(config).find((candidate) => candidate.kind === kind);
  return review && isReviewLoginActive(review, now) ? review.login : null;
}

export function activePaymentReviewLogin(config: ApiConfig, now = Date.now()) {
  return activeReviewLogin(config, "PAYMENT", now);
}

export function activeStoreReviewLogin(config: ApiConfig, now = Date.now()) {
  return activeReviewLogin(config, "STORE", now);
}

/** Passwords go only to the pinned Auth server; no guessed identities or development sessions. */
export async function authenticateReviewer(
  config: ApiConfig,
  kind: ReviewLoginKind,
  email: string,
  password: string,
  dependencies: { fetch?: typeof fetch; verifyAccessToken?: typeof verifySupabaseCustomerAccessToken } = {},
): Promise<VerifiedSupabaseCustomer> {
  const review = activeReviewLogin(config, kind, Date.now());
  if (!review || !config.supabasePublishableKey) throw notFound();
  const login = email.trim().toLowerCase();
  // The short ID resolves only inside the already-pinned, expiring TEST PG review.
  if (!(kind === "PAYMENT" && login === "pg") && login !== review.email) {
    throw unauthorized("심사 아이디 또는 비밀번호를 확인해 주세요.");
  }
  let token: string;
  try {
    const response = await (dependencies.fetch || fetch)(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
      headers: { apikey: config.supabasePublishableKey, "content-type": "application/json" },
      body: JSON.stringify({ email: review.email, password }),
    });
    if (response.status === 429) throw new AppError(429, "REVIEW_LOGIN_RATE_LIMITED", "로그인 시도가 많아요. 잠시 후 다시 시도해 주세요.");
    if (response.status >= 500) throw new AppError(503, "REVIEW_AUTH_UNAVAILABLE", "심사 로그인 연결이 지연되고 있어요.");
    if (!response.ok) throw unauthorized("심사 아이디 또는 비밀번호를 확인해 주세요.");
    const body = await readBoundedAuthJson(response) as { access_token?: unknown };
    if (typeof body.access_token !== "string" || body.access_token.length > 16_384) throw unauthorized();
    token = body.access_token;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "REVIEW_AUTH_UNAVAILABLE", "심사 로그인 연결을 확인하지 못했어요.");
  }
  const claims = await (dependencies.verifyAccessToken || verifySupabaseCustomerAccessToken)(token, {
    supabaseUrl: config.supabaseUrl!, audience: config.supabaseJwtAudience || "authenticated",
    publishableKey: config.supabasePublishableKey,
  });
  if (claims.subject !== review.subject || claims.email !== review.email
    || claims.providers.length !== 1 || claims.providers[0] !== "EMAIL") throw unauthorized();
  return claims;
}

export function authenticatePaymentReviewer(
  config: ApiConfig,
  email: string,
  password: string,
  dependencies: { fetch?: typeof fetch; verifyAccessToken?: typeof verifySupabaseCustomerAccessToken } = {},
): Promise<VerifiedSupabaseCustomer> {
  return authenticateReviewer(config, "PAYMENT", email, password, dependencies);
}
