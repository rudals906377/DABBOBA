import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DabbobaApiClient } from "../src/services/dabbobaApi.ts";

const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
const prototypeStyles = readFileSync(new URL("../src/prototype.css", import.meta.url), "utf8");

test("community detail, comments, post edits, and block removal use the existing contracts", async () => {
  const calls = [];
  const postId = "11111111-1111-4111-8111-111111111111";
  const commentId = "22222222-2222-4222-8222-222222222222";
  const blockedUserId = "33333333-3333-4333-8333-333333333333";
  const post = {
    id: postId,
    authorId: "44444444-4444-4444-8444-444444444444",
    authorNickname: "수집가",
    ipId: null,
    kind: "SNAP",
    title: "수정한 스냅",
    content: "수정한 내용",
    status: "ACTIVE",
    reportCount: 0,
    commentCount: 1,
    likeCount: 2,
    likedByViewer: false,
    mediaIds: ["55555555-5555-4555-8555-555555555555"],
    version: 2,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
  const comment = {
    id: commentId,
    postId,
    authorId: "44444444-4444-4444-8444-444444444444",
    authorNickname: "수집가",
    content: "멋진 수집이에요",
    status: "ACTIVE",
    reportCount: 0,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: () => "community-request-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith(`/posts/${postId}/comments?limit=100`)) {
        return Response.json({ items: [comment], nextCursor: null });
      }
      if (url.endsWith(`/posts/${postId}/comments`)) return Response.json(comment, { status: 201 });
      if (url.endsWith(`/comments/${commentId}`)) {
        return Response.json({ commentId, status: "DELETED" });
      }
      if (url.endsWith("/community/blocks?limit=100")) {
        return Response.json({ items: [{ userId: blockedUserId, nickname: "차단 사용자", blockedAt: post.updatedAt }], nextCursor: null });
      }
      if (url.endsWith(`/community/blocks/${blockedUserId}`)) {
        return Response.json({ userId: blockedUserId, blocked: false });
      }
      return Response.json(post);
    },
  });

  assert.deepEqual(await client.getCommunityPost(postId), post);
  assert.deepEqual(await client.listCommunityComments(postId), [comment]);
  assert.deepEqual(await client.createCommunityComment(postId, "멋진 수집이에요", "comment-create-retry"), comment);
  assert.deepEqual(await client.deleteCommunityComment(commentId, "comment-delete-retry"), { commentId, status: "DELETED" });
  assert.equal((await client.updateCommunityPost(postId, {
    expectedVersion: 1,
    title: "수정한 스냅",
    content: "수정한 내용",
    ipId: null,
    mediaIds: post.mediaIds,
  }, "post-edit-retry")).version, 2);
  assert.equal((await client.listBlockedUsers())[0].userId, blockedUserId);
  assert.deepEqual(await client.setCommunityUserBlocked(blockedUserId, false, "unblock-retry"), {
    userId: blockedUserId,
    blocked: false,
  });

  assert.deepEqual(calls.map(({ url, init }) => ({
    path: new URL(url).pathname + new URL(url).search,
    method: init.method,
    body: init.body ? JSON.parse(init.body) : undefined,
    idempotencyKey: init.headers.get("idempotency-key"),
    authorization: init.headers.get("authorization"),
  })), [
    { path: `/v1/community/posts/${postId}`, method: "GET", body: undefined, idempotencyKey: null, authorization: "Bearer opaque-user-token" },
    { path: `/v1/community/posts/${postId}/comments?limit=100`, method: "GET", body: undefined, idempotencyKey: null, authorization: "Bearer opaque-user-token" },
    { path: `/v1/community/posts/${postId}/comments`, method: "POST", body: { content: "멋진 수집이에요" }, idempotencyKey: "comment-create-retry", authorization: "Bearer opaque-user-token" },
    { path: `/v1/community/comments/${commentId}`, method: "DELETE", body: undefined, idempotencyKey: "comment-delete-retry", authorization: "Bearer opaque-user-token" },
    { path: `/v1/community/posts/${postId}`, method: "PATCH", body: { expectedVersion: 1, title: "수정한 스냅", content: "수정한 내용", ipId: null, mediaIds: post.mediaIds }, idempotencyKey: "post-edit-retry", authorization: "Bearer opaque-user-token" },
    { path: "/v1/community/blocks?limit=100", method: "GET", body: undefined, idempotencyKey: null, authorization: "Bearer opaque-user-token" },
    { path: `/v1/community/blocks/${blockedUserId}`, method: "DELETE", body: {}, idempotencyKey: "unblock-retry", authorization: "Bearer opaque-user-token" },
  ]);
});

