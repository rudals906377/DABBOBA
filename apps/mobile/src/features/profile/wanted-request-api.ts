import { CryptoDigestAlgorithm, digest, randomUUID } from "expo-crypto";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { errorMessage } from "@dabboba/api-client";
import type { CatalogIp, components } from "@dabboba/contracts";
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
  if (!result.data) throw new Error(errorMessage(result.error, "작품 추천을 불러오지 못했습니다."));
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
  const localResponse = await fetch(image.uri);
  if (!localResponse.ok) throw new Error("선택한 사진을 읽지 못했습니다.");
  const bytes = await localResponse.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("사진은 10MB 이하만 첨부할 수 있습니다.");
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
    },
  });
  if (!intentResult.data) throw new Error(errorMessage(intentResult.error, "사진 업로드를 준비하지 못했습니다."));
  const intent = intentResult.data;
  const form = new FormData();
  for (const [key, value] of Object.entries(intent.fields)) form.append(key, value);
  form.append(intent.fileFieldName, {
    uri: image.uri,
    name: image.filename,
    type: image.mimeType,
  } as unknown as Blob);
  const uploaded = await fetch(intent.uploadUrl, { method: "POST", body: form });
  if (!uploaded.ok) throw new Error("사진을 업로드하지 못했습니다. 다시 시도해 주세요.");
  const completed = await client.POST("/v1/media/{mediaId}/complete", {
    params: {
      path: { mediaId: intent.mediaId },
      header: { "Idempotency-Key": randomUUID() },
    },
  });
  if (!completed.data) throw new Error(errorMessage(completed.error, "사진 업로드를 완료하지 못했습니다."));
  return completed.data.mediaId;
}

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    throw new Error(errorMessage(result.error, "신청을 등록하지 못했습니다."));
  }
  return result.data;
}
