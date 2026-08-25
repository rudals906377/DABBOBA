import "server-only";

import { errorMessage } from "@dabboba/api-client";
import { getAdminConfig } from "./config";

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

type ApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  token?: string | null;
  body?: unknown;
  headers?: HeadersInit;
  reason?: string;
};

function assertAdminPath(path: string) {
  if (!path.startsWith("/v1/admin/") || path.includes("//") || path.includes("\\")) {
    throw new Error("Admin DAL can only call absolute /v1/admin/* paths");
  }
}

export async function adminApi<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  assertAdminPath(path);
  const config = getAdminConfig();
  const url = new URL(path, `${config.apiBaseUrl}/`);
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("x-request-id", crypto.randomUUID());
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.reason) headers.set("x-admin-reason", options.reason);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") || "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    throw new AdminApiError(
      response.status,
      errorMessage(payload, `관리 API 요청이 실패했습니다. (${response.status})`),
      requestId,
    );
  }

  return payload as T;
}

export function queryString(values: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
