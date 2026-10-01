import assert from "node:assert/strict";
import test from "node:test";
import { preserveProductGalleryMetadata } from "./catalog-gallery-metadata.js";

test("product metadata cannot introduce gallery URLs outside media attach", () => {
  assert.throws(() => preserveProductGalleryMetadata({ detailGalleryImageUrls: ["https://other.example/photo.jpg"] }), /상세 슬라이드 사진/);
  assert.deepEqual(preserveProductGalleryMetadata({ title: "상품", detailGalleryImageUrls: [] }), { title: "상품" });
});

test("regular product edits preserve the server's gallery without permitting replacement", () => {
  const current = { detailGalleryImageUrls: ["https://media.example/one.jpg", "https://media.example/two.jpg"] };
  assert.deepEqual(preserveProductGalleryMetadata({ title: "새 제목" }, current), { title: "새 제목", ...current });
  assert.deepEqual(preserveProductGalleryMetadata({ title: "새 제목", ...current }, current), { title: "새 제목", ...current });
  assert.throws(() => preserveProductGalleryMetadata({ detailGalleryImageUrls: ["https://media.example/two.jpg"] }, current), /상세 슬라이드 사진/);
  assert.throws(() => preserveProductGalleryMetadata({ detailGalleryImageUrls: [] }, current), /상세 슬라이드 사진/);
});
