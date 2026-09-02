import {
  createDabbobaClient,
  type DabbobaClientOptions,
  type UnauthorizedResponse,
} from "@dabboba/api-client";
import { clearAuthTokens, readAuthTokens } from "@/lib/session-store";

type MobileDabbobaClientOptions = Omit<DabbobaClientOptions, "onUnauthorized">;

let unauthorizedCleanup: Promise<void> | null = null;

export function createMobileDabbobaClient(options: MobileDabbobaClientOptions) {
  return createDabbobaClient({
    ...options,
    onUnauthorized: clearExpiredCustomerSession,
  });
}

async function clearExpiredCustomerSession({ request }: UnauthorizedResponse): Promise<void> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return;
  const failedAccessToken = authorization.slice("Bearer ".length);
  if (!unauthorizedCleanup) {
    unauthorizedCleanup = readAuthTokens()
      .then((current) => (
        current?.accessToken === failedAccessToken
          ? clearAuthTokens()
          : undefined
      ))
      .catch(() => undefined)
      .finally(() => {
        unauthorizedCleanup = null;
      });
  }
  await unauthorizedCleanup;
}
