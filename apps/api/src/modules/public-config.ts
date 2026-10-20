import type { FastifyInstance } from "fastify";
import { effectiveCommerceMode } from "../lib/commerce-mode.js";
import { loadRequiredPolicyDocuments } from "../lib/legal-policy.js";
import type { ApiContext } from "../types.js";
import { checkoutCardChannels } from "../lib/portone-channel-binding.js";

export async function registerPublicConfigRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/public/config", async (_request, reply) => {
    const policy = await loadRequiredPolicyDocuments(context.pool);
    reply.header("cache-control", "public, max-age=60, stale-while-revalidate=300");
    return {
      commerceMode: effectiveCommerceMode(context.config),
      requiredPolicyVersions: policy.versions,
      cardPaymentOptions: effectiveCommerceMode(context.config) === "LIVE" ? checkoutCardChannels(context.config) : [],
      ...(["TOSSPAYMENTS_DIRECT", "PORTONE_V2_NICE"].includes(context.config.paymentProvider) && context.config.tossPayments
        && effectiveCommerceMode(context.config) === "LIVE" ? {
          tossPayment: { provider: "TOSSPAYMENTS_DIRECT", environment: "TEST", clientKey: context.config.tossPayments.clientKey },
        } : {}),
    };
  });
}
