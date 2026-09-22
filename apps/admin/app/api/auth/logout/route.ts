import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { adminApi } from "../../../../lib/api";
import { getAdminConfig } from "../../../../lib/config";
import { internalRedirect, isSameOriginRequest } from "../../../../lib/request-security";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
  }

  const config = getAdminConfig();
  const store = await cookies();
  const token = store.get(config.sessionCookieName)?.value;
  if (token) {
    await adminApi<void>("/v1/admin/auth/logout", { method: "POST", token }).catch(() => undefined);
  }
  const response = internalRedirect("/login?reason=signed-out");
  response.cookies.set(config.sessionCookieName, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
