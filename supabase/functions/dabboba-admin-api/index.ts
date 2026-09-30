import { createSupabaseEdgeApiHandler } from "./api.generated.js";

// Admin catalog-media uploads/complete need the same hosted WASM sanitizer as
// the customer function; without it the shared media runtime reports
// completion as unavailable.
type EdgeSanitizer = typeof import("../dabboba-api/image-sanitizer.ts").sanitizeEdgeImage;
let sanitizerPromise: Promise<EdgeSanitizer> | null = null;

async function sanitizeEdgeImage(
  input: Parameters<EdgeSanitizer>[0],
  detectedMimeType: Parameters<EdgeSanitizer>[1],
) {
  sanitizerPromise ??= import("../dabboba-api/image-sanitizer.ts").then((module) => module.sanitizeEdgeImage);
  return (await sanitizerPromise)(input, detectedMimeType);
}

const handler = createSupabaseEdgeApiHandler({
  surface: "admin",
  readEnvironment: () => Deno.env.toObject(),
  sanitizeImage: sanitizeEdgeImage,
});

Deno.serve(async (request, info) => handler(request, {
  remoteAddr: {
    hostname: "hostname" in info.remoteAddr ? info.remoteAddr.hostname : undefined,
  },
}));
