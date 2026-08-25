import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@dabboba/contracts";

export type TokenProvider = () => string | null | Promise<string | null>;

export type DabbobaClientOptions = {
  baseUrl: string;
  token?: TokenProvider;
  fetch?: typeof globalThis.fetch;
  requestId?: () => string;
};

export function createDabbobaClient(options: DabbobaClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ""),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const middleware: Middleware = {
    async onRequest({ request }) {
      const token = await options.token?.();
      if (token) request.headers.set("authorization", `Bearer ${token}`);
      request.headers.set("x-request-id", options.requestId?.() || crypto.randomUUID());
      return request;
    },
  };

  client.use(middleware);
  return client;
}

export function errorMessage(error: unknown, fallback = "요청을 처리하지 못했습니다."): string {
  if (!error || typeof error !== "object") return fallback;
  const envelope = error as { error?: { message?: unknown } };
  return typeof envelope.error?.message === "string" ? envelope.error.message : fallback;
}
