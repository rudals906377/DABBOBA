export type MobilePlatform = "ios" | "android";

export type MobileRuntimeConfig = {
  apiBaseUrl: string;
  assetBaseUrl: string | null;
};

type RuntimeConfigInput = {
  configuredApiUrl?: string;
  configuredAssetBaseUrl?: string;
  metroHostUri?: string;
  platform: MobilePlatform;
  development: boolean;
};

export function resolveMobileRuntimeConfig(input: RuntimeConfigInput): MobileRuntimeConfig {
  const apiUrl = input.configuredApiUrl?.trim()
    ? parseRuntimeUrl(input.configuredApiUrl, input.development, "EXPO_PUBLIC_DABBOBA_API_URL")
    : developmentApiUrl(input);
  const assetUrl = input.configuredAssetBaseUrl?.trim()
    ? parseRuntimeUrl(
        input.configuredAssetBaseUrl,
        input.development,
        "EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL",
      )
    : null;

  return {
    apiBaseUrl: stripTrailingSlash(apiUrl.toString()),
    assetBaseUrl: assetUrl ? stripTrailingSlash(assetUrl.toString()) : null,
  };
}

export function resolveCatalogImageUrl(
  imageUrl: string | null,
  assetBaseUrl: string | null,
): string | null {
  if (!imageUrl) return null;
  try {
    const absolute = new URL(imageUrl);
    return absolute.protocol === "https:" || absolute.protocol === "http:"
      ? absolute.toString()
      : null;
  } catch {
    if (!assetBaseUrl || !imageUrl.startsWith("/")) return null;
    return new URL(imageUrl, `${assetBaseUrl}/`).toString();
  }
}

function developmentApiUrl(input: RuntimeConfigInput): URL {
  if (!input.development) {
    throw new Error("운영 앱에는 EXPO_PUBLIC_DABBOBA_API_URL HTTPS 주소가 필요합니다.");
  }
  const host = metroHost(input.metroHostUri) || (input.platform === "android" ? "10.0.2.2" : "127.0.0.1");
  return new URL(`http://${formatHost(host)}:8788`);
}

function metroHost(hostUri: string | undefined): string | null {
  if (!hostUri?.trim()) return null;
  try {
    return new URL(hostUri.includes("://") ? hostUri : `http://${hostUri}`).hostname;
  } catch {
    return null;
  }
}

function parseRuntimeUrl(raw: string, development: boolean, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${label} 주소 형식을 확인해 주세요.`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${label}에는 origin만 입력해 주세요.`);
  }
  if (url.protocol === "https:") return url;
  if (url.protocol !== "http:" || !development || !isLocalDevelopmentHost(url.hostname)) {
    throw new Error(`${label}는 운영에서 HTTPS를 사용해야 합니다.`);
  }
  return url;
}

function isLocalDevelopmentHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "10.0.2.2") return true;
  if (hostname.endsWith(".local") || hostname.startsWith("192.168.")) return true;
  const match = /^172\.(\d{1,3})\./.exec(hostname);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return /^10\./.test(hostname);
}

function formatHost(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}
