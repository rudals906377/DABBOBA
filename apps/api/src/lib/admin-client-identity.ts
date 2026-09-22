import {
  normalizeAdminClientIp,
  normalizeAdminClientUserAgent,
  verifyAdminProxyIdentity,
  type AdminProxyIdentity,
  type ApiConfig,
} from "@dabboba/config";
import type { FastifyRequest } from "fastify";
import { unauthorized } from "./errors.js";

export type AdminClientIdentity = AdminProxyIdentity & {
  source: "signed-admin-proxy" | "direct-non-production";
};

export function createAdminClientIdentityResolver(config: ApiConfig) {
  const cache = new WeakMap<FastifyRequest, AdminClientIdentity>();

  return (request: FastifyRequest): AdminClientIdentity => {
    const cached = cache.get(request);
    if (cached) return cached;

    const verified = config.adminProxyIdentitySecret
      ? verifyAdminProxyIdentity({
          secret: config.adminProxyIdentitySecret,
          readHeader: (name) => request.headers[name],
        })
      : null;

    if (verified) {
      const identity: AdminClientIdentity = { ...verified, source: "signed-admin-proxy" };
      cache.set(request, identity);
      return identity;
    }

    if (config.environment === "production") {
      throw unauthorized("관리자 로그인 요청의 보안 컨텍스트를 확인할 수 없습니다.");
    }

    const identity: AdminClientIdentity = {
      ipAddress: normalizeAdminClientIp(request.ip) || request.ip,
      userAgent: normalizeAdminClientUserAgent(request.headers["user-agent"]),
      issuedAt: Math.floor(Date.now() / 1_000),
      source: "direct-non-production",
    };
    cache.set(request, identity);
    return identity;
  };
}
