export const PROFILE_FAVORITE_PRODUCT_IDS = [
  "one-piece-tcg",
  "dragon-ball-figure",
  "demon-slayer-gacha",
  "jujutsu-kaisen-gacha",
  "naruto-figure",
  "hunter-x-hunter-kuji",
] as const;

export type ProfileStorageItem = {
  id: string;
  productId: string;
  prizeLabel: string;
  acquiredAt: string;
  shippingDeadline: string;
};

export const PROFILE_STORAGE_ITEMS: readonly ProfileStorageItem[] = [
  {
    id: "storage-demon-slayer",
    productId: "demon-slayer-gacha",
    prizeLabel: "B상 · 탄지로 미니 피규어",
    acquiredAt: "2026.08.23",
    shippingDeadline: "2026.09.22",
  },
  {
    id: "storage-jujutsu-kaisen",
    productId: "jujutsu-kaisen-gacha",
    prizeLabel: "A상 · 고죠 사토루 컬렉션",
    acquiredAt: "2026.08.21",
    shippingDeadline: "2026.09.20",
  },
  {
    id: "storage-hunter-x-hunter",
    productId: "hunter-x-hunter-kuji",
    prizeLabel: "C상 · 키메라 앤트 굿즈",
    acquiredAt: "2026.08.19",
    shippingDeadline: "2026.09.18",
  },
] as const;

export type ProfilePurchaseHistoryItem = {
  id: string;
  productId: string;
  orderedAt: string;
  quantity: number;
  paidTotal: number;
  status: "결제 완료" | "뽑기 완료" | "배송 신청 전";
};

export const PROFILE_PURCHASE_HISTORY: readonly ProfilePurchaseHistoryItem[] = [
  {
    id: "DBB-20260824-001",
    productId: "one-piece-tcg",
    orderedAt: "2026.08.24",
    quantity: 2,
    paidTotal: 4_000,
    status: "결제 완료",
  },
  {
    id: "DBB-20260823-014",
    productId: "demon-slayer-gacha",
    orderedAt: "2026.08.23",
    quantity: 1,
    paidTotal: 6_000,
    status: "뽑기 완료",
  },
  {
    id: "DBB-20260818-008",
    productId: "dragon-ball-figure",
    orderedAt: "2026.08.18",
    quantity: 1,
    paidTotal: 59_900,
    status: "배송 신청 전",
  },
] as const;

export type ProfilePointHistoryItem = {
  id: string;
  label: string;
  detail: string;
  occurredAt: string;
  amount: number;
};

export const PROFILE_POINT_HISTORY: readonly ProfilePointHistoryItem[] = [
  {
    id: "point-welcome",
    label: "가입 축하 포인트",
    detail: "DABBOBA 첫 가입 혜택",
    occurredAt: "2026.08.10",
    amount: 10_000,
  },
  {
    id: "point-first-order",
    label: "첫 구매 적립",
    detail: "첫 상품 구매 완료",
    occurredAt: "2026.08.18",
    amount: 3_000,
  },
  {
    id: "point-order-use",
    label: "상품 결제 사용",
    detail: "원피스 카드게임 OP-13",
    occurredAt: "2026.08.24",
    amount: -1_000,
  },
  {
    id: "point-event",
    label: "오픈 이벤트 적립",
    detail: "앱 오픈 이벤트 참여",
    occurredAt: "2026.08.24",
    amount: 500,
  },
] as const;

export const PROFILE_CUSTOMER_FAQS = [
  {
    question: "가챠·쿠지 결과는 언제 보관함에 들어오나요?",
    answer: "결제 후 뽑기를 완료하면 결과 상품이 바로 보관함에 표시됩니다.",
  },
  {
    question: "여러 상품을 한 번에 배송받을 수 있나요?",
    answer: "보관함에서 배송할 상품을 고른 뒤 배송 신청 화면에서 합배송을 선택할 수 있습니다.",
  },
  {
    question: "피규어와 카드는 어떻게 구매하나요?",
    answer: "피규어와 카드는 뽑기 없이 일반 상품처럼 수량을 고르고 바로 결제합니다.",
  },
] as const;

export type MemberPaymentCard = {
  id: string;
  issuer: string;
  nickname: string;
  holderName: string;
  last4: string;
};

export type MemberSettings = {
  personal: {
    legalName: string;
    email: string;
    phone: string;
    birthDate: string;
  };
  defaultAddress: {
    recipient: string;
    phone: string;
    postalCode: string;
    addressLine1: string;
    addressLine2: string;
    deliveryNote: string;
  };
  paymentCard: MemberPaymentCard | null;
  paymentPreferences: {
    defaultMethod: "card" | "kakao" | "naver";
    cashReceiptPhone: string;
    requirePaymentConfirmation: boolean;
  };
  security: {
    passwordUpdatedAt: string;
    twoFactorEnabled: boolean;
    socialLogin: string;
  };
  privacy: {
    orderUpdates: boolean;
    exchangeUpdates: boolean;
    requestUpdates: boolean;
    restockUpdates: boolean;
    marketingSms: boolean;
    marketingEmail: boolean;
    marketingPush: boolean;
    personalizedRecommendations: boolean;
  };
};

export const DEFAULT_MEMBER_SETTINGS: MemberSettings = {
  personal: {
    legalName: "김다뽑",
    email: "dabboba01@example.com",
    phone: "01012345678",
    birthDate: "1995.03.18",
  },
  defaultAddress: {
    recipient: "김다뽑",
    phone: "01012345678",
    postalCode: "04790",
    addressLine1: "서울특별시 성동구 성수이로 00",
    addressLine2: "101동 101호",
    deliveryNote: "문 앞에 놓아주세요.",
  },
  paymentCard: {
    id: "card-local-01",
    issuer: "현대카드",
    nickname: "굿즈 결제 카드",
    holderName: "김다뽑",
    last4: "4821",
  },
  paymentPreferences: {
    defaultMethod: "card",
    cashReceiptPhone: "01012345678",
    requirePaymentConfirmation: true,
  },
  security: {
    passwordUpdatedAt: "2026.08.10",
    twoFactorEnabled: false,
    socialLogin: "카카오 연결됨",
  },
  privacy: {
    orderUpdates: true,
    exchangeUpdates: true,
    requestUpdates: true,
    restockUpdates: false,
    marketingSms: false,
    marketingEmail: false,
    marketingPush: true,
    personalizedRecommendations: true,
  },
};
