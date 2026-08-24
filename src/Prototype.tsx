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
import { useDrag } from "@use-gesture/react";
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
import {
  DEFAULT_EXCHANGE_APPLICATIONS,
  DEFAULT_EXCHANGE_POSTS,
  DEFAULT_PRODUCT_REQUESTS,
  EXCHANGE_FILTERS,
  REQUEST_CATEGORY_IDS,
  type ExchangeApplication,
  type ExchangeFilter,
  type ExchangePost,
  type ProductRequest,
} from "./data/exchangeRequestFixtures";
import { FEATURED_IPS, IP_CATALOG } from "./data/ipCatalog";
import { PRODUCTS, productsForIp, type CatalogProduct } from "./data/productCatalog";
import {
  DUCKROOM_FILTERS,
  DUCKROOM_SHOWCASES,
  type DuckroomFilter,
} from "./data/socialFixtures";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  categoryLabel,
  isRandomDrawCategory,
  matchesIpSearch,
  normalizeCatalogSearch,
  type IpRecord,
  type ProductCategoryId,
  type ProductCategoryLabel,
} from "./domain/catalog";
import type { RootTabId } from "./domain/navigation";

type Category = ProductCategoryLabel;
type CategoryFilter = "전체" | Category;
type RequestFilter = "all" | ProductCategoryId;
type PaymentMethod = "간편카드" | "카카오페이" | "네이버페이";
type DrawState = "ready" | "transitioning" | "drawing" | "result" | "done";
type PrizeGrade = "S" | "A" | "B";
type IpDetailTab = "상품" | "캐릭터" | "스냅" | "교환방";
type SplashState = "visible" | "leaving" | "hidden";
type RootNavigationState = "expanded" | "compact";
type AuthIntent =
  | { kind: "exchange-post"; postId: string }
  | { kind: "exchange-compose" }
  | { kind: "request-compose" }
  | { kind: "request-like"; requestId: string };
type UserProfile = {
  nickname: string;
  bio: string;
  favoriteIpId: string;
};

type Product = CatalogProduct;

const products: Product[] = PRODUCTS;
const productSearchIndex = new Map(products.map((product) => {
  const ip = IP_CATALOG.find((item) => item.id === product.ipId);
  const searchableText = [
    product.title,
    product.line,
    product.description,
    product.edition,
    product.reward,
    product.category,
    ip?.nameKo,
    ip?.nameEn,
    ip?.nameJa,
    ...(ip?.aliases ?? []),
  ].filter((value): value is string => Boolean(value));

  return [product.id, normalizeCatalogSearch(searchableText.join(" "))] as const;
}));

const filters: CategoryFilter[] = ["전체", ...PRODUCT_CATEGORY_LABELS];
const paymentMethods: PaymentMethod[] = ["간편카드", "카카오페이", "네이버페이"];
const couponOptions = [1_000, 0] as const;
const ipDetailTabs: IpDetailTab[] = ["상품", "캐릭터", "스냅", "교환방"];
const DABBOBA_WORDMARK_SRC = "/assets/dabboba/brand/dabboba-wordmark.png";
const ROOT_NAVIGATION_TOP_THRESHOLD = 12;
const ROOT_NAVIGATION_COLLAPSE_THRESHOLD = 18;
const ROOT_NAVIGATION_EXPAND_THRESHOLD = 10;

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatPoints(value: number) {
  return `${value.toLocaleString("ko-KR")}P`;
}

function exchangeApplicationCount(post: ExchangePost, applications: readonly ExchangeApplication[]) {
  const seededVisibleCount = DEFAULT_EXCHANGE_APPLICATIONS[post.id]?.length ?? 0;
  return post.applications + Math.max(0, applications.length - seededVisibleCount);
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
  isAuthenticated: boolean;
  setIsAuthenticated: Dispatch<SetStateAction<boolean>>;
  authIntent: AuthIntent | null;
  setAuthIntent: Dispatch<SetStateAction<AuthIntent | null>>;
  exchangeComposerRequested: boolean;
  setExchangeComposerRequested: Dispatch<SetStateAction<boolean>>;
  requestComposerRequested: boolean;
  setRequestComposerRequested: Dispatch<SetStateAction<boolean>>;
  activeRootTab: RootTabId;
  setActiveRootTab: Dispatch<SetStateAction<RootTabId>>;
  profile: UserProfile;
  setProfile: Dispatch<SetStateAction<UserProfile>>;
  profileSaveNotice: string;
  setProfileSaveNotice: Dispatch<SetStateAction<string>>;
  exchangePosts: ExchangePost[];
  addExchangePost: (post: Omit<ExchangePost, "id" | "author" | "time" | "applications">) => void;
  exchangeApplications: Record<string, ExchangeApplication[]>;
  addExchangeApplication: (postId: string, application: Pick<ExchangeApplication, "offeredItem" | "message">) => void;
  productRequests: ProductRequest[];
  addProductRequest: (request: Omit<ProductRequest, "id" | "author" | "time" | "likes">) => void;
  likedProductRequestIds: Set<string>;
  toggleProductRequestLike: (requestId: string) => void;
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
  drawControlProgress: number;
  setDrawControlProgress: Dispatch<SetStateAction<number>>;
  prepareCheckout: () => void;
  prepareDraw: (count: number) => void;
};

const DabbobaContext = createContext<DabbobaContextValue | null>(null);

function useDabboba() {
  const context = useContext(DabbobaContext);
  if (!context) throw new Error("useDabboba must be used inside DabbobaContext");
  return context;
}

function DabbobaWordmark({ className = "", alt = "DABBOBA" }: { className?: string; alt?: string }) {
  return (
    <img
      src={DABBOBA_WORDMARK_SRC}
      className={`dabboba-wordmark ${className}`.trim()}
      alt={alt}
      draggable={false}
      decoding="async"
    />
  );
}

