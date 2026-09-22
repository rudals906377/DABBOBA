import { ensureInternalCustomerSession } from "@/features/demo/demo-api";
import type { StoredAuthTokens } from "@/lib/session-store";

/** @deprecated Use ensureInternalCustomerSession directly in customer flows. */
export async function ensureDevelopmentAuthSession(
  apiBaseUrl: string,
): Promise<StoredAuthTokens> {
  const tokens = await ensureInternalCustomerSession(apiBaseUrl);
  if (!tokens) throw new Error("내부 고객 로그인을 사용할 수 없는 서버입니다.");
  return tokens;
}
