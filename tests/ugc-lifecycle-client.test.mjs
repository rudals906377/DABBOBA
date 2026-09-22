import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DabbobaApiClient } from "../src/services/dabbobaApi.ts";

test("community and wanted lifecycle writes preserve ownership versions and desired state", async () => {
  const calls = [];
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    createId: () => "ugc-request-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/like")) return Response.json({ postId: "post-1", liked: true, likeCount: 4 });
      if (url.includes("/community/blocks/")) return Response.json({ userId: "user-2", blocked: true });
      if (url.includes("/community/posts/")) return Response.json({ postId: "post-1", status: "DELETED", version: 3 });
      return Response.json({ requestId: "wanted-1", status: "DELETED", version: 2 });
    },
  });

  await client.setCommunityPostLike("post-1", true, "post-like-once");
  await client.deleteCommunityPost("post-1", 2, "post-delete-once");
  await client.setCommunityUserBlocked("user-2", true, "block-user-once");
  await client.deleteWantedRequest("wanted-1", 1, "wanted-delete-once");

  assert.deepEqual(calls.map(({ url, init }) => ({
    url,
    method: init.method,
    body: JSON.parse(init.body),
    idempotencyKey: init.headers.get("idempotency-key"),
  })), [
    {
      url: "https://api.dabboba.test/v1/community/posts/post-1/like",
      method: "POST",
      body: { liked: true },
      idempotencyKey: "post-like-once",
    },
    {
      url: "https://api.dabboba.test/v1/community/posts/post-1",
      method: "DELETE",
      body: { expectedVersion: 2 },
      idempotencyKey: "post-delete-once",
    },
    {
      url: "https://api.dabboba.test/v1/community/blocks/user-2",
      method: "POST",
      body: {},
      idempotencyKey: "block-user-once",
    },
    {
      url: "https://api.dabboba.test/v1/wanted-requests/wanted-1",
      method: "DELETE",
      body: { expectedVersion: 1 },
      idempotencyKey: "wanted-delete-once",
    },
  ]);
  assert.ok(calls.every(({ init }) => init.headers.get("authorization") === "Bearer opaque-user-token"));
});

test("customer screens expose server-backed post like, block, and owner soft-delete actions", () => {
  const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");

  assert.match(prototypeSource, /toggleCommunityPostLike\(showcase\.id, liked, pending\.key\)/);
  assert.match(prototypeSource, /blockCommunityUser\(userId, pending\.key\)/);
  assert.match(prototypeSource, /deleteCommunityPost\(deleteTarget\.id, deleteTarget\.version \?\? 1, pending\.key\)/);
  assert.match(prototypeSource, /deleteProductRequest\(deleteRequestTarget\.id, deleteRequestTarget\.version \?\? 1, pending\.key\)/);
});