export default function Prototype() {
  const [splashState, setSplashState] = useState<SplashState>("visible");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null);
  const [exchangeComposerRequested, setExchangeComposerRequested] = useState(false);
  const [requestComposerRequested, setRequestComposerRequested] = useState(false);
  const [activeRootTab, setActiveRootTab] = useState<RootTabId>("home");
  const [profile, setProfile] = useState<UserProfile>({
    nickname: "다뽑러 01",
    bio: "좋아하는 작품과 굿즈를 천천히 모으고 있어요.",
    favoriteIpId: "one-piece",
  });
  const [profileSaveNotice, setProfileSaveNotice] = useState("");
  const [exchangePosts, setExchangePosts] = useState<ExchangePost[]>(DEFAULT_EXCHANGE_POSTS);
  const [exchangeApplications, setExchangeApplications] = useState<Record<string, ExchangeApplication[]>>(() => (
    Object.fromEntries(
      Object.entries(DEFAULT_EXCHANGE_APPLICATIONS).map(([postId, applications]) => [postId, [...applications]]),
    )
  ));
  const [productRequests, setProductRequests] = useState<ProductRequest[]>(DEFAULT_PRODUCT_REQUESTS);
  const [likedProductRequestIds, setLikedProductRequestIds] = useState<Set<string>>(() => new Set());
  const [pointBalance, setPointBalance] = useState(12_500);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [points, setPoints] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("간편카드");
  const [paying, setPaying] = useState(false);
  const [drawState, setDrawState] = useState<DrawState>("ready");
  const [drawRemaining, setDrawRemaining] = useState(1);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultGrade, setResultGrade] = useState<PrizeGrade>("B");
  const [drawControlProgress, setDrawControlProgress] = useState(0);
  const initialScreen = useMemo(() => createCatalogScreen(), []);

  useEffect(() => {
    document.title = "DABBOBA — 원하는 거 다 뽑아";
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const leaveTimer = window.setTimeout(() => setSplashState("leaving"), reducedMotion ? 260 : 1_050);
    const hideTimer = window.setTimeout(() => setSplashState("hidden"), reducedMotion ? 320 : 1_380);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(hideTimer);
    };
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
    setDrawControlProgress(0);
  }, []);

  const addExchangePost = useCallback((post: Omit<ExchangePost, "id" | "author" | "time" | "applications">) => {
    setExchangePosts((current) => [
      {
        id: `exchange-user-${Date.now()}`,
        author: profile.nickname,
        time: "방금 전",
        applications: 0,
        ...post,
      },
      ...current,
    ]);
  }, [profile.nickname]);

  const addExchangeApplication = useCallback((
    postId: string,
    application: Pick<ExchangeApplication, "offeredItem" | "message">,
  ) => {
    const nextApplication: ExchangeApplication = {
      id: `exchange-application-${Date.now()}`,
      author: profile.nickname,
      time: "방금 전",
      ...application,
    };
    setExchangeApplications((current) => ({
      ...current,
      [postId]: [...(current[postId] ?? []), nextApplication],
    }));
  }, [profile.nickname]);

  const addProductRequest = useCallback((
    request: Omit<ProductRequest, "id" | "author" | "time" | "likes">,
  ) => {
    setProductRequests((current) => [
      {
        id: `request-user-${Date.now()}`,
        author: profile.nickname,
        time: "방금 전",
        likes: 0,
        ...request,
      },
      ...current,
    ]);
  }, [profile.nickname]);

  const toggleProductRequestLike = useCallback((requestId: string) => {
    setLikedProductRequestIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  }, []);

  const contextValue: DabbobaContextValue = {
    isAuthenticated,
    setIsAuthenticated,
    authIntent,
    setAuthIntent,
    exchangeComposerRequested,
    setExchangeComposerRequested,
    requestComposerRequested,
    setRequestComposerRequested,
    activeRootTab,
    setActiveRootTab,
    profile,
    setProfile,
    profileSaveNotice,
    setProfileSaveNotice,
    exchangePosts,
    addExchangePost,
    exchangeApplications,
    addExchangeApplication,
    productRequests,
    addProductRequest,
    likedProductRequestIds,
    toggleProductRequestLike,
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
    drawControlProgress,
    setDrawControlProgress,
    prepareCheckout,
    prepareDraw,
  };

  return (
    <DabbobaContext.Provider value={contextValue}>
      <div className="dabboba-root">
        <FlowStack initial={initialScreen} />
        {splashState !== "hidden" ? <DabbobaSplash state={splashState} /> : null}
      </div>
    </DabbobaContext.Provider>
  );
}

