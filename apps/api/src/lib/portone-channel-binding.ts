import type { ApiConfig } from "@dabboba/config";
import type { Queryable } from "@dabboba/db";
import { AppError, conflict, notFound } from "./errors.js";
import type { PortOneV2AdapterOptions } from "./portone-v2.js";

export const PORTONE_CARD_PROVIDERS = ["PORTONE_V2_INICIS", "PORTONE_V2_KCP", "PORTONE_V2_NICE", "PORTONE_V2_KICC"] as const;
export type CardPg = "INICIS" | "KCP" | "NICE" | "KICC";
export type PortOneChannelBinding = {
  provider: typeof PORTONE_CARD_PROVIDERS[number];
  pgProvider: "INICIS_V2" | "KCP_V2" | "NICE_V2" | "KICC_V2";
  merchantId: string;
  storeId: string;
  channelKey: string;
  channelEnvironment: "LIVE" | "TEST";
};
export function isPortOneCardProvider(provider: string): boolean {
  return (PORTONE_CARD_PROVIDERS as readonly string[]).includes(provider);
}
export function configuredCardChannels(config: ApiConfig): PortOneChannelBinding[] {
  if (!isPortOneCardProvider(config.paymentProvider) || !config.portOne || !config.paymentWebhookSecret) return [];
  const { merchantId, storeId, channelKey, channelEnvironment, kcpChannelKey, inicisChannelKey, kiccChannelKey, niceChannelKey } = config.portOne;
  const shared = { merchantId, storeId, channelEnvironment };
  const modern = ["PORTONE_V2_NICE", "PORTONE_V2_KICC"].includes(config.paymentProvider);
  const primary = config.paymentProvider === "PORTONE_V2_KICC" ? "KICC" : config.paymentProvider === "PORTONE_V2_NICE" ? "NICE" : "INICIS";
  const bindings: PortOneChannelBinding[] = [{...shared,provider:`PORTONE_V2_${primary}`,pgProvider:`${primary}_V2`,channelKey}];
  for (const [pg,key] of [["INICIS",inicisChannelKey],["KCP",kcpChannelKey],["NICE",niceChannelKey],["KICC",kiccChannelKey]] as const) {
    if(key && pg !== primary) bindings.push({...shared,provider:`PORTONE_V2_${pg}`,pgProvider:`${pg}_V2`,channelKey:key});
  }
  return modern ? bindings : bindings.filter(c=>c.provider === "PORTONE_V2_INICIS" || c.provider === "PORTONE_V2_KCP");
}
/**
 * Channels a NEW order may bind to. The 2026-10-20 owner decision retired
 * EasyPay (KICC) as a new payment choice: it stays in configuredCardChannels so
 * historical KICC orders keep their status reads and cancellations, but it is
 * never advertised in cardPaymentOptions or selectable at checkout.
 */
export function checkoutCardChannels(config: ApiConfig): PortOneChannelBinding[] {
  const channels = configuredCardChannels(config).filter((channel) => channel.provider !== "PORTONE_V2_KICC");
  return ["PORTONE_V2_NICE", "PORTONE_V2_KICC"].includes(config.paymentProvider)
    ? channels.filter(channel=>channel.provider === "PORTONE_V2_NICE") : channels;
}
export const RETIRED_NEW_PAYMENT_RAIL_MESSAGE = "신규 결제는 나이스페이만 지원합니다. 이전 이지페이 주문은 고객지원에서 확인해 주세요.";
export function retiredNewPaymentRail(): AppError {
  return new AppError(409, "PAYMENT_RAIL_RETIRED", RETIRED_NEW_PAYMENT_RAIL_MESSAGE);
}
export function selectCardChannel(config: ApiConfig, pg?: CardPg): PortOneChannelBinding {
  const chosen = pg ?? (["PORTONE_V2_KICC", "PORTONE_V2_NICE"].includes(config.paymentProvider) ? "NICE" : "INICIS");
  if (chosen === "KICC") throw retiredNewPaymentRail();
  if (!["INICIS", "KCP", "NICE"].includes(chosen)) throw conflict("지원하지 않는 카드 결제사입니다.");
  const channel = checkoutCardChannels(config).find((item) => item.pgProvider === `${chosen}_V2`);
  if (!channel) throw new AppError(503, "PAYMENT_NOT_CONFIGURED", "선택한 카드 결제사가 구성되지 않았습니다.");
  return channel;
}
/** No untrusted client channel or PG value is ever used to configure a lookup. */
export function adapterOptionsForBinding(config: ApiConfig, provider: string, binding: unknown): PortOneV2AdapterOptions {
  const channels = configuredCardChannels(config);
  // Historical INICIS orders predate channel snapshots. Keep the old rail only;
  // a new KCP or NICE order can never take this legacy fallback.
  const expected = binding === null && provider === "PORTONE_V2_INICIS"
    ? channels.find(channel=>channel.provider === "PORTONE_V2_INICIS") : binding;
  const candidate = expected && typeof expected === "object" && !Array.isArray(expected)
    ? expected as Partial<PortOneChannelBinding> : null;
  const channel = channels.find((item) => item.provider === provider
    && candidate?.provider === item.provider && candidate.pgProvider === item.pgProvider
    && candidate.merchantId === item.merchantId && candidate.storeId === item.storeId
    && candidate.channelKey === item.channelKey && candidate.channelEnvironment === item.channelEnvironment);
  if (!channel || !config.portOne) throw conflict("주문에 저장된 결제 채널을 확인할 수 없습니다.");
  return { apiSecret: config.portOne.apiSecret, ...channel };
}
export async function boundPaymentAdapterOptions(queryable: Queryable, config: ApiConfig, paymentId: string) {
  const rows = await queryable.query<{ provider: string; portone_channel_binding: unknown }>(
    "SELECT provider,portone_channel_binding FROM payments WHERE id=$1", [paymentId],
  );
  if (!rows.rowCount) throw notFound("결제 정보를 찾을 수 없습니다.");
  const row = rows.rows[0]!;
  return { provider: row.provider, options: adapterOptionsForBinding(config, row.provider, row.portone_channel_binding) };
}
