import "server-only";

import {
  normalizeAdminClientIp,
  signAdminProxyIdentity,
  type AdminConfig,
} from "@dabboba/config";
import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequestHeaders } from "./request-origin";

export function isSameOriginRequest(request: NextRequest) {
  return isSameOriginRequestHeaders(request.headers);
}

export function safeInternalPath(value: FormDataEntryValue | string | null | undefined, fallback = "/") {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  if (candidate.startsWith("/api/") || candidate === "/api") return fallback;
  return candidate;
}

export function internalRedirect(path: string, status = 303) {
  return new NextResponse(null, {
    status,
    headers: { location: safeInternalPath(path) },
  });
}

export function signedAdminLoginClientHeaders(
  request: NextRequest,
  config: AdminConfig,
  nowMs = Date.now(),
): Record<string, string> {
  if (!config.adminProxyIdentitySecret && !config.adminEdgeClientIpHeader) return {};
  if (!config.adminProxyIdentitySecret || !config.adminEdgeClientIpHeader) {
    throw new Error("Admin proxy identity configuration is incomplete");
  }

  const ipAddress = normalizeAdminClientIp(request.headers.get(config.adminEdgeClientIpHeader));
  if (!ipAddress) throw new Error("Trusted edge client IP header is missing or invalid");

  return signAdminProxyIdentity({
    secret: config.adminProxyIdentitySecret,
    ipAddress,
    userAgent: request.headers.get("user-agent"),
    nowMs,
  });
}
