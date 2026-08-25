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
  message: string;
  time: string;
  status?: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
};

export const DEFAULT_EXCHANGE_POSTS: ExchangePost[] = [
  {
    id: "exchange-one-piece-card",
    authorId: "user-card-organizer",
    author: "카드정리중",
    categoryId: "tcg",
    ipId: "one-piece",
    title: "루피 리더 카드, 교환 제안 받아요",
    offeredInventoryUnitId: "inventory-card-organizer-luffy-leader",
    offeredCatalogItemId: "one-piece-luffy-leader",
    offeredItem: "OP-13 몽키 D. 루피 리더 카드",
    offeredItemImage: "/assets/dabboba/products/ip/one-piece.jpg",
    appReferenceValue: 12_000,
    body: "슬리브와 탑로더에 보관했습니다. 상품 상태와 함께 편하게 교환을 제안해 주세요.",
    time: "12분 전",
    applications: 3,
  },
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
    body: "개봉 후 구성만 확인했고 바로 보관했습니다. 원하는 상품으로 자유롭게 제안해 주세요.",
    time: "34분 전",
    applications: 2,
  },
  {
    id: "exchange-frieren-figure",
    authorId: "user-dawn-mage",
    author: "새벽의마법사",
    categoryId: "figure",
    ipId: "frieren",
    title: "프리렌 미니 피규어 교환 열어둘게요",
    offeredInventoryUnitId: "inventory-dawn-mage-frieren",
    offeredCatalogItemId: "frieren-mini-figure",
    offeredItem: "프리렌 미니 피규어 미개봉",
    offeredItemImage: "/assets/dabboba/products/ip/frieren.jpg",
    appReferenceValue: 54_900,
    body: "박스 눌림 없는 미개봉 제품입니다. 사진 확인 후 천천히 제안을 살펴볼게요.",
    time: "1시간 전",
    applications: 1,
  },
  {
    id: "exchange-gundam-kuji",
    authorId: "user-universal-century",
    author: "우주세기보관소",
    categoryId: "kuji",
    ipId: "mobile-suit-gundam",
    title: "건담 쿠지 B상 교환 제안 받습니다",
    offeredInventoryUnitId: "inventory-universal-century-gundam-b",
    offeredCatalogItemId: "gundam-kuji-b",
    offeredItem: "기동전사 건담 쿠지 B상",
    offeredItemImage: "/assets/dabboba/products/ip/mobile-suit-gundam.jpg",
    appReferenceValue: 24_000,
    body: "상품 상태와 구성품을 서로 확인하고 진행하고 싶습니다. 여러 제안을 편하게 남겨주세요.",
    time: "2시간 전",
    applications: 2,
  },
];

export const DEFAULT_EXCHANGE_APPLICATIONS: Record<string, ExchangeApplication[]> = {
  "exchange-one-piece-card": [
    {
      id: "exchange-one-piece-card-1",
      authorId: "user-green-binder",
      author: "초록바인더",
      offeredInventoryUnitId: "inventory-green-binder-pikachu",
      offeredCatalogItemId: "pokemon-pikachu-card",
      ipId: "pokemon",
      categoryId: "tcg",
      offeredItem: "포켓몬스터 피카츄 카드",
      offeredItemImage: "/assets/dabboba/products/ip/pokemon.jpg",
      appReferenceValue: 8_000,
      message: "상태 사진을 확인한 뒤 택배 교환하고 싶어요.",
      time: "7분 전",
    },
    {
      id: "exchange-one-piece-card-2",
      authorId: "user-charizard-collector",
      author: "리자몽수집가",
      offeredInventoryUnitId: "inventory-charizard-collector-charizard",
      offeredCatalogItemId: "pokemon-charizard-card",
      ipId: "pokemon",
      categoryId: "tcg",
      offeredItem: "포켓몬스터 리자몽 카드",
      offeredItemImage: "/assets/dabboba/products/ip/pokemon.jpg",
      appReferenceValue: 18_000,
      message: "추가 카드까지 포함해서 서로 맞춰볼 수 있어요.",
      time: "4분 전",
    },
  ],
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
      message: "저도 중복이라 1:1 교환 가능합니다.",
      time: "18분 전",
    },
  ],
  "exchange-frieren-figure": [],
  "exchange-gundam-kuji": [
    {
      id: "exchange-gundam-kuji-1",
      authorId: "user-last-ticket",
      author: "마지막한장",
      offeredInventoryUnitId: "inventory-last-ticket-gundam-a",
      offeredCatalogItemId: "gundam-kuji-a",
      ipId: "mobile-suit-gundam",
      categoryId: "kuji",
      offeredItem: "기동전사 건담 쿠지 A상",
      offeredItemImage: "/assets/dabboba/products/ip/mobile-suit-gundam.jpg",
      appReferenceValue: 42_000,
      message: "구성품과 박스 상태 확인 후 차액 없이 교환을 제안드려요.",
      time: "53분 전",
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
