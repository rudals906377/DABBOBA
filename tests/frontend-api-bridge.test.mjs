import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DabbobaApiClient,
  parseNativeDeepLinkMessage,
  resolveApiRuntimeConfiguration,
  routeForWebPath,
  webPathForRoute,
} from "../src/services/dabbobaApi.ts";

const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
const apiServiceSource = readFileSync(new URL("../src/services/dabbobaApi.ts", import.meta.url), "utf8");

test("API runtime is explicitly prototype-only when no server URL is configured", () => {
  assert.deepEqual(resolveApiRuntimeConfiguration({}), {
    mode: "prototype",
    baseUrl: null,
    token: null,
  });
  assert.throws(
    () => resolveApiRuntimeConfiguration({ production: true }),
    /프로토타입 데이터는 개발·프리뷰에서만/,
  );
  assert.throws(
    () => resolveApiRuntimeConfiguration({ baseUrl: "http://public.example.test" }),
    /HTTPS 또는 로컬 HTTP/,
  );
  assert.throws(
    () => resolveApiRuntimeConfiguration({ baseUrl: "http://10.attacker.example" }),
    /HTTPS 또는 로컬 HTTP/,
  );
  assert.deepEqual(
    resolveApiRuntimeConfiguration({
      baseUrl: "http://192.168.0.18:8787/",
      token: " opaque-session ",
    }),
    {
      mode: "remote",
      baseUrl: "http://192.168.0.18:8787",
      token: "opaque-session",
    },
  );
  assert.throws(
    () => resolveApiRuntimeConfiguration({
      baseUrl: "https://api.dabboba.test",
      token: "must-not-ship",
      production: true,
    }),
    /정적으로 포함할 수 없습니다/,
  );
  assert.doesNotMatch(apiServiceSource, /VITE_DABBOBA_USER_TOKEN/);
});

test("every user write carries bearer identity, request correlation, and one idempotency key", async () => {
  const calls = [];
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: (() => {
      const ids = ["request-id-123456789", "generated-idempotency-123456789"];
      return () => ids.shift() ?? "fallback-id-123456789";
    })(),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "request-id" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.createCatalogRequest({ kind: "PRODUCT", name: "신규 상품" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.dabboba.test/v1/catalog/requests");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer opaque-user-token");
  assert.equal(calls[0].init.headers.get("x-request-id"), "request-id-123456789");
  assert.equal(calls[0].init.headers.get("idempotency-key"), "generated-idempotency-123456789");
});

test("protected writes never fall back to a fake success when a remote token is missing", async () => {
  let fetched = false;
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: null,
    },
    fetch: async () => {
      fetched = true;
      return new Response();
    },
  });

  await assert.rejects(
    () => client.createInquiry({ category: "OTHER", title: "문의", content: "내용" }),
    (error) => error.code === "AUTH_TOKEN_REQUIRED" && error.status === 401,
  );
  assert.equal(fetched, false);
});

test("catalog product and IP additions use the exact review request contract and stable retry key", async () => {
  const calls = [];
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: () => "catalog-request-correlation-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        kind: "IP",
        name: "새 작품",
        referenceUrl: "https://example.test/ip",
        description: "관리자 확인 요청",
        mediaId: null,
        status: "PENDING",
        canonicalTargetId: null,
        decisionReason: null,
        createdAt: "2026-08-24T00:00:00Z",
        updatedAt: "2026-08-24T00:00:00Z",
      }, { status: 201 });
    },
  });

  const created = await client.createCatalogRequest({
    kind: "IP",
    name: "새 작품",
    referenceUrl: "https://example.test/ip",
    description: "관리자 확인 요청",
  }, "catalog-review-retry-key");

  assert.equal(created.status, "PENDING");
  assert.equal(calls[0].url, "https://api.dabboba.test/v1/catalog/requests");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.get("idempotency-key"), "catalog-review-retry-key");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    kind: "IP",
    name: "새 작품",
    referenceUrl: "https://example.test/ip",
    description: "관리자 확인 요청",
  });
});

