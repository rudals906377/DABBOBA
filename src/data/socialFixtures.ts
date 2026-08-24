import type { ProductCategoryId } from "../domain/catalog";

export const DUCKROOM_FILTERS = ["전체", "가챠", "피규어", "쿠지", "카드"] as const;
export type DuckroomFilter = (typeof DUCKROOM_FILTERS)[number];

export type DuckroomShowcase = {
  id: string;
  author: string;
  caption: string;
  categoryId: ProductCategoryId;
  productId: string;
  collectedCount: number;
  likes: number;
};

export const DUCKROOM_SHOWCASES: DuckroomShowcase[] = [
  {
    id: "room-naruto",
    author: "나뭇잎수집가",
    caption: "책상 한 칸을 나루토로 채웠어요",
    categoryId: "figure",
    productId: "naruto-figure",
    collectedCount: 12,
    likes: 84,
  },
  {
    id: "room-demon-slayer",
    author: "캡슐한바퀴",
    caption: "귀멸 캡슐룬 전종 완성",
    categoryId: "gacha",
    productId: "demon-slayer-gacha",
    collectedCount: 4,
    likes: 61,
  },
  {
    id: "room-gundam",
    author: "우주세기보관소",
    caption: "건담 쿠지 상위상 진열 기록",
    categoryId: "kuji",
    productId: "mobile-suit-gundam-kuji",
    collectedCount: 18,
    likes: 109,
  },
  {
    id: "room-pokemon",
    author: "초록바인더",
    caption: "포켓몬 카드 한 페이지씩 정리 중",
    categoryId: "tcg",
    productId: "pokemon-tcg",
    collectedCount: 96,
    likes: 73,
  },
  {
    id: "room-frieren",
    author: "마법수집일지",
    caption: "프리렌 피규어 조용히 자리 잡기",
    categoryId: "figure",
    productId: "frieren-figure",
    collectedCount: 7,
    likes: 58,
  },
  {
    id: "room-hunter",
    author: "헌터시험합격",
    caption: "키메라 앤트 쿠지 수집장",
    categoryId: "kuji",
    productId: "hunter-x-hunter-kuji",
    collectedCount: 15,
    likes: 92,
  },
];
