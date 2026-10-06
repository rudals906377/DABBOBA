import { NextResponse, type NextRequest } from "next/server";
import { createCloudflareAccessGate } from "./lib/cloudflare-access";
import { adminContentSecurityPolicy, createCspNonce } from "./lib/content-security-policy";

const cloudflareAccess = createCloudflareAccessGate();

function accessDenied(status: 403 | 503) {
  const message = status === 403
    ? "Cloudflare Access 인증을 거친 요청만 관리자 화면에 들어올 수 있습니다."
    : "관리자 화면의 Cloudflare Access 설정을 확인할 수 없습니다.";
  return new NextResponse(message, {
    status,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Rejects any console request that did not pass Cloudflare Access (when the
 * Access application is configured), then issues a fresh CSP nonce for every
 * dynamically rendered console response. Next.js reads the nonce from the
 * request CSP header and applies it to its framework, bundle and inline
 * bootstrap scripts.
 */
export async function proxy(request: NextRequest) {
  const access = await cloudflareAccess(request.headers, process.env);
  if (!access.allowed) return accessDenied(access.status);

  const nonce = createCspNonce();
  const policy = adminContentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Hashed build assets carry no inline script or data and stay publicly cacheable.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
