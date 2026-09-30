import assert from "node:assert/strict";
import test from "node:test";
import { legacyCatalogMediaDeliveryUrl, rebaseLegacyCatalogMediaUrl } from "./catalog-media-url.js";

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
