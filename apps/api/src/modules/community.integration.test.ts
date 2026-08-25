import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

type Session = {
  token: string;
  actor: { userId: string };
};

test(
  "community owner lifecycle, desired-state likes, and bidirectional blocks are enforced",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-community-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "community-integration-session-pepper-value",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool, redis: null });
    t.after(async () => {
      await app.close();
      await pool.end();
    });

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const session = async (label: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/dev-session",
        payload: { email: `community-${label}-${suffix}@example.test` },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json() as Session;
    };
    const author = await session("author");
    const viewer = await session("viewer");
    const commenter = await session("commenter");
    const other = await session("other");
    const auth = (value: Session) => ({ authorization: `Bearer ${value.token}` });
    const mutationHeaders = (value: Session, key = randomUUID()) => ({
      ...auth(value),
      "idempotency-key": key,
    });

    const createKey = randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/v1/community/posts",
      headers: mutationHeaders(author, createKey),
      payload: {
        kind: "DUKROOM",
        title: `생명주기 테스트 ${suffix}`,
        content: "작성자 수정과 삭제, 차단 노출을 검증합니다.",
        mediaIds: [],
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const createdBody = created.json() as {
      id: string; version: number; likeCount: number; likedByViewer: boolean;
    };
    const postId = createdBody.id;
    assert.equal(createdBody.version, 1);
    assert.equal(createdBody.likeCount, 0);
    assert.equal(createdBody.likedByViewer, false);

    const deniedUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/community/posts/${postId}`,
      headers: mutationHeaders(viewer),
      payload: { expectedVersion: 1, title: "권한 없는 수정" },
    });
    assert.equal(deniedUpdate.statusCode, 403, deniedUpdate.body);

    const updateKey = randomUUID();
    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/community/posts/${postId}`,
      headers: mutationHeaders(author, updateKey),
      payload: {
        expectedVersion: 1,
        title: `수정된 생명주기 테스트 ${suffix}`,
        content: "수정된 본문입니다.",
        mediaIds: [],
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal((updated.json() as { version: number }).version, 2);
    const updateReplay = await app.inject({
      method: "PATCH",
      url: `/v1/community/posts/${postId}`,
      headers: mutationHeaders(author, updateKey),
      payload: {
        expectedVersion: 1,
        title: `수정된 생명주기 테스트 ${suffix}`,
        content: "수정된 본문입니다.",
        mediaIds: [],
      },
    });
    assert.equal(updateReplay.statusCode, 200, updateReplay.body);
    assert.equal(updateReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(updateReplay.json(), updated.json());
    const staleUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/community/posts/${postId}`,
      headers: mutationHeaders(author),
      payload: { expectedVersion: 1, title: "오래된 수정" },
    });
    assert.equal(staleUpdate.statusCode, 409, staleUpdate.body);

    const likeKey = randomUUID();
    const liked = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/like`,
      headers: mutationHeaders(viewer, likeKey),
      payload: { liked: true },
    });
    assert.equal(liked.statusCode, 200, liked.body);
    assert.deepEqual(liked.json(), { postId, liked: true, likeCount: 1 });
    const likeReplay = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/like`,
      headers: mutationHeaders(viewer, likeKey),
      payload: { liked: true },
    });
    assert.equal(likeReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(likeReplay.json(), liked.json());
    const duplicateDesiredState = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/like`,
      headers: mutationHeaders(viewer),
      payload: { liked: true },
    });
    assert.deepEqual(duplicateDesiredState.json(), { postId, liked: true, likeCount: 1 });
    const oneLike = await pool.query<{ count: string }>(
      "SELECT count(*) FROM community_post_likes WHERE post_id=$1 AND user_id=$2",
      [postId, viewer.actor.userId],
    );
    assert.equal(Number(oneLike.rows[0]!.count), 1);
    const selfLike = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/like`,
      headers: mutationHeaders(author),
      payload: { liked: true },
    });
    assert.equal(selfLike.statusCode, 403, selfLike.body);
    const unliked = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/like`,
      headers: mutationHeaders(viewer),
      payload: { liked: false },
    });
    assert.deepEqual(unliked.json(), { postId, liked: false, likeCount: 0 });

    const commenterComment = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/comments`,
      headers: mutationHeaders(commenter),
      payload: { content: "차단 필터 검증 댓글" },
    });
    assert.equal(commenterComment.statusCode, 201, commenterComment.body);
    const commenterCommentId = (commenterComment.json() as { id: string }).id;
    const commenterLike = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/like`,
      headers: mutationHeaders(commenter),
      payload: { liked: true },
    });
    assert.deepEqual(commenterLike.json(), { postId, liked: true, likeCount: 1 });
    const viewerCommentKey = randomUUID();
    const viewerComment = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/comments`,
      headers: mutationHeaders(viewer, viewerCommentKey),
      payload: { content: "삭제할 댓글" },
    });
    assert.equal(viewerComment.statusCode, 201, viewerComment.body);
    const viewerCommentId = (viewerComment.json() as { id: string }).id;
    const commentReplay = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/comments`,
      headers: mutationHeaders(viewer, viewerCommentKey),
      payload: { content: "삭제할 댓글" },
    });
    assert.equal(commentReplay.headers["x-idempotent-replay"], "true");
    assert.equal((commentReplay.json() as { id: string }).id, viewerCommentId);
    const deniedCommentDelete = await app.inject({
      method: "DELETE",
      url: `/v1/community/comments/${viewerCommentId}`,
      headers: mutationHeaders(author),
    });
    assert.equal(deniedCommentDelete.statusCode, 403, deniedCommentDelete.body);
    const commentDeleteKey = randomUUID();
    const deletedComment = await app.inject({
      method: "DELETE",
      url: `/v1/community/comments/${viewerCommentId}`,
      headers: mutationHeaders(viewer, commentDeleteKey),
    });
    assert.equal(deletedComment.statusCode, 200, deletedComment.body);
    assert.deepEqual(deletedComment.json(), { commentId: viewerCommentId, status: "DELETED" });
    const commentDeleteReplay = await app.inject({
      method: "DELETE",
      url: `/v1/community/comments/${viewerCommentId}`,
      headers: mutationHeaders(viewer, commentDeleteKey),
    });
    assert.equal(commentDeleteReplay.headers["x-idempotent-replay"], "true");

    const selfBlock = await app.inject({
      method: "POST",
      url: `/v1/community/blocks/${viewer.actor.userId}`,
      headers: mutationHeaders(viewer),
    });
    assert.equal(selfBlock.statusCode, 400, selfBlock.body);
    const blockAuthorKey = randomUUID();
    const blockedAuthor = await app.inject({
      method: "POST",
      url: `/v1/community/blocks/${author.actor.userId}`,
      headers: mutationHeaders(viewer, blockAuthorKey),
    });
    assert.equal(blockedAuthor.statusCode, 200, blockedAuthor.body);
    assert.deepEqual(blockedAuthor.json(), { userId: author.actor.userId, blocked: true });
    const blockedAuthorReplay = await app.inject({
      method: "POST",
      url: `/v1/community/blocks/${author.actor.userId}`,
      headers: mutationHeaders(viewer, blockAuthorKey),
    });
    assert.equal(blockedAuthorReplay.headers["x-idempotent-replay"], "true");

    const blockedFeed = await app.inject({
      method: "GET",
      url: "/v1/community/posts?limit=100",
      headers: auth(viewer),
    });
    assert.equal(blockedFeed.statusCode, 200, blockedFeed.body);
    assert.ok(!(blockedFeed.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === postId));
    const blockedDetail = await app.inject({
      method: "GET",
      url: `/v1/community/posts/${postId}`,
      headers: auth(viewer),
    });
    assert.equal(blockedDetail.statusCode, 404, blockedDetail.body);
    const blockedComments = await app.inject({
      method: "GET",
      url: `/v1/community/posts/${postId}/comments`,
      headers: auth(viewer),
    });
    assert.equal(blockedComments.statusCode, 404, blockedComments.body);
    const blockedInteraction = await app.inject({
      method: "POST",
      url: `/v1/community/posts/${postId}/comments`,
      headers: mutationHeaders(viewer),
      payload: { content: "차단 중 작성 불가" },
    });
    assert.equal(blockedInteraction.statusCode, 404, blockedInteraction.body);
    const anonymousDetail = await app.inject({ method: "GET", url: `/v1/community/posts/${postId}` });
    assert.equal(anonymousDetail.statusCode, 200, anonymousDetail.body);

    const unblockedAuthor = await app.inject({
      method: "DELETE",
      url: `/v1/community/blocks/${author.actor.userId}`,
      headers: mutationHeaders(viewer),
    });
    assert.deepEqual(unblockedAuthor.json(), { userId: author.actor.userId, blocked: false });
    const reverseBlock = await app.inject({
      method: "POST",
      url: `/v1/community/blocks/${viewer.actor.userId}`,
      headers: mutationHeaders(author),
    });
    assert.equal(reverseBlock.statusCode, 200, reverseBlock.body);
    const reverseHidden = await app.inject({
      method: "GET",
      url: `/v1/community/posts/${postId}`,
      headers: auth(viewer),
    });
    assert.equal(reverseHidden.statusCode, 404, reverseHidden.body);
    await app.inject({
      method: "DELETE",
      url: `/v1/community/blocks/${viewer.actor.userId}`,
      headers: mutationHeaders(author),
    });

    await app.inject({
      method: "POST",
      url: `/v1/community/blocks/${commenter.actor.userId}`,
      headers: mutationHeaders(viewer),
    });
    await app.inject({
      method: "POST",
      url: `/v1/community/blocks/${other.actor.userId}`,
      headers: mutationHeaders(viewer),
    });
    const firstBlockPage = await app.inject({
      method: "GET",
      url: "/v1/community/blocks?limit=1",
      headers: auth(viewer),
    });
    assert.equal(firstBlockPage.statusCode, 200, firstBlockPage.body);
    const firstBlockPageBody = firstBlockPage.json() as { items: Array<{ userId: string }>; nextCursor: string | null };
    assert.equal(firstBlockPageBody.items.length, 1);
    assert.ok(firstBlockPageBody.nextCursor);
    const secondBlockPage = await app.inject({
      method: "GET",
      url: `/v1/community/blocks?limit=1&cursor=${encodeURIComponent(firstBlockPageBody.nextCursor!)}`,
      headers: auth(viewer),
    });
    assert.equal(secondBlockPage.statusCode, 200, secondBlockPage.body);
    assert.equal((secondBlockPage.json() as { items: unknown[] }).items.length, 1);

    const filteredComments = await app.inject({
      method: "GET",
      url: `/v1/community/posts/${postId}/comments`,
      headers: auth(viewer),
    });
    assert.equal(filteredComments.statusCode, 200, filteredComments.body);
    assert.ok(!(filteredComments.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === commenterCommentId));
    const filteredDetail = await app.inject({
      method: "GET",
      url: `/v1/community/posts/${postId}`,
      headers: auth(viewer),
    });
    assert.equal((filteredDetail.json() as { commentCount: number }).commentCount, 0);
    assert.equal((filteredDetail.json() as { likeCount: number }).likeCount, 0);
    const anonymousComments = await app.inject({ method: "GET", url: `/v1/community/posts/${postId}/comments` });
    assert.ok((anonymousComments.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === commenterCommentId));
    const anonymousAggregate = await app.inject({ method: "GET", url: `/v1/community/posts/${postId}` });
    assert.equal((anonymousAggregate.json() as { commentCount: number }).commentCount, 1);
    assert.equal((anonymousAggregate.json() as { likeCount: number }).likeCount, 1);
    await app.inject({
      method: "DELETE",
      url: `/v1/community/blocks/${commenter.actor.userId}`,
      headers: mutationHeaders(viewer),
    });
    const visibleComments = await app.inject({
      method: "GET",
      url: `/v1/community/posts/${postId}/comments`,
      headers: auth(viewer),
    });
    assert.ok((visibleComments.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === commenterCommentId));
    const visibleAggregate = await app.inject({
      method: "GET",
      url: `/v1/community/posts/${postId}`,
      headers: auth(viewer),
    });
    assert.equal((visibleAggregate.json() as { commentCount: number }).commentCount, 1);
    assert.equal((visibleAggregate.json() as { likeCount: number }).likeCount, 1);
    const commenterDeletesOwn = await app.inject({
      method: "DELETE",
      url: `/v1/community/comments/${commenterCommentId}`,
      headers: mutationHeaders(commenter),
    });
    assert.equal(commenterDeletesOwn.statusCode, 200, commenterDeletesOwn.body);

    const deniedPostDelete = await app.inject({
      method: "DELETE",
      url: `/v1/community/posts/${postId}`,
      headers: mutationHeaders(viewer),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deniedPostDelete.statusCode, 403, deniedPostDelete.body);
    const postDeleteKey = randomUUID();
    const deletedPost = await app.inject({
      method: "DELETE",
      url: `/v1/community/posts/${postId}`,
      headers: mutationHeaders(author, postDeleteKey),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deletedPost.statusCode, 200, deletedPost.body);
    assert.deepEqual(deletedPost.json(), { postId, status: "DELETED", version: 3 });
    const deleteReplay = await app.inject({
      method: "DELETE",
      url: `/v1/community/posts/${postId}`,
      headers: mutationHeaders(author, postDeleteKey),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deleteReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(deleteReplay.json(), deletedPost.json());
    const deletedDetail = await app.inject({ method: "GET", url: `/v1/community/posts/${postId}` });
    assert.equal(deletedDetail.statusCode, 404, deletedDetail.body);

    const stored = await pool.query<{ status: string; version: number }>(
      "SELECT status,version FROM community_posts WHERE id=$1",
      [postId],
    );
    assert.deepEqual(stored.rows[0], { status: "DELETED", version: 3 });
  },
);
