import { NextResponse, type NextRequest } from "next/server";
import { adminContentSecurityPolicy, createCspNonce } from "./lib/content-security-policy";

/**
 * Issues a fresh CSP nonce for every dynamically rendered console response.
 * Next.js reads the nonce from the request CSP header and applies it to its
 * framework, bundle and inline bootstrap scripts.
 */
export function proxy(request: NextRequest) {
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
      // Hashed build assets carry no inline script and stay publicly cacheable.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
