import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DabbobaApiClient } from "../src/services/dabbobaApi.ts";

const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");

test("exchange detail and every customer lifecycle write use the contracted route and stable retry key", async () => {
  const calls = [];
  const listingId = "11111111-1111-4111-8111-111111111111";
  const offerId = "22222222-2222-4222-8222-222222222222";
  const listing = {
    id: listingId,
    authorId: "33333333-3333-4333-8333-333333333333",
    authorNickname: "교환작성자",
    title: "교환 글",
    details: "교환 상세",
    status: "OPEN",
    offeredInventory: { id: "inventory-one" },
    offerCount: 1,
    acceptedOfferId: null,
    matchedAt: null,
    authorConfirmedAt: null,
    proposerConfirmedAt: null,
    completedAt: null,
    completionMode: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    resolvedByAdminId: null,
    createdAt: "2026-08-24T00:00:00Z",
    updatedAt: "2026-08-24T00:00:00Z",
    offers: [],
  };
  const offer = {
    id: offerId,
    listingId,
    proposerId: "44444444-4444-4444-8444-444444444444",
    offeredInventory: { id: "inventory-two" },
    status: "PENDING",
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
      const path = new URL(url).pathname;
      if (path.endsWith("/offers")) return Response.json(offer, { status: 201 });
      if (path.includes(`/offers/${offerId}/`)) {
        return Response.json({
          ...offer,
          status: path.endsWith("/withdraw") ? "WITHDRAWN" : "ACCEPTED",
        });
      }
      return Response.json(listing);
    },
  });

  const detail = await client.getExchangeListingDetail(listingId);
  await client.createExchangeOffer(listingId, {
    offeredInventoryUnitId: "inventory-two",
  }, "offer-create-retry-key");
  await client.decideExchangeOffer(listingId, offerId, "ACCEPTED", "offer-decision-retry-key");
  await client.withdrawExchangeOffer(listingId, offerId, "offer-withdraw-retry-key");
  await client.cancelExchangeListing(listingId, "listing-cancel-retry-key");
  await client.confirmExchangeCompletion(listingId, "completion-confirm-retry-key");

  assert.deepEqual(detail.offers, []);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    `/v1/exchange/listings/${listingId}`,
    `/v1/exchange/listings/${listingId}/offers`,
    `/v1/exchange/listings/${listingId}/offers/${offerId}/decision`,
    `/v1/exchange/listings/${listingId}/offers/${offerId}/withdraw`,
    `/v1/exchange/listings/${listingId}/cancel`,
    `/v1/exchange/listings/${listingId}/completion-confirmation`,
  ]);
  assert.deepEqual(calls.map((call) => call.init.method), ["GET", "POST", "POST", "POST", "POST", "POST"]);
  assert.ok(calls.every((call) => call.init.headers.get("authorization") === "Bearer opaque-user-token"));
  assert.equal(calls[0].init.headers.get("idempotency-key"), null);
  assert.deepEqual(calls.slice(1).map((call) => call.init.headers.get("idempotency-key")), [
    "offer-create-retry-key",
    "offer-decision-retry-key",
    "offer-withdraw-retry-key",
    "listing-cancel-retry-key",
    "completion-confirm-retry-key",
  ]);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    offeredInventoryUnitId: "inventory-two",
  });
  assert.deepEqual(JSON.parse(calls[2].init.body), { decision: "ACCEPTED" });
  assert.equal(calls[3].init.body, undefined);
  assert.equal(calls[4].init.body, undefined);
  assert.equal(calls[5].init.body, undefined);
});

test("exchange detail UI loads authorized offers and exposes only server-backed lifecycle actions", () => {
  const detailPage = prototypeSource.slice(
    prototypeSource.indexOf("function ExchangeDetailPage"),
    prototypeSource.indexOf("function ShopPage"),
  );

  assert.match(detailPage, /const controller = new AbortController\(\)/);
  assert.match(detailPage, /loadExchangeListingDetail\(postId, signal\)/);
  assert.match(detailPage, /pendingOfferKeyRef\.current\?\.fingerprint === fingerprint/);
  assert.match(detailPage, /addExchangeApplication\(post\.id,[\s\S]*?pending\.key\)/);
  assert.match(detailPage, /eligibleDrawExchangeProposalUnits\(sessionCommerce, currentUserId\)/);
  assert.doesNotMatch(detailPage, /draftMessage|exchange-application-message|application\.message/);
  assert.match(detailPage, /pendingLifecycleKeysRef\.current\[action\]/);
  assert.match(detailPage, /decideExchangeApplication\(post\.id, applicationId, decision, key\)/);
  assert.match(detailPage, /withdrawExchangeApplication\(post\.id, applicationId, key\)/);
  assert.match(detailPage, /cancelExchangeListing\(post\.id, key\)/);
  assert.match(detailPage, /confirmExchangeCompletion\(post\.id, key\)/);
  assert.match(detailPage, /작성자에게 허용된 전체 제안/);
  assert.match(detailPage, /내 계정이 보낸 제안만 표시/);
  assert.match(detailPage, /매칭 후 취소는 운영자 확인이 필요/);
  assert.doesNotMatch(detailPage, /교환 제안 목록 API 준비 중/);
  assert.doesNotMatch(detailPage, /공개 계약에 없는 제안 목록은 추정하지 않습니다/);
});
