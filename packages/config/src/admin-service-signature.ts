import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SERVICE_HEADERS = {
  timestamp: "x-dabboba-admin-service-timestamp",
  signature: "x-dabboba-admin-service-signature",
} as const;

type AdminServiceRequest = {
  secret: string;
  method: string;
  path: string;
  requestId: string;
  authorization: string | null;
  reason: string | null;
  reasonEncoding: string | null;
  contentType: string | null;
  body: Uint8Array | string | null;
  nowMs?: number;
};

function payload(input: AdminServiceRequest, timestamp: number): string {
  const bodyHash = createHash("sha256").update(input.body ?? "").digest("hex");
  return [
    "dabboba-admin-service-v1",
    input.method.toUpperCase(),
    input.path,
    timestamp,
    input.requestId,
    input.authorization ?? "",
    input.reason ?? "",
    input.reasonEncoding ?? "",
    input.contentType ?? "",
    bodyHash,
  ].join("\n");
}

export function signAdminServiceRequest(input: AdminServiceRequest): Record<string, string> {
  const timestamp = Math.floor((input.nowMs ?? Date.now()) / 1000);
  return {
    [ADMIN_SERVICE_HEADERS.timestamp]: String(timestamp),
    [ADMIN_SERVICE_HEADERS.signature]: createHmac("sha256", input.secret).update(payload(input, timestamp)).digest("base64url"),
  };
}

export function verifyAdminServiceRequest(input: AdminServiceRequest & { timestamp: string | null; signature: string | null }): boolean {
  if (!/^\d{10}$/.test(input.timestamp ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(input.signature ?? "")) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(input.requestId)) return false;
  const timestamp = Number(input.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor((input.nowMs ?? Date.now()) / 1000) - timestamp) > 60) return false;
  const expected = createHmac("sha256", input.secret).update(payload(input, timestamp)).digest("base64url");
  const suppliedBytes = Buffer.from(input.signature!, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}
