import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "dabboba.auth.access-token";
const REFRESH_TOKEN_KEY = "dabboba.auth.refresh-token";

export type StoredAuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export async function readAuthTokens(): Promise<StoredAuthTokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export async function writeAuthTokens(tokens: StoredAuthTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearAuthTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}
