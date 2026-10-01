import { createHash } from "node:crypto";
import { S3RequestPresigner } from "@aws-sdk/s3-request-presigner";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";

export type SupabaseMediaStorageConfig = {
  url: string;
  serviceKey: string;
  bucket: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  allowLocalHttp?: boolean;
};

export type MediaObjectStat = {
  version: string;
  size: number;
  contentType: string;
  metadata: Record<string, string>;
};

export type MediaUploadInput = {
  key: string;
  mediaId: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  expiresAt: Date;
};

export type MediaRawUpload = {
  uploadUrl: string;
  method: "PUT";
  bodyEncoding: "raw";
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
};

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const STORAGE_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_UPLOAD_LIFETIME_SECONDS = 120;
const MAX_JSON_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const SIGNED_UPLOAD_HEADERS = [
  "content-length", "content-type", "x-amz-content-sha256", "x-amz-meta-media-id", "x-amz-meta-sha256",
] as const;

type ErrorCode = "INVALID_INPUT" | "INVALID_RESPONSE" | "REQUEST_FAILED" | "OBJECT_MISMATCH";

/** Safe for application logging: never retains a provider body, URL, key, or cause. */
export class MediaStorageError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number | undefined;

  constructor(code: ErrorCode, statusCode?: number) {
    super(`Media storage ${code.toLowerCase().replaceAll("_", " ")}.`);
    this.name = "MediaStorageError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function requireValue(condition: unknown, code: ErrorCode = "INVALID_INPUT"): asserts condition {
  if (!condition) throw new MediaStorageError(code);
}

function safeUrl(raw: string, allowLocalHttp: boolean): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new MediaStorageError("INVALID_INPUT"); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  requireValue(url.protocol === "https:" || (allowLocalHttp && local && url.protocol === "http:"));
  requireValue(!url.username && !url.password && !url.search && !url.hash);
  requireValue(raw === url.toString() || raw === url.toString().replace(/\/$/, ""));
  return url;
}

function validKey(key: string): string {
  requireValue(typeof key === "string" && key.length > 0 && Buffer.byteLength(key) <= 1024);
  requireValue(/^[A-Za-z0-9._/-]+$/.test(key));
  requireValue(key.split("/").every((part) => part !== "" && part !== "." && part !== ".."));
  return key;
}

function validVersion(value: string): string {
  requireValue(typeof value === "string" && UUID.test(value));
  return value;
}

function validIdentity(mediaId: string, checksumSha256: string): void {
  requireValue(typeof mediaId === "string" && UUID.test(mediaId));
  requireValue(typeof checksumSha256 === "string" && SHA256.test(checksumSha256));
}

