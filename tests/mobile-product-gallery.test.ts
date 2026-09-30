import assert from "node:assert/strict";
import test from "node:test";
import { productDetailGalleryImages } from "../apps/mobile/src/features/shop/product-gallery.ts";

test("detail gallery preserves three curated hero slides without adding the primary image", () => {
  assert.deepEqual(productDetailGalleryImages({
    detailGalleryImageUrls: ["https://media.example/1", "https://media.example/2", "https://media.example/3"],
  }, "https://media.example/old-primary"), [
    "https://media.example/1", "https://media.example/2", "https://media.example/3",
  ]);
});

test("detail gallery ignores unsafe, duplicate, and excess URLs, with primary fallback", () => {
  assert.deepEqual(productDetailGalleryImages({ detailGalleryImageUrls: ["javascript:bad", "//evil.example/photo", "https://media.example/1", "https://media.example/1"] }, null), ["https://media.example/1"]);
  assert.deepEqual(productDetailGalleryImages({ detailGalleryImageUrls: ["javascript:bad", "https://"] }, "/v1/catalog/media/default/image"), ["/v1/catalog/media/default/image"]);
  assert.equal(productDetailGalleryImages({ detailGalleryImageUrls: Array.from({ length: 10 }, (_, i) => `https://media.example/${i}`) }, null).length, 8);
});
