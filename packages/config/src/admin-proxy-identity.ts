import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const ADMIN_PROXY_IDENTITY_HEADERS = {
  ipAddress: "x-dabboba-admin-client-ip",
  userAgent: "x-dabboba-admin-client-user-agent",
  timestamp: "x-dabboba-admin-client-timestamp",
  signature: "x-dabboba-admin-client-signature",
} as const;

export const ADMIN_PROXY_IDENTITY_MAX_AGE_SECONDS = 60;
const ABSENT_USER_AGENT = "-";

export type AdminProxyIdentity = {
  ipAddress: string;
  userAgent: string | null;
  issuedAt: number;
};

type HeaderReader = (name: string) => string | string[] | null | undefined;

function singleHeader(readHeader: HeaderReader, name: string): string | null {
  const value = readHeader(name);
  if (typeof value !== "string") return null;
  return value;
}

function canonicalPayload(input: {
  ipAddress: string;
  userAgentEncoded: string;
  issuedAt: number;
}) {
  return ["dabboba-admin-client-v1", "POST", "/v1/admin/auth/login", input.issuedAt, input.ipAddress, input.userAgentEncoded].join("\n");
}

function signature(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function truncateUtf8(value: string, maximumBytes: number) {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  let result = "";
  let used = 0;
  for (const character of value) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (used + bytes > maximumBytes) break;
    result += character;
    used += bytes;
  }
  return result;
}

export function normalizeAdminClientIp(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.includes(",") || candidate.includes("%")) return null;
  const version = isIP(candidate);
  if (version === 4) return candidate.split(".").map((part) => String(Number(part))).join(".");
  if (version !== 6) return null;

  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeAdminClientUserAgent(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? truncateUtf8(normalized, 500) : null;
}

export function signAdminProxyIdentity(input: {
  secret: string;
  ipAddress: string;
  userAgent?: string | null;
  nowMs?: number;
}): Record<string, string> {
  const ipAddress = normalizeAdminClientIp(input.ipAddress);
  if (!ipAddress) throw new Error("Admin client IP must be a single IPv4 or IPv6 address");
  const userAgent = normalizeAdminClientUserAgent(input.userAgent);
  const userAgentEncoded = userAgent ? Buffer.from(userAgent, "utf8").toString("base64url") : ABSENT_USER_AGENT;
  const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  const payload = canonicalPayload({ ipAddress, userAgentEncoded, issuedAt });

  return {
    [ADMIN_PROXY_IDENTITY_HEADERS.ipAddress]: ipAddress,
    [ADMIN_PROXY_IDENTITY_HEADERS.userAgent]: userAgentEncoded,
    [ADMIN_PROXY_IDENTITY_HEADERS.timestamp]: String(issuedAt),
    [ADMIN_PROXY_IDENTITY_HEADERS.signature]: signature(input.secret, payload),
  };
}

export function verifyAdminProxyIdentity(input: {
  secret: string;
  readHeader: HeaderReader;
  nowMs?: number;
  maximumAgeSeconds?: number;
}): AdminProxyIdentity | null {
  const ipHeader = singleHeader(input.readHeader, ADMIN_PROXY_IDENTITY_HEADERS.ipAddress);
  const userAgentEncoded = singleHeader(input.readHeader, ADMIN_PROXY_IDENTITY_HEADERS.userAgent);
  const timestampHeader = singleHeader(input.readHeader, ADMIN_PROXY_IDENTITY_HEADERS.timestamp);
  const providedSignature = singleHeader(input.readHeader, ADMIN_PROXY_IDENTITY_HEADERS.signature);
  if (ipHeader === null || userAgentEncoded === null || timestampHeader === null || providedSignature === null) return null;

  const ipAddress = normalizeAdminClientIp(ipHeader);
  if (!ipAddress || ipHeader !== ipAddress) return null;
  if (userAgentEncoded !== ABSENT_USER_AGENT && !/^[A-Za-z0-9_-]{2,667}$/.test(userAgentEncoded)) return null;
  if (!/^\d{10}$/.test(timestampHeader)) return null;
  const issuedAt = Number(timestampHeader);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  const maximumAgeSeconds = input.maximumAgeSeconds ?? ADMIN_PROXY_IDENTITY_MAX_AGE_SECONDS;
  if (!Number.isSafeInteger(issuedAt) || maximumAgeSeconds < 1 || Math.abs(nowSeconds - issuedAt) > maximumAgeSeconds) return null;

  let userAgent: string | null;
  try {
    if (userAgentEncoded === ABSENT_USER_AGENT) {
      userAgent = null;
    } else {
      const decoded = Buffer.from(userAgentEncoded, "base64url");
      if (decoded.toString("base64url") !== userAgentEncoded) return null;
      userAgent = normalizeAdminClientUserAgent(decoded.toString("utf8"));
      if (!userAgent || Buffer.from(userAgent, "utf8").toString("base64url") !== userAgentEncoded) return null;
    }
  } catch {
    return null;
  }

  const expectedSignature = signature(
    input.secret,
    canonicalPayload({ ipAddress, userAgentEncoded, issuedAt }),
  );
  const provided = Buffer.from(providedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  return { ipAddress, userAgent, issuedAt };
}
