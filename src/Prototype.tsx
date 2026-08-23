import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { ActionButton } from "@seed-design/react";
import "@seed-design/css/all.css";
import "@fontsource/press-start-2p/latin-400.css";
import {
  IconArrowLeftLine,
  IconBoxFlapLine,
  IconCameraLine,
  IconCardLine,
  IconCheckmarkCircleFill,
  IconCheckmarkLine,
  IconChevronRightLine,
  IconCouponLine,
  IconDot3HorizontalChatbubbleLeftLine,
  IconGridLine,
  IconHeartFill,
  IconHeartLine,
  IconLockLine,
  IconMagnifyingglassLine,
  IconMinusLine,
  IconPencilLine,
  IconPerson2Line,
  IconPlusLine,
  IconReceiptLine,
  IconTruckLine,
  IconXmarkLine,
} from "@karrotmarket/react-monochrome-icon";
import {
  BottomSheet,
  Carousel,
  FlowStack,
  KeyboardInput,
  KeyboardTextarea,
  MobileScroll,
  useKeyboard,
  type FlowControls,
  type FlowScreen,
} from "./mobile";
import { AppBottomNavigation } from "./components/AppBottomNavigation";
import { FEATURED_IPS, IP_CATALOG } from "./data/ipCatalog";
import { PRODUCTS, productsForIp, type CatalogProduct } from "./data/productCatalog";
import {
  COMMUNITY_TOPICS,
  DEFAULT_COMMUNITY_COMMENTS,
  DEFAULT_COMMUNITY_POSTS,
  DUCKROOM_FILTERS,
  DUCKROOM_SHOWCASES,
  type CommunityComment,
  type CommunityPost,
  type CommunityTopic,
  type DuckroomFilter,
  type PostTopic,
} from "./data/socialFixtures";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  categoryLabel,
  isRandomDrawCategory,
  matchesIpSearch,
  type IpRecord,
  type ProductCategoryId,
  type ProductCategoryLabel,
} from "./domain/catalog";
import type { RootTabId } from "./domain/navigation";

type Category = ProductCategoryLabel;
type CategoryFilter = "전체" | Category;
type PaymentMethod = "간편카드" | "카카오페이" | "네이버페이";
type DrawState = "ready" | "drawing" | "result" | "done";
type PrizeGrade = "S" | "A" | "B";
type IpDetailTab = "상품" | "캐릭터" | "스냅" | "커뮤니티";
type UserProfile = {
  nickname: string;
  bio: string;
  favoriteIpId: string;
};

type Product = CatalogProduct;

const products: Product[] = PRODUCTS;

const filters: CategoryFilter[] = ["전체", ...PRODUCT_CATEGORY_LABELS];
const paymentMethods: PaymentMethod[] = ["간편카드", "카카오페이", "네이버페이"];
const couponOptions = [1_000, 0] as const;
const ipDetailTabs: IpDetailTab[] = ["상품", "캐릭터", "스냅", "커뮤니티"];
const postTopics: readonly PostTopic[] = ["정보", "질문", "애니 이야기"];

const CAPSULE_LAYOUT = [
  { left: "5%", top: "54%", mixX: "48px", mixY: "-34px", rotate: "215deg", tone: "ivory" },
  { left: "25%", top: "63%", mixX: "-17px", mixY: "-51px", rotate: "-188deg", tone: "olive" },
  { left: "47%", top: "57%", mixX: "-42px", mixY: "-24px", rotate: "164deg", tone: "ivory" },
  { left: "69%", top: "64%", mixX: "-49px", mixY: "-42px", rotate: "-240deg", tone: "olive" },
  { left: "15%", top: "35%", mixX: "39px", mixY: "26px", rotate: "-172deg", tone: "olive" },
  { left: "40%", top: "30%", mixX: "37px", mixY: "34px", rotate: "198deg", tone: "ivory" },
  { left: "65%", top: "38%", mixX: "-43px", mixY: "20px", rotate: "228deg", tone: "olive" },
] as const;

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatPoints(value: number) {
  return `${value.toLocaleString("ko-KR")}P`;
}

function communityCommentCount(post: CommunityPost, comments: readonly CommunityComment[]) {
  const seededVisibleCount = DEFAULT_COMMUNITY_COMMENTS[post.id]?.length ?? 0;
  return post.comments + Math.max(0, comments.length - seededVisibleCount);
}

function useScreenEntryFocus() {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 80);
    return () => window.clearTimeout(timer);
  }, []);

  return ref;
}

function handleRadioArrow<T>(
  event: KeyboardEvent<HTMLButtonElement>,
  options: readonly T[],
  index: number,
  select: (value: T) => void,
) {
  if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
  event.preventDefault();
  const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
  const nextIndex = (index + delta + options.length) % options.length;
  const group = event.currentTarget.parentElement;
  select(options[nextIndex]);
  window.requestAnimationFrame(() => {
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[nextIndex]?.focus();
  });
}

function rollPrizeGrade(): PrizeGrade {
  const roll = Math.random() * 100;
  if (roll < 2) return "S";
  if (roll < 20) return "A";
  return "B";
}

function rewardForGrade(product: Product, grade: PrizeGrade) {
  const [secret, special] = prizeGuideFor(product.categoryId);
  if (grade === "S") return `${product.line} ${secret}`;
  if (grade === "A") return `${product.line} ${special}`;
  return product.reward;
}

const prizeGuides: Record<ProductCategoryId, readonly [string, string, string]> = {
  gacha: ["시크릿 컬러", "레어 디자인", "기본 디자인"],
  figure: ["시크릿 컬러", "스페셜 파츠", "기본 에디션"],
  kuji: ["라스트원상", "상위상", "굿즈상"],
  tcg: ["시크릿 레어", "홀로 레어", "커먼·언커먼"],
};

function prizeGuideFor(categoryId: ProductCategoryId) {
  return prizeGuides[categoryId];
}

function commerceCopyFor(product: Product) {
  if (product.categoryId === "gacha") {
    return { action: "가챠 뽑기", quantityTitle: "뽑기 횟수", quantityDescription: "진행할 횟수를 선택해 주세요.", unit: "회" } as const;
  }
  if (product.categoryId === "kuji") {
    return { action: "쿠지 참여하기", quantityTitle: "쿠지 수량", quantityDescription: "구매할 쿠지 장 수를 선택해 주세요.", unit: "장" } as const;
  }
  if (product.categoryId === "tcg") {
    return { action: "구매하기", quantityTitle: "팩 수량", quantityDescription: "구매할 카드 팩 수를 선택해 주세요.", unit: "팩" } as const;
  }
  return { action: "구매하기", quantityTitle: "구매 수량", quantityDescription: "구매할 상품 수량을 선택해 주세요.", unit: "개" } as const;
}

function commerceUnit(product: Product) {
  return commerceCopyFor(product).unit;
}

function purchaseGuideFor(product: Product) {
  if (product.categoryId === "figure") {
    return [
      ["판매 방식", "일반 상품 구매"],
      ["상품 구성", "피규어 본품 1개"],
      ["배송", "결제 후 배송 준비"],
    ] as const;
  }

  return [
    ["판매 방식", "미개봉 카드팩 구매"],
    ["상품 구성", "카드 팩 1팩"],
    ["배송", "결제 후 배송 준비"],
  ] as const;
}

function returnToCatalog(flow: FlowControls) {
  const steps = Math.max(0, flow.stack.length - 1);
  for (let step = 0; step < steps; step += 1) flow.pop();

  const focusCurrentMain = () => {
    const activeScreens = document.querySelectorAll<HTMLElement>('.flow-screen[data-flow-current="true"]');
    activeScreens[activeScreens.length - 1]?.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  };

  // Radix restores focus after its sheet exit. Re-assert focus once the route
  // transition and the dialog exit have both settled.
  [180, 480, 820].forEach((delay) => window.setTimeout(focusCurrentMain, delay));
}

type DabbobaContextValue = {
  activeRootTab: RootTabId;
  setActiveRootTab: Dispatch<SetStateAction<RootTabId>>;
  profile: UserProfile;
  setProfile: Dispatch<SetStateAction<UserProfile>>;
  profileSaveNotice: string;
  setProfileSaveNotice: Dispatch<SetStateAction<string>>;
  communityPosts: CommunityPost[];
  addCommunityPost: (post: { title: string; body: string; topic: PostTopic }) => void;
  communityComments: Record<string, CommunityComment[]>;
  addCommunityComment: (postId: string, body: string) => void;
  likedCommunityPostIds: Set<string>;
  toggleCommunityPostLike: (postId: string) => void;
  pointBalance: number;
  setPointBalance: Dispatch<SetStateAction<number>>;
  couponDiscount: number;
  setCouponDiscount: Dispatch<SetStateAction<number>>;
  points: number;
  setPoints: Dispatch<SetStateAction<number>>;
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
  paying: boolean;
  setPaying: Dispatch<SetStateAction<boolean>>;
  drawState: DrawState;
  setDrawState: Dispatch<SetStateAction<DrawState>>;
  drawRemaining: number;
  setDrawRemaining: Dispatch<SetStateAction<number>>;
  resultOpen: boolean;
  setResultOpen: Dispatch<SetStateAction<boolean>>;
  resultGrade: PrizeGrade;
  setResultGrade: Dispatch<SetStateAction<PrizeGrade>>;
  prepareCheckout: () => void;
  prepareDraw: (count: number) => void;
};

