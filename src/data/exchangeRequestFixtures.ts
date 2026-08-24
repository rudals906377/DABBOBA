import type { ProductCategoryId } from "../domain/catalog";

export const EXCHANGE_FILTERS = ["전체", "가챠", "피규어", "쿠지", "카드"] as const;
export type ExchangeFilter = (typeof EXCHANGE_FILTERS)[number];

export type ExchangePost = {
  id: string;
  author: string;
  categoryId: ProductCategoryId;
  ipId: string;
  title: string;
  offeredItem: string;
  wantedItem: string;
  body: string;
  time: string;
  applications: number;
};

export type ExchangeApplication = {
  id: string;
  author: string;
  offeredItem: string;
  message: string;
  time: string;
};

export const DEFAULT_EXCHANGE_POSTS: ExchangePost[] = [
  {
    id: "exchange-one-piece-card",
    author: "카드정리중",
    categoryId: "tcg",
    ipId: "one-piece",
    title: "원피스 루피 리더 카드 교환해요",
    offeredItem: "OP-13 몽키 D. 루피 리더 카드",
    wantedItem: "포켓몬 피카츄 또는 리자몽 카드",
    body: "슬리브와 탑로더에 보관했습니다. 상태가 비슷한 카드끼리 교환하고 싶어요.",
    time: "12분 전",
    applications: 3,
  },
  {
    id: "exchange-jjk-capsule",
    author: "캡슐한바퀴",
    categoryId: "gacha",
    ipId: "jujutsu-kaisen",
    title: "고죠 캡슐 중복 교환 구해요",
    offeredItem: "주술회전 캡슐 DX 고죠 사토루",
    wantedItem: "같은 시리즈 게토 스구루",
    body: "개봉 후 구성만 확인했고 바로 보관했습니다. 직거래 또는 택배 모두 괜찮아요.",
    time: "34분 전",
    applications: 2,
  },
  {
    id: "exchange-frieren-figure",
    author: "새벽의마법사",
    categoryId: "figure",
    ipId: "frieren",
    title: "프리렌 피규어를 페른으로 교환 원해요",
    offeredItem: "프리렌 미니 피규어 미개봉",
    wantedItem: "동일 라인 페른 미니 피규어",
    body: "박스 눌림 없는 미개봉 제품입니다. 사진 확인 후 천천히 교환해요.",
    time: "1시간 전",
    applications: 1,
  },
  {
    id: "exchange-gundam-kuji",
    author: "우주세기보관소",
    categoryId: "kuji",
    ipId: "mobile-suit-gundam",
    title: "건담 쿠지 B상과 라스트원 교환 문의",
    offeredItem: "기동전사 건담 쿠지 B상",
    wantedItem: "같은 쿠지 라스트원상 또는 A상",
    body: "차액 협의 가능합니다. 상품 상태와 구성품을 서로 확인하고 진행하고 싶습니다.",
    time: "2시간 전",
    applications: 2,
  },
];

export const DEFAULT_EXCHANGE_APPLICATIONS: Record<string, ExchangeApplication[]> = {
  "exchange-one-piece-card": [
    {
      id: "exchange-one-piece-card-1",
      author: "초록바인더",
      offeredItem: "포켓몬 카드 피카츄 AR",
      message: "상태 사진을 확인한 뒤 택배 교환하고 싶어요.",
      time: "7분 전",
    },
    {
      id: "exchange-one-piece-card-2",
      author: "리자몽수집가",
      offeredItem: "리자몽 ex 더블레어",
      message: "추가 카드까지 포함해서 서로 맞춰볼 수 있어요.",
      time: "4분 전",
    },
  ],
  "exchange-jjk-capsule": [
    {
      id: "exchange-jjk-capsule-1",
      author: "굿즈산책",
      offeredItem: "같은 시리즈 게토 스구루",
      message: "저도 중복이라 1:1 교환 가능합니다.",
      time: "18분 전",
    },
  ],
  "exchange-frieren-figure": [],
  "exchange-gundam-kuji": [
    {
      id: "exchange-gundam-kuji-1",
      author: "마지막한장",
      offeredItem: "건담 쿠지 A상",
      message: "구성품과 박스 상태 확인 후 차액 없이 교환을 제안드려요.",
      time: "53분 전",
    },
  ],
};

export type ProductRequest = {
  id: string;
  author: string;
  categoryId: ProductCategoryId;
  ipId: string;
  desiredItem: string;
  details: string;
  time: string;
  likes: number;
};

export const REQUEST_CATEGORY_IDS: readonly ProductCategoryId[] = ["gacha", "tcg", "figure", "kuji"];

export const DEFAULT_PRODUCT_REQUESTS: ProductRequest[] = [
  {
    id: "request-dandadan-gacha",
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
    author: "헌터시험응시자",
    categoryId: "kuji",
    ipId: "hunter-x-hunter",
    desiredItem: "키메라 앤트 편 신규 이치방쿠지",
    details: "라스트원상까지 포함된 정식 국내 판매 회차를 원해요.",
    time: "3시간 전",
    likes: 51,
  },
];
