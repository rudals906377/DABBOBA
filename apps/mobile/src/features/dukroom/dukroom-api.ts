import { randomUUID } from "expo-crypto";
import { createDabbobaClient, errorMessage } from "@dabboba/api-client";
import type { CatalogIp, CatalogProduct, components } from "@dabboba/contracts";

type CommunityPost = components["schemas"]["CommunityPost"];
export type CommunityComment = components["schemas"]["Comment"];

export type DukroomItem = {
  post: CommunityPost;
  isExample: boolean;
  ipName: string | null;
  imageUrl: string | null;
  imageVersion?: number;
  linkedProductId: string | null;
};

export type DukroomSnapshot = {
  items: DukroomItem[];
  ips: CatalogIp[];
  fetchedAt: string;
};

export type DukroomDetailSnapshot = {
  item: DukroomItem;
  comments: CommunityComment[];
};

type DukroomCatalog = {
  ips: CatalogIp[];
  products: CatalogProduct[];
};

const EXAMPLE_PREFIX = "example__dukroom__";
const EXAMPLE_AUTHORS = ["굿즈정리중", "책상위작은방", "캡슐수집가", "오늘의덕질"] as const;
const EXAMPLE_TITLES = [
  "오늘 다시 정리한 최애 진열장",
  "작은 선반에 모아본 한 작품 굿즈",
  "빛이 예뻐서 남긴 오늘의 수집 사진",
  "중복 없이 차근차근 채운 컬렉션",
  "책상 한쪽을 최애 공간으로 바꿨어요",
  "주말에 꺼내본 오래된 소장품",
  "같은 색감으로 모아본 미니 굿즈",
  "배송 온 날 바로 남기는 첫 사진",
] as const;

export async function fetchDukroomSnapshot(
  apiBaseUrl: string,
  accessToken?: string,
): Promise<DukroomSnapshot> {
  const client = dabbobaClient(apiBaseUrl, accessToken);
  const [postResult, ipResult, productResult] = await Promise.all([
    client.GET("/v1/community/posts", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/products", { params: { query: { limit: 100 } } }),
  ]);
  if (!postResult.data) throw new Error(errorMessage(postResult.error, "덕룸 글을 불러오지 못했습니다."));
  if (!ipResult.data || !productResult.data) {
    throw new Error(errorMessage(ipResult.error ?? productResult.error, "덕룸 작품 정보를 불러오지 못했습니다."));
  }

  const ips = ipResult.data.items;
  const products = productResult.data.items;
  const items = await createDukroomItems(client, postResult.data.items, { ips, products }, 30, 8);

  return {
    items,
    ips,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchDukroomHomePreview(
  apiBaseUrl: string,
  catalog: DukroomCatalog,
  accessToken?: string,
): Promise<DukroomItem[]> {
  const client = dabbobaClient(apiBaseUrl, accessToken);
  const postResult = await client.GET("/v1/community/posts", { params: { query: { limit: 12 } } });
  if (!postResult.data) throw new Error(errorMessage(postResult.error, "홈 덕룸을 불러오지 못했습니다."));
  return createDukroomItems(client, postResult.data.items, catalog, 4, 4);
}

export async function fetchDukroomDetail(
  apiBaseUrl: string,
  postId: string,
  accessToken?: string,
): Promise<DukroomDetailSnapshot> {
  const client = dabbobaClient(apiBaseUrl, accessToken);
  const [ipResult, productResult] = await Promise.all([
    client.GET("/v1/catalog/ips", { params: { query: { limit: 100 } } }),
    client.GET("/v1/catalog/products", { params: { query: { limit: 100 } } }),
  ]);
  if (!ipResult.data || !productResult.data) {
    throw new Error(errorMessage(ipResult.error ?? productResult.error, "덕룸 작품 정보를 불러오지 못했습니다."));
  }

  if (postId.startsWith(EXAMPLE_PREFIX)) {
    const item = createExampleItems(productResult.data.items, ipResult.data.items)
      .find((candidate) => candidate.post.id === postId);
    if (!item) throw new Error("덕룸 예시 글을 찾을 수 없습니다.");
    return { item, comments: createExampleComments(item.post.id) };
  }

  const [postResult, commentResult] = await Promise.all([
    client.GET("/v1/community/posts/{postId}", { params: { path: { postId } } }),
    client.GET("/v1/community/posts/{postId}/comments", {
      params: { path: { postId }, query: { limit: 100 } },
    }),
  ]);
  if (!postResult.data) throw new Error(errorMessage(postResult.error, "덕룸 글을 불러오지 못했습니다."));
  if (!commentResult.data) throw new Error(errorMessage(commentResult.error, "댓글을 불러오지 못했습니다."));

  const post = postResult.data;
  const fallbackProduct = productResult.data.items.find((product) => product.ipId === post.ipId) ?? null;
  return {
    item: {
      post,
      isExample: false,
      ipName: post.ipId ? ipResult.data.items.find((ip) => ip.id === post.ipId)?.nameKo ?? null : null,
      imageUrl: post.mediaIds[0]
        ? await fetchPublicMediaUrl(client, post.mediaIds[0])
        : fallbackProduct?.imageUrl ?? null,
      imageVersion: fallbackProduct?.version,
      linkedProductId: fallbackProduct?.id ?? null,
    },
    comments: commentResult.data.items,
  };
}

export async function setDukroomLike(
  apiBaseUrl: string,
  accessToken: string,
  postId: string,
  liked: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
  const client = dabbobaClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/community/posts/{postId}/like", {
    params: {
      path: { postId },
      header: { "Idempotency-Key": randomUUID() },
    },
    body: { liked },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "좋아요를 저장하지 못했습니다."));
  return result.data;
}

export async function createDukroomComment(
  apiBaseUrl: string,
  accessToken: string,
  postId: string,
  content: string,
): Promise<CommunityComment> {
  const client = dabbobaClient(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/community/posts/{postId}/comments", {
    params: { path: { postId } },
    body: { content },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "댓글을 등록하지 못했습니다."));
  return result.data;
}

