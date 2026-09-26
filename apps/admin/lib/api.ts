import "server-only";

import { errorMessage } from "@dabboba/api-client";
import { signAdminServiceRequest } from "@dabboba/config";
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
  const canonicalUrl = new URL(path, "https://admin.invalid");
  const url = new URL(path.slice(1), `${config.apiBaseUrl.replace(/\/+$/, "")}/`);
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("x-request-id", crypto.randomUUID());
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.reason) {
    headers.delete("x-admin-reason-encoding");
    if (/^[\x20-\x7e]+$/.test(options.reason)) {
      headers.set("x-admin-reason", options.reason);
    } else {
      headers.set("x-admin-reason", encodeURIComponent(options.reason));
      headers.set("x-admin-reason-encoding", "utf-8-percent");
    }
  }
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const serviceSecret = process.env.DABBOBA_ADMIN_SERVICE_SECRET?.trim();
  if (config.environment === "production" && (!serviceSecret || Buffer.byteLength(serviceSecret, "utf8") < 32)) {
    throw new Error("Production admin BFF requires DABBOBA_ADMIN_SERVICE_SECRET");
  }
  if (serviceSecret) {
    const signatureHeaders = signAdminServiceRequest({
      secret: serviceSecret,
      method: options.method || "GET",
      path: `${canonicalUrl.pathname}${canonicalUrl.search}`,
      requestId: headers.get("x-request-id")!,
      authorization: headers.get("authorization"),
      reason: headers.get("x-admin-reason"),
      reasonEncoding: headers.get("x-admin-reason-encoding"),
      contentType: headers.get("content-type"),
      body: body ?? null,
    });
    for (const [name, value] of Object.entries(signatureHeaders)) headers.set(name, value);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
    cache: "no-store",
    credentials: "omit",
    redirect: "manual",
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new AdminApiError(502, "관리 API가 예상치 못한 이동 응답을 반환했습니다.");
  }
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