test("account writes use their contracted verbs and preserve a supplied retry key", async () => {
  const calls = [];
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: () => "request-correlation-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "result" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const retryKey = "same-user-action-key";
  await client.updateAccountProfile({ nickname: "다뽑러", expectedVersion: 2 }, retryKey);
  await client.upsertDefaultShippingAddress({
    recipient: "김다뽑",
    phone: "01012345678",
    postalCode: "04790",
    addressLine1: "서울특별시 성동구",
    expectedVersion: 3,
  }, retryKey);
  await client.addWishlistItem("product-1", retryKey);
  await client.removeWishlistItem("product-1", retryKey);
  await client.markAccountNotificationRead("22222222-2222-4222-8222-222222222222", retryKey);
  await client.createAccountShippingRequest(["11111111-1111-4111-8111-111111111111"], retryKey);

  assert.deepEqual(calls.map((call) => call.init.method), ["PATCH", "PUT", "POST", "DELETE", "POST", "POST"]);
  assert.ok(calls.every((call) => call.init.headers.get("idempotency-key") === retryKey));
  assert.ok(calls.every((call) => call.init.headers.get("authorization") === "Bearer opaque-user-token"));
});

test("community, wanted-room, exchange, inquiry, and order writes all carry idempotency keys", async () => {
  const calls = [];
  let sequence = 0;
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: () => `generated-request-key-${String(sequence += 1).padStart(4, "0")}`,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ id: "result" }, { status: 201 });
    },
  });

  await client.createInquiry({ category: "OTHER", title: "문의", content: "내용" });
  await client.createCommunityPost({ kind: "DUKROOM", ipId: "one-piece", title: "덕룸", content: "수집 기록" });
  await client.createReport({ targetType: "POST", targetId: "11111111-1111-4111-8111-111111111111", reason: "SPAM" });
  await client.createCatalogRequest({ kind: "PRODUCT", name: "상품" });
  await client.createWantedRequest({ category: "figure", ipId: "one-piece", desiredItem: "루피 피규어", details: "재입고를 기다려요." });
  await client.setWantedRequestLike("11111111-1111-4111-8111-111111111111", true);
  await client.createExchangeListing({ title: "교환", details: "상세", offeredInventoryUnitId: "unit-1" });
  await client.createExchangeOffer("listing-1", { offeredInventoryUnitId: "unit-2", message: "제안" });
  await client.decideExchangeOffer("listing-1", "offer-1", "ACCEPTED");
  await client.createOrder({ items: [{ productId: "product-1", quantity: 1 }] });

  assert.equal(calls.length, 10);
  assert.ok(calls.every((call) => call.init.method === "POST"));
  assert.ok(calls.every((call) => (call.init.headers.get("idempotency-key")?.length ?? 0) >= 16));
});

test("community creation, reports, and inquiry conversation use their exact authenticated contracts", async () => {
  const calls = [];
  const inquiryDetail = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    category: "ORDER",
    title: "배송 문의",
    status: "ANSWERED",
    assignedAdminId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-08-24T00:00:00Z",
    updatedAt: "2026-08-24T01:00:00Z",
    messages: [{
      id: "44444444-4444-4444-8444-444444444444",
      inquiryId: "11111111-1111-4111-8111-111111111111",
      authorId: "33333333-3333-4333-8333-333333333333",
      authorRole: "ADMIN",
      content: "운영자 답변입니다.",
      isInternal: false,
      mediaIds: [],
      createdAt: "2026-08-24T01:00:00Z",
    }],
  };
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: () => "request-correlation-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      const path = new URL(url).pathname;
      if (path.startsWith("/v1/inquiries/")) return Response.json(inquiryDetail);
      if (path === "/v1/inquiries") return Response.json({ ...inquiryDetail, messages: undefined }, { status: 201 });
      if (path === "/v1/community/posts") return Response.json({ id: "post-id" }, { status: 201 });
      return Response.json({ id: "report-id", status: "PENDING" }, { status: 201 });
    },
  });

  const detail = await client.getInquiryDetail(inquiryDetail.id);
  await client.createInquiry({
    category: "ORDER",
    title: "배송 문의",
    content: "배송 상태를 확인해 주세요.",
  }, "inquiry-create-retry-key");
  await client.createCommunityPost({
    kind: "DUKROOM",
    ipId: "one-piece",
    title: "선반 수집 기록",
    content: "하나씩 모은 기록입니다.",
    mediaIds: [],
  }, "community-post-retry-key");
  await client.createReport({
    targetType: "SNAP",
    targetId: "55555555-5555-4555-8555-555555555555",
    reason: "INAPPROPRIATE",
    details: "운영자 확인이 필요합니다.",
  }, "community-report-retry-key");

  assert.equal(detail.messages[0].authorRole, "ADMIN");
  assert.equal(calls[0].url, `https://api.dabboba.test/v1/inquiries/${inquiryDetail.id}`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer opaque-user-token");
  assert.equal(calls[0].init.headers.get("idempotency-key"), null);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    category: "ORDER",
    title: "배송 문의",
    content: "배송 상태를 확인해 주세요.",
  });
  assert.equal(calls[1].init.headers.get("idempotency-key"), "inquiry-create-retry-key");
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    kind: "DUKROOM",
    ipId: "one-piece",
    title: "선반 수집 기록",
    content: "하나씩 모은 기록입니다.",
    mediaIds: [],
  });
  assert.equal(calls[2].init.headers.get("idempotency-key"), "community-post-retry-key");
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    targetType: "SNAP",
    targetId: "55555555-5555-4555-8555-555555555555",
    reason: "INAPPROPRIATE",
    details: "운영자 확인이 필요합니다.",
  });
  assert.equal(calls[3].init.headers.get("idempotency-key"), "community-report-retry-key");
});

