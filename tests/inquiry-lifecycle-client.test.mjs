import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DabbobaApiClient } from "../src/services/dabbobaApi.ts";

const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");

test("inquiry follow-up and private attachment reads use exact authenticated contracts", async () => {
  const calls = [];
  const inquiryId = "11111111-1111-4111-8111-111111111111";
  const mediaId = "22222222-2222-4222-8222-222222222222";
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
      if (path.endsWith("/url")) {
        return Response.json({
          mediaId,
          url: "https://storage.example.test/signed-inquiry-image",
          expiresAt: "2026-08-24T00:05:00Z",
          mimeType: "image/webp",
        });
      }
      return Response.json({
        id: "33333333-3333-4333-8333-333333333333",
        inquiryId,
        authorId: "44444444-4444-4444-8444-444444444444",
        authorRole: "USER",
        content: "추가 확인 부탁드립니다.",
        isInternal: false,
        mediaIds: [mediaId],
        createdAt: "2026-08-24T00:00:00Z",
      }, { status: 201 });
    },
  });

  const message = await client.createInquiryMessage(inquiryId, {
    content: "추가 확인 부탁드립니다.",
    mediaIds: [mediaId],
  }, "inquiry-reply-retry-key");
  const media = await client.getAuthenticatedMediaUrl(mediaId);

  assert.equal(message.mediaIds[0], mediaId);
  assert.equal(media.url, "https://storage.example.test/signed-inquiry-image");
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    `/v1/inquiries/${inquiryId}/messages`,
    `/v1/media/${mediaId}/url`,
  ]);
  assert.deepEqual(calls.map((call) => call.init.method), ["POST", "GET"]);
  assert.ok(calls.every((call) => call.init.headers.get("authorization") === "Bearer opaque-user-token"));
  assert.equal(calls[0].init.headers.get("idempotency-key"), "inquiry-reply-retry-key");
  assert.equal(calls[1].init.headers.get("idempotency-key"), null);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    content: "추가 확인 부탁드립니다.",
    mediaIds: [mediaId],
  });
});

test("private inquiry attachment failures remain authenticated failures", async () => {
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "https://api.dabboba.test",
      token: "opaque-user-token",
    },
    fetch: async () => Response.json({
      error: { code: "FORBIDDEN", message: "첨부 파일을 볼 권한이 없습니다." },
    }, { status: 403 }),
  });

  await assert.rejects(
    () => client.getAuthenticatedMediaUrl("22222222-2222-4222-8222-222222222222"),
    (error) => error.status === 403
      && error.code === "FORBIDDEN"
      && error.message === "첨부 파일을 볼 권한이 없습니다.",
  );
});

test("inquiry detail UI retries one server reply, uploads one INQUIRY image, and refreshes the conversation", () => {
  const detailPage = prototypeSource.slice(
    prototypeSource.indexOf("function InquiryDetailPage"),
    prototypeSource.indexOf("function InquiryPage"),
  );

  assert.match(detailPage, /pendingReplyKeyRef\.current\?\.fingerprint === fingerprint/);
  assert.match(detailPage, /replyInFlightRef\.current/);
  assert.match(detailPage, /uploadMedia\(replyMediaFile, "INQUIRY", pending\.mediaKey\)/);
  assert.match(detailPage, /mediaIds: pending\.mediaId \? \[pending\.mediaId\] : \[\]/);
  assert.match(detailPage, /submitInquiryMessage\(inquiryId,[\s\S]*?pending\.key\)/);
  assert.match(detailPage, /const refreshed = await refreshInquiryDetail\(\)/);
  assert.match(detailPage, /detail && detail\.status !== "CLOSED"/);
  assert.match(detailPage, /종료된 문의에는 후속 답글을 추가할 수 없습니다/);
  assert.match(detailPage, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(detailPage, /URL\.revokeObjectURL\(previewUrl\)/);
  assert.match(detailPage, /loadAuthenticatedMediaUrl\(mediaId, controller\.signal\)/);
  assert.match(detailPage, /target="_blank"/);
  assert.match(detailPage, /첨부 파일 \{failedMediaCount\}개를 불러오지 못했습니다/);
  assert.doesNotMatch(detailPage, /source: "prototype"[\s\S]*?ok: true/);
});
