import type { CommerceCapability } from "@/lib/runtime-config";

/**
 * How long a previously verified public config answer may keep serving
 * commerce and legal decisions after a refresh fails. Beyond this window, or
 * when no refresh has ever succeeded, the app falls back to "unknown" (nulls)
 * so login and LIVE commerce stay fail-closed.
 */
export const PUBLIC_CONFIG_GRACE_MS = 10 * 60_000;

export type RequiredPolicyVersions = {
  terms: string;
  privacy: string;
};

export type PublicConfigResponse = {
  commerceMode: CommerceCapability;
  requiredPolicyVersions: RequiredPolicyVersions;
};

export type PublicConfigState = {
  serverCapability: CommerceCapability | null;
  requiredPolicyVersions: RequiredPolicyVersions | null;
  /** Wall-clock time of the last verified server answer, or `null` before any. */
  lastSuccessAt: number | null;
};

export const EMPTY_PUBLIC_CONFIG_STATE: PublicConfigState = {
  serverCapability: null,
  requiredPolicyVersions: null,
  lastSuccessAt: null,
};

export type ResolvePublicConfigStateInput = {
  previous: Pick<PublicConfigState, "serverCapability" | "requiredPolicyVersions">;
  fetched: PublicConfigResponse | null;
  error?: unknown;
  now: number;
  lastSuccessAt: number | null;
  graceMs?: number;
};

/**
 * Pure transition for the public commerce/legal config.
 *
 * - A valid fetched answer always replaces the state, including an explicit
 *   `PRELAUNCH` commerce mode, and stamps `lastSuccessAt`.
 * - On failure, the previous verified answer is kept only while
 *   `now - lastSuccessAt <= graceMs`.
 * - After the grace window, or when there was never a success, every value is
 *   `null` so callers treat commerce and legal versions as unknown.
 */
export function resolvePublicConfigState({
  previous,
  fetched,
  now,
  lastSuccessAt,
  graceMs = PUBLIC_CONFIG_GRACE_MS,
}: ResolvePublicConfigStateInput): PublicConfigState {
  if (fetched) {
    return {
      serverCapability: fetched.commerceMode,
      requiredPolicyVersions: fetched.requiredPolicyVersions,
      lastSuccessAt: now,
    };
  }
  const withinGrace = lastSuccessAt !== null
    && Number.isFinite(lastSuccessAt)
    && now - lastSuccessAt >= 0
    && now - lastSuccessAt <= graceMs
    && previous.serverCapability !== null
    && previous.requiredPolicyVersions !== null;
  if (withinGrace) {
    return {
      serverCapability: previous.serverCapability,
      requiredPolicyVersions: previous.requiredPolicyVersions,
      lastSuccessAt,
    };
  }
  return { ...EMPTY_PUBLIC_CONFIG_STATE };
}

/** Validates the `/v1/public/config` body; anything else counts as a failed refresh. */
export function parsePublicConfig(value: unknown): PublicConfigResponse | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.commerceMode !== "PRELAUNCH" && candidate.commerceMode !== "LIVE") return null;
  if (!candidate.requiredPolicyVersions || typeof candidate.requiredPolicyVersions !== "object") return null;
  const policies = candidate.requiredPolicyVersions as Record<string, unknown>;
  if (
    typeof policies.terms !== "string"
    || policies.terms.length === 0
    || typeof policies.privacy !== "string"
    || policies.privacy.length === 0
  ) return null;
  return {
    commerceMode: candidate.commerceMode,
    requiredPolicyVersions: { terms: policies.terms, privacy: policies.privacy },
  };
}
