import type { ProductCategoryId } from "../domain/catalog";

export const EXCHANGE_FILTERS = ["전체", "가챠", "피규어", "쿠지", "카드"] as const;
export type ExchangeFilter = (typeof EXCHANGE_FILTERS)[number];

export type ExchangePost = {
  id: string;
  authorId: string;
  author: string;
  categoryId: ProductCategoryId;
  ipId: string;
  title: string;
  offeredInventoryUnitId: string;
  offeredCatalogItemId: string;
  offeredItem: string;
  offeredItemImage: string;
  appReferenceValue: number;
  sourceType: "PURCHASE" | "GACHA" | "KUJI" | "ADMIN_ADJUSTMENT";
  body: string;
  time: string;
  applications: number;
  lifecycleStatus?: "OPEN" | "MATCHED" | "COMPLETED" | "CANCELLED" | "HIDDEN";
  acceptedOfferId?: string | null;
  authorConfirmedAt?: string | null;
  proposerConfirmedAt?: string | null;
};

export type ExchangeApplication = {
  id: string;
  authorId: string;
  author: string;
  offeredInventoryUnitId: string;
  offeredCatalogItemId: string;
  ipId: string;
  categoryId: ProductCategoryId;
  offeredItem: string;
  offeredItemImage: string;
  appReferenceValue: number;
  sourceType: "PURCHASE" | "GACHA" | "KUJI" | "ADMIN_ADJUSTMENT";
  time: string;
  status?: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
};

export const DEFAULT_EXCHANGE_POSTS: ExchangePost[] = [
  {
    id: "exchange-jjk-capsule",
    authorId: "user-capsule-round",
    author: "캡슐한바퀴",
    categoryId: "gacha",
    ipId: "jujutsu-kaisen",
    title: "고죠 캡슐 중복, 교환 제안 받아요",
    offeredInventoryUnitId: "inventory-capsule-round-gojo",
    offeredCatalogItemId: "jjk-gojo-capsule",
    offeredItem: "주술회전 캡슐 DX 고죠 사토루",
    offeredItemImage: "/assets/dabboba/products/ip/jujutsu-kaisen.jpg",
    appReferenceValue: 9_000,
    sourceType: "GACHA",
    body: "개봉 후 구성만 확인했고 바로 보관했습니다. 원하는 상품으로 자유롭게 제안해 주세요.",
    time: "34분 전",
    applications: 2,
  },
];

export const DEFAULT_EXCHANGE_APPLICATIONS: Record<string, ExchangeApplication[]> = {
  "exchange-jjk-capsule": [
    {
      id: "exchange-jjk-capsule-1",
      authorId: "user-goods-walk",
      author: "굿즈산책",
      offeredInventoryUnitId: "inventory-goods-walk-geto",
      offeredCatalogItemId: "jjk-geto-capsule",
      ipId: "jujutsu-kaisen",
      categoryId: "gacha",
      offeredItem: "주술회전 캡슐 DX 게토 스구루",
      offeredItemImage: "/assets/dabboba/products/ip/jujutsu-kaisen.jpg",
      appReferenceValue: 9_000,
      sourceType: "GACHA",
      time: "18분 전",
    },
  ],
};

export type ProductRequest = {
  id: string;
  authorId: string;
  author: string;
  categoryId: ProductCategoryId;
  ipId: string;
  desiredItem: string;
  details: string;
  time: string;
  likes: number;
  version?: number;
};

export const REQUEST_CATEGORY_IDS: readonly ProductCategoryId[] = ["gacha", "tcg", "figure", "kuji"];

export const DEFAULT_PRODUCT_REQUESTS: ProductRequest[] = [
  {
    id: "request-dandadan-gacha",
    authorId: "user-occult-collector",
    author: "오컬트수집가",
    categoryId: "gacha",
    ipId: "dandadan",
    desiredItem: "오카룽 변신 버전 캡슐 피규어",
    details: "작은 책상에도 둘 수 있는 7cm 안팎 사이즈면 좋겠어요.",
    time: "9분 전",
    likes: 28,
  },
  {
    id: "request-pokemon-card",
    authorId: "user-green-binder",
    author: "초록바인더",
    categoryId: "tcg",
    ipId: "pokemon",
    desiredItem: "포켓몬 카드 한글판 신규 확장팩",
    details: "낱팩과 박스를 모두 선택해서 구매할 수 있으면 좋겠습니다.",
    time: "26분 전",
    likes: 42,
  },
  {
    id: "request-evangelion-figure",
    authorId: "user-unit-one-hangar",
    author: "초호기격납고",
    categoryId: "figure",
    ipId: "evangelion",
    desiredItem: "아스카 플러그 슈트 스케일 피규어",
    details: "재판 제품이나 예약 상품도 입고 전에 알림을 받고 싶어요.",
    time: "1시간 전",
    likes: 35,
  },
  {
    id: "request-hunter-kuji",
    authorId: "user-hunter-examinee",
    author: "헌터시험응시자",
    categoryId: "kuji",
    ipId: "hunter-x-hunter",
    desiredItem: "키메라 앤트 편 신규 이치방쿠지",
    details: "라스트원상까지 포함된 정식 국내 판매 회차를 원해요.",
    time: "3시간 전",
    likes: 51,
  },
];
