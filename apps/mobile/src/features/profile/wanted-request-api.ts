import { CryptoDigestAlgorithm, digest, randomUUID } from "expo-crypto";
import { fetch as fetchRawUpload } from "expo/fetch";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogIp, MediaUploadIntent, components } from "@dabboba/contracts";
import { createMobileDabbobaClient as createDabbobaClient } from "@/lib/mobile-api-client";

export type WantedRequest = components["schemas"]["WantedRequest"];
export type CreateWantedRequestInput = components["schemas"]["CreateWantedRequestInput"];

export type WantedRequestImage = {
  uri: string;
  filename: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function clientFor(apiBaseUrl: string, accessToken?: string) {
  return createDabbobaClient({
    baseUrl: apiBaseUrl,
    requestId: randomUUID,
    ...(accessToken ? { token: () => accessToken } : {}),
  });
}

export async function searchWantedIps(apiBaseUrl: string, query: string): Promise<CatalogIp[]> {
  const result = await clientFor(apiBaseUrl).GET("/v1/catalog/ips", {
    params: { query: { q: query.trim(), limit: 5 } },
  });
  if (!result.data) throw new Error(errorMessage(result.error, "작품 추천을 불러오지 못했어요."));
  return result.data.items;
}

export async function pickWantedRequestImage(): Promise<WantedRequestImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("사진을 첨부하려면 사진 보관함 접근을 허용해 주세요.");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  const normalized = await manipulateAsync(result.assets[0].uri, [], {
    compress: 0.9,
    format: SaveFormat.JPEG,
  });
  return {
    uri: normalized.uri,
    filename: `wanted-${randomUUID()}.jpg`,
    mimeType: "image/jpeg",
    width: normalized.width,
    height: normalized.height,
  };
}

export async function uploadWantedRequestImage(
  apiBaseUrl: string,
  accessToken: string,
  image: WantedRequestImage,
): Promise<string> {
  const localResponse = await fetchRawUpload(image.uri);
  if (!localResponse.ok) throw new Error("선택한 사진을 읽지 못했어요.");
  // Both transports must upload the same snapshot that supplies the size and checksum.
  // Clone before consuming: native Blob does not universally expose arrayBuffer().
  const multipartResponse = localResponse.clone();
  const bytes = await localResponse.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("사진은 10MB 이하만 첨부할 수 있어요.");
  }
  const checksumSha256 = toHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
  const client = clientFor(apiBaseUrl, accessToken);
  const intentResult = await client.POST("/v1/media/uploads", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: {
      purpose: "WANTED_REQUEST",
      filename: image.filename,
      mimeType: image.mimeType,
      byteSize: bytes.byteLength,
      checksumSha256,
      acceptedUploadMethods: ["POST", "PUT"],
    },
  });
  if (!intentResult.data) throw new Error(errorMessage(intentResult.error, "사진 업로드를 준비하지 못했어요."));
  const intent = intentResult.data;
  const upload = validateWantedImageUpload(intent, image.mimeType, bytes.byteLength, checksumSha256);
  let body: ArrayBuffer | FormData = bytes;
  if (intent.method === "POST") {
    body = new FormData();
    for (const [key, value] of Object.entries(intent.fields)) body.append(key, value);
    const blob = await multipartResponse.blob();
    const file = Object.assign(blob.slice(0, blob.size, image.mimeType), { name: image.filename });
    body.append(intent.fileFieldName, file);
  }
  // SDK 57's Expo transport needs a real Blob, not a URI-only React Native part.
  // Use the same explicit transport for POST and PUT so redirects remain forbidden.
  const uploaded = await fetchRawUpload(upload.url.toString(), {
    method: intent.method, body,
    ...(upload.headers ? { headers: upload.headers } : {}),
    credentials: "omit", redirect: "error",
  });
  if (!uploaded.ok || uploaded.redirected) throw new Error("사진을 업로드하지 못했어요. 다시 시도해 주세요.");
  const completed = await client.POST("/v1/media/{mediaId}/complete", {
    params: {
      path: { mediaId: intent.mediaId },
      header: { "Idempotency-Key": randomUUID() },
    },
  });
  if (!completed.data) throw new Error(errorMessage(completed.error, "사진 업로드를 완료하지 못했어요."));
  return completed.data.mediaId;
}

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateWantedImageUpload(
  intent: MediaUploadIntent,
  mimeType: string,
  byteSize: number,
  checksumSha256: string,
): { url: URL; headers?: Record<string, string> } {
  const invalid = () => new Error("사진 업로드 정책이 선택한 파일과 일치하지 않아요.");
  if (!intent || intent.maxBytes !== byteSize || !Number.isSafeInteger(intent.maxBytes)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intent.mediaId)) throw invalid();
  const expiresAt = Date.parse(intent.expiresAt);
  if (!Number.isFinite(expiresAt)) throw invalid();
  if (Date.now() >= expiresAt) {
    throw Object.assign(new Error("사진 업로드 주소가 만료됐어요. 다시 시도해 주세요."), { code: "MEDIA_UPLOAD_INTENT_EXPIRED" });
  }
  let url: URL;
  try { url = new URL(intent.uploadUrl); } catch { throw invalid(); }
  const localHttp = __DEV__ && url.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.hash) throw invalid();
  if (intent.method === "POST") {
    if (intent.fileFieldName !== "file" || !intent.fields || typeof intent.fields !== "object" || Array.isArray(intent.fields)
      || !Object.keys(intent.fields).length || Object.values(intent.fields).some((value) => typeof value !== "string")
      || "headers" in intent || "bodyEncoding" in intent) throw invalid();
    return { url };
  }
  if (intent.method !== "PUT" || intent.bodyEncoding !== "raw" || "fields" in intent || "fileFieldName" in intent
    || !intent.headers || typeof intent.headers !== "object" || Array.isArray(intent.headers)) throw invalid();
  const expected: Record<string, string> = {
    "content-type": mimeType,
    "content-length": String(byteSize),
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-meta-sha256": checksumSha256,
    "x-amz-meta-media-id": intent.mediaId,
  };
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(intent.headers)) {
    const lower = name.toLowerCase();
    if (!Object.hasOwn(expected, lower) || seen.has(lower) || value !== expected[lower]) throw invalid();
    seen.add(lower);
    // The raw ArrayBuffer fixes Content-Length; browser/native networking supplies this signed header.
    if (lower !== "content-length") headers[lower] = value;
  }
  if (seen.size !== Object.keys(expected).length) throw invalid();
  return { url, headers };
}

export async function createWantedRequest(
  apiBaseUrl: string,
  accessToken: string,
  input: CreateWantedRequestInput,
): Promise<WantedRequest> {
  const client = clientFor(apiBaseUrl, accessToken);
  const result = await client.POST("/v1/wanted-requests", {
    params: { header: { "Idempotency-Key": randomUUID() } },
    body: input,
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "신청을 등록하지 못했어요."));
  }
  return result.data;
}
