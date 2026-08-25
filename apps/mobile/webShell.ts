export const BRIDGE_VERSION = 1 as const;
export const MAX_BRIDGE_MESSAGE_BYTES = 8_192;

const WEB_PORT = 4174;
const MAX_EXTERNAL_URL_LENGTH = 2_048;

export type ShellPlatform = "ios" | "android";

export const DEEP_LINK_WEB_PATHS = {
  home: "/",
  exchange: "/exchange",
  ppoba: "/ppoba",
  dukroom: "/dukroom",
  profile: "/profile",
  "request-room": "/request-room",
  settings: "/settings",
} as const;

export type DeepLinkRoute = keyof typeof DEEP_LINK_WEB_PATHS;

export type DeepLinkTarget = {
  route: DeepLinkRoute;
  url: string;
};

export type WebToNativeBridgeMessage =
  | {
      version: typeof BRIDGE_VERSION;
      type: "APP_READY";
    }
  | {
      version: typeof BRIDGE_VERSION;
      type: "OPEN_EXTERNAL_URL";
      payload: {
        url: string;
      };
    }
  | {
      version: typeof BRIDGE_VERSION;
      type: "NAVIGATE";
      payload: {
        route: DeepLinkRoute;
      };
    };

export type NativeToWebBridgeMessage = {
  version: typeof BRIDGE_VERSION;
  type: "DEEP_LINK";
  payload: DeepLinkTarget;
};

export type ShellConfiguration = {
  webUrl: string;
  baseOrigin: string;
  allowedOrigins: string[];
};

type ShellConfigurationInput = {
  configuredUrl?: string;
  configuredAllowedOrigins?: string;
  metroHostUri?: string;
  platform: ShellPlatform;
  development: boolean;
};

export type NavigationDecision =
  | { action: "allow" }
  | { action: "open-external"; url: string }
  | { action: "dispatch-deep-link"; target: DeepLinkTarget }
  | { action: "block" };

export const APP_READY_INJECTION_SCRIPT = `
(function () {
  var bridge = window.ReactNativeWebView;
  if (bridge && typeof bridge.postMessage === "function") {
    bridge.postMessage(${JSON.stringify(
      JSON.stringify({ version: BRIDGE_VERSION, type: "APP_READY" }),
    )});
  }
})();
true;
`;

export function resolveShellConfiguration(input: ShellConfigurationInput): ShellConfiguration {
  const configuredUrl = input.configuredUrl?.trim();
  const baseUrl = configuredUrl
    ? parseApprovedWebUrl(configuredUrl, input.development, "EXPO_PUBLIC_DABBOBA_WEB_URL")
    : resolveDevelopmentWebUrl(input);

  const allowedOrigins = new Set<string>([baseUrl.origin]);
  for (const candidate of splitAllowedOrigins(input.configuredAllowedOrigins)) {
    allowedOrigins.add(parseApprovedOrigin(candidate, input.development));
  }

  return {
    webUrl: withEmbedParams(baseUrl, input.platform),
    baseOrigin: baseUrl.origin,
    allowedOrigins: [...allowedOrigins],
  };
}

export function classifyNavigationRequest(
  rawUrl: string,
  allowedOrigins: readonly string[],
  baseOrigin: string,
  platform: ShellPlatform,
): NavigationDecision {
  const deepLinkTarget = parseDabbobaDeepLink(rawUrl, baseOrigin, platform);
  if (deepLinkTarget) return { action: "dispatch-deep-link", target: deepLinkTarget };

  const webUrl = parseExternalHttpUrl(rawUrl);
  if (webUrl) {
    if (allowedOrigins.includes(webUrl.origin)) return { action: "allow" };
    return { action: "open-external", url: webUrl.toString() };
  }

  return { action: "block" };
}

export function isAllowedWebUrl(rawUrl: string, allowedOrigins: readonly string[]): boolean {
  const webUrl = parseExternalHttpUrl(rawUrl);
  return webUrl !== null && allowedOrigins.includes(webUrl.origin);
}

export function parseDabbobaDeepLink(
  rawUrl: string,
  baseOrigin: string,
  platform: ShellPlatform,
): DeepLinkTarget | null {
  let deepLink: URL;
  try {
    deepLink = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    deepLink.protocol !== "dabboba:" ||
    deepLink.username ||
    deepLink.password ||
    deepLink.port ||
    deepLink.search ||
    deepLink.hash
  ) {
    return null;
  }

  const hostRoute = deepLink.hostname;
  const pathSegments = deepLink.pathname.split("/").filter(Boolean);
  const routeCandidate = hostRoute || (pathSegments.length === 1 ? pathSegments[0] : "");

  if (
    !routeCandidate ||
    (hostRoute && pathSegments.length > 0) ||
    !isDeepLinkRoute(routeCandidate)
  ) {
    return null;
  }

  return createDeepLinkTarget(routeCandidate, baseOrigin, platform);
}

export function createDeepLinkTarget(
  route: DeepLinkRoute,
  baseOrigin: string,
  platform: ShellPlatform,
): DeepLinkTarget {
  const targetUrl = new URL(DEEP_LINK_WEB_PATHS[route], assertHttpsOrLocalOrigin(baseOrigin));
  return {
    route,
    url: withEmbedParams(targetUrl, platform),
  };
}

