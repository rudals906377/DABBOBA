export const PROFILE_FAVORITE_PRODUCT_IDS: readonly string[] = [];

export type ProfileStorageItem = {
  id: string;
  productId: string;
  prizeLabel: string;
  acquiredAt: string;
  shippingDeadline: string;
};

export const PROFILE_STORAGE_ITEMS: readonly ProfileStorageItem[] = [];

export type ProfilePurchaseHistoryItem = {
  id: string;
  productId: string;
  orderedAt: string;
  quantity: number;
  paidTotal: number;
  status: "결제 완료" | "뽑기 완료" | "배송 신청 전";
};

export const PROFILE_PURCHASE_HISTORY: readonly ProfilePurchaseHistoryItem[] = [];

export type ProfilePointHistoryItem = {
  id: string;
  label: string;
  detail: string;
  occurredAt: string;
  amount: number;
};

export const PROFILE_POINT_HISTORY: readonly ProfilePointHistoryItem[] = [];

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
