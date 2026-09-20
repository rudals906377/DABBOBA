import { configuredMediaStorage } from "./media-storage.js";
import { sanitizeImage } from "./image-sanitizer-node.js";
import type { ApiMediaRuntime } from "./media-runtime.js";

export const nodeMediaRuntime: ApiMediaRuntime = {
  completionAvailable: true,
  configuredMediaStorage,
  sanitizeImage,
};
