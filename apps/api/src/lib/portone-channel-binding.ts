import type { ApiConfig } from "@dabboba/config";
import type { Queryable } from "@dabboba/db";
import { AppError, conflict, notFound } from "./errors.js";
import type { PortOneV2AdapterOptions } from "./portone-v2.js";

export const PORTONE_CARD_PROVIDERS = ["PORTONE_V2_INICIS", "PORTONE_V2_KCP", "PORTONE_V2_NICE"] as const;
export type CardPg = "INICIS" | "KCP" | "NICE";
export type PortOneChannelBinding = {
  provider: typeof PORTONE_CARD_PROVIDERS[number];
  pgProvider: "INICIS_V2" | "KCP_V2" | "NICE_V2";
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
  const { merchantId, storeId, channelKey, channelEnvironment, kcpChannelKey, inicisChannelKey } = config.portOne;
  const shared = { merchantId, storeId, channelEnvironment };
  if (config.paymentProvider === "PORTONE_V2_NICE") return [
    { ...shared, provider: "PORTONE_V2_NICE", pgProvider: "NICE_V2", channelKey },
    ...(inicisChannelKey ? [{ ...shared, provider: "PORTONE_V2_INICIS" as const, pgProvider: "INICIS_V2" as const, channelKey: inicisChannelKey }] : []),
    ...(kcpChannelKey ? [{ ...shared, provider: "PORTONE_V2_KCP" as const, pgProvider: "KCP_V2" as const, channelKey: kcpChannelKey }] : []),
  ];
  return [
    { ...shared, provider: "PORTONE_V2_INICIS", pgProvider: "INICIS_V2", channelKey },
    ...(kcpChannelKey ? [{ ...shared, provider: "PORTONE_V2_KCP" as const, pgProvider: "KCP_V2" as const, channelKey: kcpChannelKey }] : []),
  ];
}
export function checkoutCardChannels(config: ApiConfig): PortOneChannelBinding[] {
  const channels = configuredCardChannels(config);
  return config.paymentProvider === "PORTONE_V2_NICE" ? channels.filter(channel=>channel.provider === "PORTONE_V2_NICE") : channels;
}
export function selectCardChannel(config: ApiConfig, pg?: CardPg): PortOneChannelBinding {
  const chosen = pg ?? (config.paymentProvider === "PORTONE_V2_NICE" ? "NICE" : "INICIS");
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
