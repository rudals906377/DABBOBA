import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyCatalogMediaDeliveryUrl,
  rebaseLegacyCatalogMediaReplayBody,
  rebaseLegacyCatalogMediaUrl,
} from "./catalog-media-url.js";

const mediaId = "11111111-1111-4111-8111-111111111111";
const currentBase = "https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api";
const legacyUrl = legacyCatalogMediaDeliveryUrl(mediaId);

test("only canonical legacy catalog image URLs move to the current project", () => {
  assert.equal(
    rebaseLegacyCatalogMediaUrl(currentBase, legacyUrl),
    `${currentBase}/v1/catalog/media/${mediaId}/image`,
  );
  assert.equal(rebaseLegacyCatalogMediaUrl(currentBase, `${legacyUrl}?token=unsafe`), `${legacyUrl}?token=unsafe`);
  assert.equal(rebaseLegacyCatalogMediaUrl(currentBase, legacyUrl.replace(mediaId, "not-a-uuid")), legacyUrl.replace(mediaId, "not-a-uuid"));
  assert.equal(rebaseLegacyCatalogMediaUrl(currentBase, "https://images.example.test/prize.png"), "https://images.example.test/prize.png");
  assert.equal(rebaseLegacyCatalogMediaUrl(currentBase, null), null);
  assert.equal(rebaseLegacyCatalogMediaUrl(null, legacyUrl), legacyUrl);
});

test("stored replay bodies translate only the legacy prize image and keep every other value", () => {
  const body = {
    id: "result-1",
    entitlementId: "entitlement-1",
    prizeImageUrl: legacyUrl,
    committedAt: "2026-09-24T00:00:00.000Z",
  };
  const replayed = rebaseLegacyCatalogMediaReplayBody(currentBase, body);
  assert.deepEqual(replayed, { ...body, prizeImageUrl: `${currentBase}/v1/catalog/media/${mediaId}/image` });
  assert.equal(body.prizeImageUrl, legacyUrl, "the stored body is not mutated");

  const current = { ...body, prizeImageUrl: "https://images.example.test/prize.png" };
  assert.equal(rebaseLegacyCatalogMediaReplayBody(currentBase, current), current);
  assert.equal(rebaseLegacyCatalogMediaReplayBody(null, body), body);
  const noImage = { id: "result-2", prizeImageUrl: null };
  assert.equal(rebaseLegacyCatalogMediaReplayBody(currentBase, noImage), noImage);
  const error = { error: { code: "CONFLICT" } };
  assert.equal(rebaseLegacyCatalogMediaReplayBody(currentBase, error), error);
  assert.equal(rebaseLegacyCatalogMediaReplayBody(currentBase, null), null);
});
