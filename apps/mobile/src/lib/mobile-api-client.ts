import {
  createDabbobaClient,
  type DabbobaClientOptions,
  type UnauthorizedResponse,
} from "@dabboba/api-client";
import {
  ensureCustomerSessionForUse,
  forgetCustomerSessionValidation,
} from "@/lib/customer-session";
import {
  clearAuthTokensIfCurrent,
  readAuthTokens,
} from "@/lib/session-store";
import { createPolicyAwareFetch } from "@/features/auth/policy-reconsent";

type MobileDabbobaClientOptions = Omit<DabbobaClientOptions, "onUnauthorized">;

let unauthorizedCleanup: Promise<void> | null = null;

export function createMobileDabbobaClient(options: MobileDabbobaClientOptions) {
  const originalToken = options.token;
  const networkFetch = options.fetch ?? globalThis.fetch;
  return createDabbobaClient({
    ...options,
    fetch: createPolicyAwareFetch(networkFetch),
    ...(originalToken ? {
      token: async () => {
        const requestedToken = await originalToken();
        if (!requestedToken) return null;
        // `readAuthTokens` serves an in-memory copy invalidated by every token
        // change, so this check and the session lifecycle below read
        // SecureStore at most once per request.
        const stored = await readAuthTokens();
        if (stored?.accessToken !== requestedToken) return requestedToken;
        return (await ensureCustomerSessionForUse(options.baseUrl))?.accessToken ?? null;
      },
    } : {}),
    onUnauthorized: clearExpiredCustomerSession,
  });
}

async function clearExpiredCustomerSession({ request }: UnauthorizedResponse): Promise<void> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return;
  const failedAccessToken = authorization.slice("Bearer ".length);
  if (!unauthorizedCleanup) {
    unauthorizedCleanup = readAuthTokens()
      .then(async (current) => {
        if (current?.accessToken !== failedAccessToken) return;
        await clearAuthTokensIfCurrent(current);
        forgetCustomerSessionValidation(failedAccessToken);
      })
      .catch(() => undefined)
      .finally(() => {
        unauthorizedCleanup = null;
      });
  }
  await unauthorizedCleanup;
}
