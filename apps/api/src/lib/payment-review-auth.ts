import { assertPaymentReviewBoundary, type ApiConfig } from "@dabboba/config";
import { AppError, notFound, unauthorized } from "./errors.js";
import { readBoundedAuthJson, verifySupabaseCustomerAccessToken, type VerifiedSupabaseCustomer } from "./supabase-auth.js";

export function activePaymentReviewLogin(config: ApiConfig, now = Date.now()) {
  if (!config.paymentReviewLogin) return null;
  try { assertPaymentReviewBoundary(config); } catch { return null; }
  return Date.parse(config.paymentReviewLogin.expiresAt) > now + 60_000
    ? config.paymentReviewLogin : null;
}

/** Passwords go only to the pinned Auth server; no guessed identities or development sessions. */
export async function authenticatePaymentReviewer(
  config: ApiConfig,
  email: string,
  password: string,
  dependencies: { fetch?: typeof fetch; verifyAccessToken?: typeof verifySupabaseCustomerAccessToken } = {},
): Promise<VerifiedSupabaseCustomer> {
  const review = activePaymentReviewLogin(config);
  if (!review || !config.supabasePublishableKey) throw notFound();
  const login = email.trim().toLowerCase();
  // The short ID resolves only inside this already-pinned, expiring TEST login.
  if (login !== "pg" && login !== review.email) throw unauthorized("심사 아이디 또는 비밀번호를 확인해 주세요.");
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