test("duplicate report conflicts preserve the server message instead of becoming a local success", async () => {
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    fetch: async () => Response.json({
      error: { code: "DUPLICATE_REPORT", message: "이미 접수된 신고입니다." },
    }, { status: 409 }),
  });

  await assert.rejects(
    () => client.createReport({
      targetType: "POST",
      targetId: "11111111-1111-4111-8111-111111111111",
      reason: "SPAM",
    }, "same-report-retry-key"),
    (error) => error.status === 409
      && error.code === "DUPLICATE_REPORT"
      && error.message === "이미 접수된 신고입니다.",
  );
});

test("wanted room follows its public cursor and sends exact authenticated create and like bodies", async () => {
  const calls = [];
  const firstWanted = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    authorNickname: "다뽑러",
    category: "figure",
    ipId: "one-piece",
    ipNameKo: "원피스",
    desiredItem: "루피 피규어",
    details: "재입고를 기다려요.",
    status: "ACTIVE",
    likeCount: 4,
    likedByViewer: true,
    createdAt: "2026-08-24T00:00:00Z",
    updatedAt: "2026-08-24T00:00:00Z",
  };
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: () => "request-correlation-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      const parsed = new URL(url);
      if (parsed.pathname === "/v1/wanted-requests" && init.method === "GET") {
        return Response.json(parsed.searchParams.has("cursor")
          ? { items: [{ ...firstWanted, id: "33333333-3333-4333-8333-333333333333", likedByViewer: false }], nextCursor: null }
          : { items: [firstWanted], nextCursor: "wanted-next" });
      }
      if (parsed.pathname === "/v1/wanted-requests") return Response.json(firstWanted, { status: 201 });
      if (parsed.pathname.endsWith("/like")) {
        return Response.json({ requestId: firstWanted.id, liked: false, likeCount: 3 });
      }
      if (parsed.pathname === "/v1/account/points") {
        return Response.json({ balance: 0, version: 0, items: [], nextCursor: null });
      }
      return Response.json({ items: [], nextCursor: null });
    },
  });

  const snapshot = await client.loadSnapshot();
  assert.deepEqual(snapshot.wantedRequests?.map((request) => request.id), [
    firstWanted.id,
    "33333333-3333-4333-8333-333333333333",
  ]);

  await client.createWantedRequest({
    category: "figure",
    ipId: "one-piece",
    desiredItem: "루피 피규어",
    details: "재입고를 기다려요.",
  }, "wanted-create-retry-key");
  await client.setWantedRequestLike(firstWanted.id, false, "wanted-like-retry-key");

  const wantedCalls = calls.filter((call) => new URL(call.url).pathname.startsWith("/v1/wanted-requests"));
  assert.equal(wantedCalls.length, 4);
  assert.ok(wantedCalls[1].url.includes("cursor=wanted-next"));
  assert.deepEqual(JSON.parse(wantedCalls[2].init.body), {
    category: "figure",
    ipId: "one-piece",
    desiredItem: "루피 피규어",
    details: "재입고를 기다려요.",
  });
  assert.equal(wantedCalls[2].init.headers.get("idempotency-key"), "wanted-create-retry-key");
  assert.deepEqual(JSON.parse(wantedCalls[3].init.body), { liked: false });
  assert.equal(wantedCalls[3].init.headers.get("idempotency-key"), "wanted-like-retry-key");
});

