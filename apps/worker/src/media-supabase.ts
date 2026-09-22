import { storedMediaLocation } from "@dabboba/config";
import { SupabaseMediaStorage } from "@dabboba/media-storage";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { DisabledMediaStore, type MediaStore } from "./media.js";

/** Edge-safe media routing: no Google library or fallback is reachable from this module. */
export class SupabaseOnlyMediaStore implements MediaStore {
  readonly #storage: SupabaseMediaStorage;
  readonly #disabled: DisabledMediaStore;
  readonly #bucket: string;

  constructor(config: WorkerConfig, logger: Logger) {
    if (config.gcsBucket || config.gcsProjectId || config.mediaStorageProvider !== "supabase" || !config.supabaseStorage) {
      throw new Error("Supabase Edge worker requires complete Supabase-only media storage configuration");
    }
    this.#storage = new SupabaseMediaStorage(config.supabaseStorage);
    this.#bucket = config.supabaseStorage.bucket;
    this.#disabled = new DisabledMediaStore(logger);
  }

  async deleteObject(objectKey: string, metadata: unknown = {}): Promise<"deleted" | "skipped"> {
    const location = storedMediaLocation(metadata);
    if (location.provider !== "supabase" || location.bucket !== this.#bucket) {
      return this.#disabled.deleteObject(objectKey);
    }
    await this.#storage.deleteObject(objectKey);
    return "deleted";
  }
}

export function createSupabaseOnlyMediaStore(config: WorkerConfig, logger: Logger): MediaStore {
  return new SupabaseOnlyMediaStore(config, logger);
}
