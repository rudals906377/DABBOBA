export const developmentPaymentCopy = {
  confirmation: (paymentLabel: string) => `${paymentLabel} · TEST_PG 결제 후 뽑기로 이동`,
  guidance: [
    "TEST_PG · 실제 과금 없음",
    "아래 수단은 모두 동일한 테스트 결제로 처리하며 카드나 간편결제 정보는 입력하지 않아요.",
  ],
  selectedCaption: "선택됨 · 공통 TEST_PG",
  availableCaption: "테스트용 선택 가능 · 공통 TEST_PG",
};