export function parseWebBridgeMessage(rawMessage: string): WebToNativeBridgeMessage | null {
  if (utf8ByteLength(rawMessage) > MAX_BRIDGE_MESSAGE_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(rawMessage);
  } catch {
    return null;
  }

  if (!isRecord(value) || value.version !== BRIDGE_VERSION || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "APP_READY") {
    return hasExactKeys(value, ["type", "version"])
      ? { version: BRIDGE_VERSION, type: "APP_READY" }
      : null;
  }

  if (value.type === "OPEN_EXTERNAL_URL") {
    if (!hasExactKeys(value, ["payload", "type", "version"]) || !isRecord(value.payload)) {
      return null;
    }
    if (!hasExactKeys(value.payload, ["url"]) || typeof value.payload.url !== "string") {
      return null;
    }
    if (value.payload.url.length > MAX_EXTERNAL_URL_LENGTH) return null;
    const externalUrl = parseExternalHttpUrl(value.payload.url);
    if (!externalUrl) return null;
    return {
      version: BRIDGE_VERSION,
      type: "OPEN_EXTERNAL_URL",
      payload: { url: externalUrl.toString() },
    };
  }

  if (value.type === "NAVIGATE") {
    if (!hasExactKeys(value, ["payload", "type", "version"]) || !isRecord(value.payload)) {
      return null;
    }
    if (!hasExactKeys(value.payload, ["route"]) || !isDeepLinkRoute(value.payload.route)) {
      return null;
    }
    return {
      version: BRIDGE_VERSION,
      type: "NAVIGATE",
      payload: { route: value.payload.route },
    };
  }

  return null;
}

export function serializeDeepLinkMessage(target: DeepLinkTarget): string {
  const message: NativeToWebBridgeMessage = {
    version: BRIDGE_VERSION,
    type: "DEEP_LINK",
    payload: target,
  };
  return JSON.stringify(message);
}

function resolveDevelopmentWebUrl(input: ShellConfigurationInput): URL {
  if (!input.development) {
    throw new Error("운영 빌드에는 EXPO_PUBLIC_DABBOBA_WEB_URL HTTPS 주소가 필요합니다.");
  }

  const metroHostname = extractHostname(input.metroHostUri);
  const fallbackHostname = input.platform === "android" ? "10.0.2.2" : "127.0.0.1";
  const hostname = metroHostname || fallbackHostname;
  if (!isDevelopmentHostname(hostname)) {
    throw new Error("Expo 개발 서버가 로컬 또는 사설 네트워크 주소를 사용해야 합니다.");
  }

  const urlHostname = hostname.includes(":") ? `[${hostname}]` : hostname;
  return new URL(`http://${urlHostname}:${WEB_PORT}`);
}

function parseApprovedWebUrl(rawUrl: string, development: boolean, variableName: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${variableName}에 올바른 절대 URL을 설정해 주세요.`);
  }

  if (url.username || url.password) {
    throw new Error(`${variableName}에는 사용자 정보가 포함될 수 없습니다.`);
  }
  if (url.hostname.includes("*")) {
    throw new Error(`${variableName}에는 wildcard를 사용할 수 없습니다.`);
  }

  if (url.protocol === "https:") return url;
  if (development && url.protocol === "http:" && isDevelopmentHostname(url.hostname)) return url;

  throw new Error(`${variableName}은 HTTPS여야 하며 HTTP는 로컬 개발 주소에서만 허용됩니다.`);
}

function parseApprovedOrigin(rawOrigin: string, development: boolean): string {
  const url = parseApprovedWebUrl(
    rawOrigin,
    development,
    "EXPO_PUBLIC_DABBOBA_ALLOWED_ORIGINS",
  );
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("EXPO_PUBLIC_DABBOBA_ALLOWED_ORIGINS에는 경로 없는 origin만 입력해 주세요.");
  }
  return url.origin;
}

function assertHttpsOrLocalOrigin(baseOrigin: string): string {
  const url = parseExternalHttpUrl(baseOrigin);
  if (!url || (url.protocol !== "https:" && !isDevelopmentHostname(url.hostname))) {
    throw new Error("승인되지 않은 웹 origin입니다.");
  }
  return url.origin;
}

function parseExternalHttpUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  return url;
}

function withEmbedParams(url: URL, platform: ShellPlatform): string {
  const embeddedUrl = new URL(url.toString());
  embeddedUrl.searchParams.set("embed", "1");
  embeddedUrl.searchParams.set("platform", platform);
  return embeddedUrl.toString();
}

function splitAllowedOrigins(rawOrigins?: string): string[] {
  if (!rawOrigins?.trim()) return [];
  return rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function extractHostname(hostUri?: string): string | null {
  const value = hostUri?.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    return url.hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function isDevelopmentHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe[89ab][0-9a-f]:/i.test(host)
  ) {
    return true;
  }

  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isDeepLinkRoute(value: unknown): value is DeepLinkRoute {
  return (
    typeof value === "string" && Object.prototype.hasOwnProperty.call(DEEP_LINK_WEB_PATHS, value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