function validSize(size: number): boolean {
  return Number.isSafeInteger(size) && size >= 1 && size <= MAX_MEDIA_BYTES;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function noStore(value: unknown): boolean {
  return typeof value === "string" && value.split(",").some((part) => part.trim().toLowerCase() === "no-store");
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const length = response.headers.get("content-length");
  requireValue(length === null || (/^[0-9]+$/.test(length) && Number(length) <= limit), "INVALID_RESPONSE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      requireValue(size <= limit, "INVALID_RESPONSE");
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks, size);
}

/** Server-only adapter. No implicit environment lookup, redirects, retries, or provider logging. */
export class SupabaseMediaStorage {
  readonly #base: URL;
  readonly #endpoint: URL;
  readonly #bucket: string;
  readonly #serviceKey: string;
  readonly #presigner: S3RequestPresigner;

  constructor(config: SupabaseMediaStorageConfig) {
    requireValue(record(config));
    const allowLocalHttp = config.allowLocalHttp === true;
    this.#base = safeUrl(config.url, allowLocalHttp);
    this.#endpoint = safeUrl(config.s3Endpoint, allowLocalHttp);
    requireValue(this.#base.pathname === "/");
    requireValue(this.#endpoint.pathname === "/storage/v1/s3");
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(this.#base.hostname);
    if (allowLocalHttp && local && this.#base.protocol === "http:") {
      requireValue(this.#endpoint.origin === this.#base.origin);
    } else {
      const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(this.#base.hostname);
      requireValue(match && this.#base.protocol === "https:" && !this.#base.port);
      requireValue(this.#endpoint.protocol === "https:" && !this.#endpoint.port);
      requireValue([this.#base.hostname, `${match[1]}.storage.supabase.co`].includes(this.#endpoint.hostname));
    }
    requireValue(typeof config.bucket === "string" && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(config.bucket));
    requireValue(typeof config.s3Region === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(config.s3Region));
    requireValue(typeof config.serviceKey === "string" && /^[\x21-\x7e]{20,4096}$/.test(config.serviceKey));
    requireValue(typeof config.s3AccessKeyId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(config.s3AccessKeyId));
    requireValue(typeof config.s3SecretAccessKey === "string" && /^[\x21-\x7e]{16,512}$/.test(config.s3SecretAccessKey));
    this.#bucket = config.bucket;
    this.#serviceKey = config.serviceKey;
    this.#presigner = new S3RequestPresigner({
      region: config.s3Region,
      credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey },
      sha256: Hash.bind(null, "sha256"),
    });
  }

  async createUpload(input: MediaUploadInput): Promise<MediaRawUpload> {
    validKey(input.key);
    validIdentity(input.mediaId, input.checksumSha256);
    requireValue(MIME_TYPES.has(input.mimeType) && validSize(input.byteSize));
    requireValue(input.expiresAt instanceof Date && Number.isFinite(input.expiresAt.getTime()));
    const now = Date.now();
    const signingDate = new Date(Math.floor(now / 1000) * 1000);
    const expiresIn = Math.min(MAX_UPLOAD_LIFETIME_SECONDS,
      Math.floor((input.expiresAt.getTime() - signingDate.getTime()) / 1000));
    requireValue(input.expiresAt.getTime() > now && expiresIn >= 1);
    const headers: Record<string, string> = {
      "content-type": input.mimeType,
      "content-length": String(input.byteSize),
      "x-amz-meta-sha256": input.checksumSha256,
      "x-amz-meta-media-id": input.mediaId,
    };
    const target = new URL(this.#endpoint);
    target.pathname += `/${this.#bucket}/${input.key.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const request = new HttpRequest({
        protocol: target.protocol, hostname: target.hostname,
        ...(target.port ? { port: Number(target.port) } : {}),
        path: target.pathname, method: "PUT", headers,
      });
      const signed = await this.#presigner.presign(request, {
        signingDate, expiresIn,
        // S3RequestPresigner normally excludes content-type; explicitly sign it.
        signableHeaders: new Set(SIGNED_UPLOAD_HEADERS),
        unhoistableHeaders: new Set(SIGNED_UPLOAD_HEADERS),
      });
      requireValue(signed.query?.["X-Amz-SignedHeaders"] === [...SIGNED_UPLOAD_HEADERS, "host"].sort().join(";"), "INVALID_RESPONSE");
      for (const [name, value] of Object.entries(signed.query ?? {})) {
        requireValue(typeof value === "string", "INVALID_RESPONSE");
        target.searchParams.set(name, value);
      }
      return {
        uploadUrl: target.toString(), method: "PUT", bodyEncoding: "raw",
        headers: Object.fromEntries(SIGNED_UPLOAD_HEADERS.map((name) => [name,
          name === "x-amz-content-sha256" ? "UNSIGNED-PAYLOAD" : headers[name]!])),
        expiresAt: new Date(signingDate.getTime() + expiresIn * 1000).toISOString(),
        maxBytes: input.byteSize,
      };
    } catch (error) { throw this.#safeError(error); }
  }

  async stat(key: string): Promise<MediaObjectStat> {
    return (await this.#info(key)).stat;
  }

  async *read(key: string, version: string): AsyncIterable<Uint8Array> {
    validKey(key);
    validVersion(version);
    const { stat } = await this.#info(key, version);
    const opened = await this.#open(this.#path("authenticated", key, version), { method: "GET" });
    try {
      requireValue(opened.response.headers.get("content-type") === stat.contentType, "OBJECT_MISMATCH");
      const length = opened.response.headers.get("content-length");
      requireValue(length === null || length === String(stat.size), "OBJECT_MISMATCH");
      let size = 0;
      requireValue(opened.response.body, "INVALID_RESPONSE");
      for await (const chunk of opened.response.body) {
        size += chunk.byteLength;
        requireValue(size <= stat.size && size <= MAX_MEDIA_BYTES, "OBJECT_MISMATCH");
        yield chunk;
      }
      requireValue(size === stat.size, "OBJECT_MISMATCH");
    } catch (error) { throw this.#safeError(error); }
    finally { opened.close(); }
  }

  async writeFinal(key: string, data: Buffer, input: { mediaId: string; checksumSha256: string }): Promise<MediaObjectStat> {
    validKey(key);
    validIdentity(input.mediaId, input.checksumSha256);
    requireValue(Buffer.isBuffer(data) && validSize(data.length));
    requireValue(createHash("sha256").update(data).digest("hex") === input.checksumSha256);
    // The caller supplies a fresh claim UUID. x-upsert:false is not an atomic-create guarantee.
    const prefix = `media/${input.mediaId}/${input.checksumSha256}-`;
    requireValue(key.startsWith(prefix) && key.endsWith(".webp") && UUID.test(key.slice(prefix.length, -5)));
    let uploadError: MediaStorageError | undefined;
    try {
      await this.#json(this.#path("", key), {
        method: "POST", body: new Uint8Array(data),
        headers: {
          "content-type": "image/webp", "content-length": String(data.length),
          "cache-control": "no-store", "x-upsert": "false",
          "x-metadata": Buffer.from(JSON.stringify({ sha256: input.checksumSha256, "media-id": input.mediaId, sanitized: "true" })).toString("base64"),
        },
      });
    } catch (error) { uploadError = this.#safeError(error); }
    // A timeout can follow a committed upload. Only exact bytes at this claim's
    // unique key can resolve that uncertainty; metadata alone is never proof.
    try {
      const { stat, cacheControl } = await this.#info(key);
      requireValue(stat.size === data.length && stat.contentType === "image/webp" && noStore(cacheControl)
        && stat.metadata.sha256 === input.checksumSha256 && stat.metadata["media-id"] === input.mediaId
        && stat.metadata.sanitized === "true", "OBJECT_MISMATCH");
      const hash = createHash("sha256");
      for await (const bytes of this.read(key, stat.version)) hash.update(bytes);
      requireValue(hash.digest("hex") === input.checksumSha256, "OBJECT_MISMATCH");
      const verified = await this.#info(key, stat.version);
      requireValue(JSON.stringify(verified.stat) === JSON.stringify(stat) && noStore(verified.cacheControl), "OBJECT_MISMATCH");
      return stat;
    } catch (error) { throw uploadError ?? this.#safeError(error); }
  }

  async signedRead(key: string, version: string, expiresIn: number): Promise<string> {
    validKey(key);
    validVersion(version);
    requireValue(Number.isSafeInteger(expiresIn) && expiresIn >= 1 && expiresIn <= 300);
    const info = await this.#info(key, version);
    requireValue(noStore(info.cacheControl), "OBJECT_MISMATCH");
    const body = await this.#json(this.#path("sign", key), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn, versionId: version }),
    });
    requireValue(record(body) && typeof body.signedURL === "string" && body.signedURL.length <= 16_384, "INVALID_RESPONSE");
    const expected = `/object/sign/${this.#bucket}/${key}`;
    requireValue(body.signedURL.startsWith(`${expected}?`), "INVALID_RESPONSE");
    let result: URL;
    try { result = new URL(`/storage/v1${body.signedURL}`, this.#base); }
    catch { throw new MediaStorageError("INVALID_RESPONSE"); }
    requireValue(result.origin === this.#base.origin && result.pathname === `/storage/v1${expected}` && !result.hash, "INVALID_RESPONSE");
    const params = [...result.searchParams.entries()];
    requireValue(params.length === 1 && params[0]?.[0] === "token" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(params[0][1]), "INVALID_RESPONSE");
    return result.toString();
  }

  /**
   * Edge runtimes can issue a short-lived, exact-object S3 URL without making
   * an authenticated Storage REST round trip from inside the same project.
   */
  async signedS3Read(key: string, version: string, expiresIn: number): Promise<string> {
    validKey(key);
    validVersion(version);
    requireValue(Number.isInteger(expiresIn) && expiresIn >= 1 && expiresIn <= 300);
    const target = new URL(this.#endpoint);
    target.pathname += `/${this.#bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const request = new HttpRequest({
        protocol: target.protocol,
        hostname: target.hostname,
        ...(target.port ? { port: Number(target.port) } : {}),
        path: target.pathname,
        method: "GET",
        headers: { host: target.host },
        query: { versionId: version },
      });
      const signed = await this.#presigner.presign(request, { expiresIn });
      for (const [name, value] of Object.entries(signed.query ?? {})) {
        requireValue(typeof value === "string", "INVALID_RESPONSE");
        target.searchParams.set(name, value);
      }
      requireValue(target.searchParams.get("versionId") === version, "INVALID_RESPONSE");
      requireValue(target.searchParams.get("X-Amz-Expires") === String(expiresIn), "INVALID_RESPONSE");
      requireValue(Boolean(target.searchParams.get("X-Amz-Signature")), "INVALID_RESPONSE");
      return target.toString();
    } catch (error) { throw this.#safeError(error); }
  }

  async deleteObject(key: string): Promise<void> {
    const opened = await this.#open(this.#path("", validKey(key)), { method: "DELETE" }, true);
    try {
      const body = await boundedBody(opened.response, MAX_JSON_BYTES);
      // Storage v1.73.0 reports an absent physical object as 400 NoSuchKey.
      // Do not turn other 400 responses (authorization/configuration) into success.
      if ([400, 404].includes(opened.response.status)) {
        let parsed: unknown;
        try { parsed = JSON.parse(body.toString("utf8")) as unknown; } catch { /* rejected below */ }
        requireValue(record(parsed) && parsed.code === "NoSuchKey", "REQUEST_FAILED");
      }
    }
    catch (error) { throw this.#safeError(error); }
    finally { opened.close(); }
  }

  #path(operation: string, key: string, version?: string): string {
    const path = `/storage/v1/object/${operation ? `${operation}/` : ""}${this.#bucket}/${validKey(key).split("/").map(encodeURIComponent).join("/")}`;
    return version === undefined ? path : `${path}?versionId=${encodeURIComponent(validVersion(version))}`;
  }

  async #info(key: string, version?: string): Promise<{ stat: MediaObjectStat; cacheControl: unknown }> {
    const body = await this.#json(this.#path("info/authenticated", key, version), { method: "GET" });
    requireValue(record(body) && body.name === key && body.bucket_id === this.#bucket, "INVALID_RESPONSE");
    requireValue(typeof body.version === "string" && UUID.test(body.version) && (!version || body.version === version), "OBJECT_MISMATCH");
    requireValue(typeof body.size === "number" && validSize(body.size)
      && typeof body.content_type === "string" && MIME_TYPES.has(body.content_type), "INVALID_RESPONSE");
    const custom = body.metadata ?? {};
    requireValue(record(custom) && Object.keys(custom).length <= 32, "INVALID_RESPONSE");
    const metadata: Record<string, string> = {};
    for (const [name, value] of Object.entries(custom).sort(([left], [right]) => left.localeCompare(right))) {
      requireValue(/^[A-Za-z0-9_-]{1,64}$/.test(name) && typeof value === "string" && /^[\x20-\x7e]{0,1024}$/.test(value), "INVALID_RESPONSE");
      metadata[name] = value;
    }
    return { stat: { version: body.version, size: body.size, contentType: body.content_type, metadata }, cacheControl: body.cache_control };
  }

  async #json(path: string, init: RequestInit): Promise<unknown> {
    const opened = await this.#open(path, init);
    try { return JSON.parse((await boundedBody(opened.response, MAX_JSON_BYTES)).toString("utf8")) as unknown; }
    catch (error) { throw this.#safeError(error, "INVALID_RESPONSE"); }
    finally { opened.close(); }
  }

  async #open(path: string, init: RequestInit, ignoreMissing = false): Promise<{ response: Response; close(): void }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STORAGE_REQUEST_TIMEOUT_MS);
    // Node timers have unref(); Web/Edge runtimes return a numeric handle.
    timer.unref?.();
    const close = () => { clearTimeout(timer); controller.abort(); };
    try {
      const response = await fetch(new URL(path, this.#base), {
        ...init, redirect: "error", cache: "no-store", signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.#serviceKey}`, apikey: this.#serviceKey,
          accept: "application/json", "accept-encoding": "identity", "cache-control": "no-store",
          ...init.headers,
        },
      });
      if (!response.ok && !(ignoreMissing && [400, 404].includes(response.status))) throw new MediaStorageError("REQUEST_FAILED", response.status);
      const encoding = response.headers.get("content-encoding");
      requireValue(encoding === null || encoding === "identity", "INVALID_RESPONSE");
      return { response, close };
    } catch (error) { close(); throw this.#safeError(error); }
  }

  #safeError(error: unknown, code: ErrorCode = "REQUEST_FAILED"): MediaStorageError {
    return error instanceof MediaStorageError ? error : new MediaStorageError(code);
  }
}
