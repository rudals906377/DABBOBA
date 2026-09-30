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
      }],
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
            { text: "기본 보관 기간은 획득일 기준 60일입니다. 기간이 지난 상품은 배송·교환·포인트 환급 대상에서 제외되며 자동 폐기하지 않습니다. 이후 처리는 고객센터에 문의해 주세요." },
          ],
        },
        {
          title: "교환 및 포인트 환급",
          items: [
            { text: "본인이 직접 뽑아 현재 보관 중인 가챠 상품만 교환과 포인트 환급 대상입니다. 쿠지 상품은 대상이 아닙니다." },
            { text: "포인트 환급은 본인이 직접 뽑은 가챠의 구매 당시 1회 판매가 50%를 앱 포인트로 지급하며, 현금 환불과는 다릅니다." },
            { text: "배송을 신청했거나 이미 받은 상품, 다른 교환에 사용 중인 상품은 교환·포인트 환급을 신청할 수 없습니다." },
          ],
        },
      ],
    },
    {
      id: "post-shipping",
      title: "배송 후 문의 안내",
      groups: [{
        items: [
          { text: "배송 상품의 하자, 파손 또는 오배송을 발견하면 고객센터에 주문번호와 상태를 확인할 수 있는 자료를 보내주세요." },
          { text: "문의 내용을 확인하고 관련 법령과 실제 결제·배송 기록에 따라 교환·환불 방법을 안내합니다." },
        ],
      }],
    },
  ];
}
