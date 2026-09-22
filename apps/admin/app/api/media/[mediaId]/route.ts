import { NextResponse, type NextRequest } from "next/server";
import { adminApi } from "../../../../lib/api";
import { readAdminToken } from "../../../../lib/auth";
import { internalRedirect } from "../../../../lib/request-security";

export async function GET(_request: NextRequest, context: { params: Promise<{ mediaId: string }> }) {
  const token = await readAdminToken();
  if (!token) return internalRedirect("/login?reason=session-required");
  const { mediaId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return NextResponse.json({ error: "invalid media id" }, { status: 400 });
  const result = await adminApi<{ url: string }>(`/v1/admin/media/${encodeURIComponent(mediaId)}/url`, { token });
  const destination = new URL(result.url);
  if (destination.protocol !== "https:") return NextResponse.json({ error: "unsafe media url" }, { status: 502 });
  const response = NextResponse.redirect(destination, 302);
  response.headers.set("cache-control", "private, no-store");
  return response;
}
