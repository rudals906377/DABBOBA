import { AppError } from "./errors.js";
import { configuredSupabaseMediaStorage } from "./media-storage-supabase.js";
import type { ApiMediaRuntime } from "./media-runtime.js";

export const edgeMediaRuntime: ApiMediaRuntime = {
  completionAvailable: false,
  configuredMediaStorage: configuredSupabaseMediaStorage,
  async sanitizeImage() {
    throw new AppError(503, "MEDIA_PROCESSING_UNAVAILABLE", "현재 첨부 파일 완료 처리를 사용할 수 없습니다.");
  },
};
