import { NextResponse, type NextRequest } from "next/server";
import type { SessionCreated } from "../../../../lib/admin-types";
import { adminApi } from "../../../../lib/api";
import { isAdminActor } from "../../../../lib/capabilities";
import { getAdminConfig } from "../../../../lib/config";
import { internalRedirect, isSameOriginRequest, safeInternalPath, signedAdminLoginClientHeaders } from "../../../../lib/request-security";

function loginError(reason: string, next: string, status = 303) {
  const params = new URLSearchParams({ error: reason });
  if (next !== "/") params.set("next", next);
  return internalRedirect(`/login?${params}`, status);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
  }

  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const next = safeInternalPath(form.get("next"));

  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || password.length > 256) {
    return loginError("invalid-credentials", next);
  }

  let config: ReturnType<typeof getAdminConfig>;
  let clientIdentityHeaders: Record<string, string>;
  try {
    config = getAdminConfig();
    clientIdentityHeaders = signedAdminLoginClientHeaders(request, config);
  } catch {
    return loginError("login-context-unavailable", next);
  }

  let session: SessionCreated;
  try {
    session = await adminApi<SessionCreated>("/v1/admin/auth/login", {
      method: "POST",
      headers: clientIdentityHeaders,
      body: { email, password },
    });
  } catch {
    return loginError("login-failed", next);
  }

  if (!isAdminActor(session.actor)) {
    await adminApi<void>("/v1/admin/auth/logout", { method: "POST", token: session.token }).catch(() => undefined);
    return loginError("not-authorized", next);
  }

  const expires = new Date(session.expiresAt);
  if (!session.token || Number.isNaN(expires.getTime()) || expires <= new Date()) {
    return loginError("invalid-session", next);
  }

  const response = internalRedirect(next);
  response.cookies.set(config.sessionCookieName, session.token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires,
  });

  return response;
}
