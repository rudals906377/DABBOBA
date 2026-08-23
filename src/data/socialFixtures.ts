import type { ProductCategoryId } from "../domain/catalog";

export const COMMUNITY_TOPICS = ["전체", "정보", "질문", "애니 이야기"] as const;
export type CommunityTopic = (typeof COMMUNITY_TOPICS)[number];
export type PostTopic = Exclude<CommunityTopic, "전체">;

export type CommunityPost = {
  id: string;
  author: string;
  topic: PostTopic;
  title: string;
  body: string;
  time: string;
  likes: number;
  comments: number;
};

export type CommunityComment = {
  id: string;
  author: string;
  body: string;
  time: string;
  likes: number;
};

export const DEFAULT_COMMUNITY_POSTS: CommunityPost[] = [
  {
    id: "release-note-kuji",
    author: "라스트원",
    topic: "정보",
    title: "이번 주 쿠지 발매 일정 정리했어요",
    body: "에반게리온과 건담 신작 일정이 겹칩니다. 방문 전에 판매 시작 시간을 꼭 확인해 보세요.",
    time: "8분 전",
    likes: 24,
    comments: 7,
  },
  {
    id: "jjk-capsule-size",
    author: "굿즈산책",
    topic: "질문",
    title: "주술회전 캡슐 DX 실물 크기 어떤가요?",
    body: "일반 캡슐 피규어보다 크다고 하는데 책상 위에 두기 부담 없는지 궁금합니다.",
    time: "21분 전",
    likes: 11,
    comments: 13,
  },
  {
    id: "frieren-scene",
    author: "새벽의마법사",
    topic: "애니 이야기",
    title: "프리렌에서 다시 보고 싶은 장면",
    body: "잔잔하게 이어지다가 감정이 한 번에 닿는 장면들이 좋아요. 여러분의 최애 장면도 알려주세요.",
    time: "1시간 전",
    likes: 38,
    comments: 19,
  },
  {
    id: "pokemon-storage",
    author: "카드정리중",
    topic: "정보",
    title: "카드팩 개봉 후 보관 순서 공유",
    body: "슬리브, 탑로더, 바인더 순으로 정리하니 레어 카드 확인과 보관이 편했습니다.",
    time: "2시간 전",
    likes: 46,
    comments: 9,
  },
];

export const DEFAULT_COMMUNITY_COMMENTS: Record<string, CommunityComment[]> = {
  "release-note-kuji": [
    {
      id: "release-note-kuji-1",
      author: "건프라저녁반",
      body: "건담은 저녁 7시, 에반게리온은 8시 시작으로 확인했어요. 매장마다 다를 수 있으니 공지도 같이 보세요.",
      time: "4분 전",
      likes: 6,
    },
    {
      id: "release-note-kuji-2",
      author: "마지막한장",
      body: "일정 한눈에 보기 편하네요. 품절 알림도 켜두겠습니다!",
      time: "2분 전",
      likes: 3,
    },
  ],
  "jjk-capsule-size": [
    {
      id: "jjk-capsule-size-1",
      author: "책상한칸",
      body: "받침대 포함 대략 손가락 두 마디 정도예요. 모니터 아래에 두기에는 부담 없었습니다.",
      time: "15분 전",
      likes: 8,
    },
    {
      id: "jjk-capsule-size-2",
      author: "캡슐수집가",
      body: "일반 가챠보다 존재감은 있지만 넨도로이드보다는 훨씬 작아요.",
      time: "11분 전",
      likes: 5,
    },
  ],
  "frieren-scene": [
    {
      id: "frieren-scene-1",
      author: "힘멜동상",
      body: "저는 꽃밭을 만드는 마법이 다시 등장하는 장면이 가장 오래 남았어요.",
      time: "44분 전",
      likes: 12,
    },
    {
      id: "frieren-scene-2",
      author: "마법노트",
      body: "짧은 회상인데도 인물 관계가 한 번에 이해되는 연출이 정말 좋았습니다.",
      time: "36분 전",
      likes: 9,
    },
  ],
  "pokemon-storage": [
    {
      id: "pokemon-storage-1",
      author: "홀로수집가",
      body: "바인더 안에 작은 제습지를 같이 넣어두면 습한 날에도 안심돼요.",
      time: "1시간 전",
      likes: 10,
    },
    {
      id: "pokemon-storage-2",
      author: "초록바인더",
      body: "저도 같은 순서로 정리합니다. 너무 꽉 끼는 슬리브만 피하면 꺼낼 때도 편해요.",
      time: "52분 전",
      likes: 7,
    },
  ],
};

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