test("snapshot readers follow cursors and treat a missing default address as an empty account state", async () => {
  const requestedUrls = [];
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    fetch: async (url) => {
      requestedUrls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === "/v1/account/default-address") {
        return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "없음" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      if (parsed.pathname === "/v1/notices" && !parsed.searchParams.has("cursor")) {
        return Response.json({ items: [{ id: "notice-1" }], nextCursor: "next-notice" });
      }
      if (parsed.pathname === "/v1/notices") {
        return Response.json({ items: [{ id: "notice-2" }], nextCursor: null });
      }
      if (parsed.pathname === "/v1/account/points") {
        return Response.json({ balance: 0, version: 0, items: [], nextCursor: null });
      }
      if (parsed.pathname === "/v1/account/profile") {
        return Response.json({ id: "user-1", nickname: "다뽑러", bio: null, favoriteIp: null, version: 1, updatedAt: "2026-08-24T00:00:00Z" });
      }
      return Response.json({ items: [], nextCursor: null });
    },
  });

  const snapshot = await client.loadSnapshot();
  assert.deepEqual(snapshot.notices?.map((notice) => notice.id), ["notice-1", "notice-2"]);
  assert.equal(snapshot.defaultAddress, null);
  assert.equal(snapshot.failures.defaultAddress, undefined);
  assert.ok(requestedUrls.some((url) => url.includes("cursor=next-notice")));
});

test("native deep-link messages accept only the v1 exact same-origin route contract", () => {
  const valid = JSON.stringify({
    version: 1,
    type: "DEEP_LINK",
    payload: {
      route: "request-room",
      url: "https://app.dabboba.test/request-room?embed=1&platform=ios",
    },
  });
  assert.equal(parseNativeDeepLinkMessage(valid, "https://app.dabboba.test"), "request-room");
  assert.equal(routeForWebPath("/settings"), "settings");
  assert.equal(routeForWebPath("/unknown"), null);
  assert.equal(webPathForRoute("ppoba"), "/ppoba");

  assert.equal(
    parseNativeDeepLinkMessage(
      valid.replace("app.dabboba.test", "app.dabboba.test.evil.example"),
      "https://app.dabboba.test",
    ),
    null,
  );
  assert.equal(parseNativeDeepLinkMessage(valid.replace('"version":1', '"version":2'), "https://app.dabboba.test"), null);
  assert.equal(parseNativeDeepLinkMessage(valid.replace("platform=ios", "platform=ios&redirect=https://evil.test"), "https://app.dabboba.test"), null);
  assert.equal(parseNativeDeepLinkMessage(valid.replace("platform=ios", "platform=ios&platform=android"), "https://app.dabboba.test"), null);
  assert.equal(parseNativeDeepLinkMessage(`${"x".repeat(8_193)}`, "https://app.dabboba.test"), null);
});

test("the active root flow consumes native routes without replacing the protected runtime", () => {
  assert.match(prototypeSource, /function NativeBridgeController/);
  assert.match(prototypeSource, /window\.addEventListener\("message", handleMessage\)/);
  assert.match(prototypeSource, /document\.addEventListener\("message", handleMessage as EventListener\)/);
  assert.match(prototypeSource, /route === "request-room"\) flow\.push\(createRequestRoomScreen\(\)\)/);
  assert.match(prototypeSource, /route === "settings"\) flow\.push\(createSettingsScreen\(\)\)/);
  assert.match(prototypeSource, /screensAboveRoot = Math\.max\(0, flow\.stack\.length - 1\)/);
  assert.match(prototypeSource, /index < screensAboveRoot; index \+= 1\) flow\.pop\(\)/);
});

