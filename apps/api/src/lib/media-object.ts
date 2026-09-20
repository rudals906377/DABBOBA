export type MediaObjectInfo = {
  version: string;
  size: number;
  contentType: string;
  metadata: Record<string, unknown>;
};

export type MediaObject = {
  name: string;
  info(): Promise<MediaObjectInfo>;
  read(version: string): AsyncIterable<Uint8Array>;
  delete(): Promise<void>;
};

export function validMediaObjectVersion(provider: "gcs" | "supabase", version: string): boolean {
  return provider === "gcs"
    ? /^\d+$/.test(version)
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(version);
}