function DabbobaSplash({ state }: { state: Exclude<SplashState, "hidden"> }) {
  return (
    <div className="dabboba-splash" data-state={state} role="status" aria-label="DABBOBA 불러오는 중">
      <div className="dabboba-splash-lockup">
        <DabbobaWordmark className="dabboba-splash-wordmark" alt="" />
        <small>원하는 거 다 뽑아</small>
        <span className="dabboba-splash-loader" aria-hidden="true"><i /><i /><i /><i /></span>
      </div>
    </div>
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

function createExchangeRoomScreen(): FlowScreen {
  return {
    id: "root-community",
    header: () => <RootTabHeader title="교환방" subtitle="내 굿즈와 원하는 교환을 연결하는 곳" />,
    headerHeight: 58,
    footer: (flow) => <RootTabFooter flow={flow} />,
    footerHeight: 70,
    render: (flow) => <ExchangeRoomPage flow={flow} />,
  };
}

function createExchangeDetailScreen(postId: string): FlowScreen {
  return {
    id: `exchange-post-${postId}`,
    header: (flow) => <BackHeader title="교환 상세" onBack={flow.pop} />,
    headerHeight: 56,
    render: () => <ExchangeDetailPage postId={postId} />,
  };
}

function createLoginScreen(): FlowScreen {
  return {
    id: "login",
    header: (flow) => <LoginHeader flow={flow} />,
    headerHeight: 56,
    render: (flow) => <LoginPage flow={flow} />,
  };
}

function createShopScreen(): FlowScreen {
  return {
    id: "root-shop",
    header: () => <RootTabHeader title="뽀바" subtitle="가챠 · 피규어 · 쿠지 · 카드" showPoints />,
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

function createCustomerCenterScreen(): FlowScreen {
  return {
    id: "customer-center",
    header: (flow) => <BackHeader title="고객센터" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <CustomerCenterPage flow={flow} />,
  };
}

function createRequestRoomScreen(): FlowScreen {
  return {
    id: "request-room",
    header: (flow) => <BackHeader title="신청방" onBack={flow.pop} />,
    headerHeight: 56,
    render: (flow) => <RequestRoomPage flow={flow} />,
  };
}

function createRootScreen(tab: RootTabId) {
  if (tab === "community") return createExchangeRoomScreen();
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
    header: () => <DrawHeader />,
    headerHeight: 56,
    footer: (flow) => <DrawFooter flow={flow} product={product} />,
    footerHeight: 94,
    render: () => <DrawPage product={product} quantity={quantity} />,
  };
}

function createPurchaseCompleteScreen(product: Product, quantity: number, paidTotal: number): FlowScreen {
  const drawMode = isRandomDrawCategory(product.categoryId);

  return {
    id: `purchase-complete-${product.id}`,
    header: () => <StaticHeader title={drawMode ? "결제 완료" : "주문 완료"} />,
    headerHeight: 56,
    footer: (flow) => <PurchaseCompleteFooter flow={flow} product={product} quantity={quantity} />,
    footerHeight: 82,
    render: () => <PurchaseCompletePage product={product} quantity={quantity} paidTotal={paidTotal} />,
  };
}

function CatalogHeader({ flow }: { flow: FlowControls }) {
  const { pointBalance } = useDabboba();

  return (
    <div className="app-toolbar catalog-toolbar">
      <div className="brand-lockup">
        <DabbobaWordmark className="catalog-wordmark" />
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

function LoginHeader({ flow }: { flow: FlowControls }) {
  const { setAuthIntent } = useDabboba();

  return (
    <BackHeader
      title="로그인"
      onBack={() => {
        setAuthIntent(null);
        flow.pop();
      }}
    />
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

function DrawHeader() {
  const { drawState } = useDabboba();

  return (
    <div className="app-toolbar back-toolbar draw-toolbar" data-state={drawState}>
      <span className="toolbar-spacer" aria-hidden="true" />
      <div className="draw-brand-lockup" role="img" aria-label="DABBOBA ARCADE">
        <DabbobaWordmark className="draw-wordmark" alt="" />
        <span>ARCADE</span>
      </div>
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
  const [navigationState, setNavigationState] = useState<RootNavigationState>("expanded");
  const navigationStateRef = useRef<RootNavigationState>("expanded");
  const lastScrollTopRef = useRef(0);
  const directionDistanceRef = useRef(0);
  const scrollTargetRef = useRef<HTMLElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);

  const updateNavigationState = useCallback((nextState: RootNavigationState) => {
    if (navigationStateRef.current === nextState) return;
    navigationStateRef.current = nextState;
    setNavigationState(nextState);
  }, []);

  useEffect(() => {
    updateNavigationState("expanded");
    directionDistanceRef.current = 0;
    const activeScrollTarget = document.querySelector<HTMLElement>(
      '.dabboba-root .flow-screen[data-flow-current="true"] .mobile-scroll',
    );
    scrollTargetRef.current = activeScrollTarget;
    lastScrollTopRef.current = Math.max(0, activeScrollTarget?.scrollTop ?? 0);

    const updateNavigation = () => {
      scrollFrameRef.current = null;
      const scrollTarget = scrollTargetRef.current;
      if (!scrollTarget) return;

      if (scrollTarget.scrollHeight <= scrollTarget.clientHeight + 2) {
        lastScrollTopRef.current = 0;
        directionDistanceRef.current = 0;
        updateNavigationState("expanded");
        return;
      }

      const nextScrollTop = Math.max(0, scrollTarget.scrollTop);
      const delta = nextScrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = nextScrollTop;

      if (nextScrollTop <= ROOT_NAVIGATION_TOP_THRESHOLD) {
        directionDistanceRef.current = 0;
        updateNavigationState("expanded");
        return;
      }

      if (delta === 0) return;

      if (navigationStateRef.current === "expanded") {
        directionDistanceRef.current = Math.max(0, directionDistanceRef.current + delta);
      } else {
        directionDistanceRef.current = Math.min(0, directionDistanceRef.current + delta);
      }

      if (
        navigationStateRef.current === "expanded" &&
        directionDistanceRef.current >= ROOT_NAVIGATION_COLLAPSE_THRESHOLD
      ) {
        directionDistanceRef.current = 0;
        updateNavigationState("compact");
      } else if (
        navigationStateRef.current === "compact" &&
        directionDistanceRef.current <= -ROOT_NAVIGATION_EXPAND_THRESHOLD
      ) {
        directionDistanceRef.current = 0;
        updateNavigationState("expanded");
      }
    };

    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains("mobile-scroll")) return;
      if (!target.closest('.dabboba-root .flow-screen[data-flow-current="true"]')) return;

      if (scrollTargetRef.current !== target) {
        scrollTargetRef.current = target;
        lastScrollTopRef.current = Math.max(0, target.scrollTop);
        directionDistanceRef.current = 0;
        return;
      }

      scrollTargetRef.current = target;
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current = window.requestAnimationFrame(updateNavigation);
      }
    };

    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener("scroll", handleScroll, true);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [activeRootTab, updateNavigationState]);

  const selectTab = (tab: RootTabId) => {
    if (tab === activeRootTab) return;
    updateNavigationState("expanded");
    setActiveRootTab(tab);
    flow.replace(createRootScreen(tab));
  };

  return (
    <div
      className="root-tab-footer"
      data-navigation-state={navigationState}
      onFocusCapture={() => updateNavigationState("expanded")}
    >
      <AppBottomNavigation activeTab={activeRootTab} onSelect={selectTab} />
    </div>
  );
}

function ExchangeRoomPage({ flow }: { flow: FlowControls }) {
  const {
    isAuthenticated,
    authIntent,
    setAuthIntent,
    exchangeComposerRequested,
    setExchangeComposerRequested,
    exchangePosts,
    addExchangePost,
    exchangeApplications,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [filter, setFilter] = useState<ExchangeFilter>("전체");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftCategoryId, setDraftCategoryId] = useState<ProductCategoryId>("gacha");
  const [draftIpId, setDraftIpId] = useState(IP_CATALOG[0]?.id ?? "one-piece");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftOfferedItem, setDraftOfferedItem] = useState("");
  const [draftWantedItem, setDraftWantedItem] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const visiblePosts = filter === "전체"
    ? exchangePosts
    : exchangePosts.filter((post) => categoryLabel(post.categoryId) === filter);

  useEffect(() => {
    if (!isAuthenticated || !exchangeComposerRequested) return;
    setExchangeComposerRequested(false);
    setComposerOpen(true);
  }, [exchangeComposerRequested, isAuthenticated, setExchangeComposerRequested]);

  const requestExchangeAccess = (intent: AuthIntent) => {
    if (isAuthenticated) {
      if (intent.kind === "exchange-post") flow.push(createExchangeDetailScreen(intent.postId));
      else setComposerOpen(true);
      return;
    }

    keyboard.hide();
    setAuthIntent(intent);
  };

  const submitPost = () => {
    const title = draftTitle.trim();
    const offeredItem = draftOfferedItem.trim();
    const wantedItem = draftWantedItem.trim();
    const body = draftBody.trim();
    if (!title || !offeredItem || !wantedItem || !body) return;
    addExchangePost({
      categoryId: draftCategoryId,
      ipId: draftIpId,
      title,
      offeredItem,
      wantedItem,
      body,
    });
    keyboard.hide();
    setDraftTitle("");
    setDraftOfferedItem("");
    setDraftWantedItem("");
    setDraftBody("");
    setFilter("전체");
    setComposerOpen(false);
  };

  const handleComposerOpenChange = (open: boolean) => {
    if (!open) keyboard.hide();
    setComposerOpen(open);
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page exchange-page" aria-label="교환방 목록">
          <button
            type="button"
            className="exchange-composer-callout"
            onClick={() => requestExchangeAccess({ kind: "exchange-compose" })}
          >
            <span className="exchange-composer-icon"><IconPencilLine size={21} aria-hidden="true" /></span>
            <span><strong>교환 상품 올리기</strong><small>내 상품과 원하는 교환품을 함께 등록해 주세요.</small></span>
            <IconChevronRightLine size={21} aria-hidden="true" />
          </button>

          <Carousel className="exchange-filter-carousel" contentClassName="exchange-filter-rail" ariaLabel="교환 상품 카테고리">
            {EXCHANGE_FILTERS.map((category) => (
              <button
                key={category}
                type="button"
                className="filter-chip"
                data-selected={filter === category ? "true" : "false"}
                aria-pressed={filter === category}
                onClick={() => setFilter(category)}
              >
                {category}
              </button>
            ))}
          </Carousel>

          <section className="exchange-feed" aria-labelledby="exchange-feed-title">
            <div className="section-heading">
              <h1 id="exchange-feed-title">교환을 기다리고 있어요</h1>
              <span>{visiblePosts.length}개</span>
            </div>
            {visiblePosts.map((post) => {
              const ip = IP_CATALOG.find((item) => item.id === post.ipId);
              const applicationCount = exchangeApplicationCount(post, exchangeApplications[post.id] ?? []);
              return (
                <article key={post.id} className="exchange-post">
                  <div className="exchange-post-summary">
                    <div className="exchange-post-meta">
                      <span>{categoryLabel(post.categoryId)}</span>
                      <small>{post.author} · {post.time}</small>
                    </div>
                    <h2>{post.title}</h2>
                    <div className="exchange-pair-preview" aria-label={`올린 상품 ${post.offeredItem}, 원하는 교환 ${post.wantedItem}`}>
                      <span><small>올린 상품</small><strong>{post.offeredItem}</strong></span>
                      <i aria-hidden="true">↔</i>
                      <span><small>원하는 교환</small><strong>{post.wantedItem}</strong></span>
                    </div>
                    <p>{post.body}</p>
                    <button
                      type="button"
                      className="exchange-post-open"
                      aria-label={`${post.title} 교환 상세 보기`}
                      onClick={() => requestExchangeAccess({ kind: "exchange-post", postId: post.id })}
                    />
                  </div>
                  <div className="exchange-post-actions" aria-label={`${post.title} 교환 현황`}>
                    <span>{ip?.nameKo ?? "작품 미지정"}</span>
                    <span><IconDot3HorizontalChatbubbleLeftLine size={18} aria-hidden="true" /> 교환 신청 {applicationCount}건</span>
                  </div>
                </article>
              );
            })}
          </section>
          <p className="prototype-disclosure exchange-disclosure">교환 글과 신청은 화면 확인용 테스트 데이터이며 새로고침하면 작성 내용이 초기화됩니다.</p>
        </main>
      </MobileScroll>

      {!isAuthenticated && authIntent ? (
        <GuestAuthPrompt
          intent={authIntent}
          onDismiss={() => setAuthIntent(null)}
          onLogin={() => flow.push(createLoginScreen())}
        />
      ) : null}

      <BottomSheet
        open={composerOpen}
        onOpenChange={handleComposerOpenChange}
        title="교환 상품 올리기"
        description="내 상품과 원하는 교환품을 정확히 적어주세요."
        snap={0.88}
      >
        <div className="exchange-compose-form">
          <div className="compose-category-list" role="radiogroup" aria-label="상품 카테고리">
            {PRODUCT_CATEGORIES.map((category, index) => (
              <button
                key={category.id}
                type="button"
                role="radio"
                aria-checked={draftCategoryId === category.id}
                tabIndex={draftCategoryId === category.id ? 0 : -1}
                data-selected={draftCategoryId === category.id ? "true" : "false"}
                onKeyDown={(event) => handleRadioArrow(event, PRODUCT_CATEGORIES, index, (nextCategory) => setDraftCategoryId(nextCategory.id))}
                onClick={() => setDraftCategoryId(category.id)}
              >
                {category.label}
              </button>
            ))}
          </div>
          <label>
            <span>작품 IP</span>
            <select value={draftIpId} onChange={(event) => setDraftIpId(event.currentTarget.value)}>
              {IP_CATALOG.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo}</option>)}
            </select>
          </label>
          <label>
            <span>글 제목</span>
            <KeyboardInput
              value={draftTitle}
              maxLength={48}
              placeholder="어떤 교환인지 한눈에 적어주세요"
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <label>
            <span>올릴 상품</span>
            <KeyboardInput
              value={draftOfferedItem}
              maxLength={60}
              placeholder="내가 교환할 상품 이름과 상태"
              onChange={(event) => setDraftOfferedItem(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <label>
            <span>원하는 교환품</span>
            <KeyboardInput
              value={draftWantedItem}
              maxLength={60}
              placeholder="무엇으로 교환하고 싶은지 적어주세요"
              onChange={(event) => setDraftWantedItem(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <label>
            <span>상세 설명</span>
            <KeyboardTextarea
              value={draftBody}
              maxLength={500}
              placeholder="상품 상태, 교환 방법, 확인할 내용을 적어주세요."
              onChange={(event) => setDraftBody(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            disabled={!draftTitle.trim() || !draftOfferedItem.trim() || !draftWantedItem.trim() || !draftBody.trim()}
            onPointerDown={(event) => event.preventDefault()}
            onClick={submitPost}
          >
            교환 글 등록하기
          </ActionButton>
        </div>
      </BottomSheet>
    </>
  );
}

function GuestAuthPrompt({
  intent,
  onDismiss,
  onLogin,
}: {
  intent: AuthIntent;
  onDismiss: () => void;
  onLogin: () => void;
}) {
  const description = intent.kind === "exchange-compose"
    ? "교환 상품을 올리려면 로그인해 주세요."
    : intent.kind === "exchange-post"
      ? "교환 상세와 신청을 보려면 로그인해 주세요."
      : intent.kind === "request-compose"
        ? "원하는 상품을 신청하려면 로그인해 주세요."
        : "신청에 좋아요를 남기려면 로그인해 주세요.";

  return (
    <aside
      className="guest-auth-prompt"
      role="dialog"
      aria-live="polite"
      aria-labelledby="guest-auth-title"
      aria-describedby="guest-auth-description"
    >
      <div className="guest-auth-prompt-copy">
        <span aria-hidden="true"><IconLockLine size={20} /></span>
        <div>
          <strong id="guest-auth-title">로그인이 필요합니다</strong>
          <p id="guest-auth-description">{description}</p>
        </div>
        <button type="button" className="guest-auth-dismiss" onClick={onDismiss} aria-label="로그인 안내 닫기">
          <IconXmarkLine size={20} aria-hidden="true" />
        </button>
      </div>
      <ActionButton type="button" variant="brandSolid" size="large" className="guest-auth-login-button" onClick={onLogin}>
        로그인
      </ActionButton>
    </aside>
  );
}

function LoginPage({ flow }: { flow: FlowControls }) {
  const {
    authIntent,
    setAuthIntent,
    setIsAuthenticated,
    setExchangeComposerRequested,
    setRequestComposerRequested,
    toggleProductRequestLike,
  } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const timer = useRef<number | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const intentCopy = authIntent?.kind === "exchange-compose"
    ? "로그인하면 교환 글 작성으로 바로 이어집니다."
    : authIntent?.kind === "exchange-post"
      ? "로그인하면 선택한 교환 상세로 바로 이동합니다."
      : authIntent?.kind === "request-compose"
        ? "로그인하면 원하는 상품 신청으로 바로 이어집니다."
        : "로그인하면 선택한 신청에 좋아요가 반영됩니다.";

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const returnToGuest = () => {
    if (loggingIn) return;
    setAuthIntent(null);
    flow.pop();
  };

  const completeMockLogin = () => {
    if (loggingIn) return;
    setLoggingIn(true);
    timer.current = window.setTimeout(() => {
      const completedIntent = authIntent;
      setIsAuthenticated(true);
      setAuthIntent(null);
      setLoggingIn(false);
      timer.current = null;

      if (completedIntent?.kind === "exchange-post") {
        flow.replace(createExchangeDetailScreen(completedIntent.postId));
        return;
      }

      flow.pop();
      if (completedIntent?.kind === "exchange-compose") {
        window.setTimeout(() => setExchangeComposerRequested(true), 260);
      } else if (completedIntent?.kind === "request-compose") {
        window.setTimeout(() => setRequestComposerRequested(true), 260);
      } else if (completedIntent?.kind === "request-like") {
        toggleProductRequestLike(completedIntent.requestId);
      }
    }, 520);
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="login-page" aria-label="DABBOBA 로그인">
        <section className="login-brand-panel">
          <DabbobaWordmark className="login-wordmark" />
          <h1>좋아하는 굿즈를<br />안전하게 이어보세요.</h1>
          <p>상품과 컬렉션은 로그인 없이 둘러볼 수 있어요.<br />교환과 상품 신청을 시작할 때만 로그인이 필요합니다.</p>
        </section>

        <section className="login-action-panel" aria-label="로그인 선택">
          <div className="login-intent-note">
            <IconLockLine size={19} aria-hidden="true" />
            <span>{intentCopy}</span>
          </div>
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="login-primary-button"
            disabled={loggingIn}
            aria-busy={loggingIn}
            onClick={completeMockLogin}
          >
            {loggingIn ? "로그인 중..." : "테스트 계정으로 로그인"}
          </ActionButton>
          <button type="button" className="login-guest-button" disabled={loggingIn} onClick={returnToGuest}>
            둘러보기로 돌아가기
          </button>
          <small>현재는 화면 흐름 확인용 로그인입니다. 실제 계정이나 개인정보는 사용하지 않습니다.</small>
        </section>
      </main>
    </MobileScroll>
  );
}

function ExchangeDetailPage({ postId }: { postId: string }) {
  const {
    exchangePosts,
    exchangeApplications,
    addExchangeApplication,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [draftOfferedItem, setDraftOfferedItem] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const post = exchangePosts.find((item) => item.id === postId);

  if (!post) {
    return (
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="exchange-detail-page exchange-detail-missing" aria-label="교환 글을 찾을 수 없음">
          <IconDot3HorizontalChatbubbleLeftLine size={32} aria-hidden="true" />
          <h1>교환 글을 찾을 수 없어요.</h1>
          <p>새로고침으로 임시 교환 글이 초기화됐을 수 있습니다.</p>
        </main>
      </MobileScroll>
    );
  }

  const applications = exchangeApplications[post.id] ?? [];
  const applicationCount = exchangeApplicationCount(post, applications);
  const ip = IP_CATALOG.find((item) => item.id === post.ipId);
  const isOwnPost = post.id.startsWith("exchange-user-");

  const submitApplication = () => {
    const offeredItem = draftOfferedItem.trim();
    const message = draftMessage.trim();
    if (!offeredItem || !message || isOwnPost) return;
    addExchangeApplication(post.id, { offeredItem, message });
    keyboard.hide();
    setDraftOfferedItem("");
    setDraftMessage("");
    setSubmitMessage("교환 신청을 보냈어요.");
  };

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="exchange-detail-page" aria-label={`${post.title} 교환 상세`}>
        <article className="exchange-detail-article">
          <div className="exchange-detail-meta">
            <span>{categoryLabel(post.categoryId)} · {ip?.nameKo ?? "작품 미지정"}</span>
            <small>{post.time}</small>
          </div>

          <div className="exchange-detail-author">
            <span aria-hidden="true"><IconPerson2Line size={20} /></span>
            <div><strong>{post.author}</strong><small>DABBOBA 교환방</small></div>
          </div>

          <h1>{post.title}</h1>
          <div className="exchange-pair-detail" aria-label={`올린 상품 ${post.offeredItem}, 원하는 교환 ${post.wantedItem}`}>
            <div><small>올린 상품</small><strong>{post.offeredItem}</strong></div>
            <span aria-hidden="true">↕</span>
            <div><small>원하는 교환품</small><strong>{post.wantedItem}</strong></div>
          </div>
          <p>{post.body}</p>

          <div className="exchange-detail-actions" aria-label="교환 신청 현황">
            <span><IconDot3HorizontalChatbubbleLeftLine size={19} aria-hidden="true" /> 교환 신청 {applicationCount}건</span>
            <span>교환 가능</span>
          </div>
        </article>

        <section className="exchange-application-section" aria-labelledby="exchange-application-title">
          <div className="exchange-application-heading">
            <h2 id="exchange-application-title">교환 신청 {applicationCount}</h2>
            <span>제안 상품을 확인해 보세요</span>
          </div>

          <div className="exchange-application-list">
            {applications.length > 0 ? applications.map((application) => (
              <article key={application.id} className="exchange-application">
                <div className="exchange-application-avatar" aria-hidden="true">{application.author.slice(0, 1)}</div>
                <div>
                  <header><strong>{application.author}</strong><small>{application.time}</small></header>
                  <span>제안 상품</span>
                  <b>{application.offeredItem}</b>
                  <p>{application.message}</p>
                </div>
              </article>
            )) : (
              <div className="exchange-application-empty">
                <IconDot3HorizontalChatbubbleLeftLine size={28} aria-hidden="true" />
                <strong>아직 교환 신청이 없어요.</strong>
                <span>첫 교환을 제안해 보세요.</span>
              </div>
            )}
          </div>

          {applicationCount > applications.length ? (
            <p className="exchange-application-disclosure">현재 화면에는 확인용 예시 신청 일부만 표시됩니다.</p>
          ) : null}

          {isOwnPost ? (
            <p className="exchange-owner-notice" role="status">내가 올린 교환 글입니다. 받은 신청을 확인해 주세요.</p>
          ) : (
            <form className="exchange-application-form" onSubmit={(event) => { event.preventDefault(); submitApplication(); }}>
              <label htmlFor="exchange-offered-item">내가 제안할 상품</label>
              <KeyboardInput
                id="exchange-offered-item"
                value={draftOfferedItem}
                maxLength={60}
                placeholder="교환으로 제안할 상품을 적어주세요"
                onChange={(event) => {
                  setDraftOfferedItem(event.currentTarget.value);
                  setSubmitMessage("");
                }}
                onBlur={() => keyboard.hide()}
              />
              <label htmlFor="exchange-application-message">신청 메시지</label>
              <KeyboardTextarea
                id="exchange-application-message"
                value={draftMessage}
                maxLength={300}
                placeholder="상품 상태와 교환 방법을 간단히 알려주세요."
                onChange={(event) => {
                  setDraftMessage(event.currentTarget.value);
                  setSubmitMessage("");
                }}
                onBlur={() => keyboard.hide()}
              />
              <div>
                <small>{draftMessage.length}/300</small>
                <ActionButton
                  type="submit"
                  variant="brandSolid"
                  size="medium"
                  disabled={!draftOfferedItem.trim() || !draftMessage.trim()}
                  onPointerDown={(event) => event.preventDefault()}
                >
                  교환 신청하기
                </ActionButton>
              </div>
            </form>
          )}
          {submitMessage ? <p className="exchange-application-status" role="status">{submitMessage}</p> : null}
        </section>

        <p className="prototype-disclosure exchange-detail-disclosure">
          교환 글과 신청은 화면 확인용 테스트 데이터이며 새로고침하면 작성 내용이 초기화됩니다.
        </p>
      </main>
    </MobileScroll>
  );
}

function ShopPage({ flow }: { flow: FlowControls }) {
  const [filter, setFilter] = useState<CategoryFilter>("전체");
  const [query, setQuery] = useState("");
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const normalizedQuery = normalizeCatalogSearch(query);
  const visibleProducts = useMemo(() => products.filter((product) => (
    (filter === "전체" || product.category === filter) &&
    (!normalizedQuery || productSearchIndex.get(product.id)?.includes(normalizedQuery))
  )), [filter, normalizedQuery]);

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="root-tab-page shop-page" aria-label="DABBOBA 뽀바">
        <section className="shop-lead" aria-labelledby="shop-lead-title">
          <h1 id="shop-lead-title">원하는 방식으로 골라보세요.</h1>
          <p>가챠, 피규어, 쿠지, 카드를 한곳에서 확인할 수 있어요.</p>
        </section>
        <div className="shop-search-box ip-search-box">
          <IconMagnifyingglassLine size={21} aria-hidden="true" />
          <KeyboardInput
            type="search"
            value={query}
            placeholder="상품명·작품 IP 검색"
            aria-label="뽀바 상품 검색"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onBlur={() => keyboard.hide()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                keyboard.hide();
              }
            }}
          />
          {query ? (
            <button type="button" className="ip-search-clear" onClick={() => setQuery("")} aria-label="상품 검색어 지우기">
              <IconXmarkLine size={19} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Carousel className="category-carousel shop-category-carousel" contentClassName="category-rail" ariaLabel="뽀바 카테고리">
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
            <span aria-live="polite">{visibleProducts.length}개</span>
          </div>
          {visibleProducts.length > 0 ? (
            <ProductGrid flow={flow} items={visibleProducts} />
          ) : (
            <div className="ip-empty-state shop-empty-state" role="status">
              <IconMagnifyingglassLine size={30} aria-hidden="true" />
              <strong>찾는 상품이 없어요</strong>
              <span>검색어나 카테고리를 바꿔보세요.</span>
            </div>
          )}
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

function CustomerCenterPage({ flow }: { flow: FlowControls }) {
  const screenFocusRef = useScreenEntryFocus();

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main ref={screenFocusRef} tabIndex={-1} className="customer-center-page" aria-label="고객센터">
        <section className="customer-center-lead">
          <span>VOICE DESK</span>
          <h1>찾는 상품을<br />DABBOBA에 알려주세요.</h1>
          <p>원하는 카테고리와 작품 IP, 상품을 남기면 다른 이용자의 관심도 함께 확인할 수 있어요.</p>
        </section>

        <button type="button" className="request-room-entry" onClick={() => flow.push(createRequestRoomScreen())}>
          <span aria-hidden="true"><IconPlusLine size={23} /></span>
          <div><strong>신청방</strong><small>가챠 · 카드 · 피규어 · 쿠지 입고 요청</small></div>
          <IconChevronRightLine size={22} aria-hidden="true" />
        </button>

        <section className="customer-center-guide" aria-label="신청방 이용 안내">
          <h2>신청방 이용 안내</h2>
          <ol>
            <li><span>01</span><p>카테고리와 작품 IP를 선택해 주세요.</p></li>
            <li><span>02</span><p>원하는 상품명을 구체적으로 적어주세요.</p></li>
            <li><span>03</span><p>같은 상품을 원하는 사람은 좋아요로 관심을 모을 수 있어요.</p></li>
          </ol>
        </section>
        <p className="prototype-disclosure">신청 내용과 좋아요는 현재 화면 확인용 데이터이며 실제 입고를 보장하지 않습니다.</p>
      </main>
    </MobileScroll>
  );
}

function RequestRoomPage({ flow }: { flow: FlowControls }) {
  const {
    isAuthenticated,
    authIntent,
    setAuthIntent,
    requestComposerRequested,
    setRequestComposerRequested,
    productRequests,
    addProductRequest,
    likedProductRequestIds,
    toggleProductRequestLike,
  } = useDabboba();
  const keyboard = useKeyboard();
  const screenFocusRef = useScreenEntryFocus();
  const [filter, setFilter] = useState<RequestFilter>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftCategoryId, setDraftCategoryId] = useState<ProductCategoryId>(REQUEST_CATEGORY_IDS[0] ?? "gacha");
  const [draftIpId, setDraftIpId] = useState(IP_CATALOG[0]?.id ?? "one-piece");
  const [draftDesiredItem, setDraftDesiredItem] = useState("");
  const [draftDetails, setDraftDetails] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const visibleRequests = filter === "all"
    ? productRequests
    : productRequests.filter((request) => request.categoryId === filter);

  useEffect(() => {
    if (!isAuthenticated || !requestComposerRequested) return;
    setRequestComposerRequested(false);
    setComposerOpen(true);
  }, [isAuthenticated, requestComposerRequested, setRequestComposerRequested]);

  const requestAccess = (intent: Extract<AuthIntent, { kind: "request-compose" | "request-like" }>) => {
    if (isAuthenticated) {
      if (intent.kind === "request-compose") setComposerOpen(true);
      else toggleProductRequestLike(intent.requestId);
      return;
    }
    keyboard.hide();
    setAuthIntent(intent);
  };

  const handleComposerOpenChange = (open: boolean) => {
    if (!open) keyboard.hide();
    setComposerOpen(open);
  };

  const submitRequest = () => {
    const desiredItem = draftDesiredItem.trim();
    const details = draftDetails.trim();
    if (!desiredItem || !details) return;
    addProductRequest({
      categoryId: draftCategoryId,
      ipId: draftIpId,
      desiredItem,
      details,
    });
    keyboard.hide();
    setDraftDesiredItem("");
    setDraftDetails("");
    setFilter("all");
    setComposerOpen(false);
    setSubmitMessage("상품 신청을 등록했어요.");
  };

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="request-room-page" aria-label="상품 신청방">
          <section className="request-room-lead">
            <span>WISH BOARD</span>
            <h1>어떤 상품을<br />만나고 싶나요?</h1>
            <p>원하는 굿즈를 신청하고, 같은 상품을 기다리는 사람과 좋아요를 모아보세요.</p>
          </section>

          <button type="button" className="request-composer-callout" onClick={() => requestAccess({ kind: "request-compose" })}>
            <span aria-hidden="true"><IconPencilLine size={21} /></span>
            <div><strong>원하는 상품 신청하기</strong><small>카테고리 · 작품 IP · 상품명을 알려주세요.</small></div>
            <IconChevronRightLine size={21} aria-hidden="true" />
          </button>
          {submitMessage ? <p className="request-submit-status" role="status">{submitMessage}</p> : null}

          <Carousel className="request-filter-carousel" contentClassName="request-filter-rail" ariaLabel="신청 상품 카테고리">
            <button
              type="button"
              className="filter-chip"
              data-selected={filter === "all" ? "true" : "false"}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              전체
            </button>
            {REQUEST_CATEGORY_IDS.map((categoryId) => (
              <button
                key={categoryId}
                type="button"
                className="filter-chip"
                data-selected={filter === categoryId ? "true" : "false"}
                aria-pressed={filter === categoryId}
                onClick={() => setFilter(categoryId)}
              >
                {categoryLabel(categoryId)}
              </button>
            ))}
          </Carousel>

          <section className="request-list" aria-labelledby="request-list-title">
            <div className="section-heading">
              <h2 id="request-list-title">모인 신청</h2>
              <span>{visibleRequests.length}개</span>
            </div>
            {visibleRequests.map((request) => {
              const ip = IP_CATALOG.find((item) => item.id === request.ipId);
              const liked = likedProductRequestIds.has(request.id);
              return (
                <article key={request.id} className="request-card">
                  {ip ? <img src={ip.image} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="request-card-image-placeholder" aria-hidden="true" />}
                  <div className="request-card-copy">
                    <div><span>{categoryLabel(request.categoryId)}</span><small>{request.author} · {request.time}</small></div>
                    <em>{ip?.nameKo ?? "작품 미지정"}</em>
                    <h3>{request.desiredItem}</h3>
                    <p>{request.details}</p>
                    <button
                      type="button"
                      aria-label={liked ? `${request.desiredItem} 좋아요 취소` : `${request.desiredItem} 좋아요`}
                      aria-pressed={liked}
                      onClick={() => requestAccess({ kind: "request-like", requestId: request.id })}
                    >
                      {liked ? <IconHeartFill size={18} aria-hidden="true" /> : <IconHeartLine size={18} aria-hidden="true" />}
                      <span>같이 원해요 {request.likes + (liked ? 1 : 0)}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
          <p className="prototype-disclosure request-room-disclosure">신청과 좋아요는 화면 확인용 테스트 데이터이며 새로고침하면 초기화됩니다.</p>
        </main>
      </MobileScroll>

      {!isAuthenticated && (authIntent?.kind === "request-compose" || authIntent?.kind === "request-like") ? (
        <GuestAuthPrompt
          intent={authIntent}
          onDismiss={() => setAuthIntent(null)}
          onLogin={() => flow.push(createLoginScreen())}
        />
      ) : null}

      <BottomSheet
        open={composerOpen}
        onOpenChange={handleComposerOpenChange}
        title="상품 신청하기"
        description="DABBOBA에서 만나고 싶은 상품을 알려주세요."
        snap={0.86}
      >
        <div className="request-compose-form">
          <div className="compose-category-list" role="radiogroup" aria-label="신청 카테고리">
            {REQUEST_CATEGORY_IDS.map((categoryId, index) => (
              <button
                key={categoryId}
                type="button"
                role="radio"
                aria-checked={draftCategoryId === categoryId}
                tabIndex={draftCategoryId === categoryId ? 0 : -1}
                data-selected={draftCategoryId === categoryId ? "true" : "false"}
                onKeyDown={(event) => handleRadioArrow(event, REQUEST_CATEGORY_IDS, index, setDraftCategoryId)}
                onClick={() => setDraftCategoryId(categoryId)}
              >
                {categoryLabel(categoryId)}
              </button>
            ))}
          </div>
          <label>
            <span>작품 IP</span>
            <select value={draftIpId} onChange={(event) => setDraftIpId(event.currentTarget.value)}>
              {IP_CATALOG.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo}</option>)}
            </select>
          </label>
          <label>
            <span>원하는 상품</span>
            <KeyboardInput
              value={draftDesiredItem}
              maxLength={70}
              placeholder="상품명, 캐릭터, 에디션 등을 적어주세요"
              onChange={(event) => setDraftDesiredItem(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <label>
            <span>신청 내용</span>
            <KeyboardTextarea
              value={draftDetails}
              maxLength={300}
              placeholder="원하는 크기, 버전, 판매 방식 등을 알려주세요."
              onChange={(event) => setDraftDetails(event.currentTarget.value)}
              onBlur={() => keyboard.hide()}
            />
          </label>
          <ActionButton
            type="button"
            variant="brandSolid"
            size="large"
            className="sheet-primary-button"
            disabled={!draftDesiredItem.trim() || !draftDetails.trim()}
            onPointerDown={(event) => event.preventDefault()}
            onClick={submitRequest}
          >
            신청 등록하기
          </ActionButton>
        </div>
      </BottomSheet>
    </>
  );
}

function ProfilePage({ flow }: { flow: FlowControls }) {
  const { pointBalance, exchangePosts, profile, profileSaveNotice, setProfileSaveNotice } = useDabboba();
  const screenFocusRef = useScreenEntryFocus();
  const [profileMessage, setProfileMessage] = useState("");
  const myPostCount = exchangePosts.filter((post) => post.id.startsWith("exchange-user-")).length;
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
          <div><strong>{myPostCount}</strong><span>교환글</span></div>
        </section>

        <section className="profile-menu" aria-label="프로필 메뉴">
          {menus.map((menu) => (
            <button
              key={menu}
              type="button"
              onClick={() => {
                setProfileSaveNotice("");
                if (menu === "고객센터") {
                  flow.push(createCustomerCenterScreen());
                  return;
                }
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
  const { setActiveRootTab } = useDabboba();

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

  if (tab === "스냅") {
    return (
      <div className="ip-empty-state ip-tab-empty">
        <IconCameraLine size={32} aria-hidden="true" />
        <strong>아직 등록된 스냅이 없어요</strong>
        <span>수집 사진과 후기 기능은 다음 단계에서 연결됩니다.</span>
      </div>
    );
  }

  return (
    <div className="ip-empty-state ip-tab-empty">
      <IconDot3HorizontalChatbubbleLeftLine size={32} aria-hidden="true" />
      <strong>{ip.nameKo} 교환을 찾아보세요</strong>
      <span>교환방에서 올린 상품과 원하는 교환품을 한 번에 확인할 수 있어요.</span>
      <button
        type="button"
        className="ip-exchange-link"
        onClick={() => {
          setActiveRootTab("community");
          flow.replace(createExchangeRoomScreen());
        }}
      >
        교환방으로 이동
      </button>
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
      if (drawMode) prepareDraw(quantity);
      flow.replace(createPurchaseCompleteScreen(product, quantity, total));
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
  const drawMode = isRandomDrawCategory(product.categoryId);
  const drawActionLabel = product.categoryId === "gacha" ? "가챠하러 가기" : "쿠지 추첨하러 가기";

  return (
    <MobileScroll className="app-screen dabboba-screen">
      <main
        ref={screenFocusRef}
        tabIndex={-1}
        className="purchase-complete-page"
        aria-label={drawMode ? `${product.line} 결제 완료` : "일반 상품 주문 완료"}
      >
        <section className="purchase-complete-heading">
          <span><IconCheckmarkCircleFill size={36} aria-hidden="true" /></span>
          <h1>{drawMode ? "결제가 완료됐어요." : "구매가 완료됐어요."}</h1>
          <p>
            {drawMode
              ? `${product.category} · ${quantity}${unit} 이용권이 준비됐습니다.`
              : `${product.category} · ${quantity}${unit} 구매 내역이 준비됐습니다.`}
          </p>
        </section>

        <section className="purchase-complete-product" aria-labelledby="purchase-complete-product-title">
          <h2 id="purchase-complete-product-title">{drawMode ? "결제 상품" : "주문 상품"}</h2>
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
          <div><dt>{drawMode ? "결제 상태" : "주문 상태"}</dt><dd>결제 완료</dd></div>
          <div><dt>{drawMode ? "이용 상태" : "배송 상태"}</dt><dd>{drawMode ? "뽑기 대기" : "배송 신청 전"}</dd></div>
          <div><dt>테스트 {drawMode ? "결제" : "주문"}번호</dt><dd>{orderCode}</dd></div>
        </dl>

        <div className="purchase-complete-note">
          {drawMode ? <IconReceiptLine size={21} aria-hidden="true" /> : <IconTruckLine size={21} aria-hidden="true" />}
          <span>
            {drawMode
              ? `아직 상품은 확정되지 않았어요. 아래 ${drawActionLabel} 버튼을 눌러 뽑기를 진행해 주세요.`
              : "배송지 입력과 실제 주문 접수는 정식 결제·배송 시스템 연결 후 제공됩니다."}
          </span>
        </div>
        <p className="prototype-disclosure">
          현재 화면은 {drawMode ? "결제·뽑기" : "구매"} 흐름 확인용이며 실제 결제{drawMode ? "" : "·주문·배송"}는 발생하지 않았습니다.
        </p>
      </main>
    </MobileScroll>
  );
}

function PurchaseCompleteFooter({
  flow,
  product,
  quantity,
}: {
  flow: FlowControls;
  product: Product;
  quantity: number;
}) {
  const drawMode = isRandomDrawCategory(product.categoryId);
  const drawActionLabel = product.categoryId === "gacha" ? "가챠하러 가기" : "쿠지 추첨하러 가기";

  return (
    <div className="route-footer purchase-complete-footer">
      <ActionButton
        type="button"
        variant="brandSolid"
        size="large"
        className="primary-action"
        onClick={() => {
          if (drawMode) {
            flow.replace(createDrawScreen(product, quantity));
            return;
          }
          returnToCatalog(flow);
        }}
      >
        {drawMode ? drawActionLabel : "상품 목록으로"}
      </ActionButton>
    </div>
  );
}

const CAPSULE_CINEMATIC_SCRUB_END = 0.7;

function CapsuleDrawAnimation({ state, controlProgress }: { state: DrawState; controlProgress: number }) {
  const cinematicRef = useRef<HTMLVideoElement | null>(null);
  const crankAngle = controlProgress * 360;
  const cinematicActive = state === "drawing" || state === "result";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const syncCinematic = useCallback((video: HTMLVideoElement) => {
    if (video.readyState === 0) return;

    if (state === "drawing") {
      if (reducedMotion) {
        video.pause();
        if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.04);
        return;
      }

      if (
        video.ended
        || video.currentTime < CAPSULE_CINEMATIC_SCRUB_END - 0.08
        || video.currentTime > CAPSULE_CINEMATIC_SCRUB_END + 0.24
      ) {
        video.currentTime = CAPSULE_CINEMATIC_SCRUB_END;
      }
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
    if (state === "result" && Number.isFinite(video.duration)) {
      video.currentTime = Math.max(0, video.duration - 0.04);
    }
  }, [reducedMotion, state]);

  useEffect(() => {
    if (cinematicRef.current) syncCinematic(cinematicRef.current);
  }, [syncCinematic]);

  return (
    <div
      className="capsule-animation"
      data-state={state}
      style={{
        "--crank-drag-angle": `${crankAngle}deg`,
      } as CSSProperties}
      aria-hidden="true"
    >
      {cinematicActive ? (
        <video
          ref={cinematicRef}
          className="capsule-cinematic"
          src="/assets/dabboba/video/dabboba-capsule-lower-chute.mp4"
          poster="/assets/dabboba/video/dabboba-capsule-machine-poster.jpg"
          muted
          playsInline
          preload="auto"
          controls={false}
          disablePictureInPicture
          onLoadedMetadata={(event) => syncCinematic(event.currentTarget)}
        />
      ) : (
        <div className="capsule-ready-cinematic">
          <div className="capsule-ready-machine">
            <img
              className="capsule-ready-machine-art"
              src="/assets/dabboba/capsule-machine-front-pixel.png"
              alt=""
              draggable={false}
              decoding="async"
            />
            <img
              className="capsule-ready-crank-plate"
              src="/assets/dabboba/capsule-crank-plate-pixel.png"
              alt=""
              draggable={false}
              decoding="async"
            />
            <img
              className="capsule-ready-crank-handle"
              src="/assets/dabboba/capsule-crank-pixel.png"
              alt=""
              draggable={false}
              decoding="async"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DrawPage({ product, quantity }: { product: Product; quantity: number }) {
  const { drawState, drawRemaining, drawControlProgress } = useDabboba();
  const [oddsOpen, setOddsOpen] = useState(false);
  const screenFocusRef = useScreenEntryFocus();
  const unit = commerceUnit(product);
  const drawLabel = product.categoryId === "kuji" ? "쿠지 추첨" : "가챠 뽑기";
  const prizeGuide = prizeGuideFor(product.categoryId);

  return (
    <>
      <MobileScroll className="app-screen dabboba-screen">
        <main ref={screenFocusRef} tabIndex={-1} className="draw-page" data-state={drawState} aria-label={`${product.line} ${drawLabel}`}>
          <div className="paid-ticket">
            <IconCheckmarkCircleFill size={22} aria-hidden="true" />
            <div>
              <strong>{product.categoryId === "gacha" ? "가챠 준비 완료" : "쿠지 준비 완료"}</strong>
              <span>{quantity}{unit} 추첨권이 준비됐어요</span>
            </div>
          </div>

          <div className="draw-heading">
            <span>{product.edition}</span>
            <h1>{product.line}</h1>
            <p>
              {product.categoryId === "gacha"
                ? "하단 바를 끝까지 밀면 레버가 돌아가고 뽑기가 시작돼요."
                : `${drawLabel} 버튼을 눌러 추첨을 시작하세요.`}
            </p>
          </div>

          <section className="arcade-stage" data-state={drawState} aria-label={`DABBOBA 오락실 ${drawLabel} 기계`}>
            {product.categoryId === "gacha" ? (
              <CapsuleDrawAnimation state={drawState} controlProgress={drawControlProgress} />
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
                : drawState === "transitioning" ? "SYSTEM ON"
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
    drawControlProgress,
    setDrawControlProgress,
  } = useDabboba();
  const drawTimer = useRef<number | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const activationLockRef = useRef(false);
  const sliderTrackRef = useRef<HTMLDivElement | null>(null);
  const sliderThumbRef = useRef<HTMLButtonElement | null>(null);
  const [sliderX, setSliderX] = useState(0);
  const unit = commerceUnit(product);
  const drawNoun = product.categoryId === "kuji" ? "쿠지" : "뽑기";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drawDuration = product.categoryId === "gacha"
    ? reducedMotion ? 420 : 3_350
    : 1_250;

  useEffect(() => () => {
    if (drawTimer.current !== null) window.clearTimeout(drawTimer.current);
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
  }, []);

  const resetSlider = useCallback(() => {
    activationLockRef.current = false;
    setSliderX(0);
    setDrawControlProgress(0);
  }, [setDrawControlProgress]);

  useEffect(() => {
    if (drawState === "ready") resetSlider();
  }, [drawState, resetSlider]);

  const finishDraw = useCallback(() => {
      setResultGrade(rollPrizeGrade());
      setDrawRemaining((current) => Math.max(0, current - 1));
      setDrawState("result");
      setResultOpen(true);
      drawTimer.current = null;
  }, [setDrawRemaining, setDrawState, setResultGrade, setResultOpen]);

  const startDraw = useCallback(() => {
    if (activationLockRef.current || drawState === "transitioning" || drawState === "drawing" || drawRemaining < 1) return;
    activationLockRef.current = true;

    if (product.categoryId === "gacha") {
      setDrawState("transitioning");
      transitionTimer.current = window.setTimeout(() => {
        setDrawState("drawing");
        transitionTimer.current = null;
        drawTimer.current = window.setTimeout(finishDraw, drawDuration);
      }, reducedMotion ? 40 : 400);
      return;
    }

    setDrawState("drawing");
    drawTimer.current = window.setTimeout(finishDraw, drawDuration);
  }, [drawDuration, drawRemaining, drawState, finishDraw, product.categoryId, reducedMotion, setDrawState]);

  const getSliderGeometry = useCallback(() => {
    const track = sliderTrackRef.current;
    const thumb = sliderThumbRef.current;
    const sliderStartInset = 16;
    const sliderEndInset = 4;
    const localMax = Math.max(
      1,
      (track?.offsetWidth ?? 0) - (thumb?.offsetWidth ?? 52) - sliderStartInset - sliderEndInset,
    );
    const visualScale = track?.offsetWidth ? track.getBoundingClientRect().width / track.offsetWidth : 1;

    return {
      localMax,
      visualMax: Math.max(1, localMax * visualScale),
    };
  }, []);

  const completeSlider = useCallback(() => {
    if (drawState !== "ready" || drawRemaining < 1) return;
    const { localMax } = getSliderGeometry();
    setSliderX(localMax);
    setDrawControlProgress(1);
    startDraw();
  }, [drawRemaining, drawState, getSliderGeometry, setDrawControlProgress, startDraw]);

  const bindSlider = useDrag(
    (gesture) => {
      gesture.event.stopPropagation();
      if (product.categoryId !== "gacha" || drawState !== "ready" || drawRemaining < 1) return;
      const { localMax, visualMax } = getSliderGeometry();
      const nextProgress = Math.max(0, Math.min(1, gesture.movement[0] / visualMax));
      const nextX = localMax * nextProgress;

      setSliderX(nextX);
      setDrawControlProgress(nextProgress);

      if (!gesture.last) return;
      if (nextProgress >= 0.92) {
        setSliderX(localMax);
        setDrawControlProgress(1);
        startDraw();
      } else {
        resetSlider();
      }
    },
    {
      axis: "x",
      eventOptions: { capture: true, passive: false },
      filterTaps: true,
      pointer: { touch: true },
    },
  );

  const handleSliderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (drawState !== "ready" || drawRemaining < 1) return;
    if (["Enter", " ", "End"].includes(event.key)) {
      event.preventDefault();
      completeSlider();
      return;
    }
    if (!["ArrowRight", "ArrowLeft", "Home"].includes(event.key)) return;
    event.preventDefault();
    const currentProgress = event.key === "Home"
      ? 0
      : Math.max(0, Math.min(1, drawControlProgress + (event.key === "ArrowRight" ? 0.1 : -0.1)));
    setDrawControlProgress(currentProgress);
    setSliderX(getSliderGeometry().localMax * currentProgress);
    if (currentProgress >= 1) completeSlider();
  };

  const handleResultOpen = (open: boolean) => {
    setResultOpen(open);
    if (!open && drawRemaining > 0) {
      resetSlider();
      setDrawState("ready");
    }
    if (!open && drawRemaining < 1) {
      resetSlider();
      setDrawState("done");
      returnToCatalog(flow);
    }
  };

  const nextAction = () => {
    setResultOpen(false);
    if (drawRemaining > 0) {
      resetSlider();
      setDrawState("ready");
      return;
    }
    resetSlider();
    setDrawState("done");
    returnToCatalog(flow);
  };

  return (
    <>
      <div className="route-footer draw-footer" data-state={drawState}>
        {product.categoryId === "gacha" ? (
          <div
            ref={sliderTrackRef}
            className="draw-slider"
            data-state={drawState}
            style={{ "--draw-slider-progress": drawControlProgress } as CSSProperties}
          >
            <span className="draw-slider-fill" style={{ width: `${Math.max(7, drawControlProgress * 100)}%` }} />
            <span className="draw-slider-copy" aria-hidden="true">
              {drawState === "transitioning" ? "ARCADE LOADING" : drawState === "drawing" ? "CAPSULE RUN" : drawRemaining > 0 ? "밀어서 뽑기" : "뽑기 완료"}
            </span>
            <button
              {...bindSlider()}
              ref={sliderThumbRef}
              type="button"
              role="slider"
              className="draw-slider-thumb"
              style={{ transform: `translate3d(${sliderX}px, 0, 0)` }}
              aria-label="밀어서 가챠 뽑기"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(drawControlProgress * 100)}
              aria-valuetext={`${Math.round(drawControlProgress * 100)}% 진행`}
              aria-disabled={drawState !== "ready" || drawRemaining < 1}
              onKeyDown={handleSliderKeyDown}
            >
              <span aria-hidden="true">››</span>
            </button>
          </div>
        ) : (
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
        )}
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
