export type CheckoutNoticeGroup = {
  title?: string;
  items: ReadonlyArray<{
    text: string;
    children?: readonly string[];
  }>;
};

export type CheckoutNoticeSection = {
  id: "payment-refund" | "shipping-exchange" | "post-shipping";
  title: string;
  groups: readonly CheckoutNoticeGroup[];
};

export type DrawCheckoutCategory = "gacha" | "kuji";

export const deliveryPeriodNotice = "배송 신청 접수 후 배송 완료까지 영업일 기준 2~5일이 소요됩니다. 주말·공휴일은 제외하며, 택배사 사정 등으로 지연되는 경우 별도로 안내합니다.";

export const cancellationRefundNotices = [
  { text: "취소·환불은 내정보의 고객센터에서 주문번호와 사유를 알려 접수할 수 있습니다. 결제, 뽑기 권리 사용 및 배송 상태를 확인한 뒤 처리 결과를 안내합니다." },
  { text: "뽑기 권리를 사용하지 않은 주문은 고객센터로 취소를 요청하면 전액 취소합니다. 일부 뽑기를 사용한 가챠 주문은 사용하지 않은 뽑기만 환불하며, 환불액은 결제 금액(카드 결제액과 사용 포인트의 합)을 뽑기 수로 나눈 금액에 사용하지 않은 뽑기 수를 곱해 원 단위 미만을 버린 금액입니다. 쿠폰 할인액은 돌려드리지 않습니다." },
  { text: "결과가 마음에 들지 않는다는 이유로 상품을 다시 뽑거나 다른 종류로 임의 변경하는 기능은 제공하지 않습니다. 법령상 청약철회·교환·환불 권리는 제한하지 않습니다." },
  { text: "환불 금액은 실제 결제 금액과 사용 포인트 등 주문 기록을 기준으로 산정합니다. 카드로 결제한 금액은 기존 결제 수단인 해당 카드의 결제를 취소해 환급하고, 주문에 사용한 포인트는 포인트로 되돌려 드립니다. 앱 포인트 환급으로 현금 환불을 대신하지 않습니다." },
  { text: "법령상 청약철회가 가능한 경우 법정 기산일부터 7일 이내에 요청할 수 있습니다. 상품 상태와 법정 제한 사유에 따라 처리하며, 단순히 랜덤 상품이라는 이유만으로 환불을 일괄 거절하지 않습니다." },
  { text: "법령에 따른 환급은 상품을 반환받은 날, 또는 상품을 공급하지 않았다면 청약철회한 날부터 3영업일 이내에 처리합니다. 카드사 등의 이용내역에 반영되는 시점은 결제 수단에 따라 다를 수 있습니다." },
] as const;

export const postShippingNotices = [
  { text: "하자·파손·오배송은 고객센터에 주문번호와 상품 상태를 알려 접수해 주세요. 사진이나 개봉 영상은 확인에 도움이 되며, 영상이 없다는 이유만으로 접수나 법령상 권리를 제한하지 않습니다." },
  { text: "상품의 하자나 계약과 다른 배송이 확인되면 관련 법령에 따라 교환 또는 환불을 처리하고, 이때 필요한 반환 배송비는 판매자가 부담합니다." },
  { text: "표시·광고 또는 계약 내용과 다른 상품에는 수령일부터 3개월, 그 사실을 안 날 또는 알 수 있었던 날부터 30일의 법정 청약철회 기준이 적용됩니다." },
  { text: "단순 변심에 따른 법령상 반품이 가능한 경우 반환 배송비는 구매자가 부담합니다. 반품 접수 시 비용과 반환 방법을 안내하며, 취소 위약금을 별도로 부과하지 않습니다." },
] as const;

const paymentNotices: Record<DrawCheckoutCategory, readonly string[]> = {
  gacha: [
    "결제 전에 포함 상품 목록과 전체·오픈 수량을 확인할 수 있습니다. 받을 정확한 상품은 결제 전에 알 수 없습니다.",
    "결제가 서버에서 확인되면 구매 수량만큼 뽑기 권리가 발급됩니다. 각 캡슐을 직접 열 때 서버가 남은 구성에 따라 획득 상품을 확정하고 결과 화면과 보관함에 기록합니다.",
  ],
  kuji: [
    "결제 전에 쿠지의 포함 상품과 등급별 남은 수량을 확인할 수 있습니다. 봉인된 번호별 정확한 상품은 열기 전까지 알 수 없습니다.",
    "결제가 서버에서 확인되면 구매 수량만큼 뽑기 권리가 발급됩니다. 선택한 티켓을 직접 열 때 서버가 획득 상품을 확정하고 결과 화면과 보관함에 기록합니다.",
  ],
};

/** Customer copy describes DABBOBA's implemented flow, not a competitor's private rules. */
export function checkoutNoticeSections(category: DrawCheckoutCategory): readonly CheckoutNoticeSection[] {
  return [
    {
      id: "payment-refund",
      title: "결제 및 결과 안내",
      groups: [{
        items: [
          ...paymentNotices[category].map((text) => ({ text })),
          { text: "결과 확인 중 앱을 닫거나 연결이 끊겨도 다시 결제하지 마세요. 구매 내역에서 결제·뽑기 상태를 다시 확인할 수 있습니다." },
          { text: "결제 취소·환불은 결제, 뽑기 권리 사용 및 배송 상태를 확인해 관련 법령과 이용약관에 따라 처리합니다. 고객센터로 문의해 주세요." },
        ],
      }, { title: "취소·환불 규정", items: cancellationRefundNotices }],
    },
    {
      id: "shipping-exchange",
      title: "보관·배송·포인트 안내",
      groups: [
        {
          title: "보관 및 배송",
          items: [
            { text: "획득한 실물 상품은 보관함에서 확인하고 원하는 상품을 선택해 배송을 신청할 수 있습니다." },
            { text: "가챠 상품만 묶으면 합계 24,900원 이상, 쿠지 상품이 하나라도 포함되면 합계 54,900원 이상부터 무료배송입니다." },
            { text: "무료배송 기준 미달 시 배송비는 3,000원이며, 배송비 결제가 확인된 뒤 신청이 접수됩니다." },
            { text: deliveryPeriodNotice },
            { text: "배송 신청을 취소하려면 고객센터로 문의해 주세요. 출고 여부에 따라 취소 가능한지 확인하며, 이미 출고된 상품은 배송 후 교환·반품 절차로 안내합니다." },
            { text: "기본 보관 기간은 획득일 기준 60일입니다. 기간이 지난 상품은 배송·교환·포인트 환급 대상에서 제외되며 자동 폐기하지 않습니다. 이후 처리는 고객센터에 문의해 주세요." },
          ],
        },
        {
          title: "교환 및 포인트 환급",
          items: [
            { text: "본인이 직접 뽑아 현재 보관 중인 가챠 상품만 교환과 포인트 환급 대상입니다. 쿠지 상품은 대상이 아닙니다." },
            { text: "포인트 환급은 본인이 직접 뽑아 보관 중인 가챠 경품 상품의 기준금액 50%를 상품별로 소수점 이하를 버려 앱 포인트로 지급하며, 현금 환불과는 다릅니다. 기준금액이 없는 상품은 대상이 아닙니다." },
            { text: "배송을 신청했거나 이미 받은 상품, 다른 교환에 사용 중인 상품은 교환·포인트 환급을 신청할 수 없습니다." },
          ],
        },
      ],
    },
    {
      id: "post-shipping",
      title: "배송 후 문의 안내",
      groups: [{
        items: postShippingNotices,
      }],
    },
  ];
}
