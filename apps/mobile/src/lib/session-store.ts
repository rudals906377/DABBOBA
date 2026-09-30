import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "dabboba.auth.access-token";
const REFRESH_TOKEN_KEY = "dabboba.auth.refresh-token";
const EXPIRES_AT_KEY = "dabboba.auth.expires-at";
export const SESSION_RECORD_KEY = "dabboba.auth.session.v1";
/**
 * When a later release stores `"1"` here, every supported installed build
 * reads the versioned record, so rotations stop mirroring tokens into the
 * legacy individual keys. Reading and clearing those keys is unchanged.
 */
export const LEGACY_SESSION_KEYS_RETIRED_KEY = "dabboba.auth.legacy-keys-retired.v1";

export type StoredAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
};

const authTokenListeners = new Set<() => void>();

export function subscribeAuthTokens(listener: () => void): () => void {
  authTokenListeners.add(listener);
  return () => authTokenListeners.delete(listener);
}

/**
 * In-memory copy of the last SecureStore read. Every token mutation notifies
 * the auth-token listeners, and the cache subscribes to that signal, so the
 * next read after any change goes back to SecureStore exactly once. A read that
 * started before an invalidation never repopulates the cache (generation
 * check), and concurrent reads share one SecureStore request.
 */
let tokenCache: { value: StoredAuthTokens | null } | null = null;
let tokenCacheGeneration = 0;
let tokenCacheRead: { generation: number; promise: Promise<StoredAuthTokens | null> } | null = null;

function invalidateAuthTokenCache(): void {
  tokenCache = null;
  tokenCacheRead = null;
  tokenCacheGeneration += 1;
}

authTokenListeners.add(invalidateAuthTokenCache);

export async function readAuthTokens(): Promise<StoredAuthTokens | null> {
  if (tokenCache) return tokenCache.value;
  const generation = tokenCacheGeneration;
  if (tokenCacheRead?.generation === generation) return tokenCacheRead.promise;
  const promise = readAuthTokensUnlocked().then((value) => {
    if (generation === tokenCacheGeneration) tokenCache = { value };
    return value;
  });
  tokenCacheRead = { generation, promise };
  promise.then(
    () => { if (tokenCacheRead?.promise === promise) tokenCacheRead = null; },
    () => { if (tokenCacheRead?.promise === promise) tokenCacheRead = null; },
  );
  return promise;
}

export async function writeAuthTokens(tokens: StoredAuthTokens): Promise<void> {
  assertStoredAuthTokens(tokens);
  await withStorageMutation(async () => {
    await writeAuthTokensUnlocked(tokens);
  });
  notifyAuthTokenListeners();
}

export async function clearAuthTokens(): Promise<void> {
  await withStorageMutation(clearAuthTokensUnlocked);
  notifyAuthTokenListeners();
}

export async function replaceAuthTokensIfCurrent(
  expected: Pick<StoredAuthTokens, "accessToken" | "refreshToken">,
  next: StoredAuthTokens,
): Promise<StoredAuthTokens | null> {
  assertStoredAuthTokens(next);
  let replaced = false;
  const result = await withStorageMutation(async () => {
    const current = await readAuthTokensUnlocked();
    if (!authTokensMatch(current, expected)) return current;
    await writeAuthTokensUnlocked(next);
    replaced = true;
    return next;
  });
  if (replaced) notifyAuthTokenListeners();
  return result;
}

export async function clearAuthTokensIfCurrent(
  expected: Pick<StoredAuthTokens, "accessToken" | "refreshToken">,
): Promise<boolean> {
  const cleared = await withStorageMutation(async () => {
    const current = await readAuthTokensUnlocked();
    if (!authTokensMatch(current, expected)) return false;
    await clearAuthTokensUnlocked();
    return true;
  });
  if (cleared) notifyAuthTokenListeners();
  return cleared;
}

export function authTokensMatch(
  current: StoredAuthTokens | null,
  expected: Pick<StoredAuthTokens, "accessToken" | "refreshToken">,
): boolean {
  return current?.accessToken === expected.accessToken
    && current.refreshToken === expected.refreshToken;
}

let storageMutationQueue: Promise<void> = Promise.resolve();

async function withStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
  // Compare-and-swap decisions always read SecureStore itself, and a mutation
  // invalidates the cache before and (through the listener notification) after
  // it runs, so a cached value never outlives a write.
  const guarded = async () => {
    invalidateAuthTokenCache();
    return operation();
  };
  const result = storageMutationQueue.then(guarded, guarded);
  storageMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function notifyAuthTokenListeners(): void {
  for (const listener of authTokenListeners) listener();
}

async function readAuthTokensUnlocked(): Promise<StoredAuthTokens | null> {
  const record = parseSessionRecord(await SecureStore.getItemAsync(SESSION_RECORD_KEY));
  if (record) return record;

  const [accessToken, refreshToken, expiresAt] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(EXPIRES_AT_KEY),
  ]);
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    ...(validExpiresAt(expiresAt) ? { expiresAt } : {}),
  };
}

async function writeAuthTokensUnlocked(tokens: StoredAuthTokens): Promise<void> {
  const record = JSON.stringify({ version: 1, ...tokens });

  // The versioned record is authoritative and written first. The individual
  // keys remain only so already-installed builds can read a freshly rotated
  // session during a staged mobile rollout, until the retirement flag exists.
  await SecureStore.setItemAsync(SESSION_RECORD_KEY, record);
  if (await legacySessionKeysRetired()) return;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
    tokens.expiresAt
      ? SecureStore.setItemAsync(EXPIRES_AT_KEY, tokens.expiresAt)
      : SecureStore.deleteItemAsync(EXPIRES_AT_KEY),
  ]);
}

let legacyKeysRetired: boolean | null = null;

async function legacySessionKeysRetired(): Promise<boolean> {
  if (legacyKeysRetired === true) return true;
  try {
    legacyKeysRetired = await SecureStore.getItemAsync(LEGACY_SESSION_KEYS_RETIRED_KEY) === "1";
  } catch {
    // Unknown flag state keeps the compatible (mirroring) behavior.
    return false;
  }
  return legacyKeysRetired;
}

async function clearAuthTokensUnlocked(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_RECORD_KEY),
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(EXPIRES_AT_KEY),
  ]);
}

function parseSessionRecord(raw: string | null): StoredAuthTokens | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || !("version" in value)
    || value.version !== 1
    || !("accessToken" in value)
    || !("refreshToken" in value)
    || !validToken(value.accessToken)
    || !validToken(value.refreshToken)
  ) {
    return null;
  }
  const expiresAt = "expiresAt" in value ? value.expiresAt : undefined;
  if (expiresAt !== undefined && !validExpiresAt(expiresAt)) {
    return null;
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    ...(validExpiresAt(expiresAt) ? { expiresAt } : {}),
  };
}

function assertStoredAuthTokens(tokens: StoredAuthTokens): void {
  if (
    !validToken(tokens.accessToken)
    || !validToken(tokens.refreshToken)
    || (tokens.expiresAt !== undefined && !validExpiresAt(tokens.expiresAt))
  ) {
    throw new Error("로그인 세션 정보를 안전하게 저장하지 못했습니다.");
  }
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 4_096;
}

function validExpiresAt(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}
