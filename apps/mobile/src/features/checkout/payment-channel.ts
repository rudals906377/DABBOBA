import type { components } from "@dabboba/contracts";

type Binding = components["schemas"]["PortOneCardChannelBinding"];
const pgByProvider: Record<Binding["provider"], Binding["pgProvider"]> = {
  PORTONE_V2_INICIS: "INICIS_V2", PORTONE_V2_KCP: "KCP_V2", PORTONE_V2_NICE: "NICE_V2",
};

/** A server-bound order always wins over a mutable build-wide channel. */
export function checkoutPaymentChannel(
  order: { cardPayment?: Binding | null },
  legacy: { storeId: string; channelKey: string },
): { storeId: string; channelKey: string } {
  const binding = order.cardPayment;
  if (binding != null) {
    if (!Object.hasOwn(pgByProvider, binding.provider) || pgByProvider[binding.provider] !== binding.pgProvider
      || !["TEST", "LIVE"].includes(binding.channelEnvironment)
      || !/^store-[A-Za-z0-9-]{1,160}$/.test(binding.storeId)
      || !/^channel-key-[A-Za-z0-9-]{1,160}$/.test(binding.channelKey)) {
      throw new Error("주문에 저장된 결제 채널을 확인하지 못했어요.");
    }
    return { storeId: binding.storeId, channelKey: binding.channelKey };
  }
  // Only historical unbound orders use the original build channel.
  if (!legacy.storeId || !legacy.channelKey) throw new Error("결제 채널이 설치 빌드에 구성되지 않았어요.");
  return legacy;
}