const DabbobaContext = createContext<DabbobaContextValue | null>(null);

function useDabboba() {
  const context = useContext(DabbobaContext);
  if (!context) throw new Error("useDabboba must be used inside DabbobaContext");
  return context;
}

export default function Prototype() {
  const [activeRootTab, setActiveRootTab] = useState<RootTabId>("home");
  const [profile, setProfile] = useState<UserProfile>({
    nickname: "다뽑러 01",
    bio: "좋아하는 작품과 굿즈를 천천히 모으고 있어요.",
    favoriteIpId: "one-piece",
  });
  const [profileSaveNotice, setProfileSaveNotice] = useState("");
  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>(DEFAULT_COMMUNITY_POSTS);
  const [communityComments, setCommunityComments] = useState<Record<string, CommunityComment[]>>(() => (
    Object.fromEntries(
      Object.entries(DEFAULT_COMMUNITY_COMMENTS).map(([postId, comments]) => [postId, [...comments]]),
    )
  ));
  const [likedCommunityPostIds, setLikedCommunityPostIds] = useState<Set<string>>(() => new Set());
  const [pointBalance, setPointBalance] = useState(12_500);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [points, setPoints] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("간편카드");
  const [paying, setPaying] = useState(false);
  const [drawState, setDrawState] = useState<DrawState>("ready");
  const [drawRemaining, setDrawRemaining] = useState(1);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultGrade, setResultGrade] = useState<PrizeGrade>("B");
  const initialScreen = useMemo(() => createCatalogScreen(), []);

  useEffect(() => {
    document.title = "DABBOBA — 원하는 거 다 뽑아";
  }, []);

  const prepareCheckout = useCallback(() => {
    setCouponDiscount(0);
    setPoints(0);
    setPaymentMethod("간편카드");
    setPaying(false);
  }, []);

  const prepareDraw = useCallback((count: number) => {
    setDrawRemaining(count);
    setDrawState("ready");
    setResultOpen(false);
    setResultGrade("B");
  }, []);

  const addCommunityPost = useCallback((post: { title: string; body: string; topic: PostTopic }) => {
    setCommunityPosts((current) => [
      {
        id: `community-${Date.now()}`,
        author: profile.nickname,
        time: "방금 전",
        likes: 0,
        comments: 0,
        ...post,
      },
      ...current,
    ]);
  }, [profile.nickname]);

  const addCommunityComment = useCallback((postId: string, body: string) => {
    const nextComment: CommunityComment = {
      id: `community-comment-${Date.now()}`,
      author: profile.nickname,
      body,
      time: "방금 전",
      likes: 0,
    };
    setCommunityComments((current) => ({
      ...current,
      [postId]: [...(current[postId] ?? []), nextComment],
    }));
  }, [profile.nickname]);

  const toggleCommunityPostLike = useCallback((postId: string) => {
    setLikedCommunityPostIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const contextValue: DabbobaContextValue = {
    activeRootTab,
    setActiveRootTab,
    profile,
    setProfile,
    profileSaveNotice,
    setProfileSaveNotice,
    communityPosts,
    addCommunityPost,
    communityComments,
    addCommunityComment,
    likedCommunityPostIds,
    toggleCommunityPostLike,
    pointBalance,
    setPointBalance,
    couponDiscount,
    setCouponDiscount,
    points,
    setPoints,
    paymentMethod,
    setPaymentMethod,
    paying,
    setPaying,
    drawState,
    setDrawState,
    drawRemaining,
    setDrawRemaining,
    resultOpen,
    setResultOpen,
    resultGrade,
    setResultGrade,
    prepareCheckout,
    prepareDraw,
  };

  return (
    <DabbobaContext.Provider value={contextValue}>
      <div className="dabboba-root">
        <FlowStack initial={initialScreen} />
      </div>
    </DabbobaContext.Provider>
  );
}

function createCatalogScreen(): FlowScreen {
  return {
    id: "root-home",
    header: (flow) => <CatalogHeader flow={flow} />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <CatalogPage flow={flow} />,
  };
}

function createCommunityScreen(): FlowScreen {
  return {
    id: "root-community",
    header: () => <RootTabHeader title="커뮤니티" subtitle="정보와 애니 이야기를 나누는 곳" />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <CommunityPage flow={flow} />,
  };
}

function createCommunityPostScreen(postId: string): FlowScreen {
  return {
    id: `community-post-${postId}`,
    header: (flow) => <BackHeader title="게시글" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <CommunityPostDetailPage postId={postId} />,
  };
}

function createShopScreen(): FlowScreen {
  return {
    id: "root-shop",
    header: () => <RootTabHeader title="샵" subtitle="가챠 · 피규어 · 쿠지 · 카드" showPoints />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <ShopPage flow={flow} />,
  };
}

function createDuckroomScreen(): FlowScreen {
  return {
    id: "root-duckroom",
    header: () => <RootTabHeader title="덕룸" subtitle="모은 굿즈를 꺼내 보여주는 곳" />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: () => <DuckroomPage />,
  };
}

function createProfileScreen(): FlowScreen {
  return {
    id: "root-profile",
    header: () => <RootTabHeader title="프로필" subtitle="나의 DABBOBA" />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <ProfilePage flow={flow} />,
  };
}

function createProfileDetailScreen(): FlowScreen {
  return {
    id: "profile-detail",
    header: (flow) => <BackHeader title="프로필 관리" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <ProfileDetailPage flow={flow} />,
  };
}

function createRootScreen(tab: RootTabId) {
  if (tab === "community") return createCommunityScreen();
  if (tab === "shop") return createShopScreen();
  if (tab === "duckroom") return createDuckroomScreen();
  if (tab === "profile") return createProfileScreen();
  return createCatalogScreen();
}

function createIpCatalogScreen(): FlowScreen {
  return {
    id: "ip-catalog",
    header: (flow) => <BackHeader title="전체 작품" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <IpCatalogPage flow={flow} />,
  };
}

function createIpDetailScreen(ip: IpRecord): FlowScreen {
  return {
    id: `ip-${ip.slug}`,
    header: (flow) => <BackHeader title="작품" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <IpDetailPage flow={flow} ip={ip} />,
  };
}

function createDetailScreen(product: Product): FlowScreen {
  return {
    id: `detail-${product.id}`,
    header: (flow) => <BackHeader title="상품 상세" onBack={flow.pop} />,
    headerHeight: 56,
    footer: (flow) => <DetailFooter flow={flow} product={product} />,
    footerHeight: 82,
    render: () => <ProductDetail product={product} />,
  };
}

function createCheckoutScreen(product: Product, quantity: number): FlowScreen {
  return {
    id: `checkout-${product.id}`,
    header: (flow) => <BackHeader title="결제" onBack={flow.pop} />,
    headerHeight: 56,
    footer: (flow) => <CheckoutFooter flow={flow} product={product} quantity={quantity} />,
    footerHeight: 104,
    render: () => <CheckoutPage product={product} quantity={quantity} />,
  };
}

function createDrawScreen(product: Product, quantity: number): FlowScreen {
  return {
    id: `draw-${product.id}`,
    header: () => <StaticHeader title="DABBOBA ARCADE" pixel />,
    headerHeight: 56,
    footer: (flow) => <DrawFooter flow={flow} product={product} />,
    footerHeight: 94,
    render: () => <DrawPage product={product} quantity={quantity} />,
  };
}

function createPurchaseCompleteScreen(product: Product, quantity: number, paidTotal: number): FlowScreen {
  return {
    id: `purchase-complete-${product.id}`,
    header: () => <StaticHeader title="주문 완료" />,
    headerHeight: 56,
    footer: (flow) => <PurchaseCompleteFooter flow={flow} />,
    footerHeight: 82,
    render: () => <PurchaseCompletePage product={product} quantity={quantity} paidTotal={paidTotal} />,
  };
}

function CatalogHeader({ flow }: { flow: FlowControls }) {
  const { pointBalance } = useDabboba();

  return (
    <div className="app-toolbar catalog-toolbar">
      <div className="brand-lockup">
        <strong>DABBOBA</strong>
        <span>원하는 거 다 뽑아</span>
      </div>
      <div className="catalog-toolbar-actions">
        <button
          type="button"
          className="catalog-search-button"
          onClick={() => flow.push(createIpCatalogScreen())}
          aria-label="전체 작품 검색"
        >
          <IconMagnifyingglassLine size={23} aria-hidden="true" />
        </button>
        <span className="header-points" aria-label={`보유 포인트 ${formatPoints(pointBalance)}`}>
          {formatPoints(pointBalance)}
        </span>
      </div>
    </div>
  );
}

function BackHeader({ title, onBack, pixel = false }: { title: string; onBack: () => void; pixel?: boolean }) {
  return (
    <div className="app-toolbar back-toolbar">
      <button type="button" className="icon-button" onClick={onBack} aria-label="뒤로 가기">
        <IconArrowLeftLine size={26} aria-hidden="true" />
      </button>
      <strong className={pixel ? "toolbar-title pixel-title" : "toolbar-title"}>{title}</strong>
      <span className="toolbar-spacer" aria-hidden="true" />
    </div>
  );
}

function StaticHeader({ title, pixel = false }: { title: string; pixel?: boolean }) {
  return (
    <div className="app-toolbar back-toolbar">
      <span className="toolbar-spacer" aria-hidden="true" />
      <strong className={pixel ? "toolbar-title pixel-title" : "toolbar-title"}>{title}</strong>
      <span className="toolbar-spacer" aria-hidden="true" />
    </div>
  );
}

function RootTabHeader({
  title,
  subtitle,
  showPoints = false,
}: {
  title: string;
  subtitle: string;
  showPoints?: boolean;
}) {
  const { pointBalance } = useDabboba();

  return (
    <div className="app-toolbar root-tab-toolbar">
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {showPoints ? (
        <span className="header-points" aria-label={`보유 포인트 ${formatPoints(pointBalance)}`}>
          {formatPoints(pointBalance)}
        </span>
      ) : null}
    </div>
  );
}

function RootTabFooter({ flow }: { flow: FlowControls }) {
  const { activeRootTab, setActiveRootTab } = useDabboba();

  const selectTab = (tab: RootTabId) => {
    if (tab === activeRootTab) return;
    setActiveRootTab(tab);
    flow.replace(createRootScreen(tab));
  };

  return <AppBottomNavigation activeTab={activeRootTab} onSelect={selectTab} />;
}

function CommunityPage({ flow }: { flow: FlowControls }) {
  const {
    communityPosts,
    addCommunityPost,
    communityComments,
    likedCommunityPostIds,
    toggleCommunityPostLike,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [filter, setFilter] = useState<CommunityTopic>("전체");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftTopic, setDraftTopic] = useState<PostTopic>("정보");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const visiblePosts = filter === "전체"
    ? communityPosts
    : communityPosts.filter((post) => post.topic === filter);

  const submitPost = () => {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body) return;
    addCommunityPost({ title, body, topic: draftTopic });
    keyboard.hide();
    setDraftTitle("");
    setDraftBody("");
    setFilter("전체");
    setComposerOpen(false);
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page community-page" aria-label="커뮤니티 피드">
          <button type="button" className="community-composer-callout" onClick={() => setComposerOpen(true)}>
            <span className="community-composer-icon"><IconPencilLine size={21} aria-hidden="true" /></span>
            <span><strong>새 글 쓰기</strong><small>정보, 질문, 애니 이야기를 자유롭게 남겨보세요.</small></span>
            <IconChevronRightLine size={21} aria-hidden="true" />
          </button>

          <Carousel className="community-topic-carousel" contentClassName="community-topic-rail" ariaLabel="커뮤니티 주제">
            {COMMUNITY_TOPICS.map((topic) => (
              <button
                key={topic}
                type="button"
                className="filter-chip"
                data-selected={filter === topic ? "true" : "false"}
                aria-pressed={filter === topic}
                onClick={() => setFilter(topic)}
              >
                {topic}
              </button>
            ))}
          </Carousel>

          <section className="community-feed" aria-labelledby="community-feed-title">
            <div className="section-heading">
              <h1 id="community-feed-title">지금 나누는 이야기</h1>
              <span>{visiblePosts.length}개</span>
            </div>
            {visiblePosts.map((post) => {
              const liked = likedCommunityPostIds.has(post.id);
              const commentCount = communityCommentCount(post, communityComments[post.id] ?? []);
              return (
                <article key={post.id} className="community-post">
                  <div className="community-post-summary">
                    <div className="community-post-meta">
                      <span>{post.topic}</span>
                      <small>{post.author} · {post.time}</small>
                    </div>
                    <h2>{post.title}</h2>
                    <p>{post.body}</p>
                    <button
                      type="button"
                      className="community-post-open"
                      aria-label={`${post.title} 상세 보기`}
                      onClick={() => flow.push(createCommunityPostScreen(post.id))}
                    />
                  </div>
                  <div className="community-post-actions">
                    <button
                      type="button"
                      aria-label={liked ? `${post.title} 좋아요 취소` : `${post.title} 좋아요`}
                      aria-pressed={liked}
                      onClick={() => toggleCommunityPostLike(post.id)}
                    >
                      {liked ? <IconHeartFill size={18} aria-hidden="true" /> : <IconHeartLine size={18} aria-hidden="true" />}
                      <span>{post.likes + (liked ? 1 : 0)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`${post.title} 댓글 ${commentCount}개 보기`}
                      onClick={() => flow.push(createCommunityPostScreen(post.id))}
                    >
                      <IconDot3HorizontalChatbubbleLeftLine size={18} aria-hidden="true" />
                      <span>{commentCount}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        </main>
      </MobileScroll>

      <BottomSheet
        open={composerOpen}
        onOpenChange={setComposerOpen}
        title="새 글 쓰기"
        description="DABBOBA 커뮤니티에 이야기를 남겨보세요."
        snap={0.76}
      >
        <div className="community-compose-form">
          <div className="compose-topic-list" role="radiogroup" aria-label="글 주제">
            {postTopics.map((topic) => (
              <button
                key={topic}
                type="button"
                role="radio"
                aria-checked={draftTopic === topic}
                data-selected={draftTopic === topic ? "true" : "false"}
                onClick={() => setDraftTopic(topic)}
              >
                {topic}
              </button>
            ))}
          </div>
          <label>
            <span>제목</span>
            <KeyboardInput
              value={draftTitle}
              maxLength={48}
              placeholder="제목을 입력해 주세요"
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <label>
            <span>내용</span>
            <KeyboardTextarea
              value={draftBody}
              maxLength={500}
              placeholder="정보를 공유하거나 좋아하는 작품 이야기를 남겨보세요."
              onChange={(event) => setDraftBody(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            disabled={!draftTitle.trim() || !draftBody.trim()}
            onClick={submitPost}
          >
            등록하기
          </ActionButton>
        </div>
      </BottomSheet>
    </>
  );
}

function CommunityPostDetailPage({ postId }: { postId: string }) {
  const {
    communityPosts,
    communityComments,
    addCommunityComment,
    likedCommunityPostIds,
    toggleCommunityPostLike,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [draftComment, setDraftComment] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const post = communityPosts.find((item) => item.id === postId);

  if (!post) {
    return (
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="community-detail-page community-detail-missing" aria-label="게시글을 찾을 수 없음">
          <IconDot3HorizontalChatbubbleLeftLine size={32} aria-hidden="true" />
          <h1>게시글을 찾을 수 없어요.</h1>
          <p>새로고침으로 임시 게시글이 초기화됐을 수 있습니다.</p>
        </main>
      </MobileScroll>
    );
  }

  const comments = communityComments[post.id] ?? [];
  const commentCount = communityCommentCount(post, comments);
  const liked = likedCommunityPostIds.has(post.id);

  const submitComment = () => {
    const body = draftComment.trim();
    if (!body) return;
    addCommunityComment(post.id, body);
    keyboard.hide();
    setDraftComment("");
    setSubmitMessage("댓글을 등록했어요.");
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="community-detail-page" aria-label={`${post.title} 게시글 상세`}>
        <article className="community-detail-article">
          <div className="community-detail-meta">
            <span>{post.topic}</span>
            <small>{post.time}</small>
          </div>

          <div className="community-detail-author">
            <span aria-hidden="true"><IconPerson2Line size={20} /></span>
            <div><strong>{post.author}</strong><small>DABBOBA 커뮤니티</small></div>
          </div>

          <h1>{post.title}</h1>
          <p>{post.body}</p>

          <div className="community-detail-actions" aria-label="게시글 반응">
            <button
              type="button"
              aria-label={liked ? "좋아요 취소" : "좋아요"}
              aria-pressed={liked}
              onClick={() => toggleCommunityPostLike(post.id)}
            >
              {liked ? <IconHeartFill size={19} aria-hidden="true" /> : <IconHeartLine size={19} aria-hidden="true" />}
              <span>좋아요 {post.likes + (liked ? 1 : 0)}</span>
            </button>
            <span><IconDot3HorizontalChatbubbleLeftLine size={19} aria-hidden="true" /> 댓글 {commentCount}</span>
          </div>
        </article>

        <section className="community-comment-section" aria-labelledby="community-comment-title">
          <div className="community-comment-heading">
            <h2 id="community-comment-title">댓글 {commentCount}</h2>
            <span>함께 이야기해요</span>
          </div>

          <div className="community-comment-list">
            {comments.length > 0 ? comments.map((comment) => (
              <article key={comment.id} className="community-comment">
                <div className="community-comment-avatar" aria-hidden="true">{comment.author.slice(0, 1)}</div>
                <div>
                  <header><strong>{comment.author}</strong><small>{comment.time}</small></header>
                  <p>{comment.body}</p>
                  <span><IconHeartLine size={14} aria-hidden="true" /> {comment.likes}</span>
                </div>
              </article>
            )) : (
              <div className="community-comment-empty">
                <IconDot3HorizontalChatbubbleLeftLine size={28} aria-hidden="true" />
                <strong>아직 댓글이 없어요.</strong>
                <span>첫 댓글을 남겨보세요.</span>
              </div>
            )}
          </div>

          {commentCount > comments.length ? (
            <p className="community-comment-disclosure">현재 화면에는 확인용 예시 댓글 일부만 표시됩니다.</p>
          ) : null}

          <form className="community-comment-form" onSubmit={(event) => { event.preventDefault(); submitComment(); }}>
            <label htmlFor="community-comment-input">댓글 작성</label>
            <KeyboardTextarea
              id="community-comment-input"
              value={draftComment}
              maxLength={300}
              placeholder="이 글에 대한 이야기를 남겨보세요."
              onChange={(event) => {
                setDraftComment(event.currentTarget.value);
                setSubmitMessage("");
              }}
              onBlur={() => keyboard.hide()}
            />
            <div>
              <small>{draftComment.length}/300</small>
              <ActionButton
                type="submit"
                variant="brandSolid"
                size="medium"
                disabled={!draftComment.trim()}
              >
                댓글 등록
              </ActionButton>
            </div>
          </form>
          {submitMessage ? <p className="community-comment-status" role="status">{submitMessage}</p> : null}
        </section>

        <p className="prototype-disclosure community-detail-disclosure">
          게시글과 댓글은 화면 확인용 테스트 데이터이며 새로고침하면 작성 내용이 초기화됩니다.
        </p>
      </main>
    </MobileScroll>
  );
}

function ShopPage({ flow }: { flow: FlowControls }) {
  const [filter, setFilter] = useState<CategoryFilter>("전체");
  const screenFocusRef = useScreenEntryFocus();
  const visibleProducts = filter === "전체" ? products : products.filter((product) => product.category === filter);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page shop-page" aria-label="DABBOBA 샵">
        <section className="shop-lead" aria-labelledby="shop-lead-title">
          <h1 id="shop-lead-title">원하는 방식으로 골라보세요.</h1>
          <p>가챠, 피규어, 쿠지, 카드를 한곳에서 확인할 수 있어요.</p>
        </section>
        <Carousel className="category-carousel shop-category-carousel" contentClassName="category-rail" ariaLabel="샵 카테고리">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              className="filter-chip"
              data-selected={item === filter ? "true" : "false"}
              aria-pressed={item === filter}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </Carousel>
        <section className="shop-products" aria-labelledby="shop-products-title">
          <div className="section-heading">
            <h2 id="shop-products-title">상품</h2>
            <span>{visibleProducts.length}개</span>
          </div>
          <ProductGrid flow={flow} items={visibleProducts} />
        </section>
      </main>
    </MobileScroll>
  );
}

function DuckroomPage() {
  const screenFocusRef = useScreenEntryFocus();
  const [filter, setFilter] = useState<DuckroomFilter>("전체");
  const [likedRooms, setLikedRooms] = useState<Set<string>>(() => new Set());
  const visibleShowcases = DUCKROOM_SHOWCASES.filter((showcase) => (
    filter === "전체" || categoryLabel(showcase.categoryId) === filter
  ));

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page duckroom-page" aria-label="덕룸 수집장">
        <section className="duckroom-lead" aria-labelledby="duckroom-title">
          <h1 id="duckroom-title">모은 걸 꺼내 자랑해요.</h1>
          <p>가챠 한 알부터 완성한 진열장까지, 서로의 수집 기록을 구경해 보세요.</p>
        </section>
        <Carousel className="duckroom-filter-carousel" contentClassName="duckroom-filter-rail" ariaLabel="덕룸 카테고리">
          {DUCKROOM_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              className="filter-chip"
              data-selected={filter === item ? "true" : "false"}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </Carousel>
        <section className="duckroom-grid" aria-label="수집 자랑 게시물">
          {visibleShowcases.map((showcase) => {
            const product = products.find((item) => item.id === showcase.productId);
            if (!product) return null;
            const liked = likedRooms.has(showcase.id);
            return (
              <article key={showcase.id} className="duckroom-card">
                <div className="duckroom-media">
                  <img src={product.asset} alt={`${showcase.caption} 수집 사진`} loading="lazy" decoding="async" draggable={false} />
                  <span>{categoryLabel(showcase.categoryId)}</span>
                </div>
                <div className="duckroom-copy">
                  <small>{showcase.author}</small>
                  <h2>{showcase.caption}</h2>
                  <div>
                    <span>{showcase.collectedCount}개 수집</span>
                    <button
                      type="button"
                      aria-label={liked ? `${showcase.caption} 좋아요 취소` : `${showcase.caption} 좋아요`}
                      aria-pressed={liked}
                      onClick={() => setLikedRooms((current) => {
                        const next = new Set(current);
                        if (next.has(showcase.id)) next.delete(showcase.id);
                        else next.add(showcase.id);
                        return next;
                      })}
                    >
                      {liked ? <IconHeartFill size={17} aria-hidden="true" /> : <IconHeartLine size={17} aria-hidden="true" />}
                      {showcase.likes + (liked ? 1 : 0)}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </MobileScroll>
  );
}

function ProfilePage({ flow }: { flow: FlowControls }) {
  const { pointBalance, communityPosts, profile, profileSaveNotice, setProfileSaveNotice } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const [profileMessage, setProfileMessage] = useState("");
  const myPostCount = communityPosts.filter((post) => post.id.startsWith("community-")).length;
  const menus = ["내 찜 목록", "보관함", "배송 신청", "구매 내역", "포인트 내역", "고객센터"];

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page profile-page" aria-label="내 프로필">
        <button
          type="button"
          className="profile-identity"
          aria-label="프로필 상세 보기"
          onClick={() => {
            setProfileSaveNotice("");
            flow.push(createProfileDetailScreen());
          }}
        >
          <span className="profile-avatar"><IconPerson2Line size={30} aria-hidden="true" /></span>
          <div><strong>{profile.nickname}</strong><span>{profile.bio}</span></div>
          <IconChevronRightLine size={22} aria-hidden="true" />
        </button>

        <section className="profile-wallet" aria-label="포인트와 쿠폰">
          <div><span>내 포인트</span><strong>{formatPoints(pointBalance)}</strong></div>
          <div><span>내 쿠폰</span><strong>1장</strong></div>
        </section>

        <section className="profile-activity" aria-label="나의 활동">
          <div><strong>6</strong><span>찜</span></div>
          <div><strong>3</strong><span>보관함</span></div>
          <div><strong>{myPostCount}</strong><span>작성글</span></div>
        </section>

        <section className="profile-menu" aria-label="프로필 메뉴">
          {menus.map((menu) => (
            <button
              key={menu}
              type="button"
              onClick={() => {
                setProfileSaveNotice("");
                setProfileMessage(`${menu} 기능은 다음 단계에서 연결됩니다.`);
              }}
            >
              <span>{menu}</span>
              <IconChevronRightLine size={21} aria-hidden="true" />
            </button>
          ))}
        </section>
        {profileSaveNotice || profileMessage ? (
          <p className="profile-message" role="status">{profileSaveNotice || profileMessage}</p>
        ) : null}
        <p className="prototype-disclosure profile-disclosure">현재 프로필과 활동 수치는 화면 확인용 테스트 데이터입니다.</p>
      </main>
    </MobileScroll>
  );
}

function ProfileDetailPage({ flow }: { flow: FlowControls }) {
  const { profile, setProfile, setProfileSaveNotice } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [nickname, setNickname] = useState(profile.nickname);
  const [bio, setBio] = useState(profile.bio);
  const [favoriteIpId, setFavoriteIpId] = useState(profile.favoriteIpId);
  const [favoriteOpen, setFavoriteOpen] = useState(false);
  const favoriteIp = IP_CATALOG.find((ip) => ip.id === favoriteIpId) ?? IP_CATALOG[0];
  const trimmedNickname = nickname.trim();
  const nicknameIsValid = trimmedNickname.length >= 2;
  const nicknameError = nicknameIsValid ? "" : "닉네임은 2~12자로 입력해 주세요.";

  const saveProfile = () => {
    const nextNickname = trimmedNickname;
    if (!nicknameIsValid) return;
    keyboard.hide();
    setProfile({
      nickname: nextNickname,
      bio: bio.trim() || "좋아하는 굿즈를 모으고 있어요.",
      favoriteIpId,
    });
    setProfileSaveNotice("프로필을 저장했어요.");
    flow.pop();
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="profile-detail-page" aria-label="프로필 상세 및 수정">
          <section className="profile-detail-summary" aria-label="현재 프로필 미리보기">
            <span className="profile-detail-avatar"><IconPerson2Line size={34} aria-hidden="true" /></span>
            <div>
              <strong>{nickname.trim() || "닉네임을 입력해 주세요"}</strong>
              <span>{favoriteIp?.nameKo ?? "좋아하는 작품 선택"}</span>
            </div>
          </section>

          <form className="profile-edit-form" onSubmit={(event) => { event.preventDefault(); saveProfile(); }} noValidate>
            <div className="profile-edit-field">
              <div className="profile-field-heading">
                <label htmlFor="profile-nickname">닉네임</label>
                <small id="profile-nickname-count">{nickname.length}/12</small>
              </div>
              <KeyboardInput
                id="profile-nickname"
                value={nickname}
                required
                minLength={2}
                maxLength={12}
                placeholder="닉네임을 입력해 주세요"
                aria-invalid={!nicknameIsValid}
                aria-describedby={`profile-nickname-count${nicknameError ? " profile-nickname-error" : ""}`}
                onChange={(event) => setNickname(event.currentTarget.value)}
                onBlur={() => keyboard.hide()}
              />
              {nicknameError ? <span id="profile-nickname-error" className="profile-field-error">{nicknameError}</span> : null}
            </div>

            <div className="profile-edit-field">
              <div className="profile-field-heading">
                <label htmlFor="profile-bio">한 줄 소개</label>
                <small id="profile-bio-count">{bio.length}/60</small>
              </div>
              <KeyboardTextarea
                id="profile-bio"
                value={bio}
                maxLength={60}
                placeholder="수집 취향을 간단히 소개해 보세요"
                aria-describedby="profile-bio-count"
                onChange={(event) => setBio(event.currentTarget.value)}
                onBlur={() => keyboard.hide()}
              />
            </div>

            <div className="profile-favorite-field">
              <span>좋아하는 작품</span>
              <button
                type="button"
                aria-label={`좋아하는 작품, 현재 ${favoriteIp?.nameKo ?? "선택 안 됨"}, 변경`}
                onClick={() => setFavoriteOpen(true)}
              >
                {favoriteIp ? <img src={favoriteIp.image} alt="" decoding="async" draggable={false} /> : null}
                <span><strong>{favoriteIp?.nameKo ?? "작품 선택"}</strong><small>대표 작품으로 표시됩니다.</small></span>
                <IconChevronRightLine size={21} aria-hidden="true" />
              </button>
            </div>

            <ActionButton
              type="submit"
              variant="brandSolid"
              size="large"
              className="sheet-primary-button profile-save-button"
              disabled={!nicknameIsValid}
            >
              저장하기
            </ActionButton>
          </form>

          <p className="prototype-disclosure profile-detail-disclosure">
            현재 변경 내용은 이 브라우저에만 임시로 반영되며 실제 계정에는 저장되지 않습니다.
          </p>
        </main>
      </MobileScroll>

      <BottomSheet
        open={favoriteOpen}
        onOpenChange={setFavoriteOpen}
        title="좋아하는 작품"
        description="프로필에 표시할 대표 작품을 골라주세요."
        snap={0.76}
      >
        <div className="profile-ip-options" role="radiogroup" aria-label="좋아하는 작품">
          {IP_CATALOG.map((ip, index) => {
            const selected = ip.id === favoriteIpId;
            return (
              <button
                key={ip.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-selected={selected ? "true" : "false"}
                onKeyDown={(event) => handleRadioArrow(event, IP_CATALOG, index, (nextIp) => setFavoriteIpId(nextIp.id))}
                onClick={() => { setFavoriteIpId(ip.id); setFavoriteOpen(false); }}
              >
                <img src={ip.image} alt="" loading="lazy" decoding="async" draggable={false} />
                <span>{ip.nameKo}</span>
                {selected ? <IconCheckmarkCircleFill size={20} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}

function CatalogPage({ flow }: { flow: FlowControls }) {
  const [filter, setFilter] = useState<CategoryFilter>("전체");
  const screenFocusRef = useScreenEntryFocus();
  const visibleProducts = filter === "전체" ? products : products.filter((product) => product.category === filter);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="catalog-page" aria-label="DABBOBA 상품 목록">
        <section className="texture-banner" aria-labelledby="catalog-title">
          <img
            src="/assets/dabboba/retro-arcade-texture.png"
            alt=""
            className="retro-texture"
            draggable={false}
            aria-hidden="true"
          />
          <div className="banner-copy">
            <span>8BIT SELECT</span>
            <h1 id="catalog-title">취향을 고르고<br />오늘 가볍게 골라봐.</h1>
            <p>가챠부터 카드까지, 한곳에서 가볍게.</p>
          </div>
        </section>

        <PopularIpSection flow={flow} />

        <Carousel
          className="category-carousel"
          contentClassName="category-rail"
          ariaLabel="상품 카테고리"
        >
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              className="filter-chip"
              data-selected={item === filter ? "true" : "false"}
              aria-pressed={item === filter}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </Carousel>

        <section className="catalog-section" aria-labelledby="available-products">
          <div className="section-heading">
            <h2 id="available-products">지금 만날 수 있어요</h2>
            <span>{visibleProducts.length}개</span>
          </div>
          <ProductGrid flow={flow} items={visibleProducts} />
        </section>
      </main>
    </MobileScroll>
  );
}

function ProductGrid({ flow, items }: { flow: FlowControls; items: Product[] }) {
  return (
    <div className="product-grid">
      {items.map((product) => (
        <button
          key={product.id}
          type="button"
          className="product-card"
          onClick={() => flow.push(createDetailScreen(product))}
          aria-label={`${product.title}, ${formatWon(product.price)}, ${product.stock}${commerceUnit(product)} 남음`}
        >
          <span className="product-media">
            <img src={product.asset} alt="" loading="lazy" decoding="async" draggable={false} />
            <span className="product-category">{product.category}</span>
          </span>
          <span className="product-copy">
            <small>{product.line}</small>
            <strong>{product.title}</strong>
            <span className="product-price-row">
              <b>{formatWon(product.price)}</b>
              <em>{product.stock}{commerceUnit(product)} 남음</em>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function PopularIpSection({ flow }: { flow: FlowControls }) {
  return (
    <section className="popular-ip-section" aria-labelledby="popular-ip-title">
      <div className="section-heading popular-ip-heading">
        <div>
          <span className="section-eyebrow">IP SELECT</span>
          <h2 id="popular-ip-title">인기 작품</h2>
        </div>
        <button type="button" className="section-link" onClick={() => flow.push(createIpCatalogScreen())}>
          전체보기
          <IconChevronRightLine size={18} aria-hidden="true" />
        </button>
      </div>
      <Carousel className="popular-ip-carousel" contentClassName="popular-ip-rail" ariaLabel="인기 작품">
        {FEATURED_IPS.map((ip) => (
          <button
            key={ip.id}
            type="button"
            className="popular-ip-card"
            onClick={() => flow.push(createIpDetailScreen(ip))}
            aria-label={`${ip.nameKo} 작품 보기`}
          >
            <span className="popular-ip-media">
              <img src={ip.image} alt="" loading="lazy" decoding="async" draggable={false} />
              <span aria-hidden="true">{String(FEATURED_IPS.indexOf(ip) + 1).padStart(2, "0")}</span>
            </span>
            <strong>{ip.nameKo}</strong>
          </button>
        ))}
      </Carousel>
    </section>
  );
}

function IpCatalogPage({ flow }: { flow: FlowControls }) {
  const [query, setQuery] = useState("");
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const visibleIps = useMemo(() => IP_CATALOG.filter((ip) => matchesIpSearch(ip, query)), [query]);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="ip-catalog-page" aria-label="전체 작품 검색">
        <div className="ip-search-box">
          <IconMagnifyingglassLine size={21} aria-hidden="true" />
          <KeyboardInput
            type="search"
            value={query}
            placeholder="작품명·별칭 검색"
            aria-label="작품 검색"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                keyboard.hide();
              }
            }}
          />
          {query ? (
            <button type="button" className="ip-search-clear" onClick={() => setQuery("")} aria-label="검색어 지우기">
              <IconXmarkLine size={19} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="ip-directory-heading">
          <div>
            <span className="section-eyebrow">ALL IP</span>
            <h1>작품을 골라보세요</h1>
          </div>
          <span aria-live="polite">{visibleIps.length}개</span>
        </div>

        {visibleIps.length ? (
          <div className="ip-grid">
            {visibleIps.map((ip) => (
              <button
                key={ip.id}
                type="button"
                className="ip-grid-card"
                onClick={() => flow.push(createIpDetailScreen(ip))}
                aria-label={`${ip.nameKo}, ${ip.nameEn}`}
              >
                <span className="ip-grid-media">
                  <img src={ip.image} alt={`${ip.nameKo} 임시 포스터`} loading="lazy" decoding="async" draggable={false} />
                </span>
                <strong>{ip.nameKo}</strong>
                <small>{ip.nameEn}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="ip-empty-state" role="status">
            <IconMagnifyingglassLine size={30} aria-hidden="true" />
            <strong>검색 결과가 없어요</strong>
            <span>다른 이름이나 별칭으로 검색해 보세요.</span>
            <small>작품 추가 요청 기능은 준비 중입니다.</small>
          </div>
        )}
      </main>
    </MobileScroll>
  );
}

function IpDetailPage({ flow, ip }: { flow: FlowControls; ip: IpRecord }) {
  const [activeTab, setActiveTab] = useState<IpDetailTab>("상품");
  const screenFocusRef = useScreenEntryFocus();
  const activeTabIndex = ipDetailTabs.indexOf(activeTab);
  const panelId = `ip-panel-${ip.slug}`;

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ipDetailTabs.length - 1;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ipDetailTabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + ipDetailTabs.length) % ipDetailTabs.length;
    setActiveTab(ipDetailTabs[nextIndex]);
    const group = event.currentTarget.parentElement;
    window.requestAnimationFrame(() => group?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus());
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="ip-detail-page" aria-label={`${ip.nameKo} 작품 정보`}>
        <section className="ip-detail-hero">
          <img src={ip.image} alt={`${ip.nameKo} 임시 포스터`} decoding="async" draggable={false} />
          <div className="ip-detail-hero-copy">
            <span>IP FILE · {ip.sourceMediaId}</span>
            <h1>{ip.nameKo}</h1>
            <strong>{ip.nameEn}</strong>
          </div>
        </section>

        <section className="ip-detail-summary" aria-label="작품 소개">
          <p>{ip.description}</p>
          <div className="ip-category-list" aria-label="운영 카테고리">
            {ip.availableCategories.map((category) => (
              <span key={category}>{categoryLabel(category)}</span>
            ))}
          </div>
          <a href={ip.sourcePage} target="_blank" rel="noreferrer">임시 이미지 출처 · Kitsu</a>
        </section>

        <div className="ip-tab-list" role="tablist" aria-label={`${ip.nameKo} 콘텐츠`}>
          {ipDetailTabs.map((tab, index) => {
            const selected = activeTab === tab;
            return (
              <button
                key={tab}
                id={`ip-tab-${ip.slug}-${index}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                data-selected={selected ? "true" : "false"}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => moveTab(event, index)}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <section
          id={panelId}
          className="ip-tab-panel"
          role="tabpanel"
          aria-labelledby={`ip-tab-${ip.slug}-${activeTabIndex}`}
          tabIndex={0}
        >
          <IpTabContent flow={flow} ip={ip} tab={activeTab} />
        </section>
      </main>
    </MobileScroll>
  );
}

function IpTabContent({ flow, ip, tab }: { flow: FlowControls; ip: IpRecord; tab: IpDetailTab }) {
  if (tab === "상품") {
    const linkedProducts = productsForIp(ip.id);

    return (
      <>
        <div className="ip-panel-heading">
          <IconGridLine size={23} aria-hidden="true" />
          <div><strong>카테고리</strong><span>이 작품의 상품 구조를 먼저 확인해 보세요.</span></div>
        </div>
        <div className="ip-category-cards">
          {PRODUCT_CATEGORIES.map((category) => {
            const available = ip.availableCategories.includes(category.id);
            return (
              <div key={category.id} data-available={available ? "true" : "false"}>
                <span>{category.label}</span>
                <small>{available ? `${linkedProducts.filter((product) => product.categoryId === category.id).length}개 운영 중` : "입점 예정"}</small>
              </div>
            );
          })}
        </div>
        <div className="ip-linked-products" aria-label={`${ip.nameKo} 운영 상품`}>
          {linkedProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              className="ip-linked-product"
              onClick={() => flow.push(createDetailScreen(product))}
              aria-label={`${product.title} 상세 보기`}
            >
              <img src={product.asset} alt="" loading="lazy" decoding="async" draggable={false} />
              <span>
                <small>{product.category} · {formatWon(product.price)}</small>
                <strong>{product.title}</strong>
                <em>{product.stock}{commerceUnit(product)} 남음</em>
              </span>
              <IconChevronRightLine size={22} aria-hidden="true" />
            </button>
          ))}
        </div>
        <p className="prototype-disclosure">임시 테스트 상품과 재고이며 실제 운영 전 상품 계약·권리 확인이 필요합니다.</p>
      </>
    );
  }

  if (tab === "캐릭터") {
    return (
      <>
        <div className="ip-panel-heading">
          <IconPerson2Line size={23} aria-hidden="true" />
          <div><strong>대표 캐릭터</strong><span>상품 탐색에 사용할 기본 캐릭터 목록입니다.</span></div>
        </div>
        <div className="character-list">
          {ip.characters.map((character, index) => (
            <div key={character}><span>{String(index + 1).padStart(2, "0")}</span><strong>{character}</strong></div>
          ))}
        </div>
      </>
    );
  }

  const isSnap = tab === "스냅";
  return (
    <div className="ip-empty-state ip-tab-empty">
      {isSnap ? (
        <IconCameraLine size={32} aria-hidden="true" />
      ) : (
        <IconDot3HorizontalChatbubbleLeftLine size={32} aria-hidden="true" />
      )}
      <strong>{isSnap ? "아직 등록된 스냅이 없어요" : "첫 이야기를 준비하고 있어요"}</strong>
      <span>{isSnap ? "수집 사진과 후기 기능은 다음 단계에서 연결됩니다." : "작품별 게시판은 계정·게시글 API와 함께 열립니다."}</span>
    </div>
  );
}

function ProductDetail({ product }: { product: Product }) {
  const screenFocusRef = useScreenEntryFocus();
  const drawMode = isRandomDrawCategory(product.categoryId);
  const prizeGuide = prizeGuideFor(product.categoryId);
  const purchaseGuide = purchaseGuideFor(product);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="detail-page" aria-label={`${product.title} 상세 정보`}>
        <div className="detail-hero">
          <img src={product.asset} alt={`${product.title} 상품 이미지`} decoding="async" draggable={false} />
          <span>{product.edition}</span>
        </div>

        <div className="detail-content">
          <div className="detail-kicker">
            <span>{product.category}</span>
            <b>남은 수량 {product.stock}{commerceUnit(product)}</b>
          </div>
          <h1>{product.title}</h1>
          <p>{product.description}</p>
          <strong className="detail-price">{formatWon(product.price)}</strong>
          <a className="product-source-link" href={product.sourcePage} target="_blank" rel="noreferrer">
            임시 상품 이미지 출처
            <IconChevronRightLine size={17} aria-hidden="true" />
          </a>

          <div className="detail-facts" aria-label="상품 안내">
            <div>
              <IconReceiptLine size={22} aria-hidden="true" />
              <span>{drawMode ? "결제 후 오락실에서 즉시 추첨" : "표시된 상품을 그대로 구매"}</span>
            </div>
            <div>
              <IconBoxFlapLine size={22} aria-hidden="true" />
              <span>{drawMode ? "당첨 상품은 보관함에 저장" : "주문 완료 후 구매 내역에 저장"}</span>
            </div>
            <div>
              <IconTruckLine size={22} aria-hidden="true" />
              <span>{drawMode ? "보관함에서 합배송 신청 가능" : "배송 신청 단계에서 수령 정보 입력"}</span>
            </div>
          </div>

          {drawMode ? (
            <section className="detail-section" aria-labelledby="prize-guide">
              <h2 id="prize-guide">경품 구성</h2>
              <div className="grade-table">
                <div><span>S</span><b>{prizeGuide[0]}</b><em>2%</em></div>
                <div><span>A</span><b>{prizeGuide[1]}</b><em>18%</em></div>
                <div><span>B</span><b>{prizeGuide[2]}</b><em>80%</em></div>
              </div>
              <p>표시 확률은 한 번의 추첨 기준이며, 결제 전 최종 구성과 수량을 다시 확인할 수 있습니다.</p>
            </section>
          ) : (
            <section className="detail-section" aria-labelledby="purchase-guide-title">
              <h2 id="purchase-guide-title">구매 안내</h2>
              <dl className="purchase-guide">
                {purchaseGuide.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
              <p>
                {product.categoryId === "tcg"
                  ? "팩 속 카드는 제조사 기준으로 무작위 구성될 수 있으며, 구매한 팩 그대로 제공됩니다."
                  : "선택한 피규어와 수량 그대로 주문됩니다."}
              </p>
            </section>
          )}
        </div>
      </main>
    </MobileScroll>
  );
}

function DetailFooter({ flow, product }: { flow: FlowControls; product: Product }) {
  const { prepareCheckout } = useDabboba();
  const [liked, setLiked] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const commerceCopy = commerceCopyFor(product);
  const unit = commerceCopy.unit;
  const maxQuantity = Math.min(5, product.stock);
  const total = product.price * quantity;

  const continueToCheckout = () => {
    setSheetOpen(false);
    prepareCheckout();
    flow.push(createCheckoutScreen(product, quantity));
  };

  return (
    <>
      <div className="route-footer detail-footer">
        <button
          type="button"
          className="favorite-button"
          onClick={() => setLiked((current) => !current)}
          aria-label={liked ? "찜 해제" : "찜하기"}
          aria-pressed={liked}
        >
          {liked ? <IconHeartFill size={26} aria-hidden="true" /> : <IconHeartLine size={26} aria-hidden="true" />}
        </button>
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="primary-action"
          onClick={() => setSheetOpen(true)}
        >
          {commerceCopy.action}
        </ActionButton>
      </div>

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={commerceCopy.quantityTitle}
        description={commerceCopy.quantityDescription}
        snap={0.5}
      >
        <div className="sheet-product">
          <img src={product.asset} alt="" decoding="async" draggable={false} />
          <div>
            <small>{product.line}</small>
            <strong>{product.title}</strong>
            <span>{formatWon(product.price)} / 1{unit}</span>
          </div>
        </div>

        <div className="quantity-row">
          <div>
            <small>수량</small>
            <strong>최대 {maxQuantity}{unit}까지</strong>
          </div>
          <div className="quantity-stepper" aria-label={commerceCopy.quantityTitle}>
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              disabled={quantity === 1}
              aria-label="수량 줄이기"
            >
              <IconMinusLine size={20} aria-hidden="true" />
            </button>
            <strong aria-live="polite">{quantity}</strong>
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.min(maxQuantity, current + 1))}
              disabled={quantity === maxQuantity}
              aria-label="수량 늘리기"
            >
              <IconPlusLine size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="sheet-total">
          <span>결제 예정 금액</span>
          <strong>{formatWon(total)}</strong>
        </div>
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="sheet-primary-button"
          onClick={continueToCheckout}
        >
          결제하기
        </ActionButton>
      </BottomSheet>
    </>
  );
}

function CheckoutPage({ product, quantity }: { product: Product; quantity: number }) {
  const {
    pointBalance,
    couponDiscount,
    setCouponDiscount,
    points,
    setPoints,
    paymentMethod,
    setPaymentMethod,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [couponOpen, setCouponOpen] = useState(false);
  const unit = commerceUnit(product);
  const subtotal = product.price * quantity;
  const maxPoints = Math.max(0, Math.min(pointBalance, subtotal - couponDiscount));

  const updatePoints = (value: string) => {
    const numeric = Number(value.replace(/[^0-9]/g, ""));
    setPoints(Math.min(Number.isFinite(numeric) ? numeric : 0, maxPoints));
  };

  const selectCoupon = (discount: number, close = true) => {
    setCouponDiscount(discount);
    setPoints((current) => Math.min(current, Math.max(0, subtotal - discount)));
    if (close) setCouponOpen(false);
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="checkout-page" aria-label="결제 정보 입력">
          <section className="checkout-section" aria-labelledby="order-product">
            <h1 id="order-product">구매 상품</h1>
            <div className="checkout-product">
              <img src={product.asset} alt="" decoding="async" draggable={false} />
              <div>
                <small>{product.line}</small>
                <strong>{product.title}</strong>
                <span>{formatWon(product.price)} · {quantity}{unit}</span>
              </div>
            </div>
          </section>

          <section className="checkout-section" aria-labelledby="discount-title">
            <h2 id="discount-title">할인</h2>
            <button type="button" className="checkout-row" onClick={() => setCouponOpen(true)}>
              <IconCouponLine size={22} aria-hidden="true" />
              <span>쿠폰</span>
              <b>{couponDiscount ? `${formatWon(couponDiscount)} 할인` : "사용 안 함"}</b>
              <IconChevronRightLine size={21} aria-hidden="true" />
            </button>

            <div className="point-box">
              <div className="point-heading">
                <span>포인트</span>
                <small>보유 {formatPoints(pointBalance)}</small>
              </div>
              <div className="point-input-row">
                <KeyboardInput
                  type="text"
                  inputMode="numeric"
                  value={points || ""}
                  placeholder="0"
                  aria-label="사용할 포인트"
                  onChange={(event) => updatePoints(event.currentTarget.value)}
                  onBlur={() => keyboard.hide()}
                />
                <span>원</span>
                <button type="button" onClick={() => setPoints(maxPoints)}>모두 사용</button>
              </div>
            </div>
          </section>

          <section className="checkout-section" aria-labelledby="payment-title">
            <h2 id="payment-title">결제 수단</h2>
            <div className="payment-list" role="radiogroup" aria-label="결제 수단">
              {paymentMethods.map((method, index) => {
                const selected = method === paymentMethod;
                return (
                  <button
                    key={method}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    className="payment-method"
                    data-selected={selected ? "true" : "false"}
                    onClick={() => setPaymentMethod(method)}
                    onKeyDown={(event) => handleRadioArrow(event, paymentMethods, index, setPaymentMethod)}
                  >
                    <IconCardLine size={22} aria-hidden="true" />
                    <span>{method}</span>
                    {selected ? (
                      <IconCheckmarkCircleFill className="selected-check" size={22} aria-hidden="true" />
                    ) : (
                      <span className="empty-check" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="secure-note">
            <IconLockLine size={18} aria-hidden="true" />
            <span>이 화면은 결제 흐름 확인용 프로토타입이며 실제 결제는 이루어지지 않습니다.</span>
          </div>
        </main>
      </MobileScroll>

      <BottomSheet
        open={couponOpen}
        onOpenChange={setCouponOpen}
        title="쿠폰 선택"
        description="이번 주문에 사용할 쿠폰을 골라주세요."
        snap={0.43}
      >
        <div className="coupon-list" role="radiogroup" aria-label="쿠폰">
          {couponOptions.map((discount, index) => {
            const selected = couponDiscount === discount;
            return (
              <button
                key={discount}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-selected={selected ? "true" : "false"}
                onClick={() => selectCoupon(discount)}
                onKeyDown={(event) => handleRadioArrow(event, couponOptions, index, (value) => selectCoupon(value, false))}
              >
                <span>
                  <small>{discount ? "WELCOME" : "COUPON"}</small>
                  <strong>{discount ? "첫 구매 1,000원 할인" : "사용하지 않기"}</strong>
                </span>
                {selected ? <IconCheckmarkLine size={22} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}

function CheckoutFooter({
  flow,
  product,
  quantity,
}: {
  flow: FlowControls;
  product: Product;
  quantity: number;
}) {
  const {
    couponDiscount,
    points,
    paymentMethod,
    paying,
    setPaying,
    setPointBalance,
    prepareDraw,
  } = useDabboba();
  const timer = useRef<number | null>(null);
  const drawMode = isRandomDrawCategory(product.categoryId);
  const total = Math.max(0, product.price * quantity - couponDiscount - points);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const pay = () => {
    if (paying) return;
    setPaying(true);
    timer.current = window.setTimeout(() => {
      setPointBalance((current) => Math.max(0, current - points));
      setPaying(false);
      if (drawMode) {
        prepareDraw(quantity);
        flow.replace(createDrawScreen(product, quantity));
      } else {
        flow.replace(createPurchaseCompleteScreen(product, quantity, total));
      }
      timer.current = null;
    }, 900);
  };

  return (
    <div className="route-footer checkout-footer">
      <div className="payment-total">
        <small>{paymentMethod}</small>
        <strong>{formatWon(total)}</strong>
      </div>
      <ActionButton
        type="button"
        variant="brandSolid"
        size="large"
        className="primary-action checkout-action"
        loading={paying}
        disabled={paying}
        onClick={pay}
      >
        {paying ? "결제 확인 중" : "결제하기"}
      </ActionButton>
    </div>
  );
}

function PurchaseCompletePage({
  product,
  quantity,
  paidTotal,
}: {
  product: Product;
  quantity: number;
  paidTotal: number;
}) {
  const screenFocusRef = useScreenEntryFocus();
  const unit = commerceUnit(product);
  const orderCode = `DBB-DEMO-${product.id.slice(0, 8).toUpperCase()}`;

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="purchase-complete-page" aria-label="일반 상품 주문 완료">
        <section className="purchase-complete-heading">
          <span><IconCheckmarkCircleFill size={36} aria-hidden="true" /></span>
          <h1>구매가 완료됐어요.</h1>
          <p>{product.category} · {quantity}{unit} 구매 내역이 준비됐습니다.</p>
        </section>

        <section className="purchase-complete-product" aria-labelledby="purchase-complete-product-title">
          <h2 id="purchase-complete-product-title">주문 상품</h2>
          <div>
            <img src={product.asset} alt="" decoding="async" draggable={false} />
            <span>
              <small>{product.line}</small>
              <strong>{product.title}</strong>
              <em>{formatWon(product.price)} · {quantity}{unit}</em>
            </span>
          </div>
        </section>

        <dl className="purchase-complete-meta">
          <div><dt>결제 금액</dt><dd>{formatWon(paidTotal)}</dd></div>
          <div><dt>주문 상태</dt><dd>결제 완료</dd></div>
          <div><dt>배송 상태</dt><dd>배송 신청 전</dd></div>
          <div><dt>테스트 주문번호</dt><dd>{orderCode}</dd></div>
        </dl>

        <div className="purchase-complete-note">
          <IconTruckLine size={21} aria-hidden="true" />
          <span>배송지 입력과 실제 주문 접수는 정식 결제·배송 시스템 연결 후 제공됩니다.</span>
        </div>
        <p className="prototype-disclosure">현재 화면은 구매 흐름 확인용이며 실제 결제·주문·배송은 발생하지 않았습니다.</p>
      </main>
    </MobileScroll>
  );
}

function PurchaseCompleteFooter({ flow }: { flow: FlowControls }) {
  return (
    <div className="route-footer purchase-complete-footer">
      <ActionButton
        type="button"
        variant="brandSolid"
        size="large"
        className="primary-action"
        onClick={() => returnToCatalog(flow)}
      >
        상품 목록으로
      </ActionButton>
    </div>
  );
}

function CapsuleDrawAnimation({ state }: { state: DrawState }) {
  return (
    <div className="capsule-animation" data-state={state} aria-hidden="true">
      <span className="capsule-machine-glow" />
      <div className="capsule-machine">
        <div className="capsule-marquee"><span>DABBOBA</span></div>

        <div className="capsule-chamber">
          <span className="capsule-glass-shine" />
          <div className="capsule-pool">
            {CAPSULE_LAYOUT.map((capsule, index) => (
              <span
                className={`capsule-ball capsule-ball-${capsule.tone}`}
                key={`${capsule.left}-${capsule.top}`}
                style={{
                  "--capsule-left": capsule.left,
                  "--capsule-top": capsule.top,
                  "--capsule-mix-x": capsule.mixX,
                  "--capsule-mix-y": capsule.mixY,
                  "--capsule-rotate": capsule.rotate,
                  "--capsule-delay": `${index * 31}ms`,
                } as CSSProperties}
              >
                <b>DB</b>
              </span>
            ))}
          </div>
          <span className="capsule-speed-line capsule-speed-line-left" />
          <span className="capsule-speed-line capsule-speed-line-right" />
          <span className="capsule-speed-line capsule-speed-line-bottom" />
        </div>

        <div className="capsule-machine-body">
          <span className="capsule-coin-slot" />
          <div className="capsule-crank">
            <span className="capsule-crank-hub" />
            <span className="capsule-crank-arm"><i /></span>
          </div>
          <div className="capsule-outlet"><span /></div>
        </div>
        <span className="capsule-machine-foot capsule-machine-foot-left" />
        <span className="capsule-machine-foot capsule-machine-foot-right" />
      </div>

      <div className="capsule-selected capsule-selected-drop">
        <span className="capsule-shell capsule-shell-top" />
        <span className="capsule-shell capsule-shell-bottom"><b>DB</b></span>
      </div>

      <div className="capsule-reveal">
        <span className="capsule-reveal-glow" />
        <span className="capsule-pixel capsule-pixel-1" />
        <span className="capsule-pixel capsule-pixel-2" />
        <span className="capsule-pixel capsule-pixel-3" />
        <span className="capsule-pixel capsule-pixel-4" />
        <span className="capsule-pixel capsule-pixel-5" />
        <span className="capsule-pixel capsule-pixel-6" />
        <span className="capsule-card"><i /></span>
        <span className="capsule-open-half capsule-open-half-left" />
        <span className="capsule-open-half capsule-open-half-right"><b>DB</b></span>
      </div>

      <div className="capsule-phase-copy">
        <span>TURN</span>
        <span>MIX</span>
        <span>DROP</span>
        <span>OPEN</span>
      </div>
    </div>
  );
}

function DrawPage({ product, quantity }: { product: Product; quantity: number }) {
  const { drawState, drawRemaining } = useDabboba();
  const [oddsOpen, setOddsOpen] = useState(false);
  const screenFocusRef = useScreenEntryFocus();
  const unit = commerceUnit(product);
  const drawLabel = product.categoryId === "kuji" ? "쿠지 추첨" : "가챠 뽑기";
  const prizeGuide = prizeGuideFor(product.categoryId);

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="draw-page" aria-label={`${product.line} ${drawLabel}`}>
          <div className="paid-ticket">
            <IconCheckmarkCircleFill size={22} aria-hidden="true" />
            <div>
              <strong>결제 완료</strong>
              <span>{quantity}{unit} 추첨권이 준비됐어요</span>
            </div>
          </div>

          <div className="draw-heading">
            <span>{product.edition}</span>
            <h1>{product.line}</h1>
            <p>{drawLabel} 버튼을 눌러 추첨을 시작하세요.</p>
          </div>

          <section className="arcade-stage" data-state={drawState} aria-label={`DABBOBA 오락실 ${drawLabel} 기계`}>
            {product.categoryId === "gacha" ? (
              <CapsuleDrawAnimation state={drawState} />
            ) : (
              <img
                src="/assets/dabboba/arcade-cabinet.png"
                className="arcade-cabinet"
                alt={`${product.line} 추첨을 진행하는 검은색 오락기`}
                draggable={false}
              />
            )}
            <span className="draw-status" aria-live="polite">
              {drawState === "drawing"
                ? product.categoryId === "gacha" ? "CAPSULE RUN" : "DRAWING"
                : drawRemaining > 0 ? "READY" : "CLEAR"}
            </span>
          </section>

          <section className="draw-info" aria-label={`${drawLabel} 정보`}>
            <div>
              <img src={product.asset} alt="" decoding="async" draggable={false} />
              <span><small>선택한 상품</small><strong>{product.title}</strong></span>
            </div>
            <button type="button" onClick={() => setOddsOpen(true)}>
              <span><small>남은 추첨권</small><strong>{drawRemaining}{unit}</strong></span>
              <span>경품·확률</span>
              <IconChevronRightLine size={21} aria-hidden="true" />
            </button>
          </section>
        </main>
      </MobileScroll>

      <BottomSheet
        open={oddsOpen}
        onOpenChange={setOddsOpen}
        title="경품·확률"
        description="등급별 당첨 확률을 확인해 주세요."
        snap={0.43}
      >
        <div className="grade-table sheet-grade-table">
          <div><span>S</span><b>{prizeGuide[0]}</b><em>2%</em></div>
          <div><span>A</span><b>{prizeGuide[1]}</b><em>18%</em></div>
          <div><span>B</span><b>{prizeGuide[2]}</b><em>80%</em></div>
        </div>
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="sheet-primary-button"
          onClick={() => setOddsOpen(false)}
        >
          확인
        </ActionButton>
      </BottomSheet>
    </>
  );
}

function DrawFooter({ flow, product }: { flow: FlowControls; product: Product }) {
  const {
    drawState,
    setDrawState,
    drawRemaining,
    setDrawRemaining,
    resultOpen,
    setResultOpen,
    resultGrade,
    setResultGrade,
  } = useDabboba();
  const timer = useRef<number | null>(null);
  const unit = commerceUnit(product);
  const drawNoun = product.categoryId === "kuji" ? "쿠지" : "뽑기";
  const drawDuration = product.categoryId === "gacha"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 420 : 3_200
    : 1_250;

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const startDraw = () => {
    if (drawState === "drawing" || drawRemaining < 1) return;
    setDrawState("drawing");
    timer.current = window.setTimeout(() => {
      setResultGrade(rollPrizeGrade());
      setDrawRemaining((current) => Math.max(0, current - 1));
      setDrawState("result");
      setResultOpen(true);
      timer.current = null;
    }, drawDuration);
  };

  const handleResultOpen = (open: boolean) => {
    setResultOpen(open);
    if (!open && drawRemaining > 0) setDrawState("ready");
    if (!open && drawRemaining < 1) {
      setDrawState("done");
      returnToCatalog(flow);
    }
  };

  const nextAction = () => {
    setResultOpen(false);
    if (drawRemaining > 0) {
      setDrawState("ready");
      return;
    }
    setDrawState("done");
    returnToCatalog(flow);
  };

  return (
    <>
      <div className="route-footer draw-footer">
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="primary-action draw-action"
          loading={drawState === "drawing"}
          disabled={drawState === "drawing" || drawRemaining < 1}
          onClick={startDraw}
        >
          {drawState === "drawing" ? "추첨 중" : drawRemaining > 0 ? `${drawNoun} · ${drawRemaining}${unit}` : "추첨 완료"}
        </ActionButton>
      </div>

      <BottomSheet
        open={resultOpen}
        onOpenChange={handleResultOpen}
        title={`${drawNoun} 완료`}
        description="새 경품이 보관함에 들어왔어요."
        snap={0.49}
      >
        <div className="result-card">
          <span className="result-grade">{resultGrade}</span>
          <img src={product.asset} alt="" decoding="async" draggable={false} />
          <div>
            <small>{product.line}</small>
            <strong>{rewardForGrade(product, resultGrade)}</strong>
          </div>
        </div>
        <div className="result-meta">
          <span>남은 추첨권</span>
          <strong>{drawRemaining}{unit}</strong>
        </div>
        <ActionButton
          type="button"
          variant="brandSolid"
          size="large"
          className="sheet-primary-button"
          onClick={nextAction}
        >
          {drawRemaining > 0 ? `다음 ${drawNoun}` : "상품 목록으로"}
        </ActionButton>
      </BottomSheet>
    </>
  );
}
