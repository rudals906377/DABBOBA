/**
 * Cloudflare Access is the administrator console's second factor. Access sits in
 * front of admin.dabboba.net and signs every request it lets through with a
 * short-lived RS256 JWT in `Cf-Access-Jwt-Assertion`. The console verifies that
 * token itself, as Cloudflare recommends, so a misconfigured Access policy or a
 * second route to the Worker cannot reach the password login without Access.
 *
 * The gate turns on when both ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN and
 * ADMIN_CLOUDFLARE_ACCESS_AUD are set. Either one alone, or a key download that
 * fails before any key was verified, closes the console instead of opening it.
 */

export type CloudflareAccessConfig = {
  teamDomain: string;
  audience: string;
  issuer: string;
  certsUrl: string;
};

export type CloudflareAccessIdentity = {
  email: string | null;
  subject: string | null;
};

export type CloudflareAccessDecision =
  | { allowed: true; identity: CloudflareAccessIdentity | null }
  | { allowed: false; status: 403 | 503 };

type Environment = Record<string, string | undefined>;
type KeyFetcher = (url: string) => Promise<unknown>;

export const CLOUDFLARE_ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const AUDIENCE = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 8_192;
const KEY_TTL_MS = 60 * 60 * 1_000;
const UNKNOWN_KEY_REFETCH_MS = 30 * 1_000;
const CLOCK_SKEW_SECONDS = 30;
const KEY_FETCH_TIMEOUT_MS = 5_000;

export function readCloudflareAccessConfig(env: Environment): CloudflareAccessConfig | null {
  const teamDomain = env.ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim().toLowerCase() || "";
  const audience = env.ADMIN_CLOUDFLARE_ACCESS_AUD?.trim().toLowerCase() || "";
  if (!teamDomain && !audience) return null;
  if (!teamDomain || !audience) {
    throw new Error("ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN and ADMIN_CLOUDFLARE_ACCESS_AUD must be configured together");
  }
  if (!TEAM_DOMAIN.test(teamDomain)) {
    throw new Error("ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN must be the <team>.cloudflareaccess.com host");
  }
  if (!AUDIENCE.test(audience)) {
    throw new Error("ADMIN_CLOUDFLARE_ACCESS_AUD must be the 64-character Access application audience tag");
  }
  return {
    teamDomain,
    audience,
    issuer: `https://${teamDomain}`,
    certsUrl: `https://${teamDomain}/cdn-cgi/access/certs`,
  };
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function base64UrlJson(value: string): Record<string, unknown> | null {
  const bytes = base64UrlBytes(value);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function defaultFetchKeys(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(KEY_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Cloudflare Access keys returned ${response.status}`);
  return response.json();
}

async function importSigningKeys(document: unknown): Promise<Map<string, CryptoKey>> {
  const entries = document && typeof document === "object" ? (document as { keys?: unknown }).keys : undefined;
  if (!Array.isArray(entries)) throw new Error("Cloudflare Access keys response has no key list");
  const keys = new Map<string, CryptoKey>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const jwk = entry as { kid?: unknown; kty?: unknown; n?: unknown; e?: unknown; use?: unknown; alg?: unknown };
    if (typeof jwk.kid !== "string" || jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") continue;
    if (jwk.use !== undefined && jwk.use !== "sig") continue;
    if (jwk.alg !== undefined && jwk.alg !== "RS256") continue;
    try {
      keys.set(jwk.kid, await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ));
    } catch {
      // A malformed key is skipped; tokens signed with it fail verification.
    }
  }
  if (!keys.size) throw new Error("Cloudflare Access keys response has no usable RS256 key");
  return keys;
}

/**
 * Returns a verifier bound to one Access application. Signing keys are cached
 * for an hour and refetched early (at most every 30 seconds) when a token names
 * a key the cache does not hold, which is how Access key rotation shows up.
 * Throws only when no key set has ever been loaded, so callers fail closed.
 */
export function createCloudflareAccessVerifier(
  config: CloudflareAccessConfig,
  { fetchKeys = defaultFetchKeys, now = () => Date.now() }: { fetchKeys?: KeyFetcher; now?: () => number } = {},
) {
  let cached: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;
  let loading: Promise<Map<string, CryptoKey>> | null = null;

  function load(): Promise<Map<string, CryptoKey>> {
    loading ??= (async () => {
      try {
        const keys = await importSigningKeys(await fetchKeys(config.certsUrl));
        cached = { keys, fetchedAt: now() };
        return keys;
      } catch (error) {
        // Keep serving the last verified key set when a refresh fails.
        if (cached) return cached.keys;
        throw error;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  async function keyFor(kid: string): Promise<CryptoKey | null> {
    const age = cached ? now() - cached.fetchedAt : Infinity;
    const keys = !cached || age >= KEY_TTL_MS ? await load() : cached.keys;
    const key = keys.get(kid);
    if (key) return key;
    if (cached && now() - cached.fetchedAt < UNKNOWN_KEY_REFETCH_MS) return null;
    return (await load()).get(kid) ?? null;
  }

  return async function verify(token: string | null | undefined): Promise<CloudflareAccessIdentity | null> {
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = base64UrlJson(encodedHeader);
    const payload = base64UrlJson(encodedPayload);
    const signature = base64UrlBytes(encodedSignature);
    if (!header || !payload || !signature) return null;
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

    const nowSeconds = Math.floor(now() / 1_000);
    if (payload.iss !== config.issuer) return null;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(config.audience)) return null;
    if (typeof payload.exp !== "number" || nowSeconds >= payload.exp + CLOCK_SKEW_SECONDS) return null;
    if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS)) return null;
    if (payload.iat !== undefined && (typeof payload.iat !== "number" || payload.iat > nowSeconds + CLOCK_SKEW_SECONDS)) return null;
    if (payload.type !== undefined && payload.type !== "app") return null;

    const key = await keyFor(header.kid);
    if (!key) return null;
    const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signed);
    if (!valid) return null;
    return {
      email: typeof payload.email === "string" ? payload.email : null,
      subject: typeof payload.sub === "string" ? payload.sub : null,
    };
  };
}

/**
 * Per-process gate used by the console proxy. It rebuilds its verifier only when
 * the configured Access application changes.
 */
export function createCloudflareAccessGate(options: { fetchKeys?: KeyFetcher; now?: () => number } = {}) {
  let current: { id: string; verify: ReturnType<typeof createCloudflareAccessVerifier> } | null = null;

  return async function check(headers: Headers, env: Environment): Promise<CloudflareAccessDecision> {
    let config: CloudflareAccessConfig | null;
    try {
      config = readCloudflareAccessConfig(env);
    } catch {
      return { allowed: false, status: 503 };
    }
    if (!config) return { allowed: true, identity: null };

    const id = `${config.teamDomain} ${config.audience}`;
    if (current?.id !== id) current = { id, verify: createCloudflareAccessVerifier(config, options) };
    try {
      const identity = await current.verify(headers.get(CLOUDFLARE_ACCESS_JWT_HEADER));
      return identity ? { allowed: true, identity } : { allowed: false, status: 403 };
    } catch {
      return { allowed: false, status: 503 };
    }
  };
}
