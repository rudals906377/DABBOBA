import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { ImageMagick } from "@imagemagick/magick-wasm";
import { Buffer } from "node:buffer";
import { sanitizeEdgeImage } from "./image-sanitizer.ts";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

Deno.test("Edge sanitizer decodes, strips, and emits bounded WebP bytes", async () => {
  const result = await sanitizeEdgeImage(ONE_PIXEL_PNG, "image/png");
  assertEquals(result.mimeType, "image/webp");
  assertEquals(result.width, 1);
  assertEquals(result.height, 1);
  assertEquals(result.byteSize, result.data.length);
  assertEquals(result.checksumSha256.length, 64);
  assert(result.data.length > 0);
  ImageMagick.read(result.data, (image) => {
    assertEquals(image.width, 1);
    assertEquals(image.height, 1);
    assertEquals(image.format, "WEBP");
    assertEquals(image.profileNames.length, 0);
  });
});

Deno.test("Edge sanitizer rejects decoder and declared MIME disagreement", async () => {
  await assertRejects(() => sanitizeEdgeImage(ONE_PIXEL_PNG, "image/jpeg"));
  await assertRejects(() => sanitizeEdgeImage(Buffer.from("not-an-image"), "image/png"));
});