function dabbobaClient(apiBaseUrl: string, accessToken?: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    ...(accessToken ? { token: () => accessToken } : {}),
  });
}

async function fetchPublicMediaUrl(
  client: ReturnType<typeof createDabbobaClient>,
  mediaId: string,
): Promise<string | null> {
  const result = await client.GET("/v1/media/{mediaId}/public-url", {
    params: { path: { mediaId } },
  });
  return result.data?.url ?? null;
}

async function createDukroomItems(
  client: ReturnType<typeof createDabbobaClient>,
  posts: CommunityPost[],
  catalog: DukroomCatalog,
  actualLimit: number,
  fillTo: number,
): Promise<DukroomItem[]> {
  const ipNames = new Map(catalog.ips.map((ip) => [ip.id, ip.nameKo]));
  const visiblePosts = posts
    .filter((post) => (post.kind === "DUKROOM" || post.kind === "SNAP") && !isLocalTestFixture(post))
    .slice(0, actualLimit);
  const actualItems = await Promise.all(visiblePosts.map(async (post) => {
    const fallbackProduct = catalog.products.find((product) => product.ipId === post.ipId) ?? null;
    return {
      post,
      isExample: false,
      ipName: post.ipId ? ipNames.get(post.ipId) ?? null : null,
      imageUrl: post.mediaIds[0]
        ? await fetchPublicMediaUrl(client, post.mediaIds[0])
        : fallbackProduct?.imageUrl ?? null,
      imageVersion: fallbackProduct?.version,
      linkedProductId: fallbackProduct?.id ?? null,
    } satisfies DukroomItem;
  }));
  const examples = createExampleItems(catalog.products, catalog.ips)
    .slice(0, Math.max(0, fillTo - actualItems.length));
  return [...actualItems, ...examples];
}

function createExampleItems(products: CatalogProduct[], ips: CatalogIp[]): DukroomItem[] {
  const ipNames = new Map(ips.map((ip) => [ip.id, ip.nameKo]));
  const now = Date.now();
  return products
    .filter((product) => product.imageUrl && product.isActive)
    .slice(0, 8)
    .map((product, index) => {
      const createdAt = new Date(now - (index + 1) * 3_600_000).toISOString();
      const kind: CommunityPost["kind"] = index % 3 === 2 ? "SNAP" : "DUKROOM";
      return {
        post: {
          id: `${EXAMPLE_PREFIX}${product.id}`,
          authorId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          authorNickname: EXAMPLE_AUTHORS[index % EXAMPLE_AUTHORS.length] ?? "다뽑아회원",
          ipId: product.ipId,
          kind,
          title: EXAMPLE_TITLES[index] ?? "오늘의 수집 기록",
          content: `${ipNames.get(product.ipId) ?? "좋아하는 작품"} 굿즈를 한자리에 모아봤어요. ${product.name}도 함께 두니 공간이 더 마음에 듭니다.`,
          status: "ACTIVE",
          reportCount: 0,
          commentCount: 2 + (index % 4),
          likeCount: 12 + index * 7,
          likedByViewer: false,
          mediaIds: [],
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
        isExample: true,
        ipName: ipNames.get(product.ipId) ?? null,
        imageUrl: product.imageUrl,
        imageVersion: product.version,
        linkedProductId: product.id,
      };
    });
}

function createExampleComments(postId: string): CommunityComment[] {
  const now = Date.now();
  return [
    { id: "30000000-0000-4000-8000-000000000001", postId, authorId: "30000000-0000-4000-8000-000000000011", authorNickname: "정리하는덕후", content: "진열 색감이 정말 잘 맞아요. 배치 참고하고 싶어요!", status: "ACTIVE", reportCount: 0, createdAt: new Date(now - 2_100_000).toISOString(), updatedAt: new Date(now - 2_100_000).toISOString() },
    { id: "30000000-0000-4000-8000-000000000002", postId, authorId: "30000000-0000-4000-8000-000000000012", authorNickname: "작은수집방", content: "같은 작품 모으는 분을 만나서 반가워요.", status: "ACTIVE", reportCount: 0, createdAt: new Date(now - 900_000).toISOString(), updatedAt: new Date(now - 900_000).toISOString() },
  ];
}

function isLocalTestFixture(post: CommunityPost): boolean {
  return (post.title.startsWith("경고 대상 Snap ") && post.authorNickname.startsWith("admin-flow-author-"))
    || post.title.startsWith("미디어 삭제 게시물 ");
}