test("community comments stay publicly readable without a user session", async () => {
  const calls = [];
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: null },
    createId: () => "public-comment-request",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ items: [], nextCursor: null });
    },
  });

  assert.deepEqual(await client.listCommunityComments("public-post"), []);
  assert.equal(calls[0].init.headers.get("authorization"), null);
});

test("duckroom UI connects detail comments, owner edits, explicit kinds, and block management", () => {
  assert.match(prototypeSource, /function createDuckroomDetailScreen\(postId: string\)/);
  assert.match(prototypeSource, /function DuckroomDetailPage\(/);
  assert.match(prototypeSource, /loadCommunityComments\(postId, signal\)/);
  assert.match(prototypeSource, /submitCommunityComment\(postId, content, pending\.key\)/);
  assert.match(prototypeSource, /deleteCommunityComment\(comment\.id, pending\.key\)/);
  assert.match(prototypeSource, /updateCommunityPost\(post\.id, \{[\s\S]*?expectedVersion: post\.version[\s\S]*?mediaIds:/);
  assert.match(prototypeSource, /flow\.push\(createDuckroomDetailScreen\(showcase\.id\)\)/);
  assert.match(prototypeSource, /value: "DUKROOM"[\s\S]*?value: "SNAP"/);
  assert.match(prototypeSource, /kind: draftKind/);
  assert.match(prototypeSource, /function BlockedUsersPage\(/);
  assert.match(prototypeSource, /loadBlockedUsers\(controller\.signal\)/);
  assert.match(prototypeSource, /unblockCommunityUser\(blockedUser\.userId, pending\.key\)/);
  assert.doesNotMatch(prototypeSource, /nextProducts \?\? PRODUCTS/);

  for (const selector of [
    ".duckroom-detail-page",
    ".community-comment-list",
    ".community-comment-form",
    ".community-kind-selector",
    ".blocked-user-list",
  ]) assert.match(prototypeStyles, new RegExp(selector.replace(".", "\\.")));
});

test("remote customer UGC failures are not replaced with local success", () => {
  for (const functionName of [
    "loadCommunityPost",
    "submitCommunityComment",
    "deleteCommunityComment",
    "updateCommunityPost",
    "loadBlockedUsers",
    "unblockCommunityUser",
  ]) {
    const index = prototypeSource.indexOf(`const ${functionName} = useCallback`);
    assert.notEqual(index, -1, `${functionName} must exist`);
    const next = prototypeSource.indexOf("const ", index + 8);
    const block = prototypeSource.slice(index, next === -1 ? prototypeSource.length : next);
    assert.match(block, /ok: false,[\s\S]*source: "prototype"/, `${functionName} must disclose prototype failure`);
    assert.doesNotMatch(block, /ok: true,[\s\S]*source: "prototype"/, `${functionName} must not fake prototype success`);
  }
});

test("session changes abort stale snapshots and clear viewer-specific customer state", () => {
  const snapshotStart = prototypeSource.indexOf("apiRuntime.client.loadSnapshot(controller.signal).then(async (snapshot) => {");
  assert.notEqual(snapshotStart, -1);
  const firstSnapshotCommit = prototypeSource.indexOf("setCatalogProducts", snapshotStart);
  const abortGuard = prototypeSource.indexOf("if (!snapshotIsCurrent()) return;", snapshotStart);
  assert.ok(abortGuard > snapshotStart && abortGuard < firstSnapshotCommit, "auth-generation guard must precede every snapshot state commit");
  assert.match(prototypeSource.slice(snapshotStart, prototypeSource.indexOf("}, [apiRuntime.client", snapshotStart)), /!snapshotIsCurrent\(\) \|\| \(error instanceof Error/);

  const clearStart = prototypeSource.indexOf("const clearUserSession = useCallback");
  const clearEnd = prototypeSource.indexOf("}, [advanceAuthGeneration, apiRuntime.client]);", clearStart);
  const clearBlock = prototypeSource.slice(clearStart, clearEnd);
  for (const reset of [
    /setMemberSettings\(EMPTY_REMOTE_MEMBER_SETTINGS\)/,
    /setDefaultAddressVersion\(null\)/,
    /setExchangeApplications\(\{\}\)/,
    /setLikedProductRequestIds\(new Set\(\)\)/,
    /setDuckroomShowcases\(\(current\) => current\.map\(\(post\) => \(\{ \.\.\.post, likedByViewer: false \}\)\)\)/,
    /setInquiries\(\[\]\)/,
    /setWishlistItems\(\[\]\)/,
    /setAccountOrders\(\[\]\)/,
    /setAccountNotifications\(\[\]\)/,
  ]) assert.match(clearBlock, reset);
});
