import { createSupabaseEdgeApiHandler } from "./api.generated.js";

type EdgeSanitizer = typeof import("./image-sanitizer.ts").sanitizeEdgeImage;
let sanitizerPromise: Promise<EdgeSanitizer> | null = null;

async function sanitizeEdgeImage(
  input: Parameters<EdgeSanitizer>[0],
  detectedMimeType: Parameters<EdgeSanitizer>[1],
) {
  sanitizerPromise ??= import("./image-sanitizer.ts").then((module) => module.sanitizeEdgeImage);
  return (await sanitizerPromise)(input, detectedMimeType);
}

const handler = createSupabaseEdgeApiHandler({
  readEnvironment: () => Deno.env.toObject(),
  sanitizeImage: sanitizeEdgeImage,
});

Deno.serve(async (request, info) => {
  const response = await handler(request, {
    remoteAddr: {
      hostname: "hostname" in info.remoteAddr ? info.remoteAddr.hostname : undefined,
    },
  });
  return response instanceof Response
    ? response
    : new Response('{"error":{"code":"API_UNAVAILABLE","message":"요청을 처리할 수 없습니다."}}', {
        status: 503,
        headers: { "cache-control": "no-store", "content-type": "application/json;charset=utf-8" },
      });
});
