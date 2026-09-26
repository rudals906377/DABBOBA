import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { AdminApiError, adminApi } from "../../../../lib/api";
import { getAdminConfig } from "../../../../lib/config";
import { isSameOriginRequest } from "../../../../lib/request-security";

function response(status: number) {
  return new NextResponse(null, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return response(403);

  const config = getAdminConfig();
  const store = await cookies();
  const token = store.get(config.sessionCookieName)?.value;
  if (!token) return response(401);

  let expiresAt: string;
  try {
    ({ expiresAt } = await adminApi<{ expiresAt: string }>("/v1/admin/auth/keepalive", {
      method: "POST",
      token,
    }));
  } catch (error) {
    if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) {
      const expired = response(401);
      expired.cookies.set(config.sessionCookieName, "", {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      });
      return expired;
    }
    return response(503);
  }

  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime()) || expires <= new Date()) return response(503);
  const renewed = response(204);
  renewed.cookies.set(config.sessionCookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires,
  });
  return renewed;
}
