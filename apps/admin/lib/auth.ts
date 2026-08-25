import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "./admin-types";
import { AdminApiError, adminApi } from "./api";
import { type Capability, can, isAdminActor } from "./capabilities";
import { getAdminConfig } from "./config";

export type AdminSession = { token: string; actor: Actor };

export async function readAdminToken() {
  const store = await cookies();
  return store.get(getAdminConfig().sessionCookieName)?.value || null;
}

export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const token = await readAdminToken();
  if (!token) return null;

  try {
    const actor = await adminApi<Actor>("/v1/admin/me", { token });
    return { token, actor };
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) return null;
    if (error instanceof AdminApiError && error.status === 403) redirect("/forbidden");
    throw error;
  }
});

export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect("/login?reason=session-required");
  if (!isAdminActor(session.actor)) redirect("/forbidden");
  return session;
}

export async function requireCapability(capability: Capability): Promise<AdminSession> {
  const session = await requireAdmin();
  if (!can(session.actor, capability)) redirect("/forbidden");
  return session;
}
