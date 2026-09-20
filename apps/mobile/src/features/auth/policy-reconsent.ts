export type RequiredPolicyVersions = {
  terms: string;
  privacy: string;
};

export type PolicyReconsentChallenge = {
  accessToken: string;
  requiredPolicyVersions: RequiredPolicyVersions;
};

export type PolicyReconsentHandler = (
  challenge: PolicyReconsentChallenge,
) => boolean | Promise<boolean>;

type FetchLike = typeof globalThis.fetch;

const POLICY_VERSION = /^\d{4}-\d{2}-\d{2}$/;
let registeredHandler: PolicyReconsentHandler | null = null;
let activeChallenge: PolicyReconsentChallenge | null = null;
let activeRecovery: Promise<boolean> | null = null;

export function registerPolicyReconsentHandler(handler: PolicyReconsentHandler): () => void {
  registeredHandler = handler;
  return () => {
    if (registeredHandler === handler) registeredHandler = null;
  };
}

export async function requestPolicyReconsent(
  challenge: PolicyReconsentChallenge,
): Promise<boolean> {
  if (activeRecovery && activeChallenge) {
    if (sameChallenge(activeChallenge, challenge)) return activeRecovery;
    return false;
  }
  if (!registeredHandler) return false;

  const handler = registeredHandler;
  activeChallenge = challenge;
  const recovery = Promise.resolve()
    .then(() => handler(challenge))
    .catch(() => false)
    .then((accepted) => accepted === true);
  activeRecovery = recovery;
  void recovery.finally(() => {
    if (activeRecovery !== recovery) return;
    activeRecovery = null;
    activeChallenge = null;
  });
  return recovery;
}

export function createPolicyAwareFetch(
  networkFetch: FetchLike,
  recover: (challenge: PolicyReconsentChallenge) => Promise<boolean> = requestPolicyReconsent,
): FetchLike {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const accessToken = dabbobaBearerToken(request);
    const retryRequest = accessToken && policyRecoveryAllowed(request)
      ? cloneRequest(request)
      : null;
    const response = await networkFetch(request);
    if (response.status !== 428 || !accessToken || !retryRequest) return response;

    const requiredPolicyVersions = await legalAcceptanceVersions(response);
    if (!requiredPolicyVersions) return response;
    const accepted = await recover({ accessToken, requiredPolicyVersions });
    if (!accepted) return response;

    // The retry bypasses this wrapper deliberately. Every original request can
    // therefore be replayed at most once, even if the server still returns 428.
    return networkFetch(retryRequest);
  };
}

function sameChallenge(left: PolicyReconsentChallenge, right: PolicyReconsentChallenge): boolean {
  return left.accessToken === right.accessToken
    && left.requiredPolicyVersions.terms === right.requiredPolicyVersions.terms
    && left.requiredPolicyVersions.privacy === right.requiredPolicyVersions.privacy;
}

function dabbobaBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim() || "";
  const match = /^Bearer ([A-Za-z0-9_-]{16,4096})$/.exec(value);
  return match?.[1] || null;
}

function policyRecoveryAllowed(request: Request): boolean {
  let path: string;
  try {
    path = new URL(request.url).pathname;
  } catch {
    return false;
  }
  if (path === "/v1/auth/logout" || path === "/v1/auth/logout-others") return false;
  if (path === "/v1/account/policy-acceptances") return false;
  if (path === "/v1/account/deletion-preview" || path === "/v1/account/deletion-request") return false;
  if (path.startsWith("/v1/account/deletion-requests/")) return false;
  return true;
}

function cloneRequest(request: Request): Request | null {
  try {
    return request.clone();
  } catch {
    return null;
  }
}

async function legalAcceptanceVersions(response: Response): Promise<RequiredPolicyVersions | null> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const envelope = body as Record<string, unknown>;
  const error = envelope.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const detail = error as Record<string, unknown>;
  if (detail.code !== "LEGAL_ACCEPTANCE_REQUIRED") return null;
  return parseRequiredPolicyVersions(detail.details)
    ?? parseRequiredPolicyVersions(envelope.details)
    ?? parseRequiredPolicyVersions(detail.requiredPolicyVersions)
    ?? parseRequiredPolicyVersions(envelope.requiredPolicyVersions);
}

function parseRequiredPolicyVersions(value: unknown): RequiredPolicyVersions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = "requiredPolicyVersions" in value
    ? (value as { requiredPolicyVersions?: unknown }).requiredPolicyVersions
    : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const versions = candidate as Record<string, unknown>;
  return typeof versions.terms === "string"
    && typeof versions.privacy === "string"
    && POLICY_VERSION.test(versions.terms)
    && POLICY_VERSION.test(versions.privacy)
    ? { terms: versions.terms, privacy: versions.privacy }
    : null;
}
