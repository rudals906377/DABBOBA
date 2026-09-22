import { storedMediaLocation } from "@dabboba/config";
import { SupabaseMediaStorage } from "@dabboba/media-storage";
import {
  IdempotencyStrategy,
  Storage,
  type StorageOptions,
} from "@google-cloud/storage";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { DisabledMediaStore, type MediaStore } from "./media.js";

export const GCS_REQUEST_TIMEOUT_MS = 10_000;
export const GCS_RETRY_OPTIONS: Readonly<NonNullable<StorageOptions["retryOptions"]>> = Object.freeze({
  autoRetry: true,
  maxRetries: 2,
  retryDelayMultiplier: 2,
  maxRetryDelay: 5,
  totalTimeout: 20,
  // Cleanup deletion is state-idempotent because a retry treats an already
  // removed object as success through ignoreNotFound below.
  idempotencyStrategy: IdempotencyStrategy.RetryAlways,
});
export const GCS_DELETE_OPTIONS = Object.freeze({ ignoreNotFound: true });

export function gcsStorageOptions(projectId: string | null): StorageOptions {
  return {
    ...(projectId ? { projectId } : {}),
    timeout: GCS_REQUEST_TIMEOUT_MS,
    retryOptions: GCS_RETRY_OPTIONS,
  };
}

export class GcsMediaStore implements MediaStore {
  private readonly storage: Storage;

  constructor(private readonly bucketName: string, projectId: string | null) {
    this.storage = new Storage(gcsStorageOptions(projectId));
  }

  async deleteObject(objectKey: string): Promise<"deleted"> {
    await this.storage.bucket(this.bucketName).file(objectKey).delete(GCS_DELETE_OPTIONS);
    return "deleted";
  }
}

/** Mixed-provider rows must remain deletable during rollout and rollback. */
export class RoutedMediaStore implements MediaStore {
  private readonly gcs: GcsMediaStore | null;
  private readonly supabase: SupabaseMediaStorage | null;
  private readonly disabled: DisabledMediaStore;

  constructor(private readonly config: WorkerConfig, logger: Logger) {
    this.gcs = config.gcsBucket ? new GcsMediaStore(config.gcsBucket, config.gcsProjectId) : null;
    this.supabase = config.supabaseStorage ? new SupabaseMediaStorage(config.supabaseStorage) : null;
    this.disabled = new DisabledMediaStore(logger);
  }

  async deleteObject(objectKey: string, metadata: unknown = {}): Promise<"deleted" | "skipped"> {
    const location = storedMediaLocation(metadata);
    if (location.provider === "supabase") {
      if (!this.supabase || location.bucket !== this.config.supabaseStorage?.bucket) {
        return this.disabled.deleteObject(objectKey);
      }
      await this.supabase.deleteObject(objectKey);
      return "deleted";
    }
    if (!this.gcs || (location.bucket !== null && location.bucket !== this.config.gcsBucket)) {
      return this.disabled.deleteObject(objectKey);
    }
    return this.gcs.deleteObject(objectKey);
  }
}

export function createRoutedMediaStore(config: WorkerConfig, logger: Logger): MediaStore {
  return new RoutedMediaStore(config, logger);
}