test("remote UI exposes wanted-room state and connects the available account contracts", () => {
  assert.match(prototypeSource, /snapshot\.wantedRequests\.map\(mapApiWantedRequest\)/);
  assert.match(prototypeSource, /신청 목록·작성·같이 원해요·작성자 삭제 상태는 서버 신청방과 동기화됩니다/);
  assert.doesNotMatch(prototypeSource, /신청방 좋아요 API가 아직 계약에 없어/);
  assert.match(prototypeSource, /requestAccountDeletion\(deletionKeyRef\.current\)/);
  assert.match(prototypeSource, /updateNotificationPreferences\(\{/);
  assert.doesNotMatch(prototypeSource, /수신 동의 API 준비 중/);
  assert.match(prototypeSource, /logoutUserSession\(\)/);
  assert.match(prototypeSource, /교환 상세·권한별 제안·수락·거절·철회·글 취소·상호 완료 확인은 서버 상태와 동기화됩니다/);
  assert.match(prototypeSource, /배송 신청 성공 후 서버 내역을 다시 불러옵니다/);
  assert.match(prototypeSource, /최근 배송 신청/);
});

test("request room distinguishes catalog review requests from public wanted posts", () => {
  assert.match(prototypeSource, /title="카탈로그 추가 요청"/);
  assert.match(prototypeSource, /\["PRODUCT", "IP"\] as const/);
  assert.match(prototypeSource, /submitCatalogRequest\(\{[\s\S]*?kind: catalogRequestKind,[\s\S]*?referenceUrl: referenceUrl \|\| null,[\s\S]*?description: description \|\| null,[\s\S]*?\}, pending\.key\)/);
  assert.match(prototypeSource, /kind: "catalog-request"/);
  assert.match(prototypeSource, /서버에 PENDING 요청으로 저장되며 승인·보류·거절 결과는 관리자가 결정합니다/);
  assert.match(prototypeSource, /개발 프리뷰에서는 입력 화면만 확인하며 서버나 관리자에게 전송되지 않습니다/);
});

test("duckroom writes and reports are authenticated, retry-safe, and never fake fixture success", () => {
  const postHandler = prototypeSource.slice(
    prototypeSource.indexOf("const submitCommunityPost"),
    prototypeSource.indexOf("const loadCommunityPost"),
  );
  const reportHandler = prototypeSource.slice(
    prototypeSource.indexOf("const submitCommunityReport"),
    prototypeSource.indexOf("const loadInquiryDetail"),
  );
  const inquiryHandler = prototypeSource.slice(
    prototypeSource.indexOf("const submitInquiry = useCallback"),
    prototypeSource.indexOf("const loadDrawOdds"),
  );

  assert.match(postHandler, /ok: false,[\s\S]*source: "prototype"/);
  assert.match(reportHandler, /ok: false,[\s\S]*source: "prototype"/);
  assert.doesNotMatch(postHandler, /ok: true,[\s\S]*source: "prototype"/);
  assert.doesNotMatch(reportHandler, /ok: true,[\s\S]*source: "prototype"/);
  assert.match(inquiryHandler, /ok: false,[\s\S]*source: "prototype"/);
  assert.doesNotMatch(inquiryHandler, /ok: true,[\s\S]*source: "prototype"/);
  assert.match(prototypeSource, /kind: "community-compose"/);
  assert.match(prototypeSource, /kind: "community-report"/);
  assert.match(prototypeSource, /pendingPostKeyRef\.current\?\.fingerprint === fingerprint/);
  assert.match(prototypeSource, /pendingReportKeyRef\.current\?\.fingerprint === fingerprint/);
  assert.match(prototypeSource, /setReportStatus\(result\.message\);[\s\S]*if \(!result\.ok\) return;[\s\S]*pendingReportKeyRef\.current = null/);
  assert.match(prototypeSource, /showcase\.authorId === currentUserId/);
  assert.match(prototypeSource, /onClick=\{\(\) => ownPost \? setDeleteTarget\(showcase\) : requestReportAccess\(showcase\)\}/);
  assert.match(prototypeSource, /disabled=\{ownPost \|\| pendingLikePostIds\.has\(showcase\.id\)\}/);
  assert.match(prototypeSource, /글 작성과 신고 입력은 확인할 수 있지만 서버나 운영자에게 전송되지 않습니다/);
  assert.match(prototypeSource, /<BottomSheet[\s\S]*title="덕룸 글 올리기"/);
  assert.match(prototypeSource, /<BottomSheet[\s\S]*title="게시물 신고"/);
});

test("inquiry history opens an abort-safe server conversation and labels admin answers", () => {
  assert.match(apiServiceSource, /getInquiryDetail\(inquiryId: string, signal\?: AbortSignal\)/);
  assert.match(apiServiceSource, /`\/v1\/inquiries\/\$\{encodeURIComponent\(inquiryId\)\}`/);
  assert.match(prototypeSource, /createInquiryDetailScreen\(inquiry\.id, inquiry\.title\)/);
  assert.match(prototypeSource, /pendingInquiryKeyRef\.current\?\.fingerprint === fingerprint/);
  assert.match(prototypeSource, /submitInquiry\(\{[\s\S]*?category,[\s\S]*?title: nextTitle,[\s\S]*?content,[\s\S]*?\}, pending\.key\)/);
  assert.match(prototypeSource, /if \(!result\.ok \|\| !result\.data\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?pendingInquiryKeyRef\.current = null/);
  assert.match(prototypeSource, /function InquiryDetailPage/);
  assert.match(prototypeSource, /const controller = new AbortController\(\)/);
  assert.match(prototypeSource, /if \(!active \|\| controller\.signal\.aborted\) return/);
  assert.match(prototypeSource, /active = false;[\s\S]*controller\.abort\(\)/);
  assert.match(prototypeSource, /detail\?\.messages\.filter\(\(message\) => !message\.isInternal\)/);
  assert.match(prototypeSource, /DABBOBA 운영팀/);
  assert.match(prototypeSource, /운영자 답변이 포함된 서버 문의 대화입니다/);
  assert.match(prototypeSource, /<MobileScroll className="app-screen dabboba-screen">[\s\S]*aria-labelledby="inquiry-detail-title"/);
});
